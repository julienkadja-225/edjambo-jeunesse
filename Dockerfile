# Image de production : l'interface compilée est servie par le serveur Node (un seul conteneur, un seul port).
FROM node:24-alpine AS build
WORKDIR /app
COPY client/package.json client/package-lock.json client/
RUN npm --prefix client ci
COPY client client
RUN npm --prefix client run build

FROM node:24-alpine
ENV NODE_ENV=production \
    PORT=4000 \
    DB_PATH=/data/edjambo.db \
    UPLOAD_DIR=/data/uploads \
    BACKUP_DIR=/data/backups
WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev
COPY server/ ./
COPY --from=build /app/client/dist /app/client/dist
RUN mkdir -p /data && chown -R node:node /data /app
VOLUME /data
EXPOSE 4000
USER node
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s CMD wget -qO- http://localhost:${PORT}/api/health || exit 1
CMD ["node", "--no-warnings", "src/index.js"]
