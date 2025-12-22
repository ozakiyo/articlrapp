# ArticlrApp

AI 記事生成のための React + Express プロジェクトです。競合記事の見出し構成をスクレイピングし、Gemini 2.0 Flash API を利用してドラフト記事を生成します。PIXTA 画像検索機能も統合されています。

## 主な機能

- **AI 記事生成**: Gemini 2.0 Flash を使用した高品質なSEO記事の自動生成
- **競合記事分析**: 複数の競合記事をスクレイピングして構成を分析
- **PIXTA 画像検索**: キーワードから関連画像を検索し、スクリーンショットも取得
- **Basic 認証**: 全エンドポイントを認証で保護
- **2層スクレイピング**: Playwright（JavaScript対応）+ HTTP クライアント（フォールバック）
- **文字エンコーディング対応**: Shift-JIS、EUC-JP などの自動検出・変換

## 技術スタック

### フロントエンド
- React 18.3.1
- Vite 5.4.10
- CSS（カスタムスタイル）

### バックエンド
- Express 4.21.2
- Node.js
- Playwright 1.56.1（ブラウザ自動化）
- got-scraping 4.0.6（HTTP クライアント）
- Cheerio 1.0.0（HTMLパーサー）
- express-basic-auth 1.2.1（認証）
- iconv-lite 0.6.3（文字エンコーディング）

### AI
- Google Generative AI（Gemini 2.0 Flash）

### データベース（オプション）
- MySQL 8.0

## プロジェクト構成

```
articlrapp/
├── client/              # React フロントエンド
│   ├── src/
│   │   ├── App.jsx     # メインコンポーネント #フロント
│   │   ├── main.jsx    # エントリーポイント
│   │   └── styles.css  # スタイルシート
│   ├── vite.config.js  # Vite 設定
│   └── package.json
├── server/              # Express API サーバー
│   ├── app.js          # メインアプリ（Playwright + Gemini 2.0）
│   ├── app.legacy.js   # レガシー版（got-scraping のみ）
│   ├── .env            # 環境変数（要設定）
│   ├── .env.example    # 環境変数テンプレート
│   ├── public/         # ビルド済み React + スクリーンショット
│   ├── Dockerfilecd
│   └── package.json
├── db/                  # MySQL コンテナ設定
│   └── Dockerfile
├── docker-compose.yml  # Docker Compose 設定
└── README.md
```

## 事前準備

### 1. Node.js のインストール
Node.js 18 以上と npm をインストールしてください。

### 2. 環境変数の設定
`server/.env` ファイルを作成し、以下の環境変数を設定します。

```bash
# サーバーポート（デフォルト: 3001）
PORT=3001

# Gemini API キー（必須）
GEMINI_API_KEY=your_gemini_api_key_here

# Basic 認証（推奨）
BASIC_AUTH_USER=admin
BASIC_AUTH_PASSWORD=password123
```

