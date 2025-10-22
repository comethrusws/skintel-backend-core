FROM python:3.11-slim

# Install minimal system dependencies
RUN apt-get update && apt-get install -y \
    build-essential \
    cmake \
    libjpeg-dev \
    libpng-dev \
    libtiff-dev \
    libavcodec-dev \
    libavformat-dev \
    libswscale-dev \
    pkg-config \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Upgrade pip and install setuptools first
RUN pip install --upgrade pip setuptools wheel

COPY requirements.txt .

# Install packages in stages to use pre-built wheels where possible
RUN pip install --only-binary=all numpy==1.24.3
RUN pip install --only-binary=all opencv-python==4.8.1.78
RUN pip install --only-binary=all Pillow==10.0.1
RUN pip install --only-binary=all dlib-bin
RUN pip install -r requirements.txt

COPY . .

# Make run.sh executable
RUN chmod +x run.sh

EXPOSE 8000

CMD ["./run.sh"]
