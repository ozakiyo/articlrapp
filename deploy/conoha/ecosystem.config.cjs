const path = require('path');

const appRoot = path.join(__dirname, '../..');

/**
 * pm2 — /opt/articleappNode で実行:
 *   pm2 start deploy/conoha/ecosystem.config.cjs
 *   pm2 restart articleappNode --update-env
 *
 * プロセス名 articleappNode のみ。gsaxo / dhamma 等には触れない。
 */
module.exports = {
  apps: [
    {
      name: 'articleappNode',
      cwd: appRoot,
      script: 'app.js',
      interpreter: 'node',
      autorestart: true,
      max_restarts: 20,
      min_uptime: '30s',
      out_file: path.join(appRoot, 'logs/articleapp-out.log'),
      error_file: path.join(appRoot, 'logs/articleapp-err.log'),
      merge_logs: true,
      env: {
        NODE_ENV: 'production',
        PORT: '3050',
        PLAYWRIGHT_CHROMIUM_NO_SANDBOX: '1',
      },
    },
  ],
};
