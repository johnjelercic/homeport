# Build stage — needs python3/make/g++ to compile better-sqlite3's native
# binding, plus the full npm cache. None of this belongs in the final
# image; it only exists to produce node_modules.
FROM node:20-alpine AS build

RUN apk add --no-cache python3 make g++

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

# Final stage — a clean base with nothing but the runtime and the already-
# compiled node_modules copied over, so the compiler toolchain and npm's
# download cache never ship to the NAS.
FROM node:20-alpine

WORKDIR /app

COPY --from=build /app/node_modules ./node_modules
COPY package*.json ./
COPY server ./server
COPY public ./public
COPY VERSION ./VERSION

ENV DATA_DIR=/app/data
ENV PORT=19156
ENV SYNC_INTERVAL_MINUTES=15

VOLUME ["/app/data", "/app/public/photos"]
EXPOSE 19156

CMD ["node", "server/index.js"]
