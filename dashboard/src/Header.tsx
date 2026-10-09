import { useEffect, useRef, useState } from 'react'
import { Icon } from './icons'
import { presets, type PresetId } from './layout'

const zone = 'Australia/Melbourne'
const timeFormat = new Intl.DateTimeFormat('en-AU', { timeZone: zone, hour: 'numeric', minute: '2-digit', hour12: true })
const dateFormat = new Intl.DateTimeFormat('en-AU', { timeZone: zone, weekday: 'long', day: 'numeric', month: 'long' })

function useNow() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(id)
  }, [])
  return now
}

function Clock() {
  const now = useNow()
  const parts = timeFormat.formatToParts(now)
  const time = parts.filter((p) => p.type !== 'dayPeriod').map((p) => p.value).join('').trim()
  const period = parts.find((p) => p.type === 'dayPeriod')?.value
  return (
    <div className="clock">
      <time className="clock-time">
        {time}
        {period && <span className="clock-period">{period}</span>}
      </time>
      <span className="clock-date">{dateFormat.format(now)}</span>
    </div>
  )
}

type HeaderProps = {
  preset: PresetId
  version: string
  onPreset: (p: PresetId) => void
  onResetSizes: () => void
}

export function Header({ preset, version, onPreset, onResetSizes }: HeaderProps) {
  const [open, setOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const timer = window.setTimeout(() => setOpen(false), 30_000)
    window.addEventListener('pointerdown', close)
    return () => {
      window.removeEventListener('pointerdown', close)
      window.clearTimeout(timer)
    }
  }, [open])

  return (
    <header className="topbar">
      <img className="logo" src="/logo.svg" alt="Inspire9" />
      <Clock />
      <div className="topbar-end" ref={menuRef}>
        <button className={`icon-button layout-button${open ? ' is-open' : ''}`} aria-label="Change layout" onClick={() => setOpen((o) => !o)}>
          <Icon name="layout" size={26} />
        </button>
        {open && (
          <div className="layout-menu" role="menu">
            <h2 className="layout-menu-title">Layout</h2>
            {presets.map((p) => (
              <button
                key={p.id}
                role="menuitemradio"
                aria-checked={preset === p.id}
                className={`layout-option${preset === p.id ? ' is-selected' : ''}`}
                onClick={() => {
                  onPreset(p.id)
                  setOpen(false)
                }}
              >
                <span className="layout-option-text">
                  <span className="layout-option-label">{p.label}</span>
                  <span className="layout-option-hint">{p.hint}</span>
                </span>
                {preset === p.id && <Icon name="check" />}
              </button>
            ))}
            <button
              className="layout-reset"
              onClick={() => {
                onResetSizes()
                setOpen(false)
              }}
            >
              Reset sizes
            </button>
          </div>
        )}
        <span className="version">v{version}</span>
      </div>
    </header>
  )
}
