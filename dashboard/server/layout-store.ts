// Saves the wall's chosen layout (preset, panel sizes, minimised panels) to a
// small JSON file, so it survives the kiosk browser being reset.
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const dataDir = process.env.DATA_DIR ?? './data'
const file = join(dataDir, 'layout.json')
const maxBytes = 20_000

export async function loadLayout(): Promise<object | null> {
  try {
    return JSON.parse(await readFile(file, 'utf8'))
  } catch {
    return null
  }
}

export async function saveLayout(layout: object): Promise<void> {
  const json = JSON.stringify(layout)
  if (json.length > maxBytes) throw new Error('Layout too large')
  await mkdir(dataDir, { recursive: true })
  await writeFile(file + '.tmp', json)
  await rename(file + '.tmp', file)
}
