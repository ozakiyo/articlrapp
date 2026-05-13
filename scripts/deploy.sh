#!/usr/bin/env bash
# ConoHa 本番デプロイ用（/opt/articlrapp で実行）
set -euo pipefail

BRANCH="${1:-20260513}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "==> ブランチ: $BRANCH"
git fetch origin "$BRANCH"
git reset --hard "origin/$BRANCH"

if [[ ! -f server/.env ]]; then
  echo "ERROR: server/.env がありません。GEMINI_API_KEY 等を設定してください。" >&2
  exit 1
fi

echo "==> Docker イメージをビルド（フロント含む）..."
docker compose build --no-cache app

echo "==> コンテナ起動..."
docker compose up -d

echo "==> ボタン文言の確認..."
docker compose exec -T app sh -c 'grep -rl "記事を生成" /root/app/public/assets/*.js 2>/dev/null || echo "WARN: ビルド成果物に「記事を生成」が見つかりません"'

echo "==> 完了。ブラウザで Cmd+Shift+R / Ctrl+Shift+R で再読み込みしてください。"
