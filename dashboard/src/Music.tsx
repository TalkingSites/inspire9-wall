import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { Icon } from './icons'

// Mirrors the music API (music/src/sonos.ts).
type Speaker = { id: string; name: string; volume: number; muted: boolean; maxVolume: number }
type MusicState = {
  group: { name: string; speakers: Speaker[] }
  playing: boolean
  track: { title?: string; artist?: string; album?: string; art?: string; position?: string; duration?: string } | null
  station?: string
  source?: string
  canSkip: boolean
  canGoBack: boolean
  volume: number
  muted: boolean
  maxVolume: number
}
type LibraryItem = { id: string; title: string; subtitle?: string; art?: string; kind: 'container' | 'track' | 'stream' }
type QueueItem = { position: number; title: string; artist?: string; album?: string; art?: string }

const pollMs = 2000
const queuePollMs = 5000
// While a slider is being dragged, and a moment after, the slider shows its own value.
const sliderHoldMs = 1500
const sliderSendMs = 200
const toastMs = 4000

type Api = ReturnType<typeof useMusic>

function useMusic(base: string) {
  const [state, setState] = useState<MusicState | null>(null)
  const [down, setDown] = useState(false)
  const fails = useRef(0)

  const refresh = useCallback(async () => {
    try {
      const r = await fetch(`${base}/state`)
      if (!r.ok) throw new Error()
      setState(await r.json())
      fails.current = 0
      setDown(false)
    } catch {
      // one missed poll is a blip; two in a row and the controls step aside
      if (++fails.current >= 2) setDown(true)
    }
  }, [base])

  useEffect(() => {
    refresh()
    const id = window.setInterval(() => !document.hidden && refresh(), pollMs)
    return () => window.clearInterval(id)
  }, [refresh])

  const send = useCallback(
    async (path: string, body?: object) => {
      const r = await fetch(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error ?? "Couldn't reach the speakers")
      refresh()
      return j
    },
    [base, refresh],
  )

  const get = useCallback(async <T,>(path: string): Promise<T> => {
    const r = await fetch(`${base}${path}`)
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? "Couldn't reach the speakers")
    return r.json()
  }, [base])

  const art = (url?: string) => (url ? `${base}/art?u=${encodeURIComponent(url)}` : undefined)

  return { state, setState, down, send, get, art }
}

function useToast() {
  const [message, setMessage] = useState<string | null>(null)
  const timer = useRef<number>(undefined)
  const show = useCallback((m: string) => {
    setMessage(m)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setMessage(null), toastMs)
  }, [])
  useEffect(() => () => window.clearTimeout(timer.current), [])
  return [message, show] as const
}

function Art({ src, kind, className }: { src?: string; kind?: 'radio' | 'note'; className: string }) {
  const [broken, setBroken] = useState(false)
  useEffect(() => setBroken(false), [src])
  return (
    <div className={`${className} music-art`}>
      {src && !broken ? <img src={src} alt="" loading="lazy" onError={() => setBroken(true)} /> : <Icon name={kind ?? 'note'} size={28} />}
    </div>
  )
}

// A big, touch-friendly slider. Sends changes as it moves (throttled) and once more on release.
function Slider({ value, max, label, onChange }: { value: number; max: number; label: string; onChange: (v: number) => void }) {
  const [local, setLocal] = useState<number | null>(null)
  const lastSent = useRef(0)
  const trailing = useRef<number>(undefined)
  const release = useRef<number>(undefined)
  const shown = Math.min(local ?? value, max)

  const send = (v: number, now = false) => {
    window.clearTimeout(trailing.current)
    const wait = sliderSendMs - (Date.now() - lastSent.current)
    if (now || wait <= 0) {
      lastSent.current = Date.now()
      onChange(v)
    } else trailing.current = window.setTimeout(() => send(v, true), wait)
  }
  const hold = () => {
    window.clearTimeout(release.current)
    release.current = window.setTimeout(() => setLocal(null), sliderHoldMs)
  }
  useEffect(() => () => (window.clearTimeout(trailing.current), window.clearTimeout(release.current)), [])

  return (
    <input
      className="music-slider"
      type="range"
      min={0}
      max={max}
      value={shown}
      aria-label={label}
      style={{ '--fill': `${(shown / max) * 100}%` } as React.CSSProperties}
      onChange={(e) => {
        const v = Number(e.target.value)
        setLocal(v)
        send(v)
        hold()
      }}
    />
  )
}

