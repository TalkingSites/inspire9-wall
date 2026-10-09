import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { readFileSync } from 'node:fs'
import { loadLayout, saveLayout } from './layout-store.js'

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const port = Number(process.env.PORT ?? 8787)
const isProd = process.env.NODE_ENV === 'production'

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

if (isProd) {
  app.use('/*', serveStatic({ root: './dist' }))
  app.get('*', serveStatic({ path: './dist/index.html' }))
}

serve({ fetch: app.fetch, port }, () => {
  console.log(`dashboard api on port ${port}`)
})
