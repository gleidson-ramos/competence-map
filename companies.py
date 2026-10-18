import json
import psycopg

from langchain_core.documents import Document
from langchain_openai import OpenAIEmbeddings
from langchain_postgres import PGVector

from classifier import classify_company
from config import (OPENAI_API_KEY, DB_CONN_RAW, DB_CONN_VECTOR)
from utils.text import strong_normalize, unique_join

COLLECTION_NAME = "companies"

SQL = """SELECT * FROM companies"""

embeddings = OpenAIEmbeddings(openai_api_key=OPENAI_API_KEY)

def load_data():
    conn = psycopg.connect(DB_CONN_RAW)
    cur = conn.cursor()
    cur.execute(SQL)

    columns = [desc[0] for desc in cur.description]

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


def group_by_company(rows):
    grouped = {}

    for row in rows:
        company_id = row.get("id")

        if company_id is None:
            continue

        company_id = str(company_id)

        if company_id not in grouped:
            grouped[company_id] = {
                "id": company_id,
                "name": row.get("name") or "",
                "segment": row.get("segment") or "",
                "subsegment": row.get("subsegment") or "",
                "city": row.get("city") or "",
                "state": row.get("state") or "",

                "mission": row.get("mission") or "",
                "vision": row.get("vision") or "",
                "values": row.get("values") or "",
                "institutional_description": (row.get("institutional_description") or ""),

                "_areas": {},
                "_subareas": {},
                "_keywords": {}
            }

        g = grouped[company_id]

        def add_unique(field, value):
            if not value:
                return

            value = str(value).strip()

            if not value:
                return

            key = strong_normalize(value)

            if key not in g[field]:
                g[field][key] = value

        add_unique("_areas", row.get("segment"))
        add_unique("_subareas", row.get("subsegment"))
        add_unique("_keywords", row.get("institutional_description"))
        add_unique("_keywords", row.get("mission"))
        add_unique("_keywords", row.get("vision"))
        add_unique("_keywords", row.get("values"))

    result = []

    for g in grouped.values():
        g["segment"] = " | ".join(g.pop("_areas").values())
        g["subsegment"] = " | ".join(g.pop("_subareas").values())
        g["institutional_description"] = " | ".join(g.pop("_keywords").values())

        result.append(g)

    return result


def build_documents():
    raw_rows = load_data()
    rows = group_by_company(raw_rows)
    docs = []
    
    print(f"{len(rows)} empresas encontradas.")

    conn = psycopg.connect(DB_CONN_RAW)
    cursor = conn.cursor()

    try:
        for i, r in enumerate(rows, 1):
            company_id = str(r["id"])
            print(f"[{i}] empresa {company_id}")

            #Cache da classificação
            cursor.execute("""SELECT classification FROM company_classification WHERE company_id = %s""", (company_id,))

            row_cache = cursor.fetchone()

            if row_cache:
                classification = row_cache[0]

            else:
                classification = classify_company(r)

                cursor.execute(
                    """
                    INSERT INTO company_classification (company_id, classification, updated_at)
                    VALUES (%s, %s, NOW())
                    ON CONFLICT (company_id)
                    DO UPDATE SET
                        classification = EXCLUDED.classification,
                        updated_at = NOW()
                    """,
                    (company_id, json.dumps(classification, ensure_ascii=False))
                )

                conn.commit()

            great_area = classification.get("great_area", "")
            area = classification.get("area", "")
            subarea = classification.get("subarea", "")

            if isinstance(great_area, list):
                great_area = " | ".join(great_area)

            if isinstance(area, list):
                area = " | ".join(area)

            if isinstance(subarea, list):
                subarea = " | ".join(subarea)

            great_area = str(great_area).strip()
            area = str(area).strip()
            subarea = str(subarea).strip()

            taxonomy_text = " | ".join([x for x in [great_area, area, subarea] if x])
            
            keywords_pool = [
                r.get("segment"), r.get("subsegment"), r.get("institutional_description"),
                r.get("mission"), r.get("vision"), r.get("values")
            ]

            keywords = "; ".join(
                sorted(
                    set(
                        " ".join([
                            str(k)
                            for k in keywords_pool
                            if k
                        ]).upper().split(";")
                    )
                )
            )           
            
            final_page_content = unique_join([taxonomy_text, r.get("institutional_description"), r.get("mission"),
                                              r.get("vision"), r.get("values")])
            
            metadata = {
                "company_id": company_id,

                "entity_name": r.get("name") or "Sem nome",
                "entity_type": "Empresa",

                "city": r.get("city"),
                "state": r.get("state"),

                "name": r.get("name"),
                "segment_original": r.get("segment"),
                "subsegment_original": r.get("subsegment"),
                
                "area": great_area, "subarea": f"{area} | {subarea}", "segment": taxonomy_text,
                "research_lines": f"{area} | {subarea}",
                
                "institutional_description": (r.get("institutional_description")),
                "mission": r.get("mission"), "vision": r.get("vision"), "values": r.get("values"),
                
                "keywords": keywords,

                "taxonomy_score": float(classification.get("taxonomy_score", 0)),
                "classification_method": (classification.get("classification_method", "llm_company")),
                "candidates": classification.get("candidates", [])
            }
            
            for key, value in r.items():
                if key in metadata:
                    continue

                if value is None:
                    metadata[key] = ""

                elif isinstance(value, (dict, list)):
                    metadata[key] = json.dumps(value, ensure_ascii=False)

                else:
                    metadata[key] = str(value)
            
            doc = Document(page_content=final_page_content, metadata=metadata)
            docs.append(doc)

            if i % 50 == 0:
                print(f"{i}/{len(rows)} empresas processadas")

    finally:
        cursor.close()
        conn.close()

    return docs



#Indexação
def index_documents():
    docs = build_documents()
    print(f"\nIniciando indexação de {len(docs)} empresas")

    vector_store = PGVector(embeddings=embeddings, collection_name=COLLECTION_NAME, connection=DB_CONN_VECTOR, use_jsonb=True)

    BATCH_SIZE = 10
    total = len(docs)

    for start in range(0, total, BATCH_SIZE):
        batch = docs[start:start + BATCH_SIZE]

        ids = [
            f'company-{doc.metadata["company_id"]}'
            for doc in batch
        ]

        vector_store.add_documents(documents=batch, ids=ids)
        print(f"Indexadas {min(start + BATCH_SIZE, total)}/{total}")

    print(f"\nProcesso concluído: {total} empresas indexadas.")


if __name__ == "__main__":
    index_documents()