import { useCallback, useEffect, useState } from 'react'
import { Board } from './Board'
import { Header } from './Header'
import { arrangeWith, arrangementFor, defaultSavedLayout, resolvePreset, slotsOf, type PanelId } from './layout'
import { CalendarPanel, MusicPanel, SkeddaPanel } from './panels'
import { useSavedLayout } from './use-saved-layout'

type Config = { version: string; calendarUrl: string | null; skeddaUrl: string | null }

const fullReloadMs = 4 * 60 * 60 * 1000
const expandedIdleMs = 2 * 60 * 1000

function usePortrait() {
  const query = '(orientation: portrait)'
  const [portrait, setPortrait] = useState(() => window.matchMedia(query).matches)
  useEffect(() => {
    const mq = window.matchMedia(query)
    const onChange = () => setPortrait(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return portrait
}

function useConfig() {
  const [config, setConfig] = useState<Config | null>(null)
  useEffect(() => {
    let timer: number
    const load = () =>
      fetch('/api/config')
        .then((r) => (r.ok ? r.json() : Promise.reject()))
        .then(setConfig)
        .catch(() => (timer = window.setTimeout(load, 10_000)))
    load()
    return () => window.clearTimeout(timer)
  }, [])
  return config
}

export function App() {
  const config = useConfig()
  const portrait = usePortrait()
  const [saved, updateSaved] = useSavedLayout()
  const [expanded, setExpanded] = useState<PanelId | null>(null)
  const [resets, setResets] = useState(0)

  // Safety net: a full page refresh every few hours.
  useEffect(() => {
    const id = window.setTimeout(() => location.reload(), fullReloadMs)
    return () => window.clearTimeout(id)
  }, [])

  // An expanded panel returns to the dashboard after a while without a touch.
  useEffect(() => {
    if (!expanded) return
    let timer = window.setTimeout(() => setExpanded(null), expandedIdleMs)
    const reset = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(() => setExpanded(null), expandedIdleMs)
    }
    window.addEventListener('pointerdown', reset)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('pointerdown', reset)
    }
  }, [expanded])

  const onMinimised = useCallback(
    (id: PanelId, minimised: boolean) =>
      updateSaved((l) => {
        if (minimised === l.minimised.includes(id)) return l
        return { ...l, minimised: minimised ? [...l.minimised, id] : l.minimised.filter((m) => m !== id) }
      }),
    [updateSaved],
  )

  const layout = saved ?? defaultSavedLayout
  const presetKey = resolvePreset(layout.preset, portrait)
  const arrangement = arrangeWith(arrangementFor(presetKey), layout.order?.[presetKey])

  const onSwap = (a: PanelId, b: PanelId) =>
    updateSaved((l) => {
      const order = slotsOf(arrangeWith(arrangementFor(presetKey), l.order?.[presetKey])).map((id) => (id === a ? b : id === b ? a : id))
      const next = { ...l, order: { ...l.order, [presetKey]: order } }
      // A minimised slot would minimise whichever panel lands in it, so show both and start this preset's sizes afresh.
      if (l.minimised.includes(a) || l.minimised.includes(b)) {
        next.minimised = l.minimised.filter((m) => m !== a && m !== b)
        next.sizes = Object.fromEntries(Object.entries(l.sizes).filter(([k]) => !k.startsWith(`${presetKey}:`)))
      }
      return next
    })

  return (
    <div className={`app${expanded ? ' has-expanded' : ''}`}>
      <Header
        preset={layout.preset}
        clock24={layout.clock24 ?? false}
        dateFormat={layout.dateFormat ?? 0}
        version={config?.version ?? __APP_VERSION__}
        onPreset={(preset) => updateSaved((l) => ({ ...l, preset, minimised: [] }))}
        onClock24={(on) => updateSaved((l) => ({ ...l, clock24: on }))}
        onDateFormat={(i) => updateSaved((l) => ({ ...l, dateFormat: i }))}
        onResetLayout={() => {
          updateSaved((l) => ({ ...l, sizes: {}, minimised: [], order: {}, zoom: {} }))
          setResets((n) => n + 1)
        }}
      />
      <main className="board-wrap">
        {saved && (
          <Board
            key={`${presetKey}:${slotsOf(arrangement).join()}:${resets}`}
            presetKey={presetKey}
            arrangement={arrangement}
            sizes={layout.sizes}
            minimised={layout.minimised}
            expanded={expanded}
            zoom={layout.zoom ?? {}}
            onSizes={(key, l) => updateSaved((s) => ({ ...s, sizes: { ...s.sizes, [key]: l } }))}
            onMinimised={onMinimised}
            onExpand={setExpanded}
            onZoom={(id, z) => updateSaved((l) => ({ ...l, zoom: { ...l.zoom, [id]: z } }))}
            onSwap={onSwap}
            renderPanel={(id) =>
              id === 'calendar' ? <CalendarPanel url={config?.calendarUrl ?? null} /> : id === 'skedda' ? <SkeddaPanel url={config?.skeddaUrl ?? null} /> : <MusicPanel />
            }
          />
        )}
      </main>
    </div>
  )
}
