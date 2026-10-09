// The music HTTP API. The dashboard server mounts it at /api/music in local mode;
// the Windows helper serves it on 127.0.0.1:5005 for the kiosk browser.
import { Hono, type Context } from 'hono'
import { MusicError, playModes, type PlayMode, type SonosMusic } from './sonos.js'

export function createMusicApi(music: SonosMusic, log: (m: string) => void = (m) => console.error(`[music] ${m}`)) {
  const app = new Hono()

  const run = (fn: (c: Context) => Promise<unknown>) => async (c: Context) => {
    try {
      const result = await fn(c)
      return result instanceof Response ? result : c.json(result ?? { ok: true })
    } catch (e) {
      if (e instanceof MusicError) return c.json({ error: e.message }, e.status as 400)
      log(`${c.req.method} ${c.req.path}: ${(e as Error).message}`)
      return c.json({ error: "Couldn't reach the speakers" }, 503)
    }
  }
  const body = async (c: Context) => ((await c.req.json().catch(() => ({}))) ?? {}) as Record<string, unknown>
  const num = (v: unknown) => {
    const n = Number(v)
    if (!Number.isFinite(n)) throw new MusicError('Expected a number')
    return n
  }

  app.get('/state', run(() => music.state()))
  app.post('/play', run(() => music.play()))
  app.post('/pause', run(() => music.pause()))
  app.post('/next', run(() => music.next()))
  app.post('/previous', run(() => music.previous()))
  app.post('/volume', run(async (c) => music.setVolume(num((await body(c)).volume))))
  app.post('/mute', run(async (c) => music.setMuted(Boolean((await body(c)).muted))))
  app.post('/speakers/:id/volume', run(async (c) => music.setSpeakerVolume(c.req.param('id') ?? '', num((await body(c)).volume))))
  app.post('/speakers/:id/mute', run(async (c) => music.setSpeakerMuted(c.req.param('id') ?? '', Boolean((await body(c)).muted))))

  // Lists for the tiles: metadata stays on this side.
  const strip = <T extends { metadata?: string }>(items: T[]) => items.map(({ metadata: _, ...rest }) => rest)
  app.get('/favourites', run(async () => strip(await music.favourites())))
  app.get('/playlists', run(async () => strip(await music.playlists())))
  app.get('/history', run(async () => strip(await music.recent())))
  // { id, mode?: 'replace' | 'shuffle' | 'now' | 'next' | 'end', track?: number to start at }
  for (const list of ['favourites', 'playlists', 'history'] as const) {
    app.post(`/${list}/play`, run(async (c) => {
      const b = await body(c)
      const mode = (b.mode ?? 'replace') as PlayMode
      if (!playModes.includes(mode)) throw new MusicError('Unknown play option')
      return music.playFrom(list, String(b.id), mode, b.track == null ? 1 : num(b.track))
    }))
    app.get(`/${list}/tracks`, run(async (c) => ({ tracks: await music.tracks(list, c.req.query('id') ?? '') })))
  }

  app.get('/queue', run(() => music.queue()))
  app.post('/queue/jump', run(async (c) => music.jumpTo(num((await body(c)).position))))
  app.post('/queue/remove', run(async (c) => music.removeFromQueue(num((await body(c)).position))))
  app.post('/queue/move', run(async (c) => {
    const b = await body(c)
    return music.moveInQueue(num(b.from), num(b.to))
  }))

  app.get('/art', run(async (c) => {
    const res = await music.art(c.req.query('u') ?? '')
    return new Response(res.body, { headers: { 'Content-Type': res.headers.get('content-type') ?? 'image/jpeg', 'Cache-Control': 'public, max-age=86400' } })
  }))

  return app
}
