FROM mcr.microsoft.com/playwright:v1.52.0-noble

WORKDIR /app

COPY package.json nub.lock ./
COPY packages ./packages
COPY examples ./examples

RUN npm install -g @nub-tools/nub 2>/dev/null || true

EXPOSE 3000

ENV PORT=3000
ENV DATA_DIR=/data

CMD ["node", "packages/cli/dist/index.js", "serve", "--port", "3000", "--data-dir", "/data"]
