# articleappNode

家電カテゴリ向けの記事制作支援アプリです。  
**HTML / CSS / 素の JavaScript** と **Node.js + Express + EJS** で動作します（React / Vite 不要）。

## 機能

- ランキング（URL設定・横断取得・週次用データ保存）
- 週次レポート（競合記事比較・改修タスク・KPI）
- 用途別おすすめ生成
- 記事コンテンツ（新規／リライト）
- 個別商品ページ

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

## セットアップ（ローカル・Docker・ライブ編集）

```bash
cd ~/work/apps/articleappNode
# .env があること（Git 管理外）
docker compose up --build
```

ブラウザで http://localhost:3050 。

- ホストのソースをコンテナにマウント
- `js` / `ejs` / `json` / `css` 保存で nodemon が自動再起動
- `data` / `exports` はホスト側に残る

## 構成

```
articleappNode/
├── app.js                      # Express サーバー（API + EJS）
├── aiProvider.js               # Gemini / ChatGPT / Cursor 抽象化
├── articleAppGenerate.js       # 見出し・記事生成 API
├── categoryRanking.js          # モール横断ランキング取得
├── categoryRegistry.js         # カテゴリ一覧
├── competitorArticleEngine.js  # 競合見出し分析
├── weeklyReportEngine.js       # 週次レポート
├── useCaseRecommendEngine.js   # 用途別おすすめ
├── views/index.ejs             # UI
├── public/                     # CSS / JS
├── data/                       # ランキングURL・競合記事など
├── exports/                    # CSV / 週次レポート出力
├── deploy/conoha/              # ConoHa（pm2）用
├── Dockerfile
├── docker-compose.yml
└── package.json
```

## 本番（ConoHa / pm2）

配置先は `/opt/articleappNode`。手順は [deploy/conoha/README.md](deploy/conoha/README.md)。

`BASIC_AUTH_PASSWORD` を設定すると HTML 配信にベーシック認証がかかります（`/api` は対象外）。
