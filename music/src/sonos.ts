// Controls the office Sonos system over the local network (UPnP on port 1400).
//
// It always works on one group: whatever grouping the Sonos app has set up, the
// biggest group that isn't playing AirPlay, line-in or TV (someone AirPlaying from a
// laptop splits their speaker off into its own group). Commands go to that group's
// coordinator, so every speaker in the group follows. Grouping is never changed.
import { SonosDevice, SonosDeviceDiscovery } from '@svrooij/sonos'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { escapeXml, parseDidl, playlistMetadata, toLibraryItems, toPlaylistTracks, toQueueItems, type LibraryItem, type PlaylistTrack, type QueueItem } from './didl.js'

type ZoneGroup = Awaited<ReturnType<SonosDevice['ZoneGroupTopologyService']['GetParsedZoneGroupState']>>[number]

export type Speaker = { id: string; name: string; volume: number; muted: boolean; maxVolume: number }

export type MusicState = {
  group: { name: string; speakers: Speaker[] }
  playing: boolean
  track: { title?: string; artist?: string; album?: string; art?: string; position?: string; duration?: string } | null
  station?: string
  source?: string
  canSkip: boolean
  canGoBack: boolean
  volume: number
  muted: boolean
  maxVolume: number
}

// How a favourite or playlist goes into the queue, as in the Sonos app.
export type PlayMode = 'replace' | 'shuffle' | 'now' | 'next' | 'end'
export const playModes: PlayMode[] = ['replace', 'shuffle', 'now', 'next', 'end']

type LibraryList = 'favourites' | 'playlists' | 'history'

export class MusicError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message)
  }
}

export type SonosOptions = {
  // Speaker IPs to try before network discovery (they may change with DHCP).
  hosts?: string[]
  maxVolume?: number
  // Lower limits for particular speakers, by name (case doesn't matter).
  speakerLimits?: Record<string, number>
  // Where the recently played list is kept.
  historyFile?: string
  log?: (message: string) => void
}

const groupCacheMs = 3000
const libraryCacheMs = 60_000
const skipGapMs = 1500
const historySize = 12
const otherInputs = /^(x-sonos-vli|x-rincon-stream|x-sonos-htastream):/

const sourceName = (uri: string) => {
  if (uri.startsWith('x-sonos-spotify:') || /sid=12\b/.test(uri)) return 'Spotify'
  if (/sid=204\b/.test(uri)) return 'Apple Music'
  if (/^(x-sonosapi-stream|x-sonosapi-radio|x-rincon-mp3radio|x-sonosapi-hls|aac):/.test(uri)) return 'Radio'
  return undefined
}

export class SonosMusic {
  private readonly devices = new Map<string, SonosDevice>()
  private knownHosts: string[]
  private readonly maxVolume: number
  private readonly speakerLimits: Map<string, number>
  private readonly log: (m: string) => void
  private group?: { at: number; zone: ZoneGroup; uri: string }
  private library = new Map<string, { at: number; items: LibraryItem[] }>()
  private history: LibraryItem[] | null = null
  private lastSkip = 0
  // Volume changes arrive faster than Sonos takes them; only the latest one per target is sent.
  private volumeQueue = new Map<string, { running: boolean; next?: () => Promise<unknown> }>()

  constructor(private readonly options: SonosOptions = {}) {
    this.knownHosts = [...(options.hosts ?? [])]
    this.maxVolume = Math.min(100, Math.max(1, options.maxVolume ?? 85))
    this.speakerLimits = new Map(Object.entries(options.speakerLimits ?? {}).map(([name, v]) => [name.trim().toLowerCase(), Math.min(this.maxVolume, Math.max(1, v))]))
    this.log = options.log ?? ((m) => console.log(`[music] ${m}`))
  }

  private device(host: string) {
    let d = this.devices.get(host)
    if (!d) {
      d = new SonosDevice(host, 1400)
      this.devices.set(host, d)
    }
    return d
  }

