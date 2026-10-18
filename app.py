import os
import re
import time
from types import SimpleNamespace
from flask import Flask, request, jsonify, render_template
import psycopg
from psycopg import sql
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

STOPWORDS = {
    "de", "da", "do", "das", "dos", "em",
    "para", "por", "com", "a", "o", "as", "os", "e", "ou"
}

# -------------------------------------------------------------------
# Catálogo de entidades (views do banco)
# -------------------------------------------------------------------

# A chave é o mesmo slug usado na rota do front (#/entidades/<slug>).
# Os nomes de view e colunas vêm apenas deste dicionário (whitelist);
# nenhum valor vindo da requisição é usado como identificador SQL.
CATALOG_VIEWS = {
    "pesquisadores": {
        "view": "vw_all_researchers",
        "entity_type": "Pesquisador",
        "name_field": "researcher_name",
        "order_by": ["researcher_name", "last_update"],
    },
    "grupos": {
        "view": "vw_all_groups",
        "entity_type": "Grupo de Pesquisa",
        "name_field": "name",
        "order_by": ["name", "institution"],
    },
    "empresas": {
        "view": "vw_all_companies",
        "entity_type": "Empresa",
        "name_field": "name",
        "order_by": ["name", "id"],
    },
}

CATALOG_DEFAULT_LIMIT = 24
CATALOG_MAX_LIMIT = 200

app = Flask(__name__)

embeddings = OpenAIEmbeddings(openai_api_key=OPENAI_API_KEY)
VECTOR_STORES = {}
DOCUMENT_NGRAM_CACHE = {}


def get_research_connection_string():
    """
    Conexão com o banco dos dados acadêmicos (DB_CONN_RESEARCH),
    com fallback para DB_CONN_VECTOR. Converte URLs SQLAlchemy
    (postgresql+psycopg://) para o formato aceito pelo psycopg.
    """
    connection_string = os.getenv(
        "DB_CONN_RESEARCH",
        DB_CONN_VECTOR
    )

    return connection_string.replace(
        "postgresql+psycopg://",
        "postgresql://",
        1
    )


# -------------------------------------------------------------------
# Projetos associados aos pesquisadores
# -------------------------------------------------------------------

def get_research_projects_by_researcher_names(researcher_names):
    """
    Busca projetos associados aos pesquisadores pelo nome.

    Usa DB_CONN_RESEARCH para configurar a conexão com o banco
    dos dados acadêmicos. Se não estiver definida, utiliza
    DB_CONN_VECTOR.
    """
    names = sorted({
        str(name).strip()
        for name in researcher_names
        if name and str(name).strip()
    })

    if not names:
        return {}

    connection_string = os.getenv(
        "DB_CONN_RESEARCH",
        DB_CONN_VECTOR
    )

    # Compatibilidade com URLs SQLAlchemy usadas pelo LangChain/PGVector.
    connection_string = connection_string.replace(
        "postgresql+psycopg://",
        "postgresql://",
        1
    )

    normalized_names = [name.casefold() for name in names]

    projects_by_researcher = {
        name.casefold(): []
        for name in names
    }

    sql_query = """
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
        ORDER BY
            r.name,
            rp.start_year NULLS LAST,
            rp.project_name
    """

    try:
        with psycopg.connect(
            connection_string,
            row_factory=dict_row
        ) as conn:
            with conn.cursor() as cursor:
                cursor.execute(sql_query, (normalized_names,))

                for row in cursor.fetchall():
                    key = row["researcher_name"].strip().casefold()

                    projects_by_researcher.setdefault(
                        key,
                        []
                    ).append({
                        "project_name": row["project_name"],
                        "description": row["description"],
                        "start_year": row["start_year"],
                        "end_year": row["end_year"],
                        "status": row["status"],
                    })

    except Exception as e:
        app.logger.exception(
            "Erro ao consultar projetos de pesquisa: %s",
            e
        )

        # Mantém a busca principal disponível caso a consulta
        # de projetos falhe.
        return {}

    return projects_by_researcher


