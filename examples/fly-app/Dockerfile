FROM mcr.microsoft.com/playwright:v1.62.1-noble

WORKDIR /app

# Copy the scaffolded server files
COPY server.ts package.json ./

# Install dependencies
RUN npm install

EXPOSE 3000

ENV PORT=3000
ENV DATA_DIR=/data

CMD ["node", "--experimental-transform-types", "server.ts"]
