#!/usr/bin/env bash
# Mac から ConoHa へ articleappNode を /opt/articleappNode に同期
# tradePulseNode / dhamma には触れない
#
#   bash deploy/conoha/push-from-mac.sh conoha
#   bash deploy/conoha/push-from-mac.sh root@160.251.173.118
#   bash deploy/conoha/push-from-mac.sh root@160.251.173.118 /opt/articleappNode
#
set -euo pipefail

DEST="${1:?使い方: bash deploy/conoha/push-from-mac.sh ユーザー@サーバーIP [リモートDir]}"
REMOTE_DIR="${2:-/opt/articleappNode}"
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

# ControlPath は macOS で長すぎると失敗するため短縮名を使う
SSH_CTL="/tmp/aa-ssh-%C"
SSH_OPTS=(
  -o ControlMaster=auto
  -o "ControlPath=${SSH_CTL}"
  -o ControlPersist=120
)

cleanup() {
  ssh "${SSH_OPTS[@]}" -O exit "$DEST" 2>/dev/null || true
}
trap cleanup EXIT

echo "=== articleappNode 同期 → ${DEST}:${REMOTE_DIR} ==="
echo "※ tradePulseNode / dhamma には触れません"

ssh "${SSH_OPTS[@]}" "$DEST" "mkdir -p ${REMOTE_DIR}/data ${REMOTE_DIR}/exports ${REMOTE_DIR}/logs ${REMOTE_DIR}/deploy/conoha"

cd "$REPO_ROOT"
rsync -avz \
  --exclude node_modules \
  --exclude .git \
  --exclude .env \
  --exclude exports \
  --exclude 'data/cursor-agents' \
  --exclude server \
  --exclude client \
  --exclude .DS_Store \
  --exclude .claude \
  -e "ssh ${SSH_OPTS[*]}" \
  ./ "${DEST}:${REMOTE_DIR}/"

echo ""
echo "完了。次:"
echo "  # .env は初回または更新時のみ（上書き注意）"
echo "  scp .env ${DEST}:${REMOTE_DIR}/.env"
echo "  ssh ${DEST}"
echo "  cd ${REMOTE_DIR} && bash deploy/conoha/setup.sh"
