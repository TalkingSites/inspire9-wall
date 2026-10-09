// Inspire9 wall helper. Runs on the kiosk PC as a Windows service (see
// windows/install-helper.ps1) so the wall dashboard, open in the kiosk browser, can
// control the office Sonos speakers. It serves the same music API as the dashboard's
// local mode, on 127.0.0.1 only, never on the network.
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { createMusicApi, SonosMusic } from 'music'
import { join } from 'node:path'
import pkg from '../../package.json' with { type: 'json' }
import { loadConfig } from './config.js'
import { guard } from './guard.js'

// Output goes to the service's log files, which WinSW rotates.
const log = (m: string) => console.log(`${new Date().toISOString()} ${m}`)

let config
try {
  config = loadConfig()
} catch (e) {
  log(`can't start: ${(e as Error).message}`)
  process.exit(1)
}

const music = new SonosMusic({
  hosts: config.sonosHosts,
  maxVolume: config.maxVolume,
  speakerLimits: config.speakerLimits,
  historyFile: join(config.dataDir, 'music-history.json'),
  log,
})

const app = new Hono()
app.use('*', guard(config.allowedOrigins, config.port))
app.get('/health', (c) => c.json({ ok: true, version: pkg.version }))
app.route('/', createMusicApi(music, log))

serve({ fetch: app.fetch, hostname: '127.0.0.1', port: config.port }, () => {
  log(`helper ${pkg.version} on 127.0.0.1:${config.port}, for ${config.allowedOrigins.join(', ')}`)
})
