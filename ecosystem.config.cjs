// Local dev servers under pm2: pm2 start ecosystem.config.cjs
// Dashboard on http://localhost:5191 (API on 8787, proxied under /api)
// Helper on http://127.0.0.1:5005: the kiosk's Sonos helper, run on this Mac for testing
// (pm2 start ecosystem.config.cjs --only inspire9-wall-helper). The dashboard uses it
// instead of its own local mode when started with MUSIC_SOURCE=helper.
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
    {
      name: 'inspire9-wall-helper',
      script: 'npm',
      args: 'run dev -w helper',
      cwd: __dirname,
      autorestart: true,
      max_restarts: 10,
      env: {
        HELPER_ALLOWED_ORIGINS: 'http://localhost:5191',
        HELPER_DATA_DIR: require('node:path').join(__dirname, 'dashboard', 'data'),
      },
    },
  ],
}
