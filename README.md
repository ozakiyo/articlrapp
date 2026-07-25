# articleappNode

articleapp を **HTML / CSS / 素の JavaScript** と **Node.js + Express + EJS** で動かす版です。React や Vite は不要です。

## 機能

- 競合調査（ランキング商品抽出）
- 見出し生成（Gemini）
- 記事生成（Gemini）

シグナル監視・LINE 配信は別リポジトリ **[tradePulseNode](../tradePulseNode)**（同一 ConoHa サーバー・別ポート）です。

## 必要環境

- Node.js 18 以上
- Playwright（初回のみ `npm run playwright-install`）

## セットアップ（ローカル・npm）

```bash
cd ~/work/apps/articleappNode
cp .env.example .env
# .env に GEMINI_API_KEY を設定

npm install
npm run playwright-install   # 初回のみ

npm run dev
```

ブラウザで http://localhost:3050 を開きます（`PORT` は `.env` で変更可）。

## セットアップ（ローカル・Docker）

```bash
cd ~/work/apps/articleappNode
# .env があること（Git 管理外）
docker compose up --build
```

ブラウザで http://localhost:3050 。データは `./data`、CSV 等は `./exports` に永続化します。

## 構成

```
articleappNode/
├── app.js                 # Express サーバー（API + EJS）
├── articleAppGenerate.js  # 記事・見出し API
├── Dockerfile             # ローカル Docker 用
├── docker-compose.yml
├── deploy/conoha/         # ConoHa（pm2）用
├── views/
│   └── index.ejs
├── public/
│   ├── css/style.css
│   └── js/main.js
└── package.json
```

## 本番（ConoHa / pm2）

配置先は `/opt/articleappNode`。手順は [deploy/conoha/README.md](deploy/conoha/README.md)。

`BASIC_AUTH_PASSWORD` を設定すると HTML 配信にベーシック認証がかかります（`/api` は対象外）。
