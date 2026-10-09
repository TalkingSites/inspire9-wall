import { useCallback, useEffect, useRef, useState } from 'react'
import { defaultSavedLayout, isSavedLayout, type SavedLayout } from './layout'

const cacheKey = 'wall-layout'

function readCache(): SavedLayout | null {
  try {
    const v = JSON.parse(localStorage.getItem(cacheKey) ?? 'null')
    return isSavedLayout(v) ? v : null
  } catch {
    return null
  }
}

function writeCache(layout: SavedLayout) {
  try {
    localStorage.setItem(cacheKey, JSON.stringify(layout))
  } catch {
    // storage unavailable, the server copy still works
  }
}

// The layout lives on the server so it survives the kiosk browser being reset.
// A local copy makes the first paint instant; the server copy wins once loaded.
export function useSavedLayout() {
  const [layout, setLayout] = useState<SavedLayout | null>(readCache)
  const saveTimer = useRef<number>(undefined)

  useEffect(() => {
    let cancelled = false
    fetch('/api/layout')
      .then((r) => (r.ok ? r.json() : null))
      .then((v) => {
        if (cancelled) return
        const next = isSavedLayout(v) ? v : (readCache() ?? defaultSavedLayout)
        setLayout(next)
        writeCache(next)
      })
      .catch(() => !cancelled && setLayout((l) => l ?? defaultSavedLayout))
    return () => {
      cancelled = true
    }
  }, [])

  const update = useCallback((fn: (l: SavedLayout) => SavedLayout) => {
    setLayout((prev) => {
      const next = fn(prev ?? defaultSavedLayout)
      writeCache(next)
      window.clearTimeout(saveTimer.current)
      saveTimer.current = window.setTimeout(() => {
        fetch('/api/layout', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(next),
        }).catch(() => {})
      }, 500)
      return next
    })
  }, [])

  return [layout, update] as const
}