function NowPlaying({ api, notify, children }: { api: Api; notify: (m: string) => void; children?: React.ReactNode }) {
  const s = api.state!
  const t = s.track
  const title = t?.title || s.station || 'Nothing playing'
  const by = [t?.artist, t?.title && s.station ? s.station : t?.album].filter(Boolean).join(' · ')
  const act = (path: string, body?: object) => api.send(path, body).catch((e: Error) => notify(e.message))

  return (
    <div className="music-now">
      <Art className="music-now-art" src={api.art(t?.art)} kind={s.source === 'Radio' ? 'radio' : 'note'} />
      <div className="music-meta">
        <p className="music-title">{title}</p>
        {by && <p className="music-by">{by}</p>}
        {s.source && <p className="music-source">{s.source}</p>}
      </div>
      <div className="music-controls">
        <button className="music-button" aria-label="Previous track" disabled={!s.canGoBack} onClick={() => act('/previous')}>
          <Icon name="previous" size={26} />
        </button>
        <button
          className="music-button music-play"
          aria-label={s.playing ? 'Pause' : 'Play'}
          onClick={() => {
            api.setState((x) => (x ? { ...x, playing: !x.playing } : x))
            act(s.playing ? '/pause' : '/play')
          }}
        >
          <Icon name={s.playing ? 'pause' : 'play'} size={34} />
        </button>
        <button className="music-button" aria-label="Next track" onClick={() => (s.canSkip ? act('/next') : notify("This is a radio station, so there's no next track"))}>
          <Icon name="next" size={26} />
        </button>
        {children}
      </div>
    </div>
  )
}

type List = 'favourites' | 'playlists' | 'history'
const tabs: { id: List; label: string }[] = [
  { id: 'favourites', label: 'Favourites' },
  { id: 'playlists', label: 'Playlists' },
  { id: 'history', label: 'Recently played' },
]

type PlaylistTrack = { number: number; title: string; artist?: string; album?: string; art?: string; duration?: string }
type PlayMode = 'replace' | 'shuffle' | 'now' | 'next' | 'end'

// The options the Sonos app gives under "…".
const queueOptions: { mode: PlayMode; label: string; icon: 'play' | 'playNext' | 'addToEnd' | 'replace' }[] = [
  { mode: 'now', label: 'Play now', icon: 'play' },
  { mode: 'next', label: 'Play next', icon: 'playNext' },
  { mode: 'end', label: 'Add to end of queue', icon: 'addToEnd' },
  { mode: 'replace', label: 'Replace queue', icon: 'replace' },
]
const playedMessage: Record<PlayMode, string> = {
  replace: 'Playing',
  shuffle: 'Shuffling',
  now: 'Playing',
  next: 'Playing next:',
  end: 'Added to the queue:',
}

function Tiles({ api, list, notify, empty, onOpen }: { api: Api; list: List; notify: (m: string) => void; empty: string; onOpen: (item: LibraryItem) => void }) {
  const [items, setItems] = useState<LibraryItem[] | null>(null)
  useEffect(() => {
    api.get<LibraryItem[]>(`/${list}`).then(setItems).catch((e: Error) => notify(e.message))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list])
  if (!items) return <p className="music-empty">Loading</p>
  if (!items.length) return <p className="music-empty">{empty}</p>
  return (
    <div className="music-tiles">
      {items.map((item) => (
        <button key={item.id} className="music-tile" onClick={() => onOpen(item)}>
          <Art className="music-tile-art" src={api.art(item.art)} kind={item.kind === 'stream' ? 'radio' : 'note'} />
          <span className="music-tile-title">{item.title}</span>
          {item.subtitle && <span className="music-tile-sub">{item.subtitle}</span>}
        </button>
      ))}
    </div>
  )
}

