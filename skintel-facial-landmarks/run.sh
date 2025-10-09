#!/bin/bash

echo "Starting Facial Landmarks API..."

# download dlib model if not exists
python download_model.py

# start the FastAPI server
uvicorn main:app --host 0.0.0.0 --port 8000 --reload