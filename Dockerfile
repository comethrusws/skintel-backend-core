# Multi-stage build for Express + FastAPI services

# Stage 1: Build Node.js backend
FROM node:18-slim as backend-builder

WORKDIR /app/backend
COPY skintel-backend/package*.json ./
RUN npm ci --only=production

COPY skintel-backend/ ./
RUN npm run build

# Stage 2: Build Python environment for FastAPI
FROM python:3.11-slim as python-base

# Install system dependencies for dlib and OpenCV
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    cmake \
    pkg-config \
    wget \
    curl \
    ca-certificates \
    libopenblas-dev \
    libatlas-base-dev \
    liblapack-dev \
    libx11-dev \
    libgtk-3-dev \
    libboost-all-dev \
    supervisor \
    && rm -rf /var/lib/apt/lists/*

# Stage 3: Final runtime image
FROM python-base as runtime

WORKDIR /app

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

# Install Node.js runtime
RUN curl -fsSL https://deb.nodesource.com/setup_18.x | bash - && \
    apt-get install -y nodejs

# Create supervisor config
COPY docker/supervisord.conf /etc/supervisor/conf.d/supervisord.conf

# Environment variables
ENV NODE_ENV=production
ENV PORT=3000
ENV LANDMARK_URL=http://localhost:8000
ENV DATABASE_URL="postgresql://postgres:password@host.docker.internal:5432/skintel_db"
ENV JWT_SECRET=your-super-secret-jwt-key-change-this-in-production

# Expose ports
EXPOSE 3000 8000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD curl -f http://localhost:3000/health && curl -f http://localhost:8000/health || exit 1

# Start both services
CMD ["/usr/bin/supervisord", "-c", "/etc/supervisor/conf.d/supervisord.conf"]
