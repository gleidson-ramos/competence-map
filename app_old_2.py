import os
import re
import time
from flask import Flask, request, jsonify, render_template
import psycopg
from psycopg.rows import dict_row

from langchain_postgres import PGVector
from langchain_openai import OpenAIEmbeddings

from utils.text import normalize_text
from taxonomy import TAXONOMY
from config import OPENAI_API_KEY, DB_CONN_VECTOR


COLLECTIONS = {
    "Pesquisador": "researcher",
    "Grupo de Pesquisa": "groups",
    "Empresa": "companies"
}

TOP_K = 50

STOPWORDS = {"de", "da", "do", "das", "dos", "em", "para", "por", "com", "a", "o", "as", "os", "e", "ou"}

app = Flask(__name__)

embeddings = OpenAIEmbeddings(openai_api_key=OPENAI_API_KEY)
VECTOR_STORES = {}
DOCUMENT_NGRAM_CACHE = {}


def get_research_projects_by_researcher_names(researcher_names):
    """
    Busca projetos associados aos pesquisadores pelo nome.
    Use DB_CONN_RESEARCH para configurar a conexão com o banco dos dados
    acadêmicos; se não estiver definida, utiliza DB_CONN_VECTOR.
    """
    names = sorted({
        str(name).strip()
        for name in researcher_names
        if name and str(name).strip()
    })

    if not names:
        return {}

    connection_string = os.getenv("DB_CONN_RESEARCH", DB_CONN_VECTOR)
    # Compatibilidade com URLs SQLAlchemy usadas pelo LangChain/PGVector.
    connection_string = connection_string.replace(
        "postgresql+psycopg://", "postgresql://", 1
    )

    normalized_names = [name.casefold() for name in names]
    projects_by_researcher = {name.casefold(): [] for name in names}

    sql = """
        SELECT DISTINCT
            r.name AS researcher_name,
            rp.project_name AS project_name,
            rp.description AS description,
            rp.start_year AS start_year,
            rp.end_year AS end_year,
            rp.status AS status
        FROM researcher AS r
        INNER JOIN research_project AS rp
            ON rp.researcher_id = r.id
        WHERE lower(trim(r.name)) = ANY(%s)
        ORDER BY r.name, rp.start_year NULLS LAST, rp.project_name
    """

    try:
        with psycopg.connect(connection_string, row_factory=dict_row) as conn:
            with conn.cursor() as cursor:
                cursor.execute(sql, (normalized_names,))
                for row in cursor.fetchall():
                    key = row["researcher_name"].strip().casefold()
                    projects_by_researcher.setdefault(key, []).append({
                        "project_name": row["project_name"],
                        "description": row["description"],
                        "start_year": row["start_year"],
                        "end_year": row["end_year"],
                        "status": row["status"],
                    })
    except Exception as e:
        app.logger.exception("Erro ao consultar projetos de pesquisa: %s", e)
        # Mantém a busca principal disponível caso a consulta de projetos falhe.
        return {}

    return projects_by_researcher


def get_vector_store(collection_name):
    if collection_name not in VECTOR_STORES:
        VECTOR_STORES[collection_name] = PGVector(
            connection=DB_CONN_VECTOR, collection_name=collection_name,
            embeddings=embeddings, distance_strategy="cosine"
        )
        print(f"Coleção carregada: {collection_name}")

    return VECTOR_STORES[collection_name]


#N-Grams
def generate_ngrams(text, n_min=1, n_max=3):
    if not text:
        return set()

    tokens = [
        t for t in normalize_text(text).split()
        if t and t not in STOPWORDS
    ]

    ngrams = set()

    for n in range(n_min, n_max + 1):
        for i in range(len(tokens) - n + 1):
            ngrams.add(" ".join(tokens[i:i + n]))

    return ngrams


