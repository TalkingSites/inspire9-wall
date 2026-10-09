// Inspire9 Wall calendar sync (Google Apps Script)
//
// Keeps a public copy of each office calendar ("Wall: ..."), with titles and times
// only, so the wall screen can embed Google Calendar without a login. Descriptions,
// locations, guests and meeting links are never copied. Events marked private show
// as "Busy". Each copy is its own calendar so the embed can colour it.
//
// Set up once, signed in as the account that owns the calendars, with the Google
// Calendar API service added (or the Calendar advanced service in appsscript.json): pick "setup" in the function menu above and click Run, then approve access.
// setup() creates and publishes the copies, schedules sync() every 10 minutes, runs a
// first sync and logs the embed link. Running it again is safe.

// The calendars copied, and each copy's colour on the wall.
const SOURCES = [
  // { id: '<calendar id, from the calendar's settings>', name: '<shown on the wall as "Wall: name">', color: '#039BE5' },
  { id: 'CALENDAR_ID_1', name: 'Calendar one', color: '#039BE5' },
  { id: 'CALENDAR_ID_2', name: 'Calendar two', color: '#D50000' },
]
const DAY = 24 * 60 * 60 * 1000
// From five weeks back (so this month's view is complete) to four months ahead.
const PAST_DAYS = 35
const AHEAD_DAYS = 120
// Apps Script stops a run at 6 minutes; leave room to finish cleanly.
const RUN_BUDGET_MS = 5 * 60 * 1000

const wallKey = (source) => 'wall:' + source.id

function setup() {
  const props = PropertiesService.getScriptProperties()
  // The first version kept one wall calendar for everything; it becomes the first source's copy.
  const old = props.getProperty('wallId')
  if (old && !props.getProperty(wallKey(SOURCES[0]))) props.setProperty(wallKey(SOURCES[0]), old)
  props.deleteProperty('wallId')

  for (const s of SOURCES) {
    const details = {
      summary: 'Wall: ' + s.name,
      description: 'Public copy of "' + s.name + '" for the wall screen: titles and times only. Synced every 10 minutes; changes made here are overwritten.',
      timeZone: 'Australia/Melbourne',
    }
    let id = props.getProperty(wallKey(s))
    if (id) Calendar.Calendars.patch(details, id)
    else {
      id = Calendar.Calendars.insert(details).id
      props.setProperty(wallKey(s), id)
    }
    try {
      Calendar.Acl.insert({ role: 'reader', scope: { type: 'default' } }, id)
    } catch (e) {
      throw new Error('Could not make "' + details.summary + '" public. The Workspace admin settings may not allow public calendars. ' + e.message)
    }
  }
  for (const t of ScriptApp.getProjectTriggers()) if (t.getHandlerFunction() === 'sync') ScriptApp.deleteTrigger(t)
  ScriptApp.newTrigger('sync').timeBased().everyMinutes(10).create()
  sync()
  console.log('Embed link: ' + embedLink())
}

function embedLink() {
  const props = PropertiesService.getScriptProperties()
  const calendars = SOURCES.map((s) => '&src=' + encodeURIComponent(props.getProperty(wallKey(s))) + '&color=' + encodeURIComponent(s.color)).join('')
  return 'https://calendar.google.com/calendar/embed?ctz=Australia%2FMelbourne' + calendars
}

