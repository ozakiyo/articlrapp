# Node.js 20 の軽量イメージ
#FROM node:20-alpine
FROM node:20-slim

# 作業ディレクトリ
WORKDIR /root/app

#ここ追加
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

# server/package*.json をコピーして依存インストール
COPY package*.json ./
RUN npm install

#ここ追加
RUN npx playwright install --with-deps

# server 内のコードをコピー
COPY . .

# PORT は Render が自動設定
ENV PORT $PORT
EXPOSE $PORT

# サーバー起動
CMD ["node", "app.js"]

