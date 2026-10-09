import type { Layout } from 'react-resizable-panels'

export type PanelId = 'calendar' | 'skedda' | 'music'
export type PresetId = 'auto' | 'calendar' | 'bookings' | 'even' | 'stacked'

export const panelTitles: Record<PanelId, string> = {
  calendar: 'Calendar',
  skedda: 'Bookings',
  music: 'Music',
}

// How the three panels are arranged on screen.
export type Arrangement =
  | { kind: 'main-side'; main: PanelId; side: [PanelId, PanelId]; mainSize: number; sideSplit: number }
  | { kind: 'line'; orientation: 'horizontal' | 'vertical'; order: PanelId[]; sizes: number[] }

export const presets: { id: PresetId; label: string; hint: string }[] = [
  { id: 'auto', label: 'Auto', hint: 'Fits the screen shape' },
  { id: 'calendar', label: 'Calendar focus', hint: 'Calendar large, bookings and music beside it' },
  { id: 'bookings', label: 'Bookings focus', hint: 'Bookings large, calendar and music beside it' },
  { id: 'even', label: 'Side by side', hint: 'Three equal columns' },
  { id: 'stacked', label: 'Stacked', hint: 'One above the other, for portrait screens' },
]

export function resolvePreset(preset: PresetId, portrait: boolean): Exclude<PresetId, 'auto'> {
  if (preset !== 'auto') return preset
  return portrait ? 'stacked' : 'calendar'
}

export function arrangementFor(preset: Exclude<PresetId, 'auto'>): Arrangement {
  switch (preset) {
    case 'calendar':
      return { kind: 'main-side', main: 'calendar', side: ['skedda', 'music'], mainSize: 56, sideSplit: 66 }
    case 'bookings':
      return { kind: 'main-side', main: 'skedda', side: ['calendar', 'music'], mainSize: 56, sideSplit: 66 }
    case 'even':
      return { kind: 'line', orientation: 'horizontal', order: ['calendar', 'skedda', 'music'], sizes: [36, 40, 24] }
    case 'stacked':
      return { kind: 'line', orientation: 'vertical', order: ['calendar', 'skedda', 'music'], sizes: [42, 40, 18] }
  }
}

// What gets saved on the server.
export type SavedLayout = {
  preset: PresetId
  sizes: Record<string, Layout>
  minimised: PanelId[]
}

export const defaultSavedLayout: SavedLayout = { preset: 'auto', sizes: {}, minimised: [] }

export function isSavedLayout(v: unknown): v is SavedLayout {
  const o = v as SavedLayout
  return !!o && typeof o === 'object' && typeof o.preset === 'string' && Array.isArray(o.minimised) && typeof o.sizes === 'object'
}