function sync() {
  const started = Date.now()
  const props = PropertiesService.getScriptProperties()
  const timeMin = new Date(started - PAST_DAYS * DAY).toISOString()
  const timeMax = new Date(started + AHEAD_DAYS * DAY).toISOString()

  // Work out every copy's changes first, then make them nearest days first, so a
  // big first sync fills this week before next month.
  const todo = []
  for (const s of SOURCES) {
    const wallId = props.getProperty(wallKey(s))
    if (!wallId) throw new Error('Run setup() first')
    const ops = plan([s], [{ items: listEvents(s.id, timeMin, timeMax) }], listEvents(wallId, timeMin, timeMax))
    for (const op of ops) todo.push({ op: op, wallId: wallId })
  }
  const distance = (op) => {
    if (op.action === 'delete') return -1
    const start = op.body.start.date || op.body.start.dateTime
    return Math.abs(Date.parse(start) - started)
  }
  todo.sort((a, b) => distance(a.op) - distance(b.op))

  let done = 0
  for (const t of todo) {
    if (Date.now() - started > RUN_BUDGET_MS) {
      console.log('Out of time after ' + done + ' of ' + todo.length + ' changes; the next run carries on')
      return
    }
    const op = t.op
    withRetry(() => {
      if (op.action === 'create') Calendar.Events.insert(op.body, t.wallId)
      else if (op.action === 'update') Calendar.Events.patch(op.body, t.wallId, op.id)
      else Calendar.Events.remove(t.wallId, op.id)
    })
    done++
    Utilities.sleep(200)
  }
  console.log('Synced: ' + done + ' changes')
}

// Google limits how fast events can be written; back off and try again.
function withRetry(fn) {
  for (let attempt = 0; ; attempt++) {
    try {
      return fn()
    } catch (e) {
      if (attempt >= 5 || !/rate limit|quota|backend error/i.test(e.message)) throw e
      Utilities.sleep(2000 * Math.pow(2, attempt))
    }
  }
}

function listEvents(calendarId, timeMin, timeMax) {
  let items = []
  let pageToken
  do {
    const page = Calendar.Events.list(calendarId, { singleEvents: true, maxResults: 2500, timeMin: timeMin, timeMax: timeMax, pageToken: pageToken })
    items = items.concat(page.items || [])
    pageToken = page.nextPageToken
  } while (pageToken)
  return items
}

// Compares the source calendars with the wall copy and returns the changes to make
// to the wall calendar: { action: 'create' | 'update' | 'delete', id?, body? }.
// Copies carry only title, time and free/busy; never descriptions, guests,
// locations or links. Each copy remembers its source in a private extended property.
function plan(sources, results, wallItems) {
  const when = (t) => (t.date ? { date: t.date } : { dateTime: t.dateTime, timeZone: t.timeZone || 'Australia/Melbourne' })
  const same = (a, b) => (a.date || b.date ? a.date === b.date : Date.parse(a.dateTime) === Date.parse(b.dateTime))

  const want = new Map()
  results.forEach((r, i) => {
    const src = sources[i]
    if (!Array.isArray(r.items)) throw new Error(`No events list for ${src.name}, stopping so nothing gets deleted`)
    for (const e of r.items) {
      if (e.status === 'cancelled' || !e.start || !e.end) continue
      if (e.eventType && !['default', 'fromGmail'].includes(e.eventType)) continue
      if ((e.attendees || []).some((a) => a.self && a.responseStatus === 'declined')) continue
      const key = `${src.id}|${e.id}`
      const hidden = e.visibility === 'private' || e.visibility === 'confidential'
      want.set(key, {
        summary: hidden ? 'Busy' : (e.summary || 'Busy').trim(),
        start: when(e.start),
        end: when(e.end),
        transparency: e.transparency || 'opaque',
        extendedProperties: { private: { wallKey: key } },
      })
    }
  })

  const ops = []
  const seen = new Set()
  for (const w of wallItems) {
    const key = w.extendedProperties && w.extendedProperties.private && w.extendedProperties.private.wallKey
    if (!key) continue // added by hand, leave it alone
    const target = want.get(key)
    if (!target || seen.has(key)) {
      ops.push({ action: 'delete', id: w.id })
      continue
    }
    seen.add(key)
    const changed =
      (w.summary || '') !== target.summary ||
      (w.transparency || 'opaque') !== target.transparency ||
      !same(w.start, target.start) ||
      !same(w.end, target.end)
    if (changed) ops.push({ action: 'update', id: w.id, body: target })
  }
  for (const [key, target] of want) if (!seen.has(key)) ops.push({ action: 'create', body: target })
  return ops
}

