import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Icon, type IconName } from './icons'
import { presets, type PresetId } from './layout'

const zone = 'Australia/Melbourne'
const time12 = new Intl.DateTimeFormat('en-AU', { timeZone: zone, hour: 'numeric', minute: '2-digit', hour12: true })
const time24 = new Intl.DateTimeFormat('en-AU', { timeZone: zone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })

// Tapping the date steps through these. All day, month, year order.
export const dateFormats = [
  { weekday: 'long', day: 'numeric', month: 'long' },
  { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' },
  { day: 'numeric', month: 'long', year: 'numeric' },
  { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' },
  { day: '2-digit', month: '2-digit', year: 'numeric' },
].map((o) => new Intl.DateTimeFormat('en-AU', { timeZone: zone, ...(o as Intl.DateTimeFormatOptions) }))

function useNow() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(id)
  }, [])
  return now
}

type ClockProps = { clock24: boolean; dateFormat: number; onClock24: (on: boolean) => void; onDateFormat: (i: number) => void }

function Clock({ clock24, dateFormat, onClock24, onDateFormat }: ClockProps) {
  const now = useNow()
  const parts = (clock24 ? time24 : time12).formatToParts(now)
  const time = parts.filter((p) => p.type !== 'dayPeriod').map((p) => p.value).join('').trim()
  const period = parts.find((p) => p.type === 'dayPeriod')?.value
  const format = dateFormats[dateFormat] ?? dateFormats[0]
  return (
    <div className="clock">
      <button className="clock-time" aria-label={clock24 ? 'Show 12 hour time' : 'Show 24 hour time'} onClick={() => onClock24(!clock24)}>
        <time>
          {time}
          {period && <span className="clock-period">{period}</span>}
        </time>
      </button>
      <button className="clock-date" aria-label="Change date format" onClick={() => onDateFormat((dateFormat + 1) % dateFormats.length)}>
        {format.format(now)}
      </button>
    </div>
  )
}

function MenuOption({ icon, flip, label, hint, selected, onPick }: { icon: IconName; flip?: boolean; label: string; hint: string; selected: boolean; onPick: () => void }) {
  return (
    <button role="menuitemradio" aria-checked={selected} className={`menu-option${selected ? ' is-selected' : ''}`} onClick={onPick}>
      <span className="menu-option-icon">
        <Icon name={icon} size={28} flip={flip} />
      </span>
      <span className="menu-option-text">
        <span className="menu-option-label">{label}</span>
        <span className="menu-option-hint">{hint}</span>
      </span>
      <span className="menu-option-tick">{selected && <Icon name="check" size={18} />}</span>
    </button>
  )
}

function Menu({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="menu" role="menu">
      <h2 className="menu-title">{title}</h2>
      {children}
    </div>
  )
}

type HeaderProps = ClockProps & {
  preset: PresetId
  version: string
  onPreset: (p: PresetId) => void
  onResetLayout: () => void
}

export function Header({ preset, version, onPreset, onResetLayout, ...clock }: HeaderProps) {
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

  const pick = (fn: () => void) => () => {
    fn()
    setOpen(false)
  }

  return (
    <header className="topbar">
      <img className="logo" src="/logo.svg" alt="Inspire9" />
      <Clock {...clock} />
      <div className="topbar-end" ref={menuRef}>
        <button className={`icon-button topbar-button${open ? ' is-open' : ''}`} aria-label="Change layout" onClick={() => setOpen((o) => !o)}>
          <Icon name="layout" size={26} />
        </button>
        {open && (
          <Menu title="Layout">
            {presets.map((p) => (
              <MenuOption key={p.id} icon={p.icon} flip={p.flip} label={p.label} hint={p.hint} selected={preset === p.id} onPick={pick(() => onPreset(p.id))} />
            ))}
            <button className="menu-button" onClick={pick(onResetLayout)}>
              Reset layout
            </button>
          </Menu>
        )}
        <span className="version">v{version}</span>
      </div>
    </header>
  )
}
