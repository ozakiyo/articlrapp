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

## セットアップ

```bash
cd articleappNode
cp .env.example .env
# .env に GEMINI_API_KEY を設定

npm install
npm run playwright-install   # 初回のみ

npm run dev
```

ブラウザで http://localhost:3050 を開きます（`PORT` は `.env` で変更可）。

## 構成

```
articleappNode/
├── app.js                 # Express サーバー（API + EJS）
├── articleAppGenerate.js  # 記事・見出し API
├── parseModelJson.js
├── views/
│   └── index.ejs          # 画面（3タブ）
├── public/
│   ├── css/style.css
│   └── js/main.js         # タブ切替・fetch
└── package.json
```

## 本番

`articleapp` と同様、Docker や `node app.js` で起動できます。`BASIC_AUTH_PASSWORD` を設定すると HTML 配信にベーシック認証がかかります（`/api` は対象外）。
