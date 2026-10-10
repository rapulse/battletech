/**
 * Скриншот запущенного дев-сервера.
 *
 * Playwright не тянет свой Chromium: на macOS 13 он не поддерживается. Вместо
 * этого берётся уже установленный браузер на Chromium — путь задаётся через
 * BROWSER_PATH или ищется среди известных.
 */
import { chromium } from '@playwright/test';
import { existsSync } from 'node:fs';

const CANDIDATES = [
  process.env.BROWSER_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/Applications/Yandex.app/Contents/MacOS/Yandex',
].filter(Boolean);

const executablePath = CANDIDATES.find((p) => existsSync(p));
if (!executablePath) {
  console.error('Не найден браузер на Chromium. Укажите BROWSER_PATH=...');
  process.exit(1);
}

const url = process.argv[2] ?? 'http://localhost:5173/';
const out = process.argv[3] ?? 'screenshot.png';
const width = Number(process.argv[4] ?? 1280);
const height = Number(process.argv[5] ?? 800);

const browser = await chromium.launch({ executablePath });
const page = await browser.newPage({ viewport: { width, height } });

const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));

await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForTimeout(600);
await page.screenshot({ path: out });
await browser.close();

console.log(`Браузер: ${executablePath}`);
console.log(`Скриншот: ${out}`);
if (errors.length) {
  console.log(`ОШИБКИ В КОНСОЛИ (${errors.length}):`);
  for (const e of errors) console.log('  ' + e);
  process.exit(2);
}
console.log('Ошибок в консоли нет.');
