import { useEffect, useRef, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { Group, Panel, Separator, usePanelRef, type Layout } from 'react-resizable-panels'
import { Icon } from './icons'
import { panelTitles, slotsOf, zoomRange, type Arrangement, type PanelId } from './layout'

type Orientation = 'horizontal' | 'vertical'

type BoardProps = {
  presetKey: string
  arrangement: Arrangement
  sizes: Record<string, Layout>
  minimised: PanelId[]
  expanded: PanelId | null
  zoom: Partial<Record<PanelId, number>>
  onSizes: (key: string, layout: Layout) => void
  onMinimised: (id: PanelId, minimised: boolean) => void
  onExpand: (id: PanelId | null) => void
  onZoom: (id: PanelId, zoom: number) => void
  onSwap: (a: PanelId, b: PanelId) => void
  renderPanel: (id: PanelId) => ReactNode
}

// Big enough for a finger on the wall's touch screen.
const touchTargets = { coarse: 44, fine: 18 }
const collapsedSize = '64px'

// Panels are placed in numbered slots, so saved sizes stay put when two panels swap places.
const slotId = (i: number) => `slot-${i}`

export function Board(props: BoardProps) {
  const { arrangement: a, presetKey, sizes, onSizes } = props
  const slot = (id: PanelId) => slotId(slotsOf(a).indexOf(id))
  const groupProps = (groupId: string, fallback: Layout) => {
    const saved = sizes[`${presetKey}:${groupId}`]
    const fits = saved && Object.keys(saved).sort().join() === Object.keys(fallback).sort().join()
    return {
      id: groupId,
      defaultLayout: fits ? saved : fallback,
      resizeTargetMinimumSize: touchTargets,
      onLayoutChanged: (layout: Layout, meta: { isUserInteraction: boolean; requestedLayout?: Layout }) => {
        if (meta.isUserInteraction) onSizes(`${presetKey}:${groupId}`, meta.requestedLayout ?? layout)
      },
    }
  }

  if (a.kind === 'line') {
    const fallback = Object.fromEntries(a.order.map((_, i) => [slotId(i), a.sizes[i]]))
    return (
      <Group key={presetKey} orientation={a.orientation} className="board" {...groupProps('line', fallback)}>
        {a.order.map((id, i) => (
          <Slot key={id} first={i === 0}>
            <BoardPanel id={id} slot={slotId(i)} parent={a.orientation} {...props} />
          </Slot>
        ))}
      </Group>
    )
  }

  const main = <BoardPanel id={a.main} slot={slot(a.main)} parent="horizontal" {...props} />
  const side = (
    <Panel id="side" minSize="18%">
      <Group orientation="vertical" className="board-column" {...groupProps('side', { [slot(a.side[0])]: a.sideSplit, [slot(a.side[1])]: 100 - a.sideSplit })}>
        <BoardPanel id={a.side[0]} slot={slot(a.side[0])} parent="vertical" {...props} />
        <ResizeHandle />
        <BoardPanel id={a.side[1]} slot={slot(a.side[1])} parent="vertical" {...props} />
      </Group>
    </Panel>
  )
  return (
    <Group key={presetKey} orientation="horizontal" className="board" {...groupProps('outer', { [slot(a.main)]: a.mainSize, side: 100 - a.mainSize })}>
      {a.mainRight ? side : main}
      <ResizeHandle />
      {a.mainRight ? main : side}
    </Group>
  )
}

function Slot({ first, children }: { first: boolean; children: ReactNode }) {
  return (
    <>
      {!first && <ResizeHandle />}
      {children}
    </>
  )
}

// iframes swallow pointer events mid-drag, so switch them off until the pointer lifts.
function quietIframesUntilRelease(className: string) {
  document.documentElement.classList.add(className)
  const done = () => document.documentElement.classList.remove(className)
  window.addEventListener('pointerup', done, { once: true })
  window.addEventListener('pointercancel', done, { once: true })
}

function ResizeHandle() {
  return (
    <Separator className="resize-handle" onPointerDown={() => quietIframesUntilRelease('is-resizing')}>
      <span className="resize-grip" />
    </Separator>
  )
}

const dragThreshold = 12

// Drag a panel's title bar onto another panel to swap them.
function startPanelDrag(e: ReactPointerEvent<HTMLElement>, id: PanelId, onSwap: (a: PanelId, b: PanelId) => void) {
  if (e.button !== 0 || (e.target as Element).closest('button')) return
  const bar = e.currentTarget
  const source = bar.closest<HTMLElement>('[data-panel-id]')
  const start = { x: e.clientX, y: e.clientY }
  let ghost: HTMLElement | null = null
  let target: HTMLElement | null = null
  bar.setPointerCapture(e.pointerId)

  const move = (ev: PointerEvent) => {
    if (!ghost) {
      if (Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < dragThreshold) return
      quietIframesUntilRelease('is-dragging')
      source?.classList.add('is-drag-source')
      ghost = document.createElement('div')
      ghost.className = 'drag-ghost'
      ghost.textContent = panelTitles[id]
      document.body.append(ghost)
    }
    ghost.style.transform = `translate(${ev.clientX}px, ${ev.clientY}px)`
    const over = document.elementFromPoint(ev.clientX, ev.clientY)?.closest<HTMLElement>('[data-panel-id]') ?? null
    const next = over && over !== source ? over : null
    if (next !== target) {
      target?.classList.remove('is-drop-target')
      next?.classList.add('is-drop-target')
      target = next
    }
  }

  const end = (ev: PointerEvent) => {
    bar.removeEventListener('pointermove', move)
    bar.removeEventListener('pointerup', end)
    bar.removeEventListener('pointercancel', end)
    if (!ghost) return
    ghost.remove()
    source?.classList.remove('is-drag-source')
    target?.classList.remove('is-drop-target')
    // the click that follows a drag shouldn't also open a minimised panel
    const swallow = (c: Event) => c.stopPropagation()
    window.addEventListener('click', swallow, { capture: true, once: true })
    window.setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 0)
    if (ev.type === 'pointerup' && target) onSwap(id, target.dataset.panelId as PanelId)
  }

  bar.addEventListener('pointermove', move)
  bar.addEventListener('pointerup', end)
  bar.addEventListener('pointercancel', end)
}

