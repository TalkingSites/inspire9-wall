// The helper's settings: a config.json written by windows/install-helper.ps1 (path in
// HELPER_CONFIG), with environment variables on top for running it by hand.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export type HelperConfig = {
  // Web addresses allowed to use the helper: the wall dashboard's origin.
  allowedOrigins: string[]
  port: number
  maxVolume: number
  speakerLimits: Record<string, number>
  sonosHosts: string[]
  dataDir: string
}

const list = (v?: string) => (v ?? '').split(',').map((s) => s.trim()).filter(Boolean)

export function loadConfig(): HelperConfig {
  const file = process.env.HELPER_CONFIG ?? join(process.cwd(), 'config.json')
  // PowerShell 5 likes to start UTF-8 files with a byte order mark
  const fromFile = existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8').replace(/^﻿/, '')) as Partial<HelperConfig>) : {}
  const env = process.env

  const config: HelperConfig = {
    allowedOrigins: env.HELPER_ALLOWED_ORIGINS ? list(env.HELPER_ALLOWED_ORIGINS) : (fromFile.allowedOrigins ?? []),
    port: Number(env.HELPER_PORT ?? fromFile.port ?? 5005),
    maxVolume: Number(env.MUSIC_MAX_VOLUME ?? fromFile.maxVolume ?? 85),
    speakerLimits: fromFile.speakerLimits ?? {},
    sonosHosts: env.SONOS_HOSTS ? list(env.SONOS_HOSTS) : (fromFile.sonosHosts ?? []),
    dataDir: env.HELPER_DATA_DIR ?? fromFile.dataDir ?? process.cwd(),
  }
  config.allowedOrigins = config.allowedOrigins.map((o) => new URL(o).origin)
  if (!config.allowedOrigins.length) throw new Error(`No allowedOrigins set (looked in ${file}). Run install-helper.ps1 with -DashboardUrl.`)
  return config
}
