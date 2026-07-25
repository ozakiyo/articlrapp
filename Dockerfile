# articleappNode — ルート app.js 用（ローカル Docker）
FROM node:20-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
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
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

RUN npx playwright install --with-deps chromium

COPY . .

ENV PORT=3050
ENV PLAYWRIGHT_CHROMIUM_NO_SANDBOX=1
EXPOSE 3050

CMD ["node", "app.js"]
