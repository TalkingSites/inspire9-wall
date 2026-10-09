# Inspire9 Wall

Wall dashboard for a Windows kiosk PC: Google Calendar and Skedda bookings (both iframes) and Sonos controls. Private deployment details (domain, IPs, speakers, Coolify ids, progress notes) are in `CLAUDE.local.md`, which is gitignored. Read it first.

## This repo is public

Never put identifying details in tracked files, commits, issues or PRs: no deployed domain, office or server IPs, iCal links, speaker names or IPs, member names. They belong in env vars, `.env.local` or `CLAUDE.local.md`. Before staging a commit, grep the diff for them.

## Layout

- `dashboard/`: Vite + React + TypeScript frontend (`src/`) and a Hono API (`server/`). In production one Node process serves both.
- `music/`: shared Sonos code (`SonosMusic` controller and a Hono API), used by the dashboard server in local mode and by the helper.
- `helper/` (planned): Windows service exposing the music API on `127.0.0.1:5005`, built to a single `.exe`, released by a GitHub Action.
- `windows/` (planned): PowerShell scripts for the kiosk PC.
- `apps-script/wall-calendar-sync.gs`: Google Apps Script that keeps public title-and-time copies of the office calendars for the embed (the real one, with calendar ids, lives in the Google account).
- `scripts/screenshot.mjs`: Playwright screenshots at given sizes, for checking layouts.

## Commands

- `pm2 start ecosystem.config.cjs` (or `npm run dev` in a terminal): API on 8787 and Vite on 5191, with `/api` proxied. `pm2 logs inspire9-wall --lines 40 --nostream` for logs.
- `npm run typecheck -w dashboard`, `npm run build`.
- `node scripts/screenshot.mjs http://localhost:5191/ <out-dir> 1920x1080 1080x1920`.

## How things work

- Panel layout: `react-resizable-panels` v4 (`Group`, `Panel`, `Separator`). Presets live in `src/layout.ts`; `Board.tsx` renders them. The saved layout (preset, sizes per preset and group, minimised panels, panel order per preset after drag swaps, zoom per panel, clock formats) is stored by the server in `DATA_DIR/layout.json`, with a localStorage copy for a fast first paint.
- Expanded panels are the same DOM node switched to `position: fixed`, so iframes don't reload. Minimised panels keep their body mounted for the same reason.
- Music source is pluggable (`MUSIC_SOURCE`): the dashboard server mounts the music API at `/api/music` when run on the office network (local, the dev default), and the kiosk browser talks to the helper on `localhost:5005` in production. `/api/config` tells the browser which (`musicUrl`).
- Music control: always the biggest Sonos group that isn't on AirPlay, line-in or TV; commands go to its coordinator; grouping is never changed. Volume is per speaker (no overall slider), capped at `MUSIC_MAX_VOLUME` (85) with lower limits for named speakers in `MUSIC_SPEAKER_LIMITS`, skips and volume are rate limited, favourites keep their own metadata (`r:resMD`) so Spotify plays. Sonos keeps "recently played" in its cloud, so the wall keeps its own list (`DATA_DIR/music-history.json`). The panel polls `/state` every 2 seconds; expanding it shows Favourites, Playlists, Recently played, Queue and Speakers.
- Testing music: the speakers are live in a working office. Read freely, but don't send playback or volume commands without the user's OK.
- Calendar and bookings are iframes (`src/panels.tsx`): Google Calendar's own embed (`GCAL_EMBED_URL`, one `src=` and `color=` per calendar) and Skedda (`SKEDDA_URL`). The embedded calendars are public copies kept in sync by `apps-script/wall-calendar-sync.gs` (titles and times only), so the kiosk needs no Google login. One copy per source calendar, because the embed colours whole calendars, not events.
- Access (`server/access.ts`): every request except `/api/health` and `robots.txt` is checked on the server before anything is sent. Allowed: the office IP (`ALLOWED_IPS`, read as the last `X-Forwarded-For` entry when `TRUST_PROXY=1`) or a browser that opened `?key=<ACCESS_KEY>`, which sets a signed HttpOnly cookie and redirects without the key. Always on in production and fails closed; off in dev unless those env vars are set.
- Times are always Australia/Melbourne.

## Conventions

- Brand: Plus Jakarta Sans; tokens in `src/styles.css` (`--off-white`, `--charcoal`, `--brand-red`, sage). Styled after the Mautic welcome page: warm grey background, charcoal top bar with a 4px red stripe, white cards with 1.5px warm borders and 10px radius, red bold card titles, sage-tint icon tiles. Icons are Bootstrap Icons (`src/icons.tsx`).
- Readable from across a room, everything usable by touch (44px+ targets). No keyboard on the kiosk.
- Australian English, no em dashes in copy, no eyebrow labels above headings.
- Version is in `package.json` and `dashboard/package.json`; bump both together (minor for features and fixes). It shows in the top bar.
