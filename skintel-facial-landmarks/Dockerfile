FROM python:3.12-alpine

WORKDIR /app

COPY requirements.txt .

# Install dlib wheel first, then other requirements
COPY dlib-20.0.99-cp310-cp310-manylinux2014_x86_64.manylinux_2_17_x86_64.whl .
RUN pip install dlib-20.0.99-cp310-cp310-manylinux2014_x86_64.manylinux_2_17_x86_64.whl

RUN pip install -r requirements.txt

COPY . .

# Make run.sh executable
RUN chmod +x run.sh

EXPOSE 8000

CMD ["./run.sh"]
