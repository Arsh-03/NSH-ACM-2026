# Use Ubuntu 22.04 as the required runtime base image.
FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# System packages needed for Python, numerical libraries, and the frontend build.
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    ca-certificates \
    curl \
    git \
    gnupg \
    python3 \
    python3-pip \
    python3-venv \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

# Install backend dependencies first so Docker can cache them efficiently.
COPY requirements.txt ./
RUN python3 -m pip install --upgrade pip \
    && python3 -m pip install -r requirements.txt

# Build the frontend into frontend/dist so FastAPI can serve it.
COPY frontend/package.json frontend/package.json
WORKDIR /app/frontend
RUN npm install
COPY frontend/ ./
RUN npm run build

# Copy the backend and shared project files.
WORKDIR /app
COPY . ./

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]