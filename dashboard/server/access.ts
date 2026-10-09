// Who may see the wall. The check runs on the server before anything is sent: the
// page, its scripts and every API call. Allowed are visitors from the office's
// internet address (ALLOWED_IPS) and browsers that once opened the dashboard with the
// secret key (?key=..., ACCESS_KEY), which leaves a signed cookie instead of the key.
import { createHmac, timingSafeEqual } from 'node:crypto'
import type { Context, MiddlewareHandler } from 'hono'
import { getConnInfo } from '@hono/node-server/conninfo'
import { getCookie, setCookie } from 'hono/cookie'

export type AccessOptions = {
  allowedIps: string[]
  key?: string
  // Behind a reverse proxy (Coolify's Traefik), the visitor's address is the last one the
  // proxy added to X-Forwarded-For. Without a proxy, use the connection's own address.
  behindProxy: boolean
  log?: (m: string) => void
}

const cookieName = 'wall_access'
const cookieMaxAge = 400 * 24 * 60 * 60
// Wrong keys from one address before it's turned away for a while.
const maxKeyFailures = 10
const failureWindowMs = 60 * 60 * 1000

const normaliseIp = (ip: string) => ip.trim().replace(/^::ffff:/, '')

const sameText = (a: string, b: string) => {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

const deniedPage = `<!doctype html>
<html lang="en-AU"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow"><title>Not available</title>
<style>body{margin:0;display:grid;place-items:center;min-height:100vh;background:#f1efea;color:#2b2b2b;font:600 18px/1.5 system-ui,sans-serif;text-align:center;padding:24px}</style>
</head><body><p>This screen is only available at the office.</p></body></html>`

export function accessControl({ allowedIps, key, behindProxy, log = console.warn }: AccessOptions): MiddlewareHandler {
  const allowed = new Set(allowedIps.map(normaliseIp).filter(Boolean))
  // The cookie holds a signature derived from the key, never the key itself.
  const token = key ? createHmac('sha256', key).update('inspire9-wall-access-v1').digest('base64url') : null
  const failures = new Map<string, { count: number; since: number }>()

  const clientIp = (c: Context) => {
    if (behindProxy) {
      const forwarded = c.req.header('x-forwarded-for')?.split(',').map((s) => s.trim()).filter(Boolean)
      if (forwarded?.length) return normaliseIp(forwarded[forwarded.length - 1])
    }
    return normaliseIp(getConnInfo(c).remote.address ?? '')
  }

  const deny = (c: Context) => {
    c.header('Cache-Control', 'no-store')
    return c.html(deniedPage, 403)
  }

  return async (c, next) => {
    const ip = clientIp(c)
    const given = c.req.query('key')

    if (given !== undefined) {
      const f = failures.get(ip)
      if (f && Date.now() - f.since > failureWindowMs) failures.delete(ip)
      if ((failures.get(ip)?.count ?? 0) >= maxKeyFailures) return deny(c)
      if (key && sameText(given, key)) {
        failures.delete(ip)
        setCookie(c, cookieName, token!, { httpOnly: true, secure: c.req.url.startsWith('https:') || behindProxy, sameSite: 'Lax', path: '/', maxAge: cookieMaxAge })
        // Take the key out of the address bar (and the browser history).
        const url = new URL(c.req.url)
        url.searchParams.delete('key')
        return c.redirect(url.pathname + url.search, 302)
      }
      const now = failures.get(ip) ?? { count: 0, since: Date.now() }
      failures.set(ip, { count: now.count + 1, since: now.since })
      log(`access: wrong key from ${ip}`)
      return deny(c)
    }

    const cookie = getCookie(c, cookieName)
    if (allowed.has(ip) || (token && cookie && sameText(cookie, token))) return next()
    return deny(c)
  }
}
