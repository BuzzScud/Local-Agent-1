# Agentic Coder Web, the AI-server copy (chat + calculator; no folders or runs: Linux has no folder
# fence). Built from the repo's root:
#   docker compose -f terminal/app/web-container/compose.yml up -d --build
FROM oven/bun:1.4.2-slim
WORKDIR /app
COPY package.json bun.lock bunfig.toml ./
COPY terminal ./terminal
COPY models ./models
RUN bun install --production --frozen-lockfile --ignore-scripts
ENV AGENTIC_WEB_HOME=/data AGENTIC_WEB_MODE=server AGENTIC_WEB_TRUST_PROXY=1 AGENTIC_HOME=/data/agentic NODE_ENV=production
RUN mkdir -p /data && chown bun:bun /data
VOLUME /data
USER bun
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s CMD bun -e "fetch('http://127.0.0.1:8080/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["bun", "terminal/src/web/main.mjs", "run", "--server", "--port", "8080", "--host", "0.0.0.0", "--trust-proxy"]
