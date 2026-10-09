// Local dev server under pm2: pm2 start ecosystem.config.cjs
// Dashboard on http://localhost:5191 (API on 8787, proxied under /api)
module.exports = {
  apps: [
    {
      name: 'inspire9-wall',
      script: 'npm',
      args: 'run dev',
      cwd: __dirname,
      autorestart: true,
      max_restarts: 10,
    },
  ],
}