def lexical_and_coverage(query_ngrams, document_ngrams):
    if not query_ngrams:
        return 0, 0, []

    intersection = query_ngrams & document_ngrams

    coverage = len(intersection) / len(query_ngrams)
    lexical = coverage * 100

    return lexical, coverage, list(intersection)


#Lista de conhecimentos
def build_knowledge_list(doc):
    sources = [
        doc.metadata.get("subarea"), doc.metadata.get("specialty"),
        doc.metadata.get("titulos_linhas"), doc.metadata.get("knowledge"),
    ]

    seen = set()
    result = []

    for s in sources:
        if not s:
            continue

        for part in str(s).split("|"):
            n = normalize_text(part)

            if n and n not in seen:
                seen.add(n)
                result.append(part.strip())

    return " | ".join(result)


def build_searchable_text(doc):
    fields = [
        doc.page_content,

        doc.metadata.get("knowledge"),
        doc.metadata.get("subarea"),
        doc.metadata.get("specialty"),
        doc.metadata.get("titulos_linhas"),
        doc.metadata.get("area"),
        doc.metadata.get("great_area"),

        doc.metadata.get("segment_original"),
        doc.metadata.get("subsegment_original"),

        doc.metadata.get("institutional_description"),

        doc.metadata.get("mission"),
        doc.metadata.get("vision"),
        doc.metadata.get("values"),
    ]

    return normalize_text(
        " ".join(str(f) for f in fields if f)
    )

#Threshold semântico
def get_semantic_threshold(token_count):
    """
    Quanto mais tokens, mais específica é a query e mais exigente pode ser o threshold.
    Queries curtas (1 token) são genéricas: threshold baixo para não perder resultados.
    Queries longas (5+) são específicas: threshold mais alto para garantir precisão.
    """
    if token_count <= 1:
        return 0.25
    elif token_count <= 2:
        return 0.32
    elif token_count <= 4:
        return 0.38
    else:
        return 0.45



#Busca híbrida
def hybrid_search_engine(query, collection_name, min_score,
                         use_taxonomy_boost=True,
                         search_mode="hybrid"):
    try:
        store = get_vector_store(collection_name)

        q = normalize_text(query)
        if not q:
            return []

        tokens = q.split()

        query_ngrams = generate_ngrams(q)

        query_phrases = generate_ngrams(q, n_min=2, n_max=3)

        enriched = f"Área de pesquisa: {q}"

        results = store.similarity_search_with_score(enriched, k=TOP_K)

        output = []
        threshold = get_semantic_threshold(len(tokens))

        for doc, dist in results:
            print("Distância:", dist)
            print(doc.page_content[:100])

            dist = float(dist)

            if dist > threshold:
                continue
            
            semantic = 1 - dist
            doc_text = build_searchable_text(doc)

            doc_id = (
                doc.metadata.get("id")
                or doc.metadata.get("entity_name")
                or hash(doc_text)
            )

            if doc_id not in DOCUMENT_NGRAM_CACHE:
                DOCUMENT_NGRAM_CACHE[doc_id] = generate_ngrams(doc_text)

            doc_ngrams = DOCUMENT_NGRAM_CACHE[doc_id]

            lexical_raw, _, matched = lexical_and_coverage(query_ngrams, doc_ngrams)

            lexical = lexical_raw / 100

            # exact como contagem normalizada de frases encontradas
            exact_count = sum(
                1 for phrase in query_phrases
                if re.search(r'\b' + re.escape(phrase) + r'\b', doc_text)
            )
            exact = min(exact_count / max(len(query_phrases), 1), 1.0)

            taxonomy = (
                min(1.0, doc.metadata.get("taxonomy_score", 0))
                if use_taxonomy_boost else 0.0
            )

            if search_mode == "semantic":
                score = semantic
            elif search_mode == "lexical":
                score = lexical
            else:
                # Scoring aditivo: pesos somam 1.0, score naturalmente em [0, 1]
                # taxonomy como sinal leve de desempate (0.02), sem dupla contagem com semântico
                score = (0.65 * semantic) + (0.25 * lexical) + (0.08 * exact) + (0.02 * taxonomy)

            score = max(0.0, min(1.0, score))
            score = score * 100

            if score < min_score:
                continue

            matched = sorted(
                [m for m in matched if len(m) > 2],
                key=lambda x: (-len(x.split()), -len(x))
            )[:10]

            output.append({
                "entity_name": doc.metadata.get("entity_name", "Sem nome"),
                "entity_type": doc.metadata.get("entity_type", "N/A"),
                "institution": doc.metadata.get("institution", "-"),
                "area": doc.metadata.get("great_area") or doc.metadata.get("area") or "-",

                "knowledge": build_knowledge_list(doc),

                "abstract": doc.metadata.get("abstract"),
                "last_update": doc.metadata.get("last_update"),

                "city": doc.metadata.get("city"),
                "state": doc.metadata.get("state"),

                "segment_original": doc.metadata.get("segment_original"),
                "subsegment_original": doc.metadata.get("subsegment_original"),
                "institutional_description": doc.metadata.get("institutional_description"),
                "subarea": doc.metadata.get("subarea"),

                "mission": doc.metadata.get("mission"),
                "vision": doc.metadata.get("vision"),
                "values": doc.metadata.get("values"),

                "semantic_score": round(semantic * 100, 2),
                "lexical_score": round(lexical * 100, 2),
                "hybrid_score": round(score, 2),

                "matched_terms": matched
            })

        return sorted(output, key=lambda x: x["hybrid_score"], reverse=True)

    except Exception as e:
        print(f"Erro na busca híbrida: {e}")
        return []



