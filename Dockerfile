# ============================
# Multi-stage build for Express + FastAPI services
# ============================

# ---------- Stage 1: Build Node.js backend ----------
    FROM node:18-slim AS backend-builder

    WORKDIR /app/backend
    
    # Install dependencies (including devDependencies for build)
    COPY skintel-backend/package*.json ./
    RUN npm ci
    
    # Copy backend source and build
    COPY skintel-backend/ ./
    RUN npx prisma generate
    RUN npm run build
    
    
    # ---------- Stage 2: Build Python environment for FastAPI ----------
    FROM python:3.11-slim AS python-base
    
    # Install runtime libs for OpenCV, dlib, and system tools
    RUN apt-get update && apt-get install -y --no-install-recommends \
        wget \
        curl \
        ca-certificates \
        libopenblas0 \
        liblapack3 \
        libx11-6 \
        libgtk-3-0 \
        libsm6 \
        libxext6 \
        libxrender-dev \
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
    # Install prebuilt dlib wheel first to avoid compiling from source
    COPY dlib-20.0.99-cp311-cp311-manylinux2014_x86_64.manylinux_2_17_x86_64.whl /tmp/
    RUN pip install --upgrade pip setuptools wheel && \
        pip install /tmp/dlib-20.0.99-cp311-cp311-manylinux2014_x86_64.manylinux_2_17_x86_64.whl && \
        pip install -r /app/landmarks/requirements.txt && \
        rm -f /tmp/dlib-20.0.99-cp311-cp311-manylinux2014_x86_64.manylinux_2_17_x86_64.whl
    
    # Copy FastAPI service files
    COPY skintel-facial-landmarks/ /app/landmarks/
    WORKDIR /app/landmarks
    RUN python download_model.py
    WORKDIR /app
    
    # Copy Node.js runtime and built backend INCLUDING Prisma generated files
    COPY --from=backend-builder /app/backend/node_modules /app/backend/node_modules
    COPY --from=backend-builder /app/backend/dist /app/backend/dist
    COPY --from=backend-builder /app/backend/package*.json /app/backend/
    COPY --from=backend-builder /app/backend/generated /app/backend/generated
    COPY skintel-backend/prisma /app/backend/prisma
    
    # Create supervisor config directory and logs
    RUN mkdir -p /etc/supervisor/conf.d /var/log/supervisor
    
    # Create startup script with environment variables
    COPY <<'SCRIPT' /app/start.sh
    #!/bin/bash
    set -e
    
    # Generate supervisor config with environment variables passed through
    cat > /etc/supervisor/conf.d/supervisord.conf << 'EOF'
    [supervisord]
    nodaemon=true
    user=root
    logfile=/var/log/supervisor/supervisord.log
    pidfile=/var/run/supervisord.pid
    
    [program:express-backend]
    command=bash -c "cd /app/backend && node dist/index.js"
    autostart=true
    autorestart=true
    stderr_logfile=/var/log/supervisor/express.err.log
    stdout_logfile=/var/log/supervisor/express.out.log
    
    [program:fastapi-landmarks]
    command=bash -c "cd /app/landmarks && uvicorn main:app --host 0.0.0.0 --port 8000"
    autostart=true
    autorestart=true
    stderr_logfile=/var/log/supervisor/fastapi.err.log
    stdout_logfile=/var/log/supervisor/fastapi.out.log
    EOF
    
    # Start supervisord
    exec /usr/bin/supervisord -c /etc/supervisor/conf.d/supervisord.conf
    SCRIPT
    
    RUN chmod +x /app/start.sh
    
    # ---------- Environment variables ----------
    ENV NODE_ENV=production
    ENV PORT=3000
    ENV LANDMARK_URL=http://localhost:8000
    
    # ---------- Ports and health check ----------
    EXPOSE 3000 8000
    
    HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
      CMD curl -f http://localhost:3000/health && curl -f http://localhost:8000/health || exit 1
    
    # ---------- Start both services ----------
    CMD ["/app/start.sh"]