import os
import json
import psycopg

from collections import defaultdict

from langchain_openai import ChatOpenAI, OpenAIEmbeddings
from langchain_core.messages import SystemMessage, HumanMessage

from taxonomy import TAXONOMY

from config import (OPENAI_API_KEY, DB_CONN_VECTOR, DB_CONN_RAW)

from utils.text import normalize_text, split_pipe

from prompts.taxonomy_prompts import SYSTEM_PROMPT_RESEARCHER
from prompts.company_prompts import SYSTEM_PROMPT_COMPANY


LLM_MODEL = "gpt-4o-mini"
EMBED_MODEL = "text-embedding-3-small"

TOP_K = 50
EMBED_THRESHOLD = 0.50

embeddings_model = OpenAIEmbeddings(model=EMBED_MODEL, openai_api_key=OPENAI_API_KEY)
llm = ChatOpenAI(model=LLM_MODEL, temperature=0.1, openai_api_key=OPENAI_API_KEY)


#Taxônomia
def flatten_taxonomy():
    items = []

    for ga, areas in TAXONOMY.items():
        for area, subs in areas.items():
            for sub, enriched in subs.items():
                text = f"""grande area: {ga} area: {area} subarea: {sub} descricao: {enriched}"""

                items.append({
                    "great_area": ga, "area": area, "subarea": sub, "text": normalize_text(text)
                })

    return items


def load_taxonomy_with_embeddings():   
    taxonomy_flat = flatten_taxonomy()
    print("Verificando taxonomia...")


    # Indexa taxonomia atual pela chave natural
    current = {
        (item["great_area"], item["area"], item["subarea"]): item
        for item in taxonomy_flat
    }

    conn = psycopg.connect(DB_CONN_RAW)
    cursor = conn.cursor()

    try:
        # Carrega todos os registros existentes no banco
        cursor.execute("""SELECT great_area, area, subarea, enriched_text, embedding FROM taxonomy_embeddings""")
        rows = cursor.fetchall()

        stored = {
            (row[0], row[1], row[2]): {"text": row[3], "embedding": row[4]}
            for row in rows
        }

        inserted = updated = deleted = unchanged = 0

        # Inserções e atualizações
        for key, item in current.items():
            in_db = stored.get(key)
            
            if in_db is None:
                embedding = embeddings_model.embed_query(item["text"])
                
            elif in_db["text"] != item["text"]:
                embedding = embeddings_model.embed_query(item["text"])
                
            else:
                item["embedding"] = in_db["embedding"]

            if in_db is None:
                # Novo item: gera embedding e insere
                embedding = embeddings_model.embed_query(item["text"])
                item["embedding"] = embedding

                cursor.execute("""
                    INSERT INTO taxonomy_embeddings (great_area, area, subarea, enriched_text, embedding)
                    VALUES (%s, %s, %s, %s, %s)""",
                    (item["great_area"], item["area"], item["subarea"], item["text"], embedding))

                inserted += 1

            elif in_db["text"] != item["text"]:
                # Texto mudou: regera embedding e atualiza
                embedding = embeddings_model.embed_query(item["text"])
                item["embedding"] = embedding

                cursor.execute("""
                    UPDATE taxonomy_embeddings SET enriched_text = %s, embedding = %s
                    WHERE great_area = %s AND area = %s AND subarea = %s""",
                    (item["text"], embedding, item["great_area"], item["area"], item["subarea"]))

                updated += 1

            else:
                # Sem mudança: reutiliza embedding do banco
                item["embedding"] = in_db["embedding"]
                unchanged += 1

        # Remoções: chaves que estão no banco mas sumiram da taxonomia
        for key in stored:
            if key not in current:
                cursor.execute("""DELETE FROM taxonomy_embeddings 
                    WHERE great_area = %s AND area = %s AND subarea = %s
                """, key)
                deleted += 1

        conn.commit()

        print(
            f"Taxonomia sincronizada: "
            f"{unchanged} inalterados, {inserted} inseridos, "
            f"{updated} atualizados, {deleted} removidos."
        )

        return taxonomy_flat

    finally:
        cursor.close()
        conn.close()



