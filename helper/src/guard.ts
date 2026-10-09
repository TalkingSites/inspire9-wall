// Only the wall dashboard may use the helper. It listens on 127.0.0.1, but any web page
// open in the kiosk browser could still try to reach it, so:
// - the Host must be the helper's own address (stops DNS rebinding tricks);
// - a request from a web page must come from the dashboard's origin (browsers always say
//   where POSTs come from, so another site can't press play or change volumes);
// - preflights get CORS and Private Network Access answers for that origin only.
import type { MiddlewareHandler } from 'hono'

export function guard(allowedOrigins: string[], port: number): MiddlewareHandler {
  const origins = new Set(allowedOrigins)
  const hosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`])

  return async (c, next) => {
    if (!hosts.has(c.req.header('host') ?? '')) return c.text('Forbidden', 403)
    const origin = c.req.header('origin')
    if (origin && !origins.has(origin)) return c.text('Forbidden', 403)

    if (c.req.method === 'OPTIONS') {
      if (!origin) return c.text('Forbidden', 403)
      const headers: Record<string, string> = {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Methods': 'GET, POST',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Max-Age': '600',
        Vary: 'Origin',
      }
      if (c.req.header('access-control-request-private-network') === 'true') headers['Access-Control-Allow-Private-Network'] = 'true'
      return new Response(null, { status: 204, headers })
    }

    await next()
    if (origin) {
      c.res.headers.set('Access-Control-Allow-Origin', origin)
      c.res.headers.append('Vary', 'Origin')
    }
  }
}
