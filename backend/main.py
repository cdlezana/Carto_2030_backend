import os
import psycopg2
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware

# --- Configuración base ---
app = FastAPI()
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
FRONTEND_PATH = os.path.join(BASE_DIR, "..", "frontend")

# --- Configurar CORS ---
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Configuración de conexión a PostgreSQL ---
DB_CONFIG = {
    "host": "localhost",
    "port": 5432,
    "dbname": "cartocensal_2030",
    "user": "postgres",
    "password": "postgres"  # ajusta tu contraseña
}

# --- Función genérica para convertir tablas a GeoJSON ---
def obtener_geojson(tabla, campos="id, nam AS nombre, geom", filtro=None):
    try:
        conn = psycopg2.connect(**DB_CONFIG)
        cur = conn.cursor()
        query = f"""
            SELECT jsonb_build_object(
                'type', 'FeatureCollection',
                'features', jsonb_agg(feature)
            )
            FROM (
                SELECT jsonb_build_object(
                    'type', 'Feature',
                    'geometry', ST_AsGeoJSON(geom)::jsonb,
                    'properties', to_jsonb(row) - 'geom'
                ) AS feature
                FROM (
                    SELECT {campos}
                    FROM {tabla}
                    {f"WHERE {filtro}" if filtro else ""}
                ) row
            ) features;
        """
        cur.execute(query)
        geojson = cur.fetchone()[0]
        cur.close()
        conn.close()
        return geojson
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error en tabla {tabla}: {str(e)}")

# --- Endpoints de capas ---
@app.get("/api/pjes_censal_2022")
def obtener_pjes_censal(depto: str = "todos"):
    filtro = None
    if depto.lower() != "todos":
        filtro = f"""p."CMU" IN (
                        SELECT g."CMU"
                        FROM gob_locales_2022 g
                        LEFT JOIN dpto_chaco d ON g."COD_DEPTO" = d.in1
                        WHERE d.nam ILIKE '%{depto}%'
                    )"""
    return obtener_geojson("pjes_censal_2022 p",
                           'p.id, p.nam AS nombre, p.id_estado, p."CMU", p."COD_DEPTO", p.geom',
                           filtro=filtro)

@app.get("/api/loc_censal_2022")
def obtener_loc_censal():
    return obtener_geojson("loc_censal_2022", "id, nam AS nombre, geom")

@app.get("/api/gob_locales_2022")
def obtener_gob_locales():
    return obtener_geojson("gob_locales_2022", "id, nam AS nombre, \"CMU\", \"COD_DEPTO\", geom")

@app.get("/api/dpto_chaco")
def obtener_dpto_chaco():
    return obtener_geojson("dpto_chaco", "id, nam AS nombre, in1 AS codigo, geom")

# --- Endpoint para listar capas ---
@app.get("/api/capas")
def listar_capas():
    return {
        "capas": [
            {"id": "pjes_censal_2022", "nombre": "Parajes Censales"},
            {"id": "loc_censal_2022", "nombre": "Localidades"},
            {"id": "gob_locales_2022", "nombre": "Gobiernos Locales"},
            {"id": "dpto_chaco", "nombre": "Departamentos"},
        ]
    }

# --- Endpoint para actualizar estado de Parajes ---
@app.post("/api/estado")
def cambiar_estado(payload: dict):
    try:
        id = payload.get("id")
        nuevo_estado = payload.get("estado")
        if not id or not nuevo_estado:
            raise HTTPException(status_code=400, detail="Faltan parámetros")

        conn = psycopg2.connect(**DB_CONFIG)
        cur = conn.cursor()
        cur.execute(
            "UPDATE pjes_censal_2022 SET id_estado=%s WHERE id=%s",
            (nuevo_estado, id)
        )
        conn.commit()
        cur.close()
        conn.close()
        return {"msg": f"Estado actualizado a {nuevo_estado} para id {id}"}
    except Exception as e:
        print("Error cambiando estado:", e)
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/departamentos")
def listar_departamentos():
    try:
        conn = psycopg2.connect(**DB_CONFIG)
        cur = conn.cursor()
        cur.execute("""
            SELECT nam 
            FROM dpto_chaco
            ORDER BY nam;
        """)
        departamentos = [r[0] for r in cur.fetchall()]
        cur.close()
        conn.close()
        return {"departamentos": departamentos}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# --- Endpoint KPIs ---
@app.get("/api/kpis")
def obtener_kpis(depto: str = "todos"):
    try:
        conn = psycopg2.connect(**DB_CONFIG)
        cur = conn.cursor()

        filtro = ""
        if depto.lower() != "todos":
            filtro = f"""WHERE p."CMU" IN (
                            SELECT g."CMU"
                            FROM gob_locales_2022 g
                            LEFT JOIN dpto_chaco d ON g."COD_DEPTO" = d.in1
                            WHERE d.nam ILIKE '%{depto}%'
                        )"""

        # KPIs por estado
        cur.execute(f"""
            SELECT COALESCE(es.nombre_estado,'No Revisado') AS estado, COUNT(*) AS cantidad
            FROM pjes_censal_2022 p
            LEFT JOIN estado_situacion es ON p.id_estado = es.id_estado
            {filtro}
            GROUP BY es.nombre_estado;
        """)
        total_por_estado = [{"estado": r[0], "cantidad": r[1]} for r in cur.fetchall()]

        # KPIs por municipio
        cur.execute(f"""
            SELECT COALESCE(g.nam,'Sin Municipio') AS municipio, COUNT(*) AS cantidad
            FROM pjes_censal_2022 p
            LEFT JOIN gob_locales_2022 g ON p."CMU" = g."CMU"
            {filtro}
            GROUP BY g.nam;
        """)
        por_municipio = [{"municipio": r[0], "cantidad": r[1]} for r in cur.fetchall()]

        # KPIs por departamento
        cur.execute(f"""
            SELECT COALESCE(d.nam,'Sin Departamento') AS departamento, COUNT(*) AS cantidad
            FROM pjes_censal_2022 p
            LEFT JOIN gob_locales_2022 g ON p."CMU" = g."CMU"
            LEFT JOIN dpto_chaco d ON g."COD_DEPTO" = d.in1
            {filtro}
            GROUP BY d.nam;
        """)
        por_departamento = [{"departamento": r[0], "cantidad": r[1]} for r in cur.fetchall()]

        cur.close()
        conn.close()

        return JSONResponse({
            "total_por_estado": total_por_estado,
            "por_municipio": por_municipio,
            "por_departamento": por_departamento
        })

    except Exception as e:
        print("Error obteniendo KPIs:", e)
        raise HTTPException(status_code=500, detail=str(e))

# --- Servir frontend ---
app.mount("/frontend", StaticFiles(directory=FRONTEND_PATH), name="frontend")

@app.get("/")
def serve_index():
    return FileResponse(os.path.join(FRONTEND_PATH, "index.html"))
