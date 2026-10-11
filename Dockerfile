# API image: the Express server plus the evaluator workspace package.
# MongoDB and Redis stay outside the image. Configuration comes from environment
# variables at run time (see .env.example); nothing secret is baked into the image.
FROM node:22-alpine

ENV NODE_ENV=production
WORKDIR /app

# Install production dependencies first, so this layer is reused until a package.json changes.
COPY package.json package-lock.json ./
COPY server/package.json ./server/
COPY packages/evaluator/package.json ./packages/evaluator/
COPY client/package.json ./client/
COPY sdk/package.json ./sdk/
RUN npm ci --omit=dev --workspace=@flagkit/server --workspace=@flagkit/evaluator \
  && npm cache clean --force

# Only the source the server needs at run time (no tests, scripts, or benchmarks).
COPY packages/evaluator/src ./packages/evaluator/src
COPY server/src ./server/src

USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/src/server.js"]