  private async topology(): Promise<ZoneGroup[]> {
    for (const host of this.knownHosts) {
      try {
        return this.remember(await this.device(host).ZoneGroupTopologyService.GetParsedZoneGroupState())
      } catch {
        // that speaker moved or is off, try the next
      }
    }
    this.log('looking for speakers on the network')
    const found = await new SonosDeviceDiscovery().SearchOne(5).catch(() => null)
    if (!found) throw new MusicError("Couldn't find any Sonos speakers", 503)
    return this.remember(await this.device(found.host).ZoneGroupTopologyService.GetParsedZoneGroupState())
  }

  private remember(groups: ZoneGroup[]) {
    this.knownHosts = [...new Set([...groups.flatMap((g) => g.members.map((m) => m.host)), ...this.knownHosts])]
    return groups
  }

  // The group the wall controls, re-checked every few seconds.
  private async controlled(fresh = false) {
    if (!fresh && this.group && Date.now() - this.group.at < groupCacheMs) return this.group
    const groups = await this.topology()
    const looked = await Promise.all(
      groups.map(async (zone) => {
        const media = await this.device(zone.coordinator.host).AVTransportService.GetMediaInfo({ InstanceID: 0 }).catch(() => null)
        return { zone, uri: media?.CurrentURI ?? '' }
      }),
    )
    const ours = looked.filter((g) => !otherInputs.test(g.uri))
    const pick = (ours.length ? ours : looked).sort((a, b) => b.zone.members.length - a.zone.members.length)[0]
    if (!pick) throw new MusicError("Couldn't find any Sonos speakers", 503)
    this.group = { at: Date.now(), zone: pick.zone, uri: pick.uri }
    return this.group
  }

  private async coordinator() {
    const { zone } = await this.controlled()
    return { zone, device: this.device(zone.coordinator.host) }
  }

  async state(): Promise<MusicState> {
    const { zone, device } = await this.coordinator()
    const av = device.AVTransportService
    const [transport, position, media, actions, volume, muted, speakers] = await Promise.all([
      av.GetTransportInfo({ InstanceID: 0 }),
      av.GetPositionInfo({ InstanceID: 0 }),
      av.GetMediaInfo({ InstanceID: 0 }),
      av.GetCurrentTransportActions({ InstanceID: 0 }).catch(() => ({ Actions: '' })),
      device.GroupRenderingControlService.GetGroupVolume({ InstanceID: 0 }),
      device.GroupRenderingControlService.GetGroupMute({ InstanceID: 0 }),
      Promise.all(zone.members.filter((m) => !m.Invisible).map((m) => this.speaker(m.uuid, m.name, m.host))),
    ])
    const meta = typeof position.TrackMetaData === 'object' ? position.TrackMetaData : null
    const mediaMeta = typeof media.CurrentURIMetaData === 'object' ? media.CurrentURIMetaData : null
    const isStream = /^(x-sonosapi-stream|x-sonosapi-radio|x-rincon-mp3radio|x-sonosapi-hls|aac):/.test(media.CurrentURI)
    if (isStream) this.noteStation(media.CurrentURI)
    const has = (a: string) => actions.Actions.split(',').some((x) => x.trim() === a)
    return {
      group: { name: zone.name, speakers: speakers.sort((a, b) => a.name.localeCompare(b.name)) },
      playing: transport.CurrentTransportState === 'PLAYING' || transport.CurrentTransportState === 'TRANSITIONING',
      track: meta
        ? {
            title: meta.Title,
            artist: meta.Artist,
            album: meta.Album,
            art: meta.AlbumArtUri,
            position: position.RelTime && position.RelTime !== 'NOT_IMPLEMENTED' ? position.RelTime : undefined,
            duration: position.TrackDuration && position.TrackDuration !== 'NOT_IMPLEMENTED' && position.TrackDuration !== '0:00:00' ? position.TrackDuration : undefined,
          }
        : null,
      station: isStream ? mediaMeta?.Title : undefined,
      source: sourceName(position.TrackURI || media.CurrentURI),
      canSkip: has('Next'),
      canGoBack: has('Previous'),
      volume: Number(volume.CurrentVolume),
      muted: Boolean(muted.CurrentMute),
      maxVolume: this.maxVolume,
    }
  }