# -------------------------------------------------------------------
# Linhas de pesquisa associadas aos grupos
# -------------------------------------------------------------------

def get_research_group_lines_by_names(group_names):
    """
    Busca linhas de pesquisa na view vw_research_group_lines
    usando o nome do grupo de pesquisa.

    Campos retornados:
        - title
        - objective
        - name
        - first_leader
        - second_leader
    """
    names = sorted({
        str(name).strip()
        for name in group_names
        if name and str(name).strip()
    })

    if not names:
        return {}

    connection_string = os.getenv(
        "DB_CONN_RESEARCH",
        DB_CONN_VECTOR
    )

    connection_string = connection_string.replace(
        "postgresql+psycopg://",
        "postgresql://",
        1
    )

    normalized_names = [
        name.casefold()
        for name in names
    ]

    lines_by_group = {
        name.casefold(): []
        for name in names
    }

    sql_query = """
        SELECT
            title,
            objective,
            name,
            first_leader,
            second_leader
        FROM vw_research_group_lines
        WHERE lower(trim(name)) = ANY(%s)
        ORDER BY name, title
    """

    try:
        with psycopg.connect(
            connection_string,
            row_factory=dict_row
        ) as conn:
            with conn.cursor() as cursor:
                cursor.execute(sql_query, (normalized_names,))

                for row in cursor.fetchall():
                    key = (row["name"] or "").strip().casefold()

                    lines_by_group.setdefault(
                        key,
                        []
                    ).append({
                        "title": row["title"],
                        "objective": row["objective"],
                        "name": row["name"],
                        "first_leader": row["first_leader"],
                        "second_leader": row["second_leader"],
                    })

    except Exception as e:
        app.logger.exception(
            "Erro ao consultar linhas de pesquisa dos grupos: %s",
            e
        )

        return {}

    return lines_by_group


# -------------------------------------------------------------------
# Catálogo de entidades: leitura das views
# -------------------------------------------------------------------

def fetch_catalog_page(conn, catalog_key, limit, offset):
    """
    Lê uma página da view associada ao tipo de entidade e devolve
    {"total", "limit", "offset", "items"}.

    Cada item mantém todas as colunas da view e recebe também
    `entity_name` e `entity_type`, para o front tratar os três
    tipos de forma uniforme.
    """
    config = CATALOG_VIEWS[catalog_key]
    view = sql.Identifier("public", config["view"])

    with conn.cursor() as cursor:
        cursor.execute(
            sql.SQL("SELECT COUNT(*) AS total FROM {}").format(view)
        )
        total = int(cursor.fetchone()["total"])

        order_by = sql.SQL(", ").join(
            sql.Identifier(column)
            for column in config["order_by"]
        )

        cursor.execute(
            sql.SQL(
                "SELECT * FROM {} ORDER BY {} LIMIT %s OFFSET %s"
            ).format(view, order_by),
            (limit, offset)
        )

        rows = cursor.fetchall()

    items = []

    for row in rows:
        item = dict(row)
        item["entity_name"] = (
            str(item.get(config["name_field"]) or "").strip()
            or "Sem nome"
        )
        item["entity_type"] = config["entity_type"]
        items.append(item)

    return {
        "total": total,
        "limit": limit,
        "offset": offset,
        "items": items,
    }


# -------------------------------------------------------------------
# Banco vetorial
# -------------------------------------------------------------------

def get_vector_store(collection_name):
    if collection_name not in VECTOR_STORES:
        VECTOR_STORES[collection_name] = PGVector(
            connection=DB_CONN_VECTOR,
            collection_name=collection_name,
            embeddings=embeddings,
            distance_strategy="cosine"
        )

        print(f"Coleção carregada: {collection_name}")

    return VECTOR_STORES[collection_name]


# -------------------------------------------------------------------
# N-Grams
# -------------------------------------------------------------------

