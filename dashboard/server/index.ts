import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { readFileSync } from 'node:fs'
import { loadLayout, saveLayout } from './layout-store.js'

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const port = Number(process.env.PORT ?? 8787)
const isProd = process.env.NODE_ENV === 'production'

// Where the wall's music controls talk to Sonos: this server directly ("local", when it
// runs on the office network), the helper on the kiosk PC ("helper"), or nowhere ("off").
const musicSource = process.env.MUSIC_SOURCE ?? (isProd ? 'helper' : 'local')
const helperUrl = process.env.MUSIC_HELPER_URL ?? 'http://127.0.0.1:5005'

const app = new Hono()

// Never let search engines index any part of the dashboard.
app.use('*', async (c, next) => {
  await next()
  c.header('X-Robots-Tag', 'noindex, nofollow, noarchive')
})

app.get('/robots.txt', (c) => c.text('User-agent: *\nDisallow: /\n'))

app.get('/api/health', (c) => c.json({ ok: true }))

app.get('/api/config', (c) =>
  c.json({
    version: pkg.version,
    calendarUrl: process.env.GCAL_EMBED_URL ?? null,
    musicUrl: musicSource === 'local' ? '/api/music' : musicSource === 'helper' ? helperUrl : null,
    skeddaUrl: process.env.SKEDDA_URL ?? null,
  }),
)

app.get('/api/layout', async (c) => c.json(await loadLayout()))

app.put('/api/layout', async (c) => {
  const body = await c.req.json().catch(() => null)
  if (!body || typeof body !== 'object') return c.json({ error: 'Invalid layout' }, 400)
  await saveLayout(body)
  return c.json({ ok: true })
})

if (musicSource === 'local') {
  // Only loaded in local mode; the deployed server never talks to Sonos itself.
  const { SonosMusic, createMusicApi } = await import('music' as string)
  const music = new SonosMusic({
    hosts: (process.env.SONOS_HOSTS ?? '').split(',').map((h: string) => h.trim()).filter(Boolean),
    maxVolume: Number(process.env.MUSIC_MAX_VOLUME ?? 85),
    // "Speaker name=60, Other speaker=50"
    speakerLimits: Object.fromEntries(
      (process.env.MUSIC_SPEAKER_LIMITS ?? '')
        .split(',')
        .map((pair: string) => pair.split('='))
        .filter(([name, v]: string[]) => name?.trim() && Number.isFinite(Number(v)))
        .map(([name, v]: string[]) => [name.trim(), Number(v)]),
    ),
    historyFile: `${process.env.DATA_DIR ?? './data'}/music-history.json`,
  })
  app.route('/api/music', createMusicApi(music))
}

if (isProd) {
  app.use('/*', serveStatic({ root: './dist' }))
  app.get('*', serveStatic({ path: './dist/index.html' }))
}

serve({ fetch: app.fetch, port }, () => {
  console.log(`dashboard api on port ${port}`)
})
