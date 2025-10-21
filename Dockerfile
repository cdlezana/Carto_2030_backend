# Imagen base
FROM python:3.11-slim

# Variables de entorno para no interactuar con apt
ENV DEBIAN_FRONTEND=noninteractive

# Instalar dependencias del sistema para GDAL y Postgres
RUN apt-get update && apt-get install -y \
    gdal-bin \
    libgdal-dev \
    build-essential \
    libpq-dev \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Directorio de la app
WORKDIR /app

# Copiar requirements
COPY requirements.txt .

# Instalar dependencias Python
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt

# Copiar el resto de la app
COPY backend ./backend
COPY frontend ./frontend

# Exponer puerto FastAPI
EXPOSE 8000

# Variables de entorno opcionales para Render
# Número de workers predeterminado, se puede sobrescribir desde Render
ENV WORKERS=1

# Comando para correr FastAPI
# En local puedes usar WORKERS=1, en Render puedes setear más
CMD ["sh", "-c", "uvicorn backend.main:app --host 0.0.0.0 --port 8000 --workers $WORKERS"]
