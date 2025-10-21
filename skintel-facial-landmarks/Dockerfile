FROM python:3.11-alpine

# Install build dependencies for dlib and other packages
RUN apk add --no-cache \
    build-base \
    cmake \
    gcc \
    g++ \
    make \
    libffi-dev \
    openssl-dev \
    libjpeg-turbo-dev \
    zlib-dev \
    freetype-dev \
    lcms2-dev \
    openjpeg-dev \
    tiff-dev \
    tk-dev \
    tcl-dev

WORKDIR /app

# Upgrade pip and install setuptools first
RUN pip install --upgrade pip setuptools wheel

COPY requirements.txt .

RUN pip install -vr requirements.txt

COPY . .

# Make run.sh executable
RUN chmod +x run.sh

EXPOSE 8000

CMD ["./run.sh"]
