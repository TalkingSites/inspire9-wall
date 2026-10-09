import { useEffect, useRef, type ReactNode } from 'react'
import { Group, Panel, Separator, usePanelRef, type Layout } from 'react-resizable-panels'
import { Icon } from './icons'
import { panelTitles, type Arrangement, type PanelId } from './layout'

type Orientation = 'horizontal' | 'vertical'

type BoardProps = {
  presetKey: string
  arrangement: Arrangement
  sizes: Record<string, Layout>
  minimised: PanelId[]
  expanded: PanelId | null
  onSizes: (key: string, layout: Layout) => void
  onMinimised: (id: PanelId, minimised: boolean) => void
  onExpand: (id: PanelId | null) => void
  renderPanel: (id: PanelId) => ReactNode
}

// Big enough for a finger on the wall's touch screen.
const touchTargets = { coarse: 44, fine: 18 }
const collapsedSize = '64px'

export function Board(props: BoardProps) {
  const { arrangement: a, presetKey, sizes, onSizes } = props
  const groupProps = (groupId: string, fallback: Layout) => ({
    id: groupId,
    defaultLayout: sizes[`${presetKey}:${groupId}`] ?? fallback,
    resizeTargetMinimumSize: touchTargets,
    onLayoutChanged: (layout: Layout, meta: { isUserInteraction: boolean; requestedLayout?: Layout }) => {
      if (meta.isUserInteraction) onSizes(`${presetKey}:${groupId}`, meta.requestedLayout ?? layout)
    },
  })

  if (a.kind === 'line') {
    const fallback = Object.fromEntries(a.order.map((id, i) => [id, a.sizes[i]]))
    return (
      <Group key={presetKey} orientation={a.orientation} className="board" {...groupProps('line', fallback)}>
        {a.order.map((id, i) => (
          <Slot key={id} first={i === 0}>
            <BoardPanel id={id} parent={a.orientation} {...props} />
          </Slot>
        ))}
      </Group>
    )
  }

  return (
    <Group key={presetKey} orientation="horizontal" className="board" {...groupProps('outer', { [a.main]: a.mainSize, side: 100 - a.mainSize })}>
      <BoardPanel id={a.main} parent="horizontal" {...props} />
      <ResizeHandle />
      <Panel id="side" minSize="18%">
        <Group orientation="vertical" className="board-column" {...groupProps('side', { [a.side[0]]: a.sideSplit, [a.side[1]]: 100 - a.sideSplit })}>
          <BoardPanel id={a.side[0]} parent="vertical" {...props} />
          <ResizeHandle />
          <BoardPanel id={a.side[1]} parent="vertical" {...props} />
        </Group>
      </Panel>
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

function ResizeHandle() {
  return (
    <Separator
      className="resize-handle"
      onPointerDown={() => {
        // iframes swallow pointer events mid-drag, so switch them off while resizing
        document.documentElement.classList.add('is-resizing')
        const done = () => document.documentElement.classList.remove('is-resizing')
        window.addEventListener('pointerup', done, { once: true })
        window.addEventListener('pointercancel', done, { once: true })
      }}
    >
      <span className="resize-grip" />
    </Separator>
  )
}

function BoardPanel({ id, parent, minimised, expanded, onMinimised, onExpand, renderPanel }: BoardProps & { id: PanelId; parent: Orientation }) {
  const ref = usePanelRef()
  const wasCollapsed = useRef(false)
  const isMinimised = minimised.includes(id)
  const isExpanded = expanded === id

  // Re-apply a saved minimised state after mounting or switching presets.
  useEffect(() => {
    if (minimised.includes(id)) ref.current?.collapse()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <Panel
      id={id}
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
        className={`frame frame-${id} parent-${parent}${isMinimised ? ' is-minimised' : ''}${isExpanded ? ' is-expanded' : ''}`}
        onClick={isMinimised ? () => ref.current?.expand() : undefined}
      >
        <header className="frame-bar">
          <h2 className="frame-title">{panelTitles[id]}</h2>
          <div className="frame-actions">
            {isMinimised ? (
              <button className="icon-button" aria-label={`Show ${panelTitles[id]}`} onClick={(e) => (e.stopPropagation(), ref.current?.expand())}>
                <Icon name="restore" />
              </button>
            ) : (
              <>
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
        <div className="frame-body">{renderPanel(id)}</div>
      </section>
    </Panel>
  )
}
