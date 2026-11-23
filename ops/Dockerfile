FROM node:24-alpine
WORKDIR /app
COPY --chown=node:node server.mjs ./
COPY --chown=node:node public/ ./public/
USER node
EXPOSE 4179
CMD ["node", "server.mjs"]