def generate_ngrams(text, n_min=1, n_max=3):
    if not text:
        return set()

    tokens = [
        token
        for token in normalize_text(text).split()
        if token and token not in STOPWORDS
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


# -------------------------------------------------------------------
# Lista de conhecimentos
# -------------------------------------------------------------------

def build_knowledge_list(doc):
    sources = [
        doc.metadata.get("subarea"),
        doc.metadata.get("specialty"),
        doc.metadata.get("titulos_linhas"),
        doc.metadata.get("knowledge"),
    ]

    seen = set()
    result = []

    for source in sources:
        if not source:
            continue

        for part in str(source).split("|"):
            normalized = normalize_text(part)

            if normalized and normalized not in seen:
                seen.add(normalized)
                result.append(part.strip())

    return " | ".join(result)


# -------------------------------------------------------------------
# Texto pesquisável
# -------------------------------------------------------------------

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
        " ".join(str(field) for field in fields if field)
    )


# -------------------------------------------------------------------
# Threshold semântico
# -------------------------------------------------------------------

def get_semantic_threshold(token_count):
    """
    Quanto mais tokens, mais específica é a query e mais exigente
    pode ser o threshold.

    Queries curtas (1 token) são genéricas: threshold baixo para
    não perder resultados.

    Queries longas (5+) são específicas: threshold mais alto para
    garantir precisão.
    """
    if token_count <= 1:
        return 0.25
    elif token_count <= 2:
        return 0.32
    elif token_count <= 4:
        return 0.38
    else:
        return 0.45


# -------------------------------------------------------------------
# Busca híbrida
# -------------------------------------------------------------------

def hybrid_search_engine(
    query,
    collection_name,
    min_score,
    use_taxonomy_boost=True,
    search_mode="hybrid"
):
    try:
        store = get_vector_store(collection_name)

        q = normalize_text(query)

        if not q:
            return []

        tokens = q.split()

        query_ngrams = generate_ngrams(q)
        query_phrases = generate_ngrams(
            q,
            n_min=2,
            n_max=3
        )

        enriched = f"Área de pesquisa: {q}"

        results = store.similarity_search_with_score(
            enriched,
            k=TOP_K
        )

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
                DOCUMENT_NGRAM_CACHE[doc_id] = generate_ngrams(
                    doc_text
                )

            doc_ngrams = DOCUMENT_NGRAM_CACHE[doc_id]

            lexical_raw, _, matched = lexical_and_coverage(
                query_ngrams,
                doc_ngrams
            )

            lexical = lexical_raw / 100

            # Contagem normalizada de frases encontradas.
            exact_count = sum(
                1
                for phrase in query_phrases
                if re.search(
                    r"\b" + re.escape(phrase) + r"\b",
                    doc_text
                )
            )

            exact = min(
                exact_count / max(len(query_phrases), 1),
                1.0
            )

            taxonomy = (
                min(1.0, doc.metadata.get("taxonomy_score", 0))
                if use_taxonomy_boost
                else 0.0
            )

            if search_mode == "semantic":
                score = semantic

            elif search_mode == "lexical":
                score = lexical

            else:
                # Scoring aditivo: pesos somam 1.0.
                # Taxonomia como sinal leve de desempate.
                score = (
                    (0.65 * semantic)
                    + (0.25 * lexical)
                    + (0.08 * exact)
                    + (0.02 * taxonomy)
                )

            score = max(0.0, min(1.0, score))
            score = score * 100

            if score < min_score:
                continue

            matched = sorted(
                [match for match in matched if len(match) > 2],
                key=lambda x: (-len(x.split()), -len(x))
            )[:10]

            output.append({
                "entity_name": doc.metadata.get(
                    "entity_name",
                    "Sem nome"
                ),
                "entity_type": doc.metadata.get(
                    "entity_type",
                    "N/A"
                ),
                "institution": doc.metadata.get(
                    "institution",
                    "-"
                ),
                "area": (
                    doc.metadata.get("great_area")
                    or doc.metadata.get("area")
                    or "-"
                ),

                "knowledge": build_knowledge_list(doc),

                "abstract": doc.metadata.get("abstract"),
                "last_update": doc.metadata.get("last_update"),

                "city": doc.metadata.get("city"),
                "state": doc.metadata.get("state"),

                "segment_original": doc.metadata.get(
                    "segment_original"
                ),
                "subsegment_original": doc.metadata.get(
                    "subsegment_original"
                ),
                "institutional_description": doc.metadata.get(
                    "institutional_description"
                ),
                "subarea": doc.metadata.get("subarea"),

                "mission": doc.metadata.get("mission"),
                "vision": doc.metadata.get("vision"),
                "values": doc.metadata.get("values"),

                "semantic_score": round(semantic * 100, 2),
                "lexical_score": round(lexical * 100, 2),
                "hybrid_score": round(score, 2),

                "matched_terms": matched,
            })

        return sorted(
            output,
            key=lambda item: item["hybrid_score"],
            reverse=True
        )

    except Exception as e:
        app.logger.exception(
            "Erro na busca híbrida: %s",
            e
        )
        return []