**Gemini API キーの取得方法**:
1. [Google AI Studio](https://makersuite.google.com/app/apikey) にアクセス
2. API キーを作成
3. 上記の `GEMINI_API_KEY` に設定

### 3. Playwright のセットアップ（初回のみ）
サーバー側で Playwright ブラウザをインストールします。

```bash
cd server
npm install
npx playwright install chromium
```

## ローカル開発での起動方法

### 依存関係のインストール

スクラッチからセットアップする場合は、フロントとサーバーの依存関係をそれぞれインストールします。

```bash
# サーバー依存関係
cd server
npm install

# 別ターミナルでフロントエンド依存関係
cd ../client
npm install
```

### 開発モード（推奨）

2つのターミナルを使用して、フロントエンドとバックエンドを同時に起動します。

#### ターミナル1: サーバー (API)

```bash
cd server
npm run dev    # nodemon でホットリロード
```

サーバーは `http://localhost:3001` で起動します。

#### ターミナル2: フロントエンド (React)

```bash
cd client
npm run dev    # Vite 開発サーバー
```

ブラウザで `http://localhost:5173` を開くと開発用 UI が表示されます。

Vite の開発サーバーが `/api` を `http://localhost:3001` にプロキシするため、サーバーを先に起動しておく必要があります。

### 本番モード（Express で配信）

ビルド済みの React アプリを Express で配信する場合:

```bash
# フロントエンドをビルド
cd client
npm run build   # 出力が server/public に生成される

# サーバー起動
cd ../server
npm run start   # http://localhost:3001 で React 画面が表示される
```

## Docker Compose での起動方法

Docker を使ってバックエンド + MySQL をまとめて起動することもできます。

### 前提条件

- Docker と Docker Compose がインストールされていること
- `server/.env` に環境変数が設定されていること（特に `GEMINI_API_KEY`）

### 起動手順

```bash
# イメージビルド＆コンテナ起動
docker compose build
docker compose up

# バックグラウンド実行の場合
docker compose up -d

# ログ確認
docker compose logs -f app
```

ブラウザで `http://localhost:3001` を開き、React のビルド済み UI と API を確認できます。

### Docker 利用時の注意

- `server/.env` の環境変数は Docker コンテナにマウントされるため、起動前に必ず設定してください
- フロントエンドを更新した場合は、まず `client` ディレクトリで `npm run build` を実行してから `docker compose up --build` で再ビルドしてください
- MySQL コンテナのデータは `db_data` ボリュームに永続化されます

### コンテナの停止

```bash
# コンテナを停止
docker compose down

# ボリュームも削除する場合
docker compose down -v
```

## 認証について

このアプリケーションは **Basic 認証**で保護されています。

### デフォルト認証情報

```
ユーザー名: admin
パスワード: password123
```

これらの認証情報は `server/.env` ファイルで変更できます:

```bash
BASIC_AUTH_USER=your_username
BASIC_AUTH_PASSWORD=your_secure_password
```

### 認証の流れ

1. ブラウザで `http://localhost:3001` または `http://localhost:5173` にアクセス
2. Basic 認証のダイアログが表示される
3. ユーザー名とパスワードを入力
4. 認証成功後、アプリケーションが利用可能になる

**セキュリティ上の注意**: 本番環境では必ず以下を実施してください:
- デフォルトのパスワードを変更する
- HTTPS を使用する
- より強固な認証方式（JWT など）への移行を検討する

## 主要コマンド一覧

| ディレクトリ | コマンド        | 内容                              |
| ------------ | --------------- | --------------------------------- |
| `server`     | `npm run dev`   | nodemon を使った API 開発サーバー |
| `server`     | `npm run start` | Express を本番モードで起動        |
| `client`     | `npm run dev`   | Vite 開発サーバー                 |
| `client`     | `npm run build` | React アプリの本番ビルド          |
| ルート       | `docker compose up` | Docker コンテナ起動          |
| ルート       | `docker compose down` | Docker コンテナ停止        |

## API エンドポイント

### POST /api/generate

AI 記事生成のメインエンドポイント。

**リクエストボディ**:

```json
{
  "keyword": "記事のキーワード",
  "competitorUrl1": "競合記事URL1",
  "competitorUrl2": "競合記事URL2（オプション）",
  "competitorUrl3": "競合記事URL3（オプション）"
}
```

**レスポンス**:

```json
{
  "title": "記事タイトル",
  "introduction": "導入文",
  "summary": "まとめ文",
  "outline": {
    "h1": "タイトル",
    "sections": [
      {
        "h2": "見出し2",
        "subsections": ["見出し3-1", "見出し3-2", "見出し3-3"]
      }
    ]
  },
  "article": {
    "h1": "タイトル",
    "introduction": "導入文",
    "sections": [
      {
        "h2": "見出し2",
        "content": "本文（300文字以上）",
        "subsections": [
          {
            "h3": "見出し3",
            "content": "本文（200文字以上）"
          }
        ]
      }
    ],
    "summary": "まとめ文"
  },
  "warnings": [
    {
      "url": "失敗したURL",
      "message": "エラーメッセージ"
    }
  ]
}
```

### GET /api/searchPIXTAimage

PIXTA から画像を検索し、スクリーンショットを取得します。

**クエリパラメータ**:

- `keyword` (string, 必須): 検索キーワード

**レスポンス**:

```json
{
  "PIXTAimages": [
    {
      "materialNo": "素材番号",
      "srcUrl": "画像URL"
    }
  ],
  "screenshot": "pixta_keyword_timestamp.png"
}
```

## PIXTA クローリング機能

PIXTA.jp から素材情報とスクリーンショットを取得する機能です。

### 機能詳細

1. **画像検索**: キーワードに基づいて PIXTA の素材を検索
2. **素材情報抽出**: 素材番号と画像 URL を抽出
3. **スクリーンショット保存**: 検索結果ページのフルページスクリーンショットを保存
4. **自動クリーンアップ**: 1時間以上前のスクリーンショットを自動削除

### 使用方法

1. **フロントエンドから検索**: キーワード入力後、「PIXTA検索」ボタンをクリック
2. **自動検索**: 「記事生成時にPIXTA検索も実行」にチェックを入れると、記事生成と同時に検索
3. **結果表示**: 「画像一覧を見る」または「スクリーンショットを見る」ボタンで結果を確認

### スクリーンショット保存場所

```text
server/public/pixta_{keyword}_{timestamp}.png
```

例: `pixta_洗濯機_1699500000000.png`

## サーバー実装の切り替え (app.js / app.legacy.js)

2つのスクレイピング実装から選択できます。

### app.js（推奨）

**特徴**:

- Playwright + Gemini 2.0 Flash
- JavaScript 実行対応
- HTTP フォールバック機能

**メリット**:

- SPA サイト対応
- 高精度な本文抽出
- 構造化 JSON 出力

**デメリット**:

- Chromium 必須
- メモリ使用量多
- 起動速度遅

### app.legacy.js

**特徴**:

- got-scraping のみ
- Cheerio で HTML 解析
- ブラウザ不要

**メリット**:

- 高速
- 軽量
- シンプル

**デメリット**:

- JavaScript 非対応
- SPA で失敗の可能性

### 切り替え手順

```bash
cd server

# app.js から app.legacy.js に切り替え
mv app.js app.playwright.js        # バックアップ (任意)
mv app.legacy.js app.js

# サーバー再起動
npm run dev

# Docker の場合
cd ..
docker compose up --build
```

**注意**: フロントエンド (`client/src/App.jsx`) はどちらのレスポンス形式にも対応しているため、追加変更は不要です。

## トラブルシューティング

### スクレイピング関連

**問題**: スクレイピングが 403 で失敗する

- **原因**: 対象サイトの bot 対策によるブロック
- **解決策**:
  - 再試行する
  - `app.legacy.js` に切り替える
  - User-Agent やヘッダーを調整する
  - アクセス間隔を空ける

**問題**: Playwright が起動しない

- **原因**: Chromium ブラウザがインストールされていない
- **解決策**:

  ```bash
  cd server
  npx playwright install chromium
  ```

**問題**: 文字化けが発生する

- **原因**: エンコーディング検出の失敗
- **解決策**: 現在の実装は Shift-JIS、EUC-JP に対応していますが、特殊なエンコーディングの場合は手動で対応が必要

### Docker 関連

**問題**: `MODULE_NOT_FOUND` エラーが出る

- **原因**: 依存関係が更新されているがイメージが古い
- **解決策**:

  ```bash
  docker compose build
  docker compose up
  ```

**問題**: ポート 3001 が既に使用されている

- **原因**: 他のプロセスがポートを使用している
- **解決策**:

  ```bash
  # macOS/Linux
  lsof -ti:3001 | xargs kill

  # または .env で PORT を変更
  PORT=3002
  ```

### Gemini API 関連

**問題**: API キーエラーが発生する

- **原因**: `GEMINI_API_KEY` が設定されていない、または無効
- **解決策**:
  - `server/.env` ファイルを確認
  - [Google AI Studio](https://makersuite.google.com/app/apikey) で新しいキーを取得

**問題**: レート制限エラーが発生する

- **原因**: API の使用量が制限を超えた
- **解決策**: しばらく待ってから再試行、またはAPI キーのクォータを確認

### PIXTA 関連

**問題**: PIXTA 検索が失敗する

- **原因**: PIXTA のサイト構造変更、ネットワークエラー
- **解決策**:
  - キーワードを変更して再試行
  - サーバーログでエラー内容を確認
  - PIXTA のサイトが正常にアクセスできるか確認

## 環境変数リファレンス

`server/.env` ファイルで設定できる環境変数の一覧:

| 変数名 | 説明 | 必須 | デフォルト値 |
| ------ | ---- | ---- | ------------ |
| `PORT` | サーバーのポート番号 | いいえ | 3001 |
| `GEMINI_API_KEY` | Google Gemini API キー | **はい** | なし |
| `BASIC_AUTH_USER` | Basic 認証のユーザー名 | いいえ | admin |
| `BASIC_AUTH_PASSWORD` | Basic 認証のパスワード | いいえ | password123 |

## データベース設定（MySQL）

Docker Compose を使用する場合、MySQL データベースも自動的に起動します。

### 接続情報

| 項目 | 値 |
| ---- | --- |
| ホスト | localhost（ホストから）/ db（コンテナ間） |
| ポート | 3306 |
| データベース名 | articledb |
| ユーザー | user |
| パスワード | user111 |
| ルートパスワード | root111 |

### データの永続化

MySQL のデータは `db_data` という名前の Docker ボリュームに保存され、コンテナを削除しても保持されます。

データを完全に削除したい場合:

```bash
docker compose down -v
```

**注意**: 現在の `app.js` は MySQL に接続していません。データベース機能を利用する場合は、別途実装が必要です。

## 技術仕様

### スクレイピング処理フロー

```text
1. URL 受信
   ↓
2. Playwright でブラウザ起動
   ↓
3. ページ遷移（JavaScript 実行）
   ↓
4. 本文テキスト抽出
   ↓
5. 失敗時 → HTTP クライアント (got-scraping) でフォールバック
   ↓
6. 文字エンコーディング変換（Shift-JIS、EUC-JP 対応）
   ↓
7. 最大 8000 文字に制限
   ↓
8. Gemini API に送信
```

### AI 記事生成フロー

```text
1. 競合記事のスクレイピング（最大3件）
   ↓
2. Gemini API: アウトライン生成
   - キーワードに基づいた見出し構成（H2×3、H3×3）
   ↓
3. Gemini API: 本文生成
   - 各セクション 300文字以上
   - 各サブセクション 200文字以上
   - 導入文・まとめ文を含む
   ↓
4. 構造化 JSON レスポンス返却
```

### Gemini プロンプト戦略

**役割**: SEO に強い家電専門ライター

**品質要件**:

- キーワードとの高い関連性
- 検索ユーザーの意図を満たす内容
- 具体的で独自の視点・根拠・事例
- 信頼感があり客観的な表現
- 家電販売店にふさわしいフォーマルな文体
- 数値・比較・用途別の提案を意識

**出力形式**: 階層構造を持つ JSON

## セキュリティ考慮事項

### 本番環境での推奨事項

1. **HTTPS の使用**: 必ず HTTPS で運用する
2. **認証情報の変更**: デフォルトのパスワードを変更する
3. **環境変数の保護**: `.env` ファイルを Git 管理に含めない（`.gitignore` で除外済み）
4. **API キーの管理**: Gemini API キーを安全に管理する
5. **CORS 設定**: 必要に応じて CORS ポリシーを設定する
6. **レート制限**: API へのアクセス制限を実装する
7. **入力検証**: ユーザー入力の妥当性検証を強化する

### 現在の制限事項

- Basic 認証は平文で送信されるため、HTTPS 必須
- JWT などのトークンベース認証への移行を推奨
- SQL インジェクション対策（データベース使用時）

## ライセンス

このプロジェクトは個人学習用です。商用利用する場合は、使用している各ライブラリのライセンスを確認してください。

## 今後の拡張案

- [ ] データベース連携: 生成記事の保存機能
- [ ] ユーザー管理: JWT 認証の導入
- [ ] スケジューリング: 定期的な記事生成
- [ ] キャッシング: Redis による結果キャッシュ
- [ ] 画像処理: PIXTA 素材の自動最適化・ダウンロード
- [ ] マルチランゲージ: 多言語対応
- [ ] API レート制限: Express-rate-limit の導入
- [ ] エラーハンドリング: より詳細なエラー情報とリトライ機能
- [ ] テストコード: Jest / React Testing Library
- [ ] CI/CD: GitHub Actions による自動デプロイ

## 貢献

バグ報告や機能提案は Issue で受け付けています。

## お問い合わせ

質問や問題がある場合は、Issue を作成してください。
