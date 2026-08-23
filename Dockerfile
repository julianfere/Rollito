# Rollito — imagen de producción.
#
# Multi-stage para que la imagen final no cargue con el toolchain de compilación
# ni con las dependencias de desarrollo (Vite, React, etc.).
#
# Base Debian (bookworm-slim) y no Alpine a propósito: `sharp` y
# `better-sqlite3` traen binarios precompilados para glibc, así que en Debian
# se instalan sin compilar nada. En Alpine (musl) habría que compilarlos,
# lo que en una Raspberry Pi son varios minutos y ~500 MB de toolchain.

# ---------- 1. dependencias de producción ----------
FROM node:20-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# `npm ci --omit=dev` deja sólo lo que el server necesita en runtime.
RUN npm ci --omit=dev \
 # better-sqlite3 guarda los objetos de compilación (~10 MB) que no se usan
 # en runtime; el .node ya construido es lo único que hace falta.
 && rm -rf node_modules/better-sqlite3/build/Release/obj.target \
           node_modules/better-sqlite3/build/Release/.deps \
           node_modules/better-sqlite3/deps \
           node_modules/better-sqlite3/src \
 # Restos de compilación y documentación de todo el árbol.
 && find node_modules -name "*.o" -o -name "*.a" -delete 2>/dev/null || true \
 && rm -rf node_modules/**/test node_modules/**/tests \
           node_modules/**/*.md node_modules/**/.github 2>/dev/null || true

# ---------- 2. build del front ----------
FROM node:20-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY web ./web
RUN npm run build

# ---------- 3. imagen final ----------
FROM node:20-bookworm-slim AS runtime
ENV NODE_ENV=production \
    PORT=8087 \
    DATA_DIR=/data

WORKDIR /app

# curl para el healthcheck. fontconfig porque sharp lo pide al rasterizar SVG
# con texto (lo usa el seed); sin él tira "Cannot load default config file".
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl fontconfig \
 && rm -rf /var/lib/apt/lists/*

COPY --from=deps  /app/node_modules ./node_modules
COPY --from=build /app/web/dist     ./web/dist
COPY package.json ./
COPY server ./server

# El volumen de datos tiene que pertenecer al usuario que corre el proceso:
# node:20 ya trae el usuario `node` (uid 1000), así no corremos como root.
RUN mkdir -p /data/originals /data/previews /data/zips \
 && chown -R node:node /data /app

USER node
VOLUME ["/data"]
EXPOSE 8087

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS "http://127.0.0.1:${PORT}/api/health" || exit 1

CMD ["node", "server/index.js"]
