FROM node:20-alpine

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY server.js ./
COPY src ./src
COPY scripts ./scripts
COPY sql ./sql

ENV PORT=3000
EXPOSE 3000

USER node

CMD ["sh", "-c", "node scripts/migrate.js && node server.js"]
