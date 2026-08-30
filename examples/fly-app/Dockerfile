FROM mcr.microsoft.com/playwright:v1.62.1-noble

WORKDIR /app

COPY package.json nub.lock ./
COPY packages ./packages

RUN npm install -g @nubjs/nub
RUN nub install

EXPOSE 3000

ENV PORT=3000
ENV DATA_DIR=/data

CMD ["nub", "packages/node-server/src/index.ts", "serve", "--port", "3000", "--data-dir", "/data"]