# -------------------------------------------------------------------
# Página inicial
# -------------------------------------------------------------------

@app.route("/")
def home():
    return render_template("index.html")


# -------------------------------------------------------------------
# Taxonomia
# -------------------------------------------------------------------

@app.route("/api/taxonomy")
def api_taxonomy():
    """
    Somente leitura. Expõe a hierarquia já existente em taxonomy.py
    (grande área > área > subáreas) para a navegação por áreas
    do conhecimento.

    As descrições internas usadas na classificação não são expostas.
    """
    return jsonify([
        {
            "great_area": great_area,
            "areas": [
                {
                    "area": area,
                    "subareas": (
                        list(subareas.keys())
                        if isinstance(subareas, dict)
                        else []
                    )
                }
                for area, subareas in areas.items()
            ]
        }
        for great_area, areas in TAXONOMY.items()
    ])


# -------------------------------------------------------------------
# Catálogo de entidades
# -------------------------------------------------------------------

@app.route("/api/entities/catalog")
def api_entities_catalog():
    """
    Catálogo completo de entidades, lido das views do banco.

    Parâmetros (query string):
        type   : all | pesquisadores | grupos | empresas (padrão: all)
        limit  : itens por página (1..200, padrão 24)
        offset : deslocamento (>= 0, padrão 0; ignorado em type=all)

    type=all  -> {"catalogs": {"pesquisadores": {...}, "grupos": {...},
                               "empresas": {...}}}
    type=<x>  -> {"type": x, "total", "limit", "offset", "items": [...]}
    """
    catalog_type = (
        request.args.get("type", "all").strip().lower() or "all"
    )

    if catalog_type != "all" and catalog_type not in CATALOG_VIEWS:
        return jsonify({"error": "Tipo de catálogo inválido."}), 400

    try:
        limit = int(request.args.get("limit", CATALOG_DEFAULT_LIMIT))
        offset = int(request.args.get("offset", 0))
    except (TypeError, ValueError):
        return jsonify({"error": "Parâmetros de paginação inválidos."}), 400

    limit = max(1, min(CATALOG_MAX_LIMIT, limit))
    offset = max(0, offset)

    try:
        with psycopg.connect(
            get_research_connection_string(),
            row_factory=dict_row
        ) as conn:
            if catalog_type == "all":
                return jsonify({
                    "catalogs": {
                        key: fetch_catalog_page(conn, key, limit, 0)
                        for key in CATALOG_VIEWS
                    }
                })

            page = fetch_catalog_page(conn, catalog_type, limit, offset)

            return jsonify({"type": catalog_type, **page})

    except Exception as e:
        app.logger.exception(
            "Erro ao consultar o catálogo de entidades (%s): %s",
            catalog_type,
            e
        )

        return jsonify({
            "error": "Não foi possível consultar o catálogo de entidades."
        }), 500


