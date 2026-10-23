// Renders the SVG app icons to PNG using the locally installed Chromium (Playwright).
// Usage: node scripts/gen-icons.mjs   (needs `playwright` installed locally or globally;
// set PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs for a global install)
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
import { readFileSync } from 'node:fs';

const jobs = [
  ['public/icons/favicon.svg', 'public/icons/icon-192.png', 192],
  ['public/icons/favicon.svg', 'public/icons/icon-512.png', 512],
  ['public/icons/maskable.svg', 'public/icons/icon-maskable-512.png', 512],
  ['public/icons/maskable.svg', 'public/icons/apple-touch-icon.png', 180],
];
const browser = await chromium.launch();
const page = await browser.newPage();
for (const [src, out, size] of jobs) {
  await page.setViewportSize({ width: size, height: size });
  const svg = readFileSync(src, 'utf8');
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
  await page.screenshot({ path: out, omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
  console.log('wrote', out);
}
await browser.close();
