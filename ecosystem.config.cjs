/**
 * PM2 配置文件
 * 使用方法:
 *   pm2 start ecosystem.config.cjs
 *   pm2 stop pc28-polling
 *   pm2 restart pc28-polling
 *   pm2 logs pc28-polling
 *   pm2 delete pc28-polling
 */

module.exports = {
  apps: [
    {
      name: 'pc28-polling',
      script: './scripts/pc28-polling.js',
      interpreter: 'node',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'production'
      },
      error_file: './logs/pc28-polling-error.log',
      out_file: './logs/pc28-polling-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      // 如果脚本崩溃，等待10秒后重启
      min_uptime: '10s',
      max_restarts: 10,
      restart_delay: 5000
    }
  ]
}
