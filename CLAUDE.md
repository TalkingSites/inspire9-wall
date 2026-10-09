# Inspire9 Wall

Wall dashboard for a Windows kiosk PC: Google Calendar agenda, Skedda bookings (iframe) and Sonos controls. Private deployment details (domain, IPs, speakers, Coolify ids, progress notes) are in `CLAUDE.local.md`, which is gitignored. Read it first.

## This repo is public

Never put identifying details in tracked files, commits, issues or PRs: no deployed domain, office or server IPs, iCal links, speaker names or IPs, member names. They belong in env vars, `.env.local` or `CLAUDE.local.md`. Before staging a commit, grep the diff for them.

## Layout

- `dashboard/`: Vite + React + TypeScript frontend (`src/`) and a Hono API (`server/`). In production one Node process serves both.
- `music/` (next): shared Sonos code, used by the dashboard server in local mode and by the helper.
- `helper/` (planned): Windows service exposing the music API on `127.0.0.1:5005`, built to a single `.exe`, released by a GitHub Action.
- `windows/` (planned): PowerShell scripts for the kiosk PC.
- `scripts/screenshot.mjs`: Playwright screenshots at given sizes, for checking layouts.

## Commands

- `pm2 start ecosystem.config.cjs` (or `npm run dev` in a terminal): API on 8787 and Vite on 5191, with `/api` proxied. `pm2 logs inspire9-wall --lines 40 --nostream` for logs.
- `npm run typecheck -w dashboard`, `npm run build`.
- `node scripts/screenshot.mjs http://localhost:5191/ <out-dir> 1920x1080 1080x1920`.

## How things work

- Panel layout: `react-resizable-panels` v4 (`Group`, `Panel`, `Separator`). Presets live in `src/layout.ts`; `Board.tsx` renders them. The saved layout (preset, sizes per preset and group, minimised panels) is stored by the server in `DATA_DIR/layout.json`, with a localStorage copy for a fast first paint.
- Expanded panels are the same DOM node switched to `position: fixed`, so iframes don't reload. Minimised panels keep their body mounted for the same reason.
- Music source is pluggable: the dashboard server talks to Sonos directly when run on the office network (local mode), and the kiosk browser talks to the helper on `localhost:5005` in production.
- Times are always Australia/Melbourne.

## Conventions

- Brand: Plus Jakarta Sans; tokens in `src/styles.css` (`--off-white`, `--charcoal`, `--brand-red`, sage). White cards, 1.5px warm borders, 14px radius, a 4px red stripe under the top bar.
- Readable from across a room, everything usable by touch (44px+ targets). No keyboard on the kiosk.
- Australian English, no em dashes in copy, no eyebrow labels above headings.
- Version is in `package.json` and `dashboard/package.json`; bump both together (minor for features and fixes). It shows in the top bar.