@app.route("/")
def home():
    return render_template("index.html")


@app.route("/api/taxonomy")
def api_taxonomy():
    """
    Somente leitura. Expõe a hierarquia já existente em taxonomy.py
    (grande área > área > subáreas) para a navegação por áreas do conhecimento.
    As descrições internas usadas na classificação não são expostas.
    """
    return jsonify([
        {
            "great_area": great_area,
            "areas": [
                {
                    "area": area,
                    "subareas": list(subareas.keys()) if isinstance(subareas, dict) else []
                }
                for area, subareas in areas.items()
            ]
        }
        for great_area, areas in TAXONOMY.items()
    ])


@app.route("/api/search", methods=["POST"])
def api_search():
    start = time.time()

    data = request.json
    print(f">>> PAYLOAD COMPLETO: {data}")  # linha de debug
    query = data.get("query", "").strip()
    min_score = float(data.get("min_score", 50))
    requested = data.get("entity_types", [])
    search_mode = data.get("search_mode", "hybrid")
    top_results = max(1, int(data.get("top_results", 5)))
    print(f">>> top_results: {top_results}")
    print(f">>> top_results recebido: {top_results}")  # linha de debug

    grouped = {
        "Pesquisador": [],
        "Grupo de Pesquisa": [],
        "Empresa": []
    }

    for label, collection in COLLECTIONS.items():

        if requested and label not in requested:
            continue

        use_boost = (label == "Pesquisador")

        try:
            results = hybrid_search_engine(
                query=query,
                collection_name=collection,
                min_score=min_score,
                use_taxonomy_boost=use_boost,
                search_mode=search_mode
            )

            if label == "Pesquisador" and results:
                projects_by_researcher = get_research_projects_by_researcher_names(
                    [item.get("entity_name") for item in results]
                )
                for item in results:
                    researcher_name = (item.get("entity_name") or "").strip().casefold()
                    item["research_projects"] = projects_by_researcher.get(
                        researcher_name, []
                    )

            grouped[label] = results[:top_results]

        except Exception as e:
            print(f"Erro coleção {label}: {e}")
            grouped[label] = []

    return jsonify({
        "grouped_results": grouped,
        "execution_time_ms": int((time.time() - start) * 1000)
    })


if __name__ == "__main__":
    app.run(debug=True)