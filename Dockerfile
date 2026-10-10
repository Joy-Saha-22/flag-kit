# API image: Express server plus the pure evaluator workspace package.
# MongoDB and Redis stay outside this image (compose or a hosted pair).
FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json ./
COPY server/package.json ./server/
COPY packages/evaluator/package.json ./packages/evaluator/
COPY client/package.json ./client/
COPY sdk/package.json ./sdk/

RUN npm ci --omit=dev --workspace=@flagkit/server --workspace=@flagkit/evaluator

COPY packages/evaluator ./packages/evaluator
COPY server ./server

ENV NODE_ENV=production
EXPOSE 3000

USER node
CMD ["node", "server/src/server.js"]
