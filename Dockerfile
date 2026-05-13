# フロント（client）をビルドして server/public に含めた本番用イメージ
FROM node:20-slim AS client-build
WORKDIR /app/client
COPY client/package*.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

FROM node:20-slim
WORKDIR /root/app

RUN apt-get update && apt-get install -y \
    libnss3 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libxkbcommon0 \
    libatspi2.0-0 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    libgbm1 \
    libpango-1.0-0 \
    libcairo2 \
    libasound2 \
    libharfbuzz0b \
    fonts-ipafont-gothic \
    && rm -rf /var/lib/apt/lists/*

COPY server/package*.json ./
RUN npm ci
RUN npx playwright install --with-deps

COPY server/ ./
COPY --from=client-build /app/server/public ./public

ENV PORT=3001
EXPOSE 3001

CMD ["node", "app.js"]
