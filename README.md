# articlrapp

AI 記事生成のための React + Express プロジェクトです。競合記事の見出し構成をスクレイピングし、Gemini API を利用してドラフト記事を生成します。

## プロジェクト構成

- `client/` — Vite + React で構築したフロントエンド
- `server/` — Express ベースの API とスクレイピング処理
- `db/` — Docker Compose 用の MySQL 初期化スクリプト（利用する場合）

## 事前準備

1. Node.js 18 以上と npm をインストールしてください。
2. Gemini API キーを取得し、`server/.env` に設定します。
   ```bash
   GEMINI_API_KEY=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
   ```

## ローカル開発での起動方法

スクラッチからセットアップする場合は、フロントとサーバーの依存関係をそれぞれインストールします。

```bash
# サーバー依存関係
cd server
npm install

# 別ターミナルでフロントエンド依存関係
cd ../client
npm install
```

### 1. サーバー (API)

```bash
cd server
npm run dev    # nodemon でホットリロード
# もしくは本番相当で起動: npm run start
```

サーバーは `http://localhost:3001` で待ち受けます。

### 2. フロントエンド (React)

```bash
cd client
npm run dev
```

ブラウザで `http://localhost:5173` を開くと開発用 UI が表示されます。Vite の開発サーバーが `/api` を `http://localhost:3001` にプロキシするため、API を先に起動しておく必要があります。

#### ビルド済み画面を Express で配信したい場合

```bash
cd client
npm run build   # 出力が server/public に生成される

cd ../server
npm run start   # http://localhost:3001 で React 画面が表示される
```

## Docker Compose での起動方法

Docker を使ってバックエンド + MySQL をまとめて起動することもできます。

```bash
docker compose build
docker compose up
```

ブラウザで `http://localhost:3001` を開き、React のビルド済み UI と API を確認できます。

### Docker 利用時の注意

- `server/.env` の `GEMINI_API_KEY` は Docker コンテナにマウントされるため、起動前に必ず設定してください。
- フロントエンドを更新した場合は、`client/npm run build` を実行してから `docker compose up --build` で再ビルドしてください。

## 主要コマンド一覧

| ディレクトリ | コマンド        | 内容                              |
| ------------ | --------------- | --------------------------------- |
| `server`     | `npm run dev`   | nodemon を使った API 開発サーバー |
| `server`     | `npm run start` | Express を本番モードで起動        |
| `client`     | `npm run dev`   | Vite 開発サーバー                 |
| `client`     | `npm run build` | React アプリの本番ビルド          |

## サーバー実装の切り替え (app.js / app.legacy.js)

最新の Playwright ベース実装と従来の `got-scraping` 実装を切り替えられます。

| ファイル               | 特徴                                                                                                                      |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `server/app.js`        | Playwright + Gemini 2 を利用。Playwright が失敗した場合は HTTP フォールバックで再取得。構成 JSON と本文 JSON を返します。 |
| `server/app.legacy.js` | 旧版を少し改良。`got-scraping` のみで HTML を取得し、見出しベースの JSON を返します。Playwright やブラウザは不要。        |

### 切り替え手順

1. `server` ディレクトリでファイル名を入れ替えます。
   ```bash
   cd server
   mv app.js app.playwright.js        # バックアップ (任意)
   mv app.legacy.js app.js
   ```
   逆に戻す場合は `app.js` と元のファイル名を差し替えてください。
2. 作業後はサーバーを再起動します。Docker を使っている場合は `docker compose up --build` を実行してください。

フロントエンド (`client/src/App.jsx`) はどちらのレスポンス形式にも対応しているため、追加変更は不要です。

## トラブルシューティング

- **スクレイピングが 403 で失敗する**  
  対象サイトの bot 対策によるブロックが考えられます。再試行や timeout 調整、アクセス間隔を空けるなどの対策を検討してください。
- **`MODULE_NOT_FOUND` が出る (Docker)**  
  依存関係を更新した場合は `docker compose build` を実行してイメージを再作成してください。