  private limitFor(name: string) {
    return this.speakerLimits.get(name.trim().toLowerCase()) ?? this.maxVolume
  }

  private async speaker(id: string, name: string, host: string): Promise<Speaker> {
    const rc = this.device(host).RenderingControlService
    const [v, m] = await Promise.all([rc.GetVolume({ InstanceID: 0, Channel: 'Master' }), rc.GetMute({ InstanceID: 0, Channel: 'Master' })])
    return { id, name, volume: Number(v.CurrentVolume), muted: Boolean(m.CurrentMute), maxVolume: this.limitFor(name) }
  }

  async play() {
    await (await this.coordinator()).device.Play()
  }

  async pause() {
    await (await this.coordinator()).device.Pause()
  }

  private async skip(direction: 'Next' | 'Previous') {
    if (Date.now() - this.lastSkip < skipGapMs) throw new MusicError('One moment, still skipping', 429)
    const { device } = await this.coordinator()
    const { Actions } = await device.AVTransportService.GetCurrentTransportActions({ InstanceID: 0 }).catch(() => ({ Actions: '' }))
    if (!Actions.split(',').some((a) => a.trim() === direction)) {
      throw new MusicError(direction === 'Next' ? "This is a radio station, so there's no next track" : "There's no previous track here", 409)
    }
    this.lastSkip = Date.now()
    await (direction === 'Next' ? device.Next() : device.Previous())
  }

  next() {
    return this.skip('Next')
  }

  previous() {
    return this.skip('Previous')
  }

  private clampVolume(v: number, max = this.maxVolume) {
    if (!Number.isFinite(v)) throw new MusicError('Volume must be a number')
    return Math.round(Math.min(max, Math.max(0, v)))
  }

  // Runs fn now if nothing is in flight for this target, otherwise keeps it as the
  // one to run next (replacing any older waiting change).
  private latestOnly(key: string, fn: () => Promise<unknown>) {
    const q = this.volumeQueue.get(key) ?? { running: false }
    this.volumeQueue.set(key, q)
    if (q.running) {
      q.next = fn
      return Promise.resolve()
    }
    q.running = true
    const run = async (f: () => Promise<unknown>): Promise<void> => {
      try {
        await f()
      } finally {
        const next = q.next
        q.next = undefined
        if (next) await run(next)
        else q.running = false
      }
    }
    return run(fn)
  }

  async setVolume(volume: number) {
    const v = this.clampVolume(volume)
    const { device } = await this.coordinator()
    await this.latestOnly('group', async () => {
      await device.GroupRenderingControlService.SnapshotGroupVolume({ InstanceID: 0 })
      await device.GroupRenderingControlService.SetGroupVolume({ InstanceID: 0, DesiredVolume: v })
    })
  }

  async setMuted(muted: boolean) {
    const { device } = await this.coordinator()
    await device.GroupRenderingControlService.SetGroupMute({ InstanceID: 0, DesiredMute: muted })
  }

  private async member(id: string) {
    const { zone } = await this.controlled()
    const m = zone.members.find((x) => x.uuid === id)
    if (!m) throw new MusicError("That speaker isn't in the group any more", 404)
    return { device: this.device(m.host), name: m.name }
  }

  async setSpeakerVolume(id: string, volume: number) {
    const { device: d, name } = await this.member(id)
    const v = this.clampVolume(volume, this.limitFor(name))
    await this.latestOnly(id, () => d.RenderingControlService.SetVolume({ InstanceID: 0, Channel: 'Master', DesiredVolume: v }))
  }

  async setSpeakerMuted(id: string, muted: boolean) {
    const { device: d } = await this.member(id)
    await d.RenderingControlService.SetMute({ InstanceID: 0, Channel: 'Master', DesiredMute: muted })
  }

  private async browse(objectId: string, max = 500) {
    const { device } = await this.coordinator()
    const nodes = []
    for (let start = 0; start < max; ) {
      const r = await device.ContentDirectoryService.Browse({ ObjectID: objectId, BrowseFlag: 'BrowseDirectChildren', Filter: '*', StartingIndex: start, RequestedCount: 100, SortCriteria: '' })
      const page = parseDidl(String(r.Result ?? ''))
      nodes.push(...page)
      start += Number(r.NumberReturned)
      if (!Number(r.NumberReturned) || start >= Number(r.TotalMatches)) break
    }
    return nodes
  }