def build_profile_fields(doc):
    """
    Campos do perfil vindos dos metadados do banco vetorial, com os mesmos
    nomes e regras usados pelos resultados da busca (áreas, competências,
    resumo, missão etc.), mas sem scores.
    """
    meta = doc.metadata or {}

    return {
        "entity_name": meta.get("entity_name"),
        "entity_type": meta.get("entity_type"),
        "institution": meta.get("institution"),
        "area": meta.get("great_area") or meta.get("area"),
        "knowledge": build_knowledge_list(doc),
        "abstract": meta.get("abstract"),
        "last_update": meta.get("last_update"),
        "city": meta.get("city"),
        "state": meta.get("state"),
        "segment_original": meta.get("segment_original"),
        "subsegment_original": meta.get("subsegment_original"),
        "institutional_description": meta.get(
            "institutional_description"
        ),
        "subarea": meta.get("subarea"),
        "mission": meta.get("mission"),
        "vision": meta.get("vision"),
        "values": meta.get("values"),
    }


def get_vector_profile(entity_type, name):
    """
    Busca, no banco vetorial, o documento da entidade pelo nome e devolve
    seus campos de perfil (sem valores vazios). Retorna {} se não houver
    documento ou se a consulta falhar.
    """
    collection_name = COLLECTIONS[entity_type]
    wanted = name.strip().lower()

    connection_string = DB_CONN_VECTOR.replace(
        "postgresql+psycopg://",
        "postgresql://",
        1
    )

    sql_query = """
        SELECT e.document AS document, e.cmetadata AS cmetadata
        FROM langchain_pg_embedding AS e
        INNER JOIN langchain_pg_collection AS c
            ON c.uuid = e.collection_id
        WHERE c.name = %s
          AND lower(trim(e.cmetadata->>'entity_name')) = %s
        LIMIT 1
    """

    doc = None

    try:
        with psycopg.connect(
            connection_string,
            row_factory=dict_row
        ) as conn:
            with conn.cursor() as cursor:
                cursor.execute(sql_query, (collection_name, wanted))
                row = cursor.fetchone()

        if row:
            doc = SimpleNamespace(
                page_content=row["document"] or "",
                metadata=row["cmetadata"] or {}
            )

    except Exception as e:
        app.logger.exception(
            "Erro ao consultar o perfil no banco vetorial; "
            "tentando pela API do PGVector: %s",
            e
        )

        # Alternativa caso o esquema das tabelas do LangChain seja outro.
        try:
            found = get_vector_store(collection_name).similarity_search(
                name,
                k=1,
                filter={"entity_name": name}
            )

            doc = found[0] if found else None

        except Exception as fallback_error:
            app.logger.exception(
                "Erro ao consultar o perfil pelo PGVector: %s",
                fallback_error
            )

            return {}

    if doc is None:
        return {}

    return {
        key: value
        for key, value in build_profile_fields(doc).items()
        if value not in (None, "", "-")
    }


def fetch_catalog_row(entity_type, name):
    """
    Linha da view do catálogo para a entidade, localizada pelo nome
    (sem diferenciar maiúsculas/minúsculas nem espaços nas pontas).
    Retorna None se não existir ou se a consulta falhar.
    """
    config = next(
        (
            item
            for item in CATALOG_VIEWS.values()
            if item["entity_type"] == entity_type
        ),
        None
    )

    if config is None:
        return None

    query = sql.SQL(
        "SELECT * FROM {} WHERE lower(trim({})) = %s LIMIT 1"
    ).format(
        sql.Identifier("public", config["view"]),
        sql.Identifier(config["name_field"])
    )

    try:
        with psycopg.connect(
            get_research_connection_string(),
            row_factory=dict_row
        ) as conn:
            with conn.cursor() as cursor:
                cursor.execute(query, (name.strip().lower(),))
                row = cursor.fetchone()

    except Exception as e:
        app.logger.exception(
            "Erro ao consultar a view do catálogo (%s): %s",
            config["view"],
            e
        )

        return None

    if not row:
        return None

    item = dict(row)
    item["entity_name"] = (
        str(item.get(config["name_field"]) or "").strip() or name
    )
    item["entity_type"] = entity_type

    return item


