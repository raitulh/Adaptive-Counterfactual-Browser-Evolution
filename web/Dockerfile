# syntax=docker/dockerfile:1.7
#
# AgentOS web — production image (Next.js standalone server, non-root).
#
# Build context is the REPOSITORY ROOT so the build can verify the typed API client against the
# backend contract (backend/docs/openapi.json):
#
#   docker build -f web/Dockerfile -t agentos-web .
#   docker run -p 3000:3000 -e AGENTOS_API_ORIGIN=http://api:8000 agentos-web
#
# NEXT_PUBLIC_* values are inlined at build time (build args). AGENTOS_API_ORIGIN is read at
# request time by the same-origin API pass-through, so one image runs in every environment.

ARG NODE_IMAGE=node:22-bookworm-slim

FROM ${NODE_IMAGE} AS deps
WORKDIR /repo/web
COPY web/package.json web/package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund

FROM ${NODE_IMAGE} AS build
WORKDIR /repo/web
ENV NEXT_TELEMETRY_DISABLED=1
ARG NEXT_PUBLIC_API_URL=/api/v1
ARG NEXT_PUBLIC_SITE_URL=http://localhost:3000
ARG NEXT_PUBLIC_DEMO_MODE=false
ARG NEXT_PUBLIC_ANALYTICS_PROVIDER=none
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL} \
    NEXT_PUBLIC_SITE_URL=${NEXT_PUBLIC_SITE_URL} \
    NEXT_PUBLIC_DEMO_MODE=${NEXT_PUBLIC_DEMO_MODE} \
    NEXT_PUBLIC_ANALYTICS_PROVIDER=${NEXT_PUBLIC_ANALYTICS_PROVIDER}
COPY backend/docs/openapi.json /repo/backend/docs/openapi.json
COPY --from=deps /repo/web/node_modules ./node_modules
COPY web/ ./
# Fail the image build if the generated client drifted from the backend contract.
RUN npm run api:check && npm run build

FROM ${NODE_IMAGE} AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    AGENTOS_API_ORIGIN=http://api:8000
RUN groupadd --system --gid 10001 agentos && useradd --system --uid 10001 --gid agentos --no-create-home agentos
COPY --from=build --chown=10001:10001 /repo/web/.next/standalone ./
COPY --from=build --chown=10001:10001 /repo/web/.next/static ./.next/static
COPY --from=build --chown=10001:10001 /repo/web/public ./public
USER 10001
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=4s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
