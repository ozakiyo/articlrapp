# Node.js 20 の軽量イメージ
FROM node:20-alpine

# 作業ディレクトリ
WORKDIR /root/app

# package.json と package-lock.json をコピー
COPY server/package*.json ./

# 依存関係をインストール
RUN npm install

# サーバーコードをコピー
COPY server/ .

# 環境変数 PORT は Render が自動設定
ENV PORT $PORT
EXPOSE $PORT

# サーバー起動
CMD ["node", "app.js"]