  private async cached(key: string, load: () => Promise<LibraryItem[]>) {
    const hit = this.library.get(key)
    if (hit && Date.now() - hit.at < libraryCacheMs) return hit.items
    const items = await load()
    this.library.set(key, { at: Date.now(), items })
    return items
  }

  favourites() {
    return this.cached('favourites', async () => toLibraryItems(await this.browse('FV:2')))
  }

  playlists() {
    return this.cached('playlists', async () =>
      toLibraryItems(await this.browse('SQ:')).map((p) => ({ ...p, metadata: playlistMetadata(p.id, p.title) })),
    )
  }

  async queue(): Promise<{ current: number; items: QueueItem[] }> {
    const { device } = await this.coordinator()
    const [position, media] = await Promise.all([device.AVTransportService.GetPositionInfo({ InstanceID: 0 }), device.AVTransportService.GetMediaInfo({ InstanceID: 0 })])
    const onQueue = media.CurrentURI.startsWith('x-rincon-queue:')
    return { current: onQueue ? Number(position.Track) : 0, items: toQueueItems(await this.browse('Q:0', 1000)) }
  }

  // Puts a favourite, playlist or history item on the group, the same ways the Sonos app
  // offers: replace the queue (optionally shuffled, optionally starting at a track), play
  // now (straight after the current track), play next, or add to the end. Radio stations
  // can't go in a queue, so they just play.
  async playItem(item: LibraryItem, mode: PlayMode = 'replace', startAt = 1) {
    const { zone, device } = await this.coordinator()
    const av = device.AVTransportService
    const metadata = item.metadata ? escapeXml(item.metadata) : ''
    const queueUri = `x-rincon-queue:${zone.coordinator.uuid}#0`
    const add = (position: number, asNext: boolean) =>
      av.AddURIToQueue({ InstanceID: 0, EnqueuedURI: item.uri, EnqueuedURIMetaData: metadata, DesiredFirstTrackNumberEnqueued: position, EnqueueAsNext: asNext })

    if (item.kind === 'stream') {
      if (mode === 'next' || mode === 'end') throw new MusicError("Radio stations can't go in the queue, tap Play instead")
      await av.SetAVTransportURI({ InstanceID: 0, CurrentURI: item.uri, CurrentURIMetaData: metadata })
    } else if (mode === 'replace' || mode === 'shuffle') {
      await av.RemoveAllTracksFromQueue({ InstanceID: 0 })
      await add(0, false)
      await av.SetAVTransportURI({ InstanceID: 0, CurrentURI: queueUri, CurrentURIMetaData: '' })
      if (mode === 'shuffle') await av.SetPlayMode({ InstanceID: 0, NewPlayMode: 'SHUFFLE_NOREPEAT' as never }) // the library's PlayMode enum isn't exported
      await device.SeekTrack(Math.max(1, startAt))
    } else {
      const [media, position] = await Promise.all([av.GetMediaInfo({ InstanceID: 0 }), av.GetPositionInfo({ InstanceID: 0 })])
      const onQueue = media.CurrentURI.startsWith('x-rincon-queue:')
      const after = onQueue ? Number(position.Track) + 1 : 0
      if (mode === 'end') {
        await add(0, false)
        return
      }
      const added = await add(after, true)
      if (mode === 'next') return
      if (!onQueue) await av.SetAVTransportURI({ InstanceID: 0, CurrentURI: queueUri, CurrentURIMetaData: '' })
      await device.SeekTrack(Number(added.FirstTrackNumberEnqueued) || 1)
    }
    await device.Play()
    await this.addToHistory(item)
  }

  private async find(list: LibraryList, id: string) {
    const items = list === 'favourites' ? await this.favourites() : list === 'playlists' ? await this.playlists() : await this.recent()
    const item = items.find((i) => i.id === id)
    if (!item) throw new MusicError("Couldn't find that one, it may have been removed", 404)
    return item
  }

