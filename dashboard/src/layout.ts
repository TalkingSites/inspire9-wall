import type { Layout } from 'react-resizable-panels'
import type { IconName } from './icons'

export type PanelId = 'calendar' | 'skedda' | 'music'
export type PresetId = 'auto' | 'main' | 'mainRight' | 'even' | 'stacked'

export const panelTitles: Record<PanelId, string> = {
  calendar: 'Calendar',
  skedda: 'Bookings',
  music: 'Music',
}

// How the three panels are arranged on screen.
export type Arrangement =
  | { kind: 'main-side'; main: PanelId; side: [PanelId, PanelId]; mainSize: number; sideSplit: number; mainRight?: boolean }
  | { kind: 'line'; orientation: 'horizontal' | 'vertical'; order: PanelId[]; sizes: number[] }

export const presets: { id: PresetId; label: string; hint: string; icon: IconName; flip?: boolean }[] = [
  { id: 'auto', label: 'Auto', hint: 'Fits the screen shape', icon: 'layoutAuto' },
  { id: 'main', label: 'Large left', hint: 'One large panel on the left, two beside it', icon: 'layoutMain' },
  { id: 'mainRight', label: 'Large right', hint: 'One large panel on the right, two beside it', icon: 'layoutMain', flip: true },
  { id: 'even', label: 'Side by side', hint: 'Three equal columns', icon: 'layoutEven' },
  { id: 'stacked', label: 'Stacked', hint: 'One above the other, for portrait screens', icon: 'layoutStacked' },
]

export function resolvePreset(preset: PresetId, portrait: boolean): Exclude<PresetId, 'auto'> {
  if (preset !== 'auto') return preset
  return portrait ? 'stacked' : 'main'
}

export function arrangementFor(preset: Exclude<PresetId, 'auto'>): Arrangement {
  switch (preset) {
    case 'main':
      return { kind: 'main-side', main: 'calendar', side: ['skedda', 'music'], mainSize: 56, sideSplit: 66 }
    case 'mainRight':
      return { kind: 'main-side', main: 'calendar', side: ['skedda', 'music'], mainSize: 56, sideSplit: 66, mainRight: true }
    case 'even':
      return { kind: 'line', orientation: 'horizontal', order: ['calendar', 'skedda', 'music'], sizes: [36, 40, 24] }
    case 'stacked':
      return { kind: 'line', orientation: 'vertical', order: ['calendar', 'skedda', 'music'], sizes: [42, 40, 18] }
  }
}

// The panels in slot order: main then side for main-side, left to right (or top to bottom) for a line.
export function slotsOf(a: Arrangement): PanelId[] {
  return a.kind === 'main-side' ? [a.main, ...a.side] : a.order
}

// The preset's arrangement with its panels moved around, if they have been.
export function arrangeWith(a: Arrangement, order: PanelId[] | undefined): Arrangement {
  const slots = slotsOf(a)
  if (!order || order.length !== slots.length || !slots.every((id) => order.includes(id))) return a
  return a.kind === 'main-side' ? { ...a, main: order[0], side: [order[1], order[2]] } : { ...a, order }
}

export const zoomRange = { min: 0.5, max: 2, step: 0.1 }

// What gets saved on the server.
export type SavedLayout = {
  preset: PresetId
  sizes: Record<string, Layout>
  minimised: PanelId[]
  // panels in slot order, per preset, once they've been dragged around
  order?: Record<string, PanelId[]>
  zoom?: Partial<Record<PanelId, number>>
  // clock settings, kept through a layout reset
  clock24?: boolean
  dateFormat?: number
}

export const defaultSavedLayout: SavedLayout = { preset: 'auto', sizes: {}, minimised: [] }

export function isSavedLayout(v: unknown): v is SavedLayout {
  const o = v as SavedLayout
  return !!o && typeof o === 'object' && presets.some((p) => p.id === o.preset) && Array.isArray(o.minimised) && typeof o.sizes === 'object'
}
