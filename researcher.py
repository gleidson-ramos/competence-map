import json
import psycopg

from langchain_core.documents import Document
from langchain_openai import OpenAIEmbeddings
from langchain_postgres import PGVector

from classifier import classify_researcher

from config import (OPENAI_API_KEY, DB_CONN_RAW, DB_CONN_VECTOR)

from utils.text import (normalize_text, strong_normalize, unique_join, normalized_keys)

COLLECTION_NAME = "researcher"

SQL = """select * from vw_researcher_projects"""

embeddings = OpenAIEmbeddings(openai_api_key=OPENAI_API_KEY)

def extract_field(value) -> str:
    if isinstance(value, list):
        return " | ".join(str(v)
            for v in value
            if v
        )

    return str(value) if value else ""

#Cache
def load_cached_classification(cursor, researcher_id):
    cursor.execute("""
        SELECT classification, last_update
        FROM researcher_classification
        WHERE researcher_id = %s
    """, (str(researcher_id),))

    row = cursor.fetchone()

    if row:
        return {"classification": row[0], "last_update": row[1]}

    return None


def save_classification(conn, cursor, researcher_id, classification, last_update):
    researcher_id = str(researcher_id)

    print(f"Salvando classificação do pesquisador {researcher_id}")

    cursor.execute("""
        INSERT INTO researcher_classification (researcher_id, classification, last_update, updated_at)
        VALUES (%s, %s, %s, NOW())
        ON CONFLICT (researcher_id)
        DO UPDATE SET
            classification = EXCLUDED.classification,
            last_update    = EXCLUDED.last_update,
            updated_at     = NOW()
    """, (researcher_id, json.dumps(classification, ensure_ascii=False), last_update))

    conn.commit()

def load_data():
    conn = psycopg.connect(DB_CONN_RAW)
    cur = conn.cursor()
    cur.execute(SQL)

    columns = [
        desc[0]
        for desc in cur.description
    ]

    try:
        while True:
            rows = cur.fetchmany(1000)

            if not rows:
                break

            for row in rows:
                yield dict(zip(columns, row))
    finally:
        cur.close()
        conn.close()


def group_by_researcher(rows):
    grouped = {}

    for row in rows:
        researcher_id = row.get("id")

        if researcher_id is None:
            continue

        researcher_id = str(researcher_id)

        if researcher_id not in grouped:
            grouped[researcher_id] = {
                "id": researcher_id,
                "researcher_name": row.get("researcher_name") or "",
                "lattes_id": row.get("lattes_id"),
                "abstract": row.get("abstract") or "",
                "city": row.get("city"),
                "country": row.get("country"),
                "institution": row.get("institution"),
                "graduation": row.get("graduation"),
                "last_update": row.get("last_update"),

                "_great_areas": {},
                "_areas": {},
                "_subareas": {},
                "_specialties": {},
                "_project_names": {},
                "_descriptions": {},
            }

        r = grouped[researcher_id]

        def add_unique(field, value):
            if not value:
                return

            value = str(value).strip()

            if not value:
                return

            key = strong_normalize(value)

            if key not in r[field]:
                r[field][key] = value

        add_unique("_great_areas", row.get("great_area"))
        add_unique("_areas", row.get("area"))
        add_unique("_subareas", row.get("subarea"))
        add_unique("_specialties", row.get("specialty"))
        add_unique("_project_names", row.get("project_name"))
        add_unique("_descriptions", row.get("description"))

    result = []

    for r in grouped.values():
        r["great_area"] = " | ".join(r.pop("_great_areas").values())
        r["area"] = " | ".join(r.pop("_areas").values())
        r["subarea"] = " | ".join(r.pop("_subareas").values())
        r["specialty"] = " | ".join(r.pop("_specialties").values())
        r["project_name"] = " | ".join(r.pop("_project_names").values())
        r["description"] = " | ".join(r.pop("_descriptions").values())

        result.append(r)

    return result