const clampZoom = (z: number) => Math.round(Math.min(zoomRange.max, Math.max(zoomRange.min, z)) * 10) / 10

function BoardPanel({ id, slot, parent, minimised, expanded, zoom, onMinimised, onExpand, onZoom, onSwap, renderPanel }: BoardProps & { id: PanelId; slot: string; parent: Orientation }) {
  const ref = usePanelRef()
  const wasCollapsed = useRef(false)
  const isMinimised = minimised.includes(id)
  const isExpanded = expanded === id
  const z = zoom[id] ?? 1
  // Re-apply a saved minimised state after mounting or switching presets.
  useEffect(() => {
    if (minimised.includes(id)) ref.current?.collapse()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <Panel
      id={slot}
      panelRef={ref}
      collapsible
      collapsedSize={collapsedSize}
      minSize="14%"
      onResize={() => {
        const c = ref.current?.isCollapsed() ?? false
        if (c !== wasCollapsed.current) {
          wasCollapsed.current = c
          onMinimised(id, c)
        }
      }}
    >
      <section
        data-panel-id={id}
        className={`frame frame-${id} parent-${parent}${isMinimised ? ' is-minimised' : ''}${isExpanded ? ' is-expanded' : ''}`}
        onClick={isMinimised ? () => ref.current?.expand() : undefined}
      >
        <header className={`frame-bar${isExpanded ? '' : ' is-draggable'}`} onPointerDown={isExpanded ? undefined : (e) => startPanelDrag(e, id, onSwap)}>
          <h2 className="frame-title">{panelTitles[id]}</h2>
          <div className="frame-actions">
            {isMinimised ? (
              <button className="icon-button" aria-label={`Show ${panelTitles[id]}`} onClick={(e) => (e.stopPropagation(), ref.current?.expand())}>
                <Icon name="restore" />
              </button>
            ) : (
              <>
                <button className="icon-button" aria-label={`Zoom out ${panelTitles[id]}`} disabled={z <= zoomRange.min} onClick={() => onZoom(id, clampZoom(z - zoomRange.step))}>
                  <Icon name="zoomOut" />
                </button>
                <button className={`zoom-level${z === 1 ? ' is-default' : ''}`} aria-label="Reset zoom" onClick={() => onZoom(id, 1)}>
                  {Math.round(z * 100)}%
                </button>
                <button className="icon-button" aria-label={`Zoom in ${panelTitles[id]}`} disabled={z >= zoomRange.max} onClick={() => onZoom(id, clampZoom(z + zoomRange.step))}>
                  <Icon name="zoomIn" />
                </button>
                {!isExpanded && (
                  <button className="icon-button" aria-label={`Minimise ${panelTitles[id]}`} onClick={() => ref.current?.collapse()}>
                    <Icon name="minimise" />
                  </button>
                )}
                <button className="icon-button" aria-label={isExpanded ? 'Back to dashboard' : `Expand ${panelTitles[id]}`} onClick={() => onExpand(isExpanded ? null : id)}>
                  <Icon name={isExpanded ? 'shrink' : 'expand'} />
                </button>
              </>
            )}
          </div>
        </header>
        <div className="frame-body">
          <div className="frame-zoom" style={{ zoom: z }}>
            {renderPanel(id)}
          </div>
        </div>
      </section>
    </Panel>
  )
}
