# syntax=docker/dockerfile:1.7
#
# AgentOS backend image (API, worker and scheduler share this image).
#
# Build context is the REPOSITORY ROOT, because the backend depends on the
# original `acbe` library package that lives there:
#
#   docker build -f backend/Dockerfile -t agentos-backend:local .
#   (or: cd backend && docker compose build)
#
# Stages:
#   builder  – builds wheels for acbe + agentos-backend and every dependency.
#   api      – minimal runtime: no compilers, no source tree, non-root (uid 10001).
#
# The same `api` target runs the other processes via a command override:
#   worker:     agentos-worker --queues planning,execution,memory,notifications,files,maintenance,evaluation
#   scheduler:  agentos-scheduler
#   migrations: alembic upgrade head
#
# Proxy headers: the default CMD trusts X-Forwarded-* from any peer
# (`--forwarded-allow-ips '*'`). That is only safe when the container is reachable
# exclusively through a trusted reverse proxy / ingress. In Kubernetes the manifests
# drop the flag and set FORWARDED_ALLOW_IPS to the ingress controller's address
# range instead (uvicorn reads that variable when the flag is absent). Per-IP rate
# limits and audit IPs depend on this being correct.

ARG PYTHON_IMAGE=python:3.11-slim-bookworm

# --------------------------------------------------------------------------- builder
FROM ${PYTHON_IMAGE} AS builder

ENV PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PYTHONDONTWRITEBYTECODE=1

# Compilers are only present in this stage (for any dependency without a binary wheel).
# Not version-pinned: Debian removes superseded package versions from its mirrors, and nothing
# from this stage except the built wheels reaches the runtime image.
# hadolint ignore=DL3008
RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /src

# Root `acbe` library (the backend imports it at runtime).
COPY pyproject.toml README.md ./
COPY acbe ./acbe
COPY benchmarks ./benchmarks

# Backend package metadata first, then sources.
COPY backend/pyproject.toml backend/README.md ./backend/
COPY backend/app ./backend/app

# Optional extras baked into the image (comma separated, e.g. "otlp").
# The browser extra is NOT installed here: Chromium lives in the separate browser image.
ARG BACKEND_EXTRAS=otlp

RUN python -m pip wheel --wheel-dir /wheels ./ \
    && if [ -n "${BACKEND_EXTRAS}" ]; then spec="./backend[${BACKEND_EXTRAS}]"; else spec="./backend"; fi \
    && python -m pip wheel --wheel-dir /wheels "${spec}"

# --------------------------------------------------------------------------- runtime
FROM ${PYTHON_IMAGE} AS api

LABEL org.opencontainers.image.title="agentos-backend" \
      org.opencontainers.image.description="AgentOS API / worker / scheduler" \
      org.opencontainers.image.licenses="MIT"

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONFAULTHANDLER=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    APP_ENV=production \
    LOG_JSON=true

RUN groupadd --system --gid 10001 agentos \
    && useradd --system --uid 10001 --gid agentos --home-dir /home/agentos --create-home \
       --shell /usr/sbin/nologin agentos

# Install exactly the wheels built above, offline. The wheel directory is bind-mounted
# from the builder, so it never becomes an image layer. Bytecode is compiled here, at
# build time; PYTHONDONTWRITEBYTECODE only stops the (read-only) runtime from writing it.
RUN --mount=type=bind,from=builder,source=/wheels,target=/wheels \
    python -m pip install --no-index /wheels/*.whl

WORKDIR /app

# Runtime files that are not part of the Python package: migrations and ops scripts.
COPY --chown=10001:10001 backend/alembic.ini ./alembic.ini
COPY --chown=10001:10001 backend/migrations ./migrations
COPY --chown=10001:10001 backend/scripts ./scripts

# Writable data directory for the *local* object-storage backend (development only;
# staging/production refuse OBJECT_STORAGE_BACKEND=local). Named volumes mounted here
# inherit this ownership.
RUN mkdir -p /app/.data/objects && chown -R 10001:10001 /app/.data

USER 10001:10001

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD ["python", "-c", "import sys, urllib.request; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/api/v1/live', timeout=4).status == 200 else 1)"]

CMD ["uvicorn", "--factory", "app.main:app_factory", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips", "*"]
