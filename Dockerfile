# Imagens da API e do painel web, a partir do monorepo (npm workspaces).
# Usado pelo docker-compose.yml (`docker compose up --build`) e pelo Render, que constrói a
# ÚLTIMA imagem deste ficheiro quando não lhe é indicada outra: por isso a da API fica no fim.
# A app mobile (Expo) não entra aqui: corre no computador de quem desenvolve.

FROM node:24-slim AS base
# O Prisma precisa do OpenSSL para falar com o PostgreSQL.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

# Dependências só da API e da web (as da app mobile ficam de fora). Os package.json vêm
# primeiro, sozinhos, para o Docker reaproveitar esta camada enquanto não mudarem.
FROM base AS deps
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/mobile/package.json apps/mobile/
COPY packages/types/package.json packages/types/
COPY packages/validation/package.json packages/validation/
# O postinstall da API corre `prisma generate`, que precisa do schema.
COPY apps/api/prisma apps/api/prisma
COPY apps/api/prisma.config.ts apps/api/
RUN npm ci --workspace apps/api --workspace apps/web

# ---------- Painel web ----------
FROM deps AS web
COPY packages packages
COPY apps/web apps/web
WORKDIR /app/apps/web
# O Next grava estes endereços no build (ver next.config.ts), por isso entram como argumentos.
ARG NEXT_API_URL=http://api:3000/api/v1
ARG NEXT_APP_URL=http://localhost:3001
ARG NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=
ENV NEXT_API_URL=$NEXT_API_URL \
    NEXT_APP_URL=$NEXT_APP_URL \
    NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=$NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
RUN npm run build
EXPOSE 3001
CMD ["npx", "next", "start", "-p", "3001"]

# ---------- API (a imagem por omissão: tem de ser a última) ----------
FROM deps AS api
COPY packages packages
COPY apps/api apps/api
WORKDIR /app/apps/api
RUN npx prisma generate
# Em produção (Render) a porta vem da variável PORT, que a API lê; 3000 é a local.
EXPOSE 3000
# Aplica as migrações pendentes e arranca. Os dados de exemplo (contas com uma password
# pública) NÃO são criados aqui: só o docker-compose.yml os pede, para desenvolvimento.
CMD ["sh", "-c", "npx prisma migrate deploy && npx tsx src/app/server.ts"]
