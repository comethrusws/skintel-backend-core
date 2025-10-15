# ============================
# Simplified build for Express + FastAPI services
# ============================

FROM python:3.11-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    wget \
    ca-certificates \
    build-essential \
    cmake \
    pkg-config \
    libopenblas-dev \
    liblapack-dev \
    libx11-6 \
    libgtk-3-0 \
    libsm6 \
    libxext6 \
    libxrender-dev \
    && rm -rf /var/lib/apt/lists/*

# Install Node.js
RUN curl -fsSL https://deb.nodesource.com/setup_18.x | bash - && \
    apt-get install -y nodejs && \
    rm -rf /var/lib/apt/lists/*

# Copy and install Python dependencies first (better caching)
COPY skintel-facial-landmarks/requirements.txt /app/landmarks/requirements.txt
COPY dlib-20.0.99-cp311-cp311-manylinux2014_x86_64.manylinux_2_17_x86_64.whl /tmp/
RUN pip install --upgrade pip setuptools wheel && \
    pip install /tmp/dlib-20.0.99-cp311-cp311-manylinux2014_x86_64.manylinux_2_17_x86_64.whl && \
    pip install -r /app/landmarks/requirements.txt && \
    rm -f /tmp/dlib-20.0.99-cp311-cp311-manylinux2014_x86_64.manylinux_2_17_x86_64.whl

# Copy FastAPI service
COPY skintel-facial-landmarks/ /app/landmarks/
WORKDIR /app/landmarks
RUN python download_model.py

# Copy and install Node.js dependencies
WORKDIR /app/backend
COPY skintel-backend/package*.json ./
RUN npm ci

# Copy backend source and build
COPY skintel-backend/ ./
RUN npx prisma generate && npm run build

# Create startup script
WORKDIR /app
RUN echo '#!/bin/bash' > /app/start.sh && \
    echo 'echo "Starting FastAPI landmarks service..."' >> /app/start.sh && \
    echo 'cd /app/landmarks && python -m uvicorn main:app --host 0.0.0.0 --port 8000 &' >> /app/start.sh && \
    echo 'FASTAPI_PID=$!' >> /app/start.sh && \
    echo 'echo "FastAPI started with PID $FASTAPI_PID"' >> /app/start.sh && \
    echo 'echo "Waiting for FastAPI to be ready..."' >> /app/start.sh && \
    echo 'sleep 5' >> /app/start.sh && \
    echo 'echo "Starting Express backend..."' >> /app/start.sh && \
    echo 'cd /app/backend && node dist/index.js &' >> /app/start.sh && \
    echo 'EXPRESS_PID=$!' >> /app/start.sh && \
    echo 'echo "Express started with PID $EXPRESS_PID"' >> /app/start.sh && \
    echo 'wait $EXPRESS_PID' >> /app/start.sh && \
    chmod +x /app/start.sh

# Environment variables
ENV NODE_ENV=production
ENV PORT=3000
ENV LANDMARK_URL=http://localhost:8000

# Only expose Express backend port
EXPOSE 3000

# Health check only for Express (since it's the only exposed service)
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1

CMD ["/app/start.sh"]