// A favourite, playlist or recent item, opened like in the Sonos app: big artwork, Play,
// Shuffle and the queue options, and the track list where the speakers can give one.
function Detail({ api, list, item, notify, onBack }: { api: Api; list: List; item: LibraryItem; notify: (m: string) => void; onBack: () => void }) {
  const [tracks, setTracks] = useState<PlaylistTrack[] | null | undefined>(undefined)
  const [menu, setMenu] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const isStation = item.kind === 'stream'

  // A tap anywhere else closes the menu.
  useEffect(() => {
    if (!menu) return
    const close = (e: PointerEvent) => !menuRef.current?.contains(e.target as Node) && setMenu(false)
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [menu])

  useEffect(() => {
    if (isStation) return setTracks(null)
    api
      .get<{ tracks: PlaylistTrack[] | null }>(`/${list}/tracks?id=${encodeURIComponent(item.id)}`)
      .then((r) => setTracks(r.tracks))
      .catch(() => setTracks(null))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id])

  const play = (mode: PlayMode, track?: number) => {
    setMenu(false)
    api
      .send(`/${list}/play`, { id: item.id, mode, track })
      .then(() => notify(`${playedMessage[mode]} ${track ? tracks?.[track - 1]?.title : item.title}`))
      .catch((e: Error) => notify(e.message))
  }

  return (
    <div className="music-detail">
      <button className="music-back" onClick={onBack}>
        <Icon name="back" size={20} />
        {tabs.find((t) => t.id === list)?.label}
      </button>
      <div className="music-detail-head">
        <Art className="music-detail-art" src={api.art(item.art)} kind={isStation ? 'radio' : 'note'} />
        <div className="music-detail-info">
          <h3 className="music-detail-title">{item.title}</h3>
          <p className="music-detail-sub">{[item.subtitle, isStation ? 'Radio station' : tracks ? `${tracks.length} tracks` : null].filter(Boolean).join(' · ')}</p>
          <div className="music-detail-actions">
            <button className="music-button music-play" aria-label={`Play ${item.title}`} onClick={() => play('replace')}>
              <Icon name="play" size={30} />
            </button>
            {!isStation && (
              <>
                <button className="music-button" aria-label={`Shuffle ${item.title}`} onClick={() => play('shuffle')}>
                  <Icon name="shuffle" size={24} />
                </button>
                <div className="music-menu-wrap" ref={menuRef}>
                  <button className={`music-button${menu ? ' is-on' : ''}`} aria-label="More options" aria-expanded={menu} onClick={() => setMenu((m) => !m)}>
                    <Icon name="more" size={24} />
                  </button>
                  {menu && (
                    <div className="music-menu" role="menu">
                      {queueOptions.map((o) => (
                        <button key={o.mode} role="menuitem" className="music-menu-item" onClick={() => play(o.mode)}>
                          <Icon name={o.icon} size={20} />
                          {o.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
      {tracks === undefined && <p className="music-empty">Loading</p>}
      {tracks === null && !isStation && <p className="music-empty">The speakers can't list the tracks in {item.subtitle ?? 'this'} playlists, but Play, Shuffle and the queue options all work.</p>}
      {tracks && tracks.length === 0 && <p className="music-empty">This playlist is empty</p>}
      {tracks && tracks.length > 0 && (
        <ol className="music-tracks">
          {tracks.map((t) => (
            <li key={t.number}>
              <button className="music-track" onClick={() => play('replace', t.number)}>
                <Art className="music-queue-art" src={api.art(t.art)} />
                <span className="music-queue-text">
                  <span className="music-queue-title">{t.title}</span>
                  {t.artist && <span className="music-queue-by">{t.artist}</span>}
                </span>
                {t.duration && <span className="music-track-time">{t.duration}</span>}
              </button>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

const queueShown = 100

function Queue({ api, notify }: { api: Api; notify: (m: string) => void }) {
  const [queue, setQueue] = useState<{ current: number; items: QueueItem[] } | null>(null)
  const [drag, setDrag] = useState<{ from: number; dy: number; rowH: number } | null>(null)

  const { get } = api
  const load = useCallback(() => get<{ current: number; items: QueueItem[] }>('/queue').then(setQueue).catch((e: Error) => notify(e.message)), [get, notify])
  useEffect(() => {
    load()
    const id = window.setInterval(() => !drag && load(), queuePollMs)
    return () => window.clearInterval(id)
  }, [load, drag])

  if (!queue) return <p className="music-empty">Loading</p>
  if (!queue.items.length) return <p className="music-empty">The queue is empty</p>
  const start = Math.max(0, queue.current - 1)
  const rows = queue.items.slice(start, start + queueShown)
  const target = drag ? Math.min(rows.length - 1, Math.max(0, drag.from + Math.round(drag.dy / drag.rowH))) : -1

  const act = (path: string, body: object, message?: string) =>
    api
      .send(path, body)
      .then(() => (message && notify(message), load()))
      .catch((e: Error) => notify(e.message))

  const startDrag = (e: ReactPointerEvent<HTMLElement>, index: number) => {
    const handle = e.currentTarget
    const rowH = handle.closest('li')?.getBoundingClientRect().height ?? 64
    const y0 = e.clientY
    handle.setPointerCapture(e.pointerId)
    setDrag({ from: index, dy: 0, rowH })
    const move = (ev: PointerEvent) => setDrag({ from: index, dy: ev.clientY - y0, rowH })
    const end = (ev: PointerEvent) => {
      handle.removeEventListener('pointermove', move)
      handle.removeEventListener('pointerup', end)
      handle.removeEventListener('pointercancel', end)
      const to = Math.min(rows.length - 1, Math.max(0, index + Math.round((ev.clientY - y0) / rowH)))
      setDrag(null)
      if (ev.type === 'pointerup' && to !== index) act('/queue/move', { from: rows[index].position, to: rows[to].position })
    }
    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', end)
    handle.addEventListener('pointercancel', end)
  }

  return (
    <ol className="music-queue">
      {rows.map((item, i) => {
        const isCurrent = item.position === queue.current
        const dragging = drag?.from === i
        const shift = drag && !dragging ? (i > drag.from && i <= target ? -1 : i < drag.from && i >= target ? 1 : 0) : 0
        return (
          <li
            key={item.position}
            className={`music-queue-row${isCurrent ? ' is-current' : ''}${dragging ? ' is-dragging' : ''}`}
            style={dragging ? { transform: `translateY(${drag.dy}px)` } : shift ? { transform: `translateY(${shift * (drag?.rowH ?? 0)}px)` } : undefined}
          >
            <span className="music-queue-grip" aria-label="Drag to reorder" onPointerDown={(e) => startDrag(e, i)}>
              <Icon name="grip" size={22} />
            </span>
            <button className="music-queue-main" onClick={() => act('/queue/jump', { position: item.position }, `Playing ${item.title}`)}>
              <Art className="music-queue-art" src={api.art(item.art)} />
              <span className="music-queue-text">
                <span className="music-queue-title">{item.title}</span>
                {item.artist && <span className="music-queue-by">{item.artist}</span>}
              </span>
              {isCurrent && <span className="music-queue-now">Now</span>}
            </button>
            {!isCurrent && (
              <button className="music-button music-queue-remove" aria-label={`Remove ${item.title}`} onClick={() => act('/queue/remove', { position: item.position })}>
                <Icon name="remove" size={18} />
              </button>
            )}
          </li>
        )
      })}
    </ol>
  )
}

// Each speaker in the group with its own volume, like the Sonos app. There's no overall
// volume on purpose: rooms are set individually.
function Speakers({ api, notify }: { api: Api; notify: (m: string) => void }) {
  const s = api.state!
  const act = (path: string, body: object) => api.send(path, body).catch((e: Error) => notify(e.message))
  return (
    <ul className="music-speaker-list">
      {s.group.speakers.map((sp) => (
        <li key={sp.id} className="music-speaker">
          <span className="music-speaker-name">{sp.name}</span>
          <button
            className={`music-button music-mute${sp.muted ? ' is-on' : ''}`}
            aria-label={sp.muted ? `Unmute ${sp.name}` : `Mute ${sp.name}`}
            onClick={() => {
              api.setState((x) => (x ? { ...x, group: { ...x.group, speakers: x.group.speakers.map((y) => (y.id === sp.id ? { ...y, muted: !y.muted } : y)) } } : x))
              act(`/speakers/${sp.id}/mute`, { muted: !sp.muted })
            }}
          >
            <Icon name={sp.muted ? 'muted' : 'volume'} size={22} />
          </button>
          <Slider
            value={sp.volume}
            max={sp.maxVolume}
            label={`${sp.name} volume`}
            onChange={(v) => {
              api.setState((x) => (x ? { ...x, group: { ...x.group, speakers: x.group.speakers.map((y) => (y.id === sp.id ? { ...y, volume: v } : y)) } } : x))
              act(`/speakers/${sp.id}/volume`, { volume: v })
            }}
          />
          <span className="music-volume-value">{sp.volume}</span>
        </li>
      ))}
    </ul>
  )
}

function Library({ api, notify }: { api: Api; notify: (m: string) => void }) {
  const [tab, setTab] = useState<List>('favourites')
  const [open, setOpen] = useState<LibraryItem | null>(null)
  return (
    <div className="music-library">
      <div className="music-tabs" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            className={`music-tab${tab === t.id ? ' is-selected' : ''}`}
            onClick={() => {
              setTab(t.id)
              setOpen(null)
            }}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="music-tab-body">
        {open ? (
          <Detail key={open.id} api={api} list={tab} item={open} notify={notify} onBack={() => setOpen(null)} />
        ) : (
          <Tiles
            api={api}
            list={tab}
            notify={notify}
            onOpen={setOpen}
            empty={tab === 'history' ? 'Nothing yet. Favourites and playlists played from here show up in this list.' : `No Sonos ${tab} yet`}
          />
        )}
      </div>
    </div>
  )
}

type Side = 'volume' | 'queue'

// Switches the list beside now playing between speaker volumes and the queue. It sits in
// the spare space next to the play controls.
function SideSwitch({ side, onSide }: { side: Side; onSide: (s: Side) => void }) {
  return (
    <div className="music-switch" role="tablist">
      {(['volume', 'queue'] as const).map((id) => (
        <button key={id} role="tab" aria-selected={side === id} aria-label={id === 'volume' ? 'Volume' : 'Queue'} className={`music-switch-option${side === id ? ' is-selected' : ''}`} onClick={() => onSide(id)}>
          <Icon name={id === 'volume' ? 'volume' : 'list'} size={16} />
          <span className="music-switch-label">{id === 'volume' ? 'Volume' : 'Queue'}</span>
        </button>
      ))}
    </div>
  )
}

function Unavailable() {
  return (
    <div className="placeholder">
      <p className="placeholder-text">Music controls unavailable</p>
    </div>
  )
}

function MusicControls({ base, expanded }: { base: string; expanded: boolean }) {
  const api = useMusic(base)
  const [toast, notify] = useToast()
  const [side, setSide] = useState<Side>('volume')
  if (api.down || !api.state) return api.down ? <Unavailable /> : <div className="placeholder" />
  return (
    <div className={`music${expanded ? ' is-expanded' : ''}`}>
      <div className="music-main">
        <NowPlaying api={api} notify={notify}>
          <SideSwitch side={side} onSide={setSide} />
        </NowPlaying>
        <div className="music-side">{side === 'volume' ? <Speakers api={api} notify={notify} /> : <Queue api={api} notify={notify} />}</div>
      </div>
      {expanded && <Library api={api} notify={notify} />}
      {toast && (
        <p className="music-toast" role="status">
          {toast}
        </p>
      )}
    </div>
  )
}

export function MusicPanel({ base, expanded }: { base: string | null; expanded: boolean }) {
  return base ? <MusicControls base={base} expanded={expanded} /> : <Unavailable />
}
