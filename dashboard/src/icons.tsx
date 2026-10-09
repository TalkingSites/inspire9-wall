// Bootstrap Icons (https://icons.getbootstrap.com), bundled as raw SVG so only the ones used ship.
import aspectRatio from 'bootstrap-icons/icons/aspect-ratio.svg?raw'
import checkLg from 'bootstrap-icons/icons/check-lg.svg?raw'
import columnsGap from 'bootstrap-icons/icons/columns-gap.svg?raw'
import dashLg from 'bootstrap-icons/icons/dash-lg.svg?raw'
import fullscreen from 'bootstrap-icons/icons/fullscreen.svg?raw'
import fullscreenExit from 'bootstrap-icons/icons/fullscreen-exit.svg?raw'
import grid1x2 from 'bootstrap-icons/icons/grid-1x2.svg?raw'
import layoutThreeColumns from 'bootstrap-icons/icons/layout-three-columns.svg?raw'
import plusLg from 'bootstrap-icons/icons/plus-lg.svg?raw'
import viewStacked from 'bootstrap-icons/icons/view-stacked.svg?raw'
import zoomIn from 'bootstrap-icons/icons/zoom-in.svg?raw'
import zoomOut from 'bootstrap-icons/icons/zoom-out.svg?raw'

const svgs = {
  minimise: dashLg,
  restore: plusLg,
  expand: fullscreen,
  shrink: fullscreenExit,
  layout: columnsGap,
  check: checkLg,
  zoomIn,
  zoomOut,
  layoutAuto: aspectRatio,
  layoutMain: grid1x2,
  layoutEven: layoutThreeColumns,
  layoutStacked: viewStacked,
}

export type IconName = keyof typeof svgs

// Just the shapes inside each <svg>, so every icon gets the same wrapper.
const shapes = Object.fromEntries(Object.entries(svgs).map(([k, v]) => [k, v.replace(/^[\s\S]*?<svg[^>]*>|<\/svg>\s*$/g, '')])) as Record<IconName, string>

export function Icon({ name, size = 22, flip = false }: { name: IconName; size?: number; flip?: boolean }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden="true"
      style={flip ? { transform: 'scaleX(-1)' } : undefined}
      dangerouslySetInnerHTML={{ __html: shapes[name] }}
    />
  )
}
