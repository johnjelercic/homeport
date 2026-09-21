FROM node:20-alpine

# better-sqlite3 needs build tools to compile its native binding on install
RUN apk add --no-cache python3 make g++

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY server ./server
COPY public ./public
COPY VERSION ./VERSION

ENV DATA_DIR=/app/data
ENV PORT=19156
ENV SYNC_INTERVAL_MINUTES=15

VOLUME ["/app/data", "/app/public/photos"]
EXPOSE 19156

CMD ["node", "server/index.js"]
