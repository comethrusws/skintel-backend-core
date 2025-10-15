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
    
    # Create supervisor config that will use environment variables
    RUN echo '[supervisord]' > /etc/supervisor/conf.d/supervisord.conf && \
        echo 'nodaemon=true' >> /etc/supervisor/conf.d/supervisord.conf && \
        echo 'user=root' >> /etc/supervisor/conf.d/supervisord.conf && \
        echo 'logfile=/var/log/supervisor/supervisord.log' >> /etc/supervisor/conf.d/supervisord.conf && \
        echo 'pidfile=/var/run/supervisord.pid' >> /etc/supervisor/conf.d/supervisord.conf && \
        echo '' >> /etc/supervisor/conf.d/supervisord.conf && \
        echo '[program:express-backend]' >> /etc/supervisor/conf.d/supervisord.conf && \
        echo 'command=bash -c "cd /app/backend && node dist/index.js"' >> /etc/supervisor/conf.d/supervisord.conf && \
        echo 'directory=/app/backend' >> /etc/supervisor/conf.d/supervisord.conf && \
        echo 'autostart=true' >> /etc/supervisor/conf.d/supervisord.conf && \
        echo 'autorestart=true' >> /etc/supervisor/conf.d/supervisord.conf && \
        echo 'stderr_logfile=/var/log/supervisor/express.err.log' >> /etc/supervisor/conf.d/supervisord.conf && \
        echo 'stdout_logfile=/var/log/supervisor/express.out.log' >> /etc/supervisor/conf.d/supervisord.conf && \
        echo '' >> /etc/supervisor/conf.d/supervisord.conf && \
        echo '[program:fastapi-landmarks]' >> /etc/supervisor/conf.d/supervisord.conf && \
        echo 'command=bash -c "cd /app/landmarks && uvicorn main:app --host 0.0.0.0 --port 8000"' >> /etc/supervisor/conf.d/supervisord.conf && \
        echo 'directory=/app/landmarks' >> /etc/supervisor/conf.d/supervisord.conf && \
        echo 'autostart=true' >> /etc/supervisor/conf.d/supervisord.conf && \
        echo 'autorestart=true' >> /etc/supervisor/conf.d/supervisord.conf && \
        echo 'stderr_logfile=/var/log/supervisor/fastapi.err.log' >> /etc/supervisor/conf.d/supervisord.conf && \
        echo 'stdout_logfile=/var/log/supervisor/fastapi.out.log' >> /etc/supervisor/conf.d/supervisord.conf
    
    # ---------- Environment variables ----------
    ENV NODE_ENV=production
    ENV PORT=3000
    ENV LANDMARK_URL=http://localhost:8000
    
    # ---------- Ports and health check ----------
    EXPOSE 3000 8000
    
    HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
      CMD curl -f http://localhost:3000/health && curl -f http://localhost:8000/health || exit 1
    
    # ---------- Start both services ----------
    CMD ["/usr/bin/supervisord", "-c", "/etc/supervisor/conf.d/supervisord.conf"]