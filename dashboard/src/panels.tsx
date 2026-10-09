import { useEffect, useState } from 'react'

const embedRefreshMs = 60 * 60 * 1000

// An embedded page (Google Calendar, Skedda), reloaded hourly in case its own live updates stall.
function EmbedPanel({ url, title, missing }: { url: string | null; title: string; missing: string }) {
  const [reloads, setReloads] = useState(0)
  useEffect(() => {
    const id = window.setInterval(() => setReloads((n) => n + 1), embedRefreshMs)
    return () => window.clearInterval(id)
  }, [])

  if (!url) {
    return (
      <div className="placeholder">
        <p className="placeholder-text">{missing}</p>
      </div>
    )
  }
  return <iframe key={reloads} className="embed-frame" src={url} title={title} />
}

export function CalendarPanel({ url }: { url: string | null }) {
  return <EmbedPanel url={url} title="Calendar" missing="The calendar isn't set up yet." />
}

export function SkeddaPanel({ url }: { url: string | null }) {
  return <EmbedPanel url={url} title="Room bookings" missing="Bookings aren't set up yet." />
}

export function MusicPanel() {
  return (
    <div className="placeholder">
      <p className="placeholder-text">Music controls unavailable</p>
    </div>
  )
}
