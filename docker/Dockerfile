FROM python:3.12-slim

WORKDIR /app

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    ACBE_DB_PATH=/data/acbe.db

COPY pyproject.toml README.md ./
COPY acbe ./acbe
COPY benchmarks ./benchmarks

ARG EXTRAS="server,models"
RUN pip install --no-cache-dir ".[${EXTRAS}]"

EXPOSE 8420

RUN mkdir -p /data
VOLUME ["/data"]

ENTRYPOINT ["acbe"]
CMD ["serve", "--host", "0.0.0.0", "--port", "8420", "--db", "/data/acbe.db"]

