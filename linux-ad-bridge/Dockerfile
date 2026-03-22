FROM python:3.12-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
    samba-common-bin && \
    rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY server.py .
CMD ["python", "server.py"]
