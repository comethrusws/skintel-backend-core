#!/bin/bash
set -e

echo "Starting FastAPI landmarks service..."
cd /app/landmarks
python -m uvicorn main:app --host 0.0.0.0 --port 8000 &
FASTAPI_PID=$!
echo "FastAPI started with PID $FASTAPI_PID"

echo "Waiting for FastAPI to be ready..."
sleep 8

# Check if FastAPI is responding
echo "Checking FastAPI health..."
for i in {1..10}; do
  if curl -f http://localhost:8000/health > /dev/null 2>&1; then
    echo "FastAPI is ready!"
    break
  fi
  echo "Waiting for FastAPI... ($i/10)"
  sleep 2
done

echo "Starting Express backend..."
cd /app/backend
node dist/index.js &
EXPRESS_PID=$!
echo "Express started with PID $EXPRESS_PID"

# Wait for Express to exit (keeps container running)
wait $EXPRESS_PID
