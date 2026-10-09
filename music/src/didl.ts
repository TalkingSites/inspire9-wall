// Sonos describes music as DIDL-Lite XML. These helpers turn it into plain objects
// and back, keeping the original metadata a favourite needs to play (r:resMD).
import { XMLParser } from 'fast-xml-parser'

export type ItemKind = 'container' | 'track' | 'stream'

export type LibraryItem = {
  id: string
  title: string
  subtitle?: string
  art?: string
  uri: string
  // DIDL metadata sent back to Sonos when playing the item
  metadata: string
  kind: ItemKind
}

export type QueueItem = { position: number; title: string; artist?: string; album?: string; art?: string }

export type PlaylistTrack = { number: number; title: string; artist?: string; album?: string; art?: string; duration?: string }

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  textNodeName: '#text',
  parseTagValue: false,
  parseAttributeValue: false,
  isArray: (name) => name === 'item' || name === 'container',
})

const entities: Record<string, string> = { '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'", '&amp;': '&' }
const unescapeXml = (s: string) => s.replace(/&(lt|gt|quot|apos|amp);/g, (m) => entities[m])
export const escapeXml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')

const text = (v: unknown): string | undefined => {
  if (v == null) return undefined
  if (typeof v === 'object') return text((v as Record<string, unknown>)['#text'])
  const s = String(v).trim()
  return s || undefined
}

export function kindOf(uri: string): ItemKind {
  if (/^(x-sonosapi-stream|x-sonosapi-radio|x-rincon-mp3radio|x-sonosapi-hls|hls-radio|aac):/.test(uri)) return 'stream'
  if (/^(x-rincon-cpcontainer|x-rincon-playlist|file:\/\/\/jffs\/settings\/savedqueues)/.test(uri)) return 'container'
  return 'track'
}

type DidlNode = Record<string, unknown>

// Browse results arrive with the XML escaped once more; undo that first.
export function parseDidl(xml: string): DidlNode[] {
  const raw = xml.trimStart().startsWith('&lt;') ? unescapeXml(xml) : xml
  const root = parser.parse(raw)['DIDL-Lite'] as Record<string, DidlNode[]> | undefined
  if (!root) return []
  return [...(root.container ?? []), ...(root.item ?? [])]
}

// Favourites and Sonos playlists. Items Sonos can't play directly (app shortcuts) are left out.
export function toLibraryItems(nodes: DidlNode[]): LibraryItem[] {
  const out: LibraryItem[] = []
  for (const n of nodes) {
    const uri = text(n.res)
    const title = text(n['dc:title'])
    if (!uri || !title) continue
    out.push({
      id: String(n.id),
      title,
      subtitle: text(n['r:description']) ?? text(n['dc:creator']),
      art: text(n['upnp:albumArtURI']),
      uri,
      metadata: text(n['r:resMD']) ?? '',
      kind: kindOf(uri),
    })
  }
  return out
}

export function toQueueItems(nodes: DidlNode[]): QueueItem[] {
  return nodes.map((n) => ({
    position: Number(String(n.id).split('/').pop()),
    title: text(n['dc:title']) ?? 'Unknown track',
    artist: text(n['dc:creator']),
    album: text(n['upnp:album']),
    art: text(n['upnp:albumArtURI']),
  }))
}

export function toPlaylistTracks(nodes: DidlNode[]): PlaylistTrack[] {
  return nodes.map((n, i) => {
    const res = n.res as Record<string, unknown> | undefined
    const duration = typeof res === 'object' ? text(res.duration) : undefined
    return {
      number: i + 1,
      title: text(n['dc:title']) ?? 'Unknown track',
      artist: text(n['dc:creator']),
      album: text(n['upnp:album']),
      art: text(n['upnp:albumArtURI']),
      duration: duration?.replace(/^0:/, ''),
    }
  })
}

// Minimal metadata for a Sonos playlist, which has no r:resMD of its own.
export function playlistMetadata(id: string, title: string) {
  return (
    '<DIDL-Lite xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/" ' +
    'xmlns:r="urn:schemas-rinconnetworks-com:metadata-1-0/" xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/">' +
    `<item id="${escapeXml(id)}" parentID="SQ:" restricted="true"><dc:title>${escapeXml(title)}</dc:title>` +
    '<upnp:class>object.container.playlistContainer</upnp:class>' +
    '<desc id="cdudn" nameSpace="urn:schemas-rinconnetworks-com:metadata-1-0/">RINCON_AssociatedZPUDN</desc></item></DIDL-Lite>'
  )
}