  async playFrom(list: LibraryList, id: string, mode: PlayMode = 'replace', startAt = 1) {
    await this.playItem(await this.find(list, id), mode, startAt)
  }

  // Track lists exist for Sonos playlists only: the speakers won't list a Spotify or Apple
  // Music playlist's tracks to anything but the Sonos app.
  async tracks(list: LibraryList, id: string): Promise<PlaylistTrack[] | null> {
    const item = await this.find(list, id)
    const saved = /savedqueues\.rsq#(\d+)/.exec(item.uri)
    return saved ? toPlaylistTracks(await this.browse(`SQ:${saved[1]}`, 1000)) : null
  }

  private async onQueue() {
    const { zone, device } = await this.coordinator()
    const media = await device.AVTransportService.GetMediaInfo({ InstanceID: 0 })
    if (!media.CurrentURI.startsWith('x-rincon-queue:')) {
      await device.AVTransportService.SetAVTransportURI({ InstanceID: 0, CurrentURI: `x-rincon-queue:${zone.coordinator.uuid}#0`, CurrentURIMetaData: '' })
    }
    return device
  }

  async jumpTo(position: number) {
    const device = await this.onQueue()
    await device.SeekTrack(position)
    await device.Play()
  }

  async removeFromQueue(position: number) {
    const { device } = await this.coordinator()
    await device.AVTransportService.RemoveTrackFromQueue({ InstanceID: 0, ObjectID: `Q:0/${position}`, UpdateID: 0 })
  }

  // Moves the track at `from` so it ends up at `to` (both 1-based queue positions).
  async moveInQueue(from: number, to: number) {
    if (from === to) return
    const { device } = await this.coordinator()
    await device.AVTransportService.ReorderTracksInQueue({ InstanceID: 0, StartingIndex: from, NumberOfTracks: 1, InsertBefore: to > from ? to + 1 : to, UpdateID: 0 })
  }

  // Album art lives on the speakers (plain http on the office network) or a music
  // service's CDN. The browser can't load the speaker's copy itself, so it's passed through.
  async art(url: string): Promise<Response> {
    let target: URL
    if (url.startsWith('/')) {
      const { zone } = await this.controlled()
      target = new URL(url, `http://${zone.coordinator.host}:1400`)
    } else {
      target = new URL(url)
      const onSpeaker = target.protocol === 'http:' && target.port === '1400' && this.knownHosts.includes(target.hostname)
      if (target.protocol !== 'https:' && !onSpeaker) throw new MusicError('Not an artwork address', 400)
    }
    const res = await fetch(target, { signal: AbortSignal.timeout(8000) })
    if (!res.ok || !String(res.headers.get('content-type')).startsWith('image/')) throw new MusicError('No artwork', 404)
    return res
  }

  // Sonos keeps "recently played" in its cloud, so the wall keeps its own list: things
  // played from the wall, plus radio stations from the favourites seen playing.
  async recent() {
    if (this.history) return this.history
    try {
      this.history = this.options.historyFile ? (JSON.parse(await readFile(this.options.historyFile, 'utf8')) as LibraryItem[]) : []
    } catch {
      this.history = []
    }
    return this.history
  }

  private async addToHistory(item: LibraryItem) {
    const list = await this.recent()
    if (list[0]?.uri === item.uri) return
    this.history = [{ ...item, id: `h:${item.uri}` }, ...list.filter((i) => i.uri !== item.uri)].slice(0, historySize)
    if (!this.options.historyFile) return
    try {
      await mkdir(dirname(this.options.historyFile), { recursive: true })
      await writeFile(this.options.historyFile + '.tmp', JSON.stringify(this.history))
      await rename(this.options.historyFile + '.tmp', this.options.historyFile)
    } catch (e) {
      this.log(`couldn't save history: ${(e as Error).message}`)
    }
  }

  private noteStation(uri: string) {
    const fav = this.library.get('favourites')?.items.find((f) => f.uri === uri)
    if (fav) void this.addToHistory(fav)
  }
}