#Carregamento taxonomia
TAXONOMY_FLAT = load_taxonomy_with_embeddings()

TAXONOMY_LOOKUP = {}
AREA_LOOKUP = defaultdict(list)
SUBAREA_LOOKUP = defaultdict(list)

for item in TAXONOMY_FLAT:
    key = (normalize_text(item["great_area"]), normalize_text(item["area"]), normalize_text(item["subarea"]),)

    TAXONOMY_LOOKUP[key] = item
    AREA_LOOKUP[normalize_text(item["area"])].append(item)
    SUBAREA_LOOKUP[normalize_text(item["subarea"])].append(item)


#Similaridade
def search_taxonomy_embeddings(query_embedding, limit=TOP_K):
    conn = psycopg.connect(DB_CONN_RAW)

    try:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT
                great_area, area, subarea, enriched_text, embedding <=> %s::vector AS distance
            FROM taxonomy_embeddings
            ORDER BY distance
            LIMIT %s """, (query_embedding, limit))

        rows = cursor.fetchall()
        output = []

        for row in rows:
            distance = float(row[4])
            similarity = 1 - distance

            output.append({
                "great_area": row[0],
                "area": row[1],
                "subarea": row[2],
                "text": row[3],
                "confidence": similarity
            })
        return output

    finally:
        conn.close()



#Qualidade e densidade do perfil (unificado)
def calculate_profile_quality(profile_text, row):
    """
    Combina riqueza estrutural (richness) e densidade informacional (density)
    em uma única métrica de qualidade do perfil, com pesos configuráveis.

    Dimensões avaliadas:
    - Projetos: quantidade e riqueza descritiva (>=50 palavras)
    - Abstract: tamanho e profundidade
    - Especialidades: presença como sinal de perfil declarado
    """
    if not profile_text:
        return {"quality": 0.0, "richness": 0.0, "density": 0.0}

    from utils.text import split_pipe

    projects = split_pipe(row.get("project_name", ""))
    descriptions = split_pipe(row.get("description", ""))
    specialties = split_pipe(row.get("specialty", ""))
    abstract = row.get("abstract", "") or ""

    # --- Richness (capacidade estrutural do perfil) ---
    project_count = len([p for p in projects if p.strip()])
    project_score = min(project_count / 10, 1.0)

    abstract_words = len(abstract.split())
    abstract_score = min(abstract_words / 200, 1.0)

    total_descriptions = len([d for d in descriptions if d.strip()])
    rich_descriptions = sum(1 for d in descriptions if len(d.split()) >= 50)
    description_score = (rich_descriptions / total_descriptions) if total_descriptions > 0 else 0.0

    richness = (project_score * 0.35 + abstract_score * 0.35 + description_score * 0.30)
    richness = min(1.0, richness)

    # --- Density (densidade informacional para classificação) ---
    specialty_score = min(len(specialties), 10) if specialties else 0
    abstract_bonus = 2 if abstract_words > 80 else 0

    density = ((rich_descriptions * 0.45) + (specialty_score * 0.05) + abstract_bonus) / 10
    density = min(1.0, density)

    # --- Quality (média ponderada das duas dimensões) ---
    quality = richness * 0.5 + density * 0.5

    return {"quality": round(quality, 4), "richness": round(richness, 4), "density": round(density, 4)}


def get_dynamic_top_k(density):
    if density < 0.25:
        return 15
    if density < 0.6:
        return 25
    else:
        return TOP_K


def get_embedding_expansion_limit(density):
    if density < 0.20:
        return 15
    if density < 0.45:
        return 25
    else:
        return TOP_K


def get_llm_limit(density):
    if density < 0.20:
        return 10
    if density < 0.45:
        return 15    
    else:
        return TOP_K

# Construção do texto do pesquisador
def build_researcher_text(row):
    parts = []

    for field in ("great_area", "area", "subarea", "specialty"):
        parts.extend( split_pipe(row.get(field, "")) )
    if row.get("abstract"):
        parts.extend([row["abstract"]])
    if row.get("project_name"):
        parts.extend([row["project_name"]])
    if row.get("description"):
        parts.extend([row["description"]])

    return normalize_text(" ".join(parts))


def build_group_text(row):
    fields = ["name", "area", "keywords", "titulos_linhas", "institution", "first_leader", "second_leader"]

    parts = []

    for field in fields:
        value = row.get(field, "")

        if not value:
            continue

        if isinstance(value, list):
            value = " ".join(
                str(v)
                for v in value
                if v
            )

        parts.append(str(value))

    return normalize_text(" ".join(parts))


def build_company_text(row):
    parts = []

    fields = [
        "segment",
        "subsegment",
        "mission",
        "vision",
        "values",
        "institutional_description"
    ]

    for f in fields:
        value = row.get(f, "")

        if value:
            parts.append(str(value))

    return " ".join(parts)



#Classificação pesquisador
def classify_with_llm(profile_text):
    try:
        messages = [
            SystemMessage(content=SYSTEM_PROMPT_RESEARCHER), 
            HumanMessage(content=f"Perfil: {profile_text}")]

        response = llm.invoke(messages, response_format={"type": "json_object"})
        
        data = json.loads(response.content.strip())

        return data.get("classifications", [])

    except Exception as e:
        print("[LLM ERROR]", e)
        return []

#Classificação empresa
def classify_with_llm_company(text):
    try:
        messages = [SystemMessage(content=SYSTEM_PROMPT_COMPANY), HumanMessage(content=f"Empresa: {text}")]
        response = llm.invoke(messages, response_format={"type": "json_object"})

        data = json.loads(response.content.strip())
        return data.get("classifications", [])

    except Exception as e:
        print("[LLM COMPANY ERROR]", e)
        return []


def resolve_llm_item(item):
    ga = normalize_text(item.get("great_area", ""))
    ar = normalize_text(item.get("area", ""))
    sub = normalize_text(item.get("subarea", ""))
    key = (ga, ar, sub)

    if key in TAXONOMY_LOOKUP:
        return {
            **TAXONOMY_LOOKUP[key],
            "confidence": float(item.get("confidence", 0.7)),
            "evidence": item.get("evidence", "")
        }

    if sub in SUBAREA_LOOKUP:
        return {
            **SUBAREA_LOOKUP[sub][0],
            "confidence": float(item.get("confidence", 0.6)),
            "evidence": item.get("evidence", "")
        }

    if ar in AREA_LOOKUP:
        return {
            **AREA_LOOKUP[ar][0], 
            "confidence": float(item.get("confidence", 0.5)),
            "evidence": item.get("evidence", "")
        }

    return None



#Saída
def format_output(selected, method="hybrid"):
    if not selected:
        return {
            "great_area": [],
            "area": [],
            "subarea": [],
            "taxonomy_score": 0.0,
            "classification_method": "none",
            "candidates": []
        }

    def unique(key):

        seen = set()
        out = []

        for s in selected:
            v = str(s.get(key, "")).strip()
            n = normalize_text(v)

            if v and n not in seen:
                seen.add(n)
                out.append(v.title())

        return out

    return {
        "great_area": unique("great_area"),
        "area": unique("area"),
        "subarea": unique("subarea"),
        "taxonomy_score": round(selected[0]["confidence"], 4),
        "classification_method": method,
        "candidates": [
            {
                "great_area": s["great_area"].title(),
                "area": s["area"].title(),
                "subarea": s["subarea"].title(),
                "score": round(s["confidence"], 4),
                "evidence": s.get("evidence", "")
            }
            for s in selected
        ]
    }

#Classificação
def classify_researcher(row):
    profile_text = build_researcher_text(row)

    if not profile_text:
        return format_output([], method="empty")

    profile_quality = calculate_profile_quality(profile_text, row)
    density = profile_quality["density"]
    richness = profile_quality["richness"]

    dynamic_k = get_dynamic_top_k(density)
    factor = 0.65 if richness < 0.3 else 0.80 if richness < 0.5 else 1.0
    query_emb = embeddings_model.embed_query(profile_text)
    llm_raw = classify_with_llm(profile_text)
    llm_results = []
    llm_limit = get_llm_limit(density)

    for item in llm_raw[:llm_limit]:
        resolved = resolve_llm_item(item)

        if resolved:
            resolved["confidence"] = (float(item.get("confidence", 0.7)) * factor)

            llm_results.append(resolved)

    embedding_results = []
    taxonomy_candidates = search_taxonomy_embeddings(query_emb, limit=get_embedding_expansion_limit(density))
    
    for item in taxonomy_candidates:
        score = item["confidence"] * factor

        if density < 0.50:
            adaptive_threshold = 0.65
        elif density < 0.60:
            adaptive_threshold = 0.60
        else:
            adaptive_threshold = EMBED_THRESHOLD

        if score >= adaptive_threshold:
            embedding_results.append({
                "great_area": item["great_area"],
                "area": item["area"],
                "subarea": item["subarea"],
                "text": item["text"],
                "confidence": score,
                "evidence": ""
            })      


    embedding_limit = get_embedding_expansion_limit(density)
    embedding_results = sorted(embedding_results, key=lambda x: x["confidence"], reverse=True)[:embedding_limit]

    # Pesos da fusão: LLM tem maior confiança semântica; embedding é complementar
    LLM_WEIGHT = 0.60
    EMBED_WEIGHT = 0.40

    merged = {}

    # Indexar resultados LLM e embedding separadamente para preservar origem
    llm_keyed = {
        (normalize_text(item["great_area"]), normalize_text(item["area"]), normalize_text(item["subarea"])): item
        for item in llm_results
    }
    embed_keyed = {
        (normalize_text(item["great_area"]), normalize_text(item["area"]), normalize_text(item["subarea"])): item
        for item in embedding_results
    }

    all_keys = set(llm_keyed) | set(embed_keyed)

    for key in all_keys:
        llm_item = llm_keyed.get(key)
        emb_item = embed_keyed.get(key)

        if llm_item and emb_item:
            # Ambos concordam: média ponderada
            blended_confidence = (
                LLM_WEIGHT * llm_item["confidence"] +
                EMBED_WEIGHT * emb_item["confidence"]
            )
            merged[key] = {
                **llm_item,
                "confidence": blended_confidence,
                # Melhoria 8: evidência do LLM tem prioridade por ser mais rica
                "evidence": llm_item.get("evidence") or emb_item.get("evidence", "")
            }
        elif llm_item:
            merged[key] = llm_item
        else:
            merged[key] = emb_item

    final = sorted(merged.values(), key=lambda x: x["confidence"], reverse=True)

    return format_output(final[:dynamic_k], method="hybrid")


def classify_text_list(texts):
    if not texts:
        return format_output([], method="empty")

    return classify_researcher({"abstract": " ".join(texts)})


def classify_group(row):
    text = build_group_text(row)
    return classify_text_list([text])


def classify_company(row):
    text = build_company_text(row)
    normalized_text = normalize_text(text)
    llm_raw = classify_with_llm_company(normalized_text)

    results = []

    for item in llm_raw:
        resolved = resolve_llm_item(item)
        if resolved:
            results.append({
                "great_area": resolved["great_area"],
                "area": resolved["area"],
                "subarea": resolved["subarea"],
                "confidence": float(item.get("confidence", 0.8))
            })

        else:
            results.append({
                "great_area": item.get("great_area", ""),
                "area": item.get("area", ""),
                "subarea": item.get("subarea", ""),
                "confidence": float(item.get("confidence", 0.8))
            })

    results = sorted(results, key=lambda x: x["confidence"], reverse=True)

    return {
        "great_area": list({r["great_area"] for r in results}),
        "area": list({r["area"] for r in results}),
        "subarea": list({r["subarea"] for r in results}),
        "taxonomy_score": (results[0]["confidence"] if results else 0.0),

        "classification_method": "LLM_Company",
        "candidates": results
    }