@app.route("/api/entities/detail")
def api_entity_detail():
    """
    Detalhes de um perfil aberto pelo catálogo (que lê apenas as views).
    Devolve o mesmo conteúdo que a busca anexa a cada resultado:

        profile            -> áreas, competências, resumo, missão etc.
                              (metadados do banco vetorial)
        research_projects  -> somente para Pesquisador
        research_lines     -> somente para Grupo de Pesquisa
    """
    entity_type = request.args.get("type", "").strip()
    name = request.args.get("name", "").strip()

    if entity_type not in COLLECTIONS or not name:
        return jsonify({"error": "Parâmetros inválidos."}), 400

    key = name.casefold()

    detail = {
        # Metadados do banco vetorial (áreas, competências, resumo…).
        "profile": get_vector_profile(entity_type, name),
        # Linha da view do catálogo; permite abrir um perfil que ainda
        # não está no cache do navegador (ex.: líder de um grupo).
        "catalog": fetch_catalog_row(entity_type, name),
    }

    if entity_type == "Pesquisador":
        projects = get_research_projects_by_researcher_names([name])
        detail["research_projects"] = projects.get(key, [])

    elif entity_type == "Grupo de Pesquisa":
        lines = get_research_group_lines_by_names([name])
        detail["research_lines"] = lines.get(key, [])

    return jsonify(detail)


# -------------------------------------------------------------------
# Busca de entidades
# -------------------------------------------------------------------

@app.route("/api/search", methods=["POST"])
def api_search():
    start = time.time()

    data = request.json or {}

    query = data.get("query", "").strip()
    min_score = float(data.get("min_score", 50))
    requested = data.get("entity_types", [])
    search_mode = data.get("search_mode", "hybrid")
    top_results = max(1, int(data.get("top_results", 5)))

    print(f">>> top_results: {top_results}")

    grouped = {
        "Pesquisador": [],
        "Grupo de Pesquisa": [],
        "Empresa": [],
    }

    for label, collection in COLLECTIONS.items():

        if requested and label not in requested:
            continue

        use_boost = label == "Pesquisador"

        try:
            results = hybrid_search_engine(
                query=query,
                collection_name=collection,
                min_score=min_score,
                use_taxonomy_boost=use_boost,
                search_mode=search_mode,
            )

            # -------------------------------------------------------
            # Projetos dos pesquisadores
            # -------------------------------------------------------

            if label == "Pesquisador" and results:
                projects_by_researcher = (
                    get_research_projects_by_researcher_names(
                        [
                            item.get("entity_name")
                            for item in results
                        ]
                    )
                )

                for item in results:
                    researcher_name = (
                        item.get("entity_name") or ""
                    ).strip().casefold()

                    item["research_projects"] = (
                        projects_by_researcher.get(
                            researcher_name,
                            []
                        )
                    )

            # -------------------------------------------------------
            # Linhas de pesquisa dos grupos
            # -------------------------------------------------------

            if label == "Grupo de Pesquisa" and results:
                lines_by_group = (
                    get_research_group_lines_by_names(
                        [
                            item.get("entity_name")
                            for item in results
                        ]
                    )
                )

                for item in results:
                    group_name = (
                        item.get("entity_name") or ""
                    ).strip().casefold()

                    item["research_lines"] = (
                        lines_by_group.get(
                            group_name,
                            []
                        )
                    )

            grouped[label] = results[:top_results]

        except Exception as e:
            app.logger.exception(
                "Erro ao processar coleção %s: %s",
                label,
                e
            )
            grouped[label] = []

    return jsonify({
        "grouped_results": grouped,
        "execution_time_ms": int(
            (time.time() - start) * 1000
        ),
    })


# -------------------------------------------------------------------
# Execução
# -------------------------------------------------------------------

if __name__ == "__main__":
    app.run(debug=True)