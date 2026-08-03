#!/usr/bin/env bash
# articleappNode セットアップ（/opt/articleappNode 内のみ）
# 使い方: cd /opt/articleappNode && bash deploy/conoha/setup.sh
set -euo pipefail

echo "=== articleappNode セットアップ ==="

if ! command -v node >/dev/null 2>&1; then
  echo "ERROR: node が見つかりません。"
  exit 1
fi

echo "Node: $(node -v)  npm: $(npm -v)"

NODE_MAJOR="$(node -p "process.versions.node.split('.')[0]")"
NODE_MINOR="$(node -p "process.versions.node.split('.')[1]")"
if [ "${NODE_MAJOR}" -lt 22 ] || { [ "${NODE_MAJOR}" -eq 22 ] && [ "${NODE_MINOR}" -lt 13 ]; }; then
  echo "WARNING: @cursor/sdk は Node.js 22.13 以上が必要です（現在: $(node -v)）。"
  echo "         Cursor プロバイダを使う場合は Node を上げてください。Gemini のみなら動作します。"
fi

APP_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$APP_ROOT"

echo "作業ディレクトリ: ${APP_ROOT}"
mkdir -p data exports logs data/cursor-workspace data/cursor-agents

echo "依存関係インストール..."
npm ci --omit=dev

echo "Playwright Chromium..."
npx playwright install chromium || npm run playwright-install || true

if ! command -v pm2 >/dev/null 2>&1; then
  echo "pm2 をグローバルに追加します（既存プロセスは停止しません）。"
  npm install -g pm2
else
  echo "pm2: 既存を利用"
fi

if [[ ! -f .env ]]; then
  echo ""
  echo "WARNING: .env がありません。Mac から scp してください。"
  echo "  必須例: PORT, GEMINI_API_KEY"
  echo "  scp .env root@サーバー:/opt/articleappNode/.env"
fi

if pm2 describe articleappNode >/dev/null 2>&1; then
  echo "既存プロセスを再起動..."
  pm2 restart articleappNode --update-env
else
  echo "pm2 で起動..."
  pm2 start deploy/conoha/ecosystem.config.cjs
fi

pm2 save

echo ""
echo "=== 完了 ==="
echo "  pm2 list"
echo "  pm2 logs articleappNode"
echo "  curl -s -o /dev/null -w '%{http_code}\\n' http://127.0.0.1:3050/"
echo ""
echo "Apache が 3001 を見ている場合は ProxyPass を 127.0.0.1:3050 に変更してください。"
echo "詳細: deploy/conoha/README.md"
