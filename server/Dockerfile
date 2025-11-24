# Node.js 20 の軽量イメージ
FROM node:20-alpine

# 作業ディレクトリ
WORKDIR /root/app

# server/package*.json をコピーして依存インストール
COPY package*.json ./
RUN npm install

# server 内のコードをコピー
COPY ...

# PORT は Render が自動設定
ENV PORT $PORT
EXPOSE $PORT

# サーバー起動
CMD ["node", "app.js"]

