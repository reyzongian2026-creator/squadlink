FROM node:24-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund
COPY --chown=node:node server.mjs room-music.mjs social.mjs progression.mjs postgres-store.mjs ./
COPY --chown=node:node public/ ./public/
USER node
EXPOSE 4179
CMD ["node", "server.mjs"]