def build_documents():
    raw_rows = load_data()
    rows = group_by_researcher(raw_rows)

    docs = []
    docs_to_index = []

    new_count = updated_count = skipped_count = 0

    print(f"{len(rows)} pesquisadores encontrados.")

    conn = psycopg.connect(DB_CONN_RAW)
    cursor = conn.cursor()

    try:
        for i, r in enumerate(rows, 1):
            researcher_id = r["id"]

            if researcher_id is None:
                continue

            researcher_id = str(researcher_id)
            raw = r.get("last_update")
            current_last_update = raw.date() if hasattr(raw, "date") else raw

            cached = load_cached_classification(cursor, researcher_id)

            # Decide se precisa reclassificar
            if cached is None:
                # Pesquisador novo: classifica e indexa
                reason = "novo"
                classification = classify_researcher(r)
                save_classification(conn, cursor, researcher_id, classification, current_last_update)
                needs_index = True
                new_count += 1
            elif cached["last_update"] != current_last_update:
                # Currículo atualizado: reclassifica e reindexia
                reason = f"atualizado ({cached['last_update']} → {current_last_update})"
                classification = classify_researcher(r)
                save_classification(conn, cursor, researcher_id, classification, current_last_update)
                needs_index = True
                updated_count += 1
            else:
                # Sem mudança: pula etapa
                classification = cached["classification"]
                needs_index = False
                skipped_count += 1

            if not needs_index:
                print(f"[{i}] pesquisador {researcher_id} — sem alterações, pulando.")
                continue

            print(f"[{i}] pesquisador {researcher_id} — {reason}")

            abstract = (r.get("abstract") or "")
            project_name = (r.get("project_name") or "")
            description = (r.get("description") or "")

            ga = unique_join([extract_field(classification.get("great_area")), r.get("great_area", "")])
            area = unique_join([extract_field(classification.get("area")), r.get("area", "")])
            sa = unique_join([extract_field(classification.get("subarea")),
                              r.get("subarea", "")], exclude=(normalized_keys(ga) | normalized_keys(area)))

            method = classification.get("classification_method", "none")
            taxonomy_text = normalize_text(f"{ga} {area} {sa}")
            projects_text = unique_join([project_name, description])
            final_page_content = unique_join([taxonomy_text, abstract, projects_text])

            doc = Document(
                page_content=final_page_content,
                metadata={
                    "researcher_id": str(researcher_id),
                    "entity_name": str(r.get("researcher_name") or "Sem nome"),
                    "entity_type": "Pesquisador",
                    "lattes_id": str(r.get("lattes_id") or ""),
                    "institution": str(r.get("institution") or ""),
                    "city": str(r.get("city") or ""),
                    "country": str(r.get("country") or ""),
                    "last_update": current_last_update.isoformat() if current_last_update else "",
                    "great_area": str(ga),
                    "area": str(area),
                    "subarea": str(sa),
                    "declared_great_area": str(r.get("great_area") or ""),
                    "declared_area": str(r.get("area") or ""),
                    "declared_subarea": str(r.get("subarea") or ""),
                    "specialty": str(r.get("specialty") or ""),
                    "abstract": str(abstract),
                    "taxonomy_score": float(classification.get("taxonomy_score", 0)),
                    "interdisciplinaridade_score": float(classification.get("interdisciplinaridade_score", 0)),
                    "classification_method": str(method),
                    "candidates": classification.get("candidates", []),
                }
            )

            docs_to_index.append(doc)

            if i % 50 == 0:
                print(f"{i}/{len(rows)} processados")

    finally:
        cursor.close()
        conn.close()

    print(
        f"\nResumo: {new_count} novos, {updated_count} atualizados, "
        f"{skipped_count} sem alterações."
    )

    return docs_to_index


def index_documents():
    docs = build_documents()

    if not docs:
        print("Nenhum documento para indexar.")
        return

    print(f"\nIniciando indexação de {len(docs)} documentos")

    vector_store = PGVector(embeddings=embeddings, collection_name=COLLECTION_NAME, connection=DB_CONN_VECTOR, use_jsonb=True)
    BATCH_SIZE = 50
    total = len(docs)

    for start in range(0, total, BATCH_SIZE):
        batch = docs[start:start + BATCH_SIZE]
        ids = [doc.metadata["researcher_id"] for doc in batch]

        try:
            vector_store.add_documents(documents=batch, ids=ids)
            print(f"Indexados {min(start + BATCH_SIZE, total)}/{total}")
        except Exception as e:
            failed_ids = ", ".join(ids)
            print(f"Erro ao indexar batch [{failed_ids}]: {e}")

    print(f"\nProcesso concluído: {len(docs)} pesquisadores indexados.")

if __name__ == "__main__":
    index_documents()