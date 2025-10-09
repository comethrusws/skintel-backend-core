#!/bin/bash

echo "🚀 Starting Skintel Services with Docker Compose"

# Build and start services
docker-compose up --build -d

echo "✅ Services started successfully!"
echo "📊 Express API: http://localhost:3000"
echo "🤖 FastAPI Landmarks: http://localhost:8000"
echo "📚 API Documentation: http://localhost:3000/docs"
echo "🔍 FastAPI Documentation: http://localhost:8000/docs"

echo ""
echo "📋 Useful commands:"
echo "  View logs: docker-compose logs -f"
echo "  Stop services: docker-compose down"
echo "  Restart: docker-compose restart"
echo ""

# Show service status
docker-compose ps
