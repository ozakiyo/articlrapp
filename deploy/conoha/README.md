# articleappNode — ConoHa VPS（pm2）

本番配置先: **`/opt/articleappNode`**  
公開 URL: **https://articleapp.duckdns.org/**  
ローカル Docker とは別。本番は **pm2**（Docker にしない）。

同居アプリ（触らない）:

```text
/opt/tradePulseNode/   ← G-SAXO（pm2: gsaxo）
/opt/dhamma/           ← 一切経（あれば）
```

## サーバー構成

| 項目 | 値 |
|------|-----|
| フォルダ | `/opt/articleappNode` |
| pm2 名 | `articleappNode` |
| アプリポート | `3050` |
| リバースプロキシ | Apache → `127.0.0.1:3050` |

### やってはいけないこと

- `pm2 delete all` / `pm2 kill`
- `/opt/tradePulseNode` や dhamma の変更
- 他アプリの pm2 stop / restart

## Mac からのデプロイ

SSH（`~/.ssh/config` の `Host conoha` 想定）:

```bash
ssh conoha
```

### 1. コード同期

```bash
cd ~/work/apps/articleappNode
bash deploy/conoha/push-from-mac.sh conoha
```

### 2. .env 配置（初回・更新時）

```bash
scp .env conoha:/opt/articleappNode/.env
# または
scp ~/work/secrets/articleappNode.env conoha:/opt/articleappNode/.env
```

### 3. サーバーでセットアップ / 再起動

```bash
ssh conoha
cd /opt/articleappNode
bash deploy/conoha/setup.sh
```

### 4. 確認

```bash
pm2 list
pm2 logs articleappNode --lines 50
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3050/
```

ブラウザ: https://articleapp.duckdns.org/

## Apache プロキシ

記事生成は時間がかかることがあるため `ProxyTimeout 300` を推奨。

例（`/etc/apache2/sites-available/` 配下）:

```apache
ProxyPass / http://127.0.0.1:3050/
ProxyPassReverse / http://127.0.0.1:3050/
ProxyTimeout 300
```

旧構成が `3001` のままなら **3050 に変更**してから:

```bash
sudo systemctl reload apache2
```

設定例ファイル: `deploy/conoha/apache-proxy.conf`

## 安全な pm2 操作

```bash
pm2 start deploy/conoha/ecosystem.config.cjs
pm2 restart articleappNode --update-env
pm2 stop articleappNode
pm2 logs articleappNode
pm2 save
```
