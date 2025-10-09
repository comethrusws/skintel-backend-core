FROM python:3.11-slim

WORKDIR /app
ENV PYTHONUNBUFFERED=1

# install system deps needed to build dlib (and OpenCV runtime deps)
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
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt download_model.py main.py main_face_recognition.py ./
COPY .gitignore ./

RUN pip install --upgrade pip setuptools wheel
RUN pip install -r requirements.txt

EXPOSE 8000

# start: download model if missing and run
CMD ["sh", "-c", "python download_model.py && uvicorn main:app --host 0.0.0.0 --port 8000 --reload"]
