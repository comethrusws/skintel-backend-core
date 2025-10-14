# ============================
# Multi-stage build for Express + FastAPI services
# ============================

# ---------- Stage 1: Build Node.js backend ----------
FROM node:18-slim AS backend-builder

WORKDIR /app/backend

# Install dependencies
COPY skintel-backend/package*.json ./
RUN npm ci --omit=dev

# Copy backend source and build
COPY skintel-backend/ ./
RUN npm run build


# ---------- Stage 2: Build Python environment for FastAPI ----------
FROM python:3.11-slim AS python-base

# Install system dependencies for dlib and OpenCV
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    cmake \
    pkg-config \
    wget \
    curl \
    ca-certificates \
    libopenblas-dev \
    liblapack-dev \
    libx11-dev \
    libgtk-3-dev \
    libboost-all-dev \
    supervisor \
 && rm -rf /var/lib/apt/lists/*


# ---------- Stage 3: Final runtime image ----------
FROM python-base AS runtime

WORKDIR /app

# Install Node.js runtime first
RUN curl -fsSL https://deb.nodesource.com/setup_18.x | bash - && \
    apt-get install -y nodejs && \
    rm -rf /var/lib/apt/lists/*

# Copy Python requirements and install
COPY skintel-facial-landmarks/requirements.txt /app/landmarks/
RUN pip install --upgrade pip setuptools wheel && \
    pip install -r /app/landmarks/requirements.txt

# Copy FastAPI service files
COPY skintel-facial-landmarks/ /app/landmarks/
WORKDIR /app/landmarks
RUN python download_model.py
WORKDIR /app

# Copy Node.js runtime and built backend
COPY --from=backend-builder /app/backend/node_modules /app/backend/node_modules
COPY --from=backend-builder /app/backend/dist /app/backend/dist
COPY --from=backend-builder /app/backend/package*.json /app/backend/
COPY skintel-backend/prisma /app/backend/prisma

# Create supervisor config
RUN mkdir -p /etc/supervisor/conf.d
COPY <<EOF /etc/supervisor/conf.d/supervisord.conf
[supervisord]
nodaemon=true
user=root
logfile=/var/log/supervisor/supervisord.log
pidfile=/var/run/supervisord.pid

[program:express-backend]
command=node dist/index.js
directory=/app/backend
autostart=true
autorestart=true
stderr_logfile=/var/log/supervisor/express.err.log
stdout_logfile=/var/log/supervisor/express.out.log
environment=NODE_ENV=production,PORT=3000

[program:fastapi-landmarks]
command=uvicorn main:app --host 0.0.0.0 --port 8000
directory=/app/landmarks
autostart=true
autorestart=true
stderr_logfile=/var/log/supervisor/fastapi.err.log
stdout_logfile=/var/log/supervisor/fastapi.out.log
EOF

# ---------- Environment variables ----------
ENV NODE_ENV=production
ENV PORT=3000
ENV LANDMARK_URL=http://localhost:8000
# DATABASE_URL should be provided at runtime via environment variable
# ENV DATABASE_URL will be set when running the container

# ---------- Ports and health check ----------
EXPOSE 3000 8000

HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD curl -f http://localhost:3000/health && curl -f http://localhost:8000/health || exit 1

# ---------- Start both services ----------
CMD ["/usr/bin/supervisord", "-c", "/etc/supervisor/conf.d/supervisord.conf"]
