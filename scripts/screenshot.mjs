// Screenshots the dashboard at common wall sizes.
// Usage: node scripts/screenshot.mjs <url> <out-dir> [WxH ...]
import { chromium } from 'playwright'

const [url = 'http://localhost:5191/', out = '.', ...sizes] = process.argv.slice(2)
const browser = await chromium.launch()
for (const size of sizes.length ? sizes : ['1920x1080']) {
  const [width, height] = size.split('x').map(Number)
  const page = await browser.newPage({ viewport: { width, height } })
  page.on('console', (m) => m.type() === 'error' && console.log(`[${size}] console: ${m.text()}`))
  page.on('pageerror', (e) => console.log(`[${size}] page error: ${e.message}`))
  await page.goto(url, { waitUntil: 'networkidle' }).catch((e) => console.log(`[${size}] ${e.message}`))
  await page.waitForTimeout(3000)
  await page.screenshot({ path: `${out}/wall-${size}.png` })
  console.log(`saved ${out}/wall-${size}.png`)
  await page.close()
}
await browser.close()
