import { useEffect, useState } from 'react'

export function CalendarPanel() {
  return (
    <div className="placeholder">
      <p className="placeholder-title">Calendar</p>
      <p className="placeholder-text">Today and the next few days will show here.</p>
    </div>
  )
}

const skeddaRefreshMs = 60 * 60 * 1000

export function SkeddaPanel({ url }: { url: string | null }) {
  // Reload the booking view hourly in case its own live updates stall.
  const [reloads, setReloads] = useState(0)
  useEffect(() => {
    const id = window.setInterval(() => setReloads((n) => n + 1), skeddaRefreshMs)
    return () => window.clearInterval(id)
  }, [])

  if (!url) {
    return (
      <div className="placeholder">
        <p className="placeholder-text">Bookings aren't set up yet.</p>
      </div>
    )
  }
  return <iframe key={reloads} className="skedda-frame" src={url} title="Room bookings" />
}

export function MusicPanel() {
  return (
    <div className="placeholder">
      <p className="placeholder-text">Music controls unavailable</p>
    </div>
  )
}
