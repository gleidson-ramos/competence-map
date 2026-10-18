import json
import psycopg

from langchain_core.documents import Document
from langchain_openai import OpenAIEmbeddings
from langchain_postgres import PGVector

from config import (OPENAI_API_KEY, DB_CONN_RAW, DB_CONN_VECTOR)
from utils.text import (normalize_text, strong_normalize, unique_join)

COLLECTION_NAME = "groups"

SQL = """select * from group_similarity;"""

embeddings = OpenAIEmbeddings(openai_api_key=OPENAI_API_KEY)

def extract_field(value) -> str:
    if isinstance(value, list):
        return " | ".join(str(v)
            for v in value
            if v
        )
    return str(value) if value else ""

#Cache
def load_cached_classification(cursor, group_id):
    cursor.execute(""" SELECT classification FROM group_classification WHERE group_id = %s""", (str(group_id),))
    row = cursor.fetchone()

    if row:
        return row[0]

    return None

def save_classification(conn, cursor, group_id, classification):
    group_id = str(group_id)
    print( f"[CACHE] salvando classificação do grupo {group_id}")

    cursor.execute(
        """
        INSERT INTO group_classification (group_id, classification, updated_at ) VALUES (%s, %s, NOW())
        ON CONFLICT (group_id)
        DO UPDATE SET classification = EXCLUDED.classification, updated_at = NOW()
        """,
        (group_id, json.dumps(classification, ensure_ascii=False))
    )
    conn.commit()


#Carregar Dados
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
                yield dict( zip(columns, row) )
    finally:
        cur.close()
        conn.close()


# Agrupar
def group_by_group(rows):
    grouped = {}

    for row in rows:
        group_id = row.get("id")

        if group_id is None:
            continue

        group_id = str(group_id)

        if group_id not in grouped:
            grouped[group_id] = {
                "id": group_id,
                "name": row.get("name") or "",
                "institution": row.get("institution") or "",
                "first_leader": row.get("first_leader") or "",
                "second_leader": row.get("second_leader") or "",

                "_areas": {},
                "_keywords": {},
                "_titles": {},
            }

        g = grouped[group_id]
       
        def add_unique(field, value):
            if not value:
                return

            value = str(value).strip()

            if not value:
                return

            key = strong_normalize(value)

            if key not in g[field]:
                g[field][key] = value

        add_unique( "_areas", row.get("area") )
        add_unique( "_keywords", row.get("keywords") )
        add_unique( "_titles", row.get("titulos_linhas") )

    result = []

    for g in grouped.values():
        g["area"] = " | ".join( g.pop("_areas").values())
        g["keywords"] = " | ".join( g.pop("_keywords").values() )
        g["titulos_linhas"] = " | ".join( g.pop("_titles").values() )

        result.append(g)

    return result

def build_documents():
    raw_rows = load_data()
    rows = group_by_group(raw_rows)

    docs = []

    print( f"{len(rows)} grupos encontrados.")
    conn = psycopg.connect(DB_CONN_RAW)
    cursor = conn.cursor()

    try:
        for i, g in enumerate(rows, 1):
            group_id = g["id"]

            if group_id is None:
                continue

            group_id = str(group_id)
            print( f"[{i}] grupo {group_id}")

            classification = (load_cached_classification(cursor, group_id))
            
            if not classification:
                classification = {
                    "great_area": [],
                    "area": ([g.get("area")] if g.get("area") else [] ),
                    # linhas de pesquisa
                    "subarea": ([g.get("titulos_linhas")] if g.get("titulos_linhas") else [] ),
                    "candidates": [],
                    "taxonomy_score": 1.0,
                    "classification_method": "declared_group_data"
                }

                save_classification(conn, cursor, group_id, classification)

            area = unique_join([extract_field(classification.get("area")), g.get("area", "")])
            subarea = unique_join([extract_field( classification.get( "subarea" ) ), g.get("titulos_linhas", "")])

            titles = (g.get("titulos_linhas") or "")
            keywords = (g.get("keywords") or "")
            taxonomy_text = normalize_text( unique_join([area, subarea]) )
            final_page_content = unique_join([ taxonomy_text, titles, keywords, area])
          
            doc = Document(
                page_content=final_page_content,
                metadata={
                    "group_id": str(group_id),
                    "entity_name": str( g.get("name") or "Sem nome" ),
                    "entity_type": "Group",
                    "institution": str(g.get("institution") or ""),
                    "first_leader": str(g.get("first_leader") or ""),
                    "second_leader": str(g.get("second_leader") or ""),
                    "area": str(area),
                    "subarea": str(subarea),
                    "research_lines": str(titles),
                    "keywords": str(keywords),
                    "taxonomy_score": float( classification.get("taxonomy_score", 0) ),
                    "classification_method": str(classification.get("classification_method", "none")),
                    "candidates": classification.get("candidates", []),
                }
            )

            docs.append(doc)

            if i % 100 == 0:
                print(f"{i}/{len(rows)} grupos processados")
    finally:
        cursor.close()
        conn.close()

    return docs

def index_groups():
    docs = build_documents()
    print(f"\nIniciando indexação de {len(docs)} grupos")

    vector_store = PGVector(embeddings=embeddings, collection_name=COLLECTION_NAME, connection=DB_CONN_VECTOR, use_jsonb=True)
    BATCH_SIZE = 100
    total = len(docs)
    for start in range(0, total, BATCH_SIZE):
        batch = docs[start:start + BATCH_SIZE]
        ids = [doc.metadata["group_id"]
            for doc in batch
        ]

        vector_store.add_documents(documents=batch, ids=ids)

        print(f"Indexados {min(start + BATCH_SIZE, total)}/{total}")

    print(f"\n Processo concluído: {total} grupos indexados.")

if __name__ == "__main__":

    index_groups()