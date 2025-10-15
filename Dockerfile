# ============================
# Simplified build for Express + FastAPI services
# ============================

FROM python:3.12-slim

WORKDIR /app

# Install system dependencies (including OpenGL for OpenCV)
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
    libgl1-mesa-dri \
    libglib2.0-0 \
    libfontconfig1 \
    libxcb1 \
    libgomp1 \
    && rm -rf /var/lib/apt/lists/*

# Install Node.js
RUN curl -fsSL https://deb.nodesource.com/setup_18.x | bash - && \
    apt-get install -y nodejs && \
    rm -rf /var/lib/apt/lists/*

# Copy and install Python dependencies first (better caching)
COPY skintel-facial-landmarks/requirements.txt /app/landmarks/requirements.txt
COPY dlib-20.0.99-cp312-cp312-manylinux2014_x86_64.manylinux_2_17_x86_64.whl /tmp/
RUN pip install --upgrade pip setuptools wheel && \
    pip install /tmp/dlib-20.0.99-cp312-cp312-manylinux2014_x86_64.manylinux_2_17_x86_64.whl && \
    pip install -r /app/landmarks/requirements.txt && \
    rm -f /tmp/dlib-20.0.99-cp312-cp312-manylinux2014_x86_64.manylinux_2_17_x86_64.whl

# Copy FastAPI service
COPY skintel-facial-landmarks/ /app/landmarks/
WORKDIR /app/landmarks
RUN python download_model.py

# Copy and install Node.js dependencies
WORKDIR /app/backend
COPY skintel-backend/package*.json ./
RUN npm ci

# Copy backend source and build (including prisma schema first)
COPY skintel-backend/prisma ./prisma/
RUN npx prisma generate

# Copy the rest of the backend source
COPY skintel-backend/ ./
RUN npm run build

# Ensure generated Prisma files are in the right place
RUN cp -r node_modules/.prisma dist/ && \
    cp -r prisma/generated dist/ 2>/dev/null || true

# Copy startup script
COPY start.sh /app/start.sh
RUN chmod +x /app/start.sh

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