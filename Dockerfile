# syntax=docker/dockerfile:1
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=8790 DB_PATH=/data/boo.db
RUN apk add --no-cache wget
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY server ./server
RUN mkdir -p /data && printf 'soon\n' > /data/contract.txt
ENV CONTRACT_FILE=/data/contract.txt
VOLUME ["/data"]
EXPOSE 8790
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD wget -qO- http://127.0.0.1:8790/api/health | grep -q '"ok":true' || exit 1
CMD ["node", "server/index.js"]
