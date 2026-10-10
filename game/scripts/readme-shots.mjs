/**
 * Снимки экранов для README репозитория: `docs/screens/<язык>/*.jpg`.
 *
 * Идёт по игре тем же путём, что игрок: главное меню → основание отряда → ангар, карта,
 * контракты → свободный бой; держава — из готового сохранения. Нужные кнопки обводятся
 * пронумерованными метками, их расшифровка — в README. Метки рисует только этот скрипт,
 * в игру они не попадают.
 *
 * Запуск (дев-сервер уже поднят, `pnpm dev`):
 *
 *   REALM_SLOT=readme pnpm vite-node scripts/realmplay.ts -- setup --cbills 200000000
 *   REALM_SLOT=readme pnpm vite-node scripts/realmplay.ts -- do '{"kind":"claimGrant"}'
 *   REALM_SLOT=readme pnpm vite-node scripts/realmplay.ts -- do '{"kind":"raiseRegiment","mechs":16}'
 *   REALM_SLOT=readme pnpm vite-node scripts/realmplay.ts -- adv 365
 *   REALM_SLOT=readme pnpm vite-node scripts/realmplay.ts -- do '{"kind":"travel","systemId":"kanegawa"}'
 *   REALM_SLOT=readme pnpm vite-node scripts/realmplay.ts -- adv 20
 *   REALM_SLOT=readme pnpm vite-node scripts/realmplay.ts -- do '{"kind":"buyWorld"}'
 *   REALM_SLOT=readme pnpm vite-node scripts/realmplay.ts -- adv 120
 *   REALM_SLOT=readme pnpm vite-node scripts/realmplay.ts -- do '{"kind":"setCompanyName","name":"Iron Ravens"}'
 *   node scripts/readme-shots.mjs [http://localhost:5173/]
 *
 * Браузер — уже установленный Chromium-совместимый (см. screenshot.mjs).
 */
/* global document, window, localStorage -- они нужны только внутри `page.evaluate` и `addInitScript`, где код исполняется в браузере */
import { chromium } from '@playwright/test';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

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
const ROOT = join(import.meta.dirname, '..', '..');
const REALM_SAVE = join(import.meta.dirname, '.realmplay', 'readme', 'campaign');
/** Сид, у которого в стартовой роте воин кланов: с ним первые бои легче. */
const SEED = '49646175';
/** Одно имя отряда на всех снимках, в том числе у державы из сохранения. */
const COMPANY = 'Iron Ravens';
const CALLSIGN = 'Raven';
const VIEWPORT = { width: 1440, height: 900 };

const browser = await chromium.launch({ executablePath });
const errors = [];

async function open(lang) {
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 });
  await context.addInitScript((l) => {
    localStorage.setItem('battletech.preferences', JSON.stringify({ interfaceLanguage: l, termsLanguage: l }));
  }, lang);
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  return { context, page };
}

/**
 * Метки поверх экрана: рамка вокруг элемента и номер в кружке. `marks` — пары
 * [селектор, номер]; селектор берёт первый видимый элемент.
 */
async function mark(page, marks) {
  await page.evaluate((list) => {
    document.querySelectorAll('.readme-mark').forEach((n) => n.remove());
    for (const [selector, n] of list) {
      const el = [...document.querySelectorAll(selector)].find((e) => e.getBoundingClientRect().width > 0);
      if (!el) throw new Error(`метка ${n}: нет элемента ${selector}`);
      const r = el.getBoundingClientRect();
      // Рамка не выходит за край окна, иначе номер у края срезается.
      const left = Math.max(r.left - 4, 16);
      const top = Math.max(r.top - 4, 16);
      const right = Math.min(r.right + 4, window.innerWidth - 4);
      const bottom = Math.min(r.bottom + 4, window.innerHeight - 4);
      const box = document.createElement('div');
      box.className = 'readme-mark';
      Object.assign(box.style, {
        position: 'fixed', left: `${left}px`, top: `${top}px`,
        width: `${right - left}px`, height: `${bottom - top}px`, boxSizing: 'border-box',
        border: '3px solid #ffb020', borderRadius: '6px', boxShadow: '0 0 0 2px rgba(0,0,0,.6)',
        zIndex: 99999, pointerEvents: 'none',
      });
      const badge = document.createElement('div');
      badge.textContent = String(n);
      Object.assign(badge.style, {
        position: 'absolute', left: '-15px', top: '-15px', width: '26px', height: '26px',
        borderRadius: '50%', background: '#ffb020', color: '#111', font: '700 15px/26px sans-serif',
        textAlign: 'center', boxShadow: '0 0 0 2px rgba(0,0,0,.6)',
      });
      box.append(badge);
      document.body.append(box);
    }
  }, marks);
}

async function shot(page, lang, name, marks = []) {
  await mark(page, marks);
  const dir = join(ROOT, 'docs', 'screens', lang);
  mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: join(dir, `${name}.jpg`), type: 'jpeg', quality: 82 });
  await page.evaluate(() => document.querySelectorAll('.readme-mark').forEach((n) => n.remove()));
  console.log(`${lang}/${name}.jpg`);
}

const tab = (page, screen) => page.locator(`nav.tabs button[data-screen="${screen}"]`);

/**
 * Карта: слой пиратов (вторая кнопка слоёв) и ближайший к роте очаг, до которого можно лететь.
 * Точки ищутся по цвету янтарного кольца на канвасе — так же, как в `smoke.mjs`.
 */
async function pickPirateWorld(page) {
  await page.locator('.starmap .controls .btn').nth(1).click();
  await page.waitForTimeout(300);
  const spots = await page.evaluate(() => {
    const c = document.querySelector('.starmap canvas');
    const r = c.getBoundingClientRect();
    const { width, height } = c;
    const px = c.getContext('2d').getImageData(0, 0, width, height).data;
    const cell = 14;
    const cols = Math.ceil(width / cell);
    const grid = new Map();
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        if (px[i] > 170 && px[i + 1] > 120 && px[i + 2] < 110 && px[i] - px[i + 2] > 90) {
          const k = Math.floor(y / cell) * cols + Math.floor(x / cell);
          const g = grid.get(k) ?? { n: 0, sx: 0, sy: 0 };
          g.n++;
          g.sx += x;
          g.sy += y;
          grid.set(k, g);
        }
      }
    }
    const sx = r.width / width;
    const sy = r.height / height;
    return [...grid.values()]
      .filter((g) => g.n >= 6)
      .map((g) => ({
        x: r.left + (g.sx / g.n) * sx,
        y: r.top + (g.sy / g.n) * sy,
        dist: Math.hypot(g.sx / g.n - width / 2, g.sy / g.n - height / 2),
      }))
      .sort((a, b) => a.dist - b.dist)
      .slice(0, 25);
  });
  for (const spot of spots) {
    await page.mouse.click(spot.x, spot.y);
    await page.waitForTimeout(120);
    const jump = page.locator('.dossier .btn.jump');
    if ((await jump.count()) > 0 && (await jump.isEnabled())) return true;
  }
  return false;
}

/** Время идёт кнопками суток в шапке, пока рота не прибудет (в шапке пропадает строка пути). */
async function arrive(page) {
  for (let i = 0; i < 12; i++) {
    if ((await page.locator('.place-row .gold').count()) === 0) return;
    await page.locator('.step').nth(1).click();
    await page.waitForTimeout(500);
  }
  throw new Error('рота не долетела');
}

for (const lang of ['en', 'ru']) {
  // --- Кампания с нуля ---
  const { context, page } = await open(lang);
  await shot(page, lang, 'menu', [['.langs', 1], ['.opt:nth-child(2)', 2], ['.opt:nth-child(4)', 3], ['.opt:nth-child(5)', 4]]);

  await page.locator('.opt').nth(1).click();
  await page.waitForTimeout(400);
  await page.locator('#company-name').fill(COMPANY);
  await page.locator('#company-commander').fill(CALLSIGN);
  await page.locator('#company-seed').fill(SEED);
  await page.waitForTimeout(300);
  await shot(page, lang, 'setup', [['#company-seed', 1], ['.pack', 2], ['button.btn-gold', 3]]);
  await page.locator('button.btn-gold').first().click();
  await page.waitForTimeout(800);
  await shot(page, lang, 'hangar', [
    ['nav.tabs', 1], ['.steps', 2], ['.hangar aside.left', 3], ['.paperdoll-box', 4], ['.hangar aside.workshop', 5],
  ]);

  await tab(page, 'starmap').click();
  await page.waitForTimeout(800);
  if (!(await pickPirateWorld(page))) throw new Error('на карте нет мира с работой');
  await page.locator('.dossier .btn.jump').scrollIntoViewIfNeeded();
  await shot(page, lang, 'starmap', [['.starmap .controls', 1], ['.dossier .btn.jump', 2], ['.steps', 3]]);
  await page.locator('.dossier .btn.jump').click();
  await page.waitForTimeout(300);
  await arrive(page);

  await tab(page, 'contracts').click();
  await page.waitForTimeout(500);
  await page.locator('.btn.sign').scrollIntoViewIfNeeded();
  await shot(page, lang, 'contracts', [['.pick.offer', 1], ['.btn.sign', 2]]);

  // --- Бой: свободный бой из меню ---
  await page.locator('.unit').first().click();
  await page.waitForTimeout(400);
  await page.locator('.opt').nth(3).click();
  await page.waitForTimeout(1200);
  await shot(page, lang, 'battle', [['.btn-phase', 1], ['.weapons', 2], ['.ticker', 3]]);
  await context.close();

  // --- Держава из готового сохранения ---
  const realm = await open(lang);
  // Позывной командира в пробе — по умолчанию; на снимке — тот же, что у отряда с нуля.
  const save = readFileSync(REALM_SAVE, 'utf8').replaceAll('"Командир"', JSON.stringify(CALLSIGN));
  await realm.page.locator('input[type=file]').setInputFiles({
    name: 'campaign.json', mimeType: 'application/json', buffer: Buffer.from(save),
  });
  await realm.page.waitForTimeout(1200);
  if ((await realm.page.locator('nav.tabs').count()) === 0) {
    await realm.page.locator('.opt').first().click();
    await realm.page.waitForTimeout(800);
  }
  await realm.page.locator('.scope-btn.scope-realm').click();
  await realm.page.waitForTimeout(1500);
  await shot(realm.page, lang, 'realm', [['.scope-switch', 1], ['nav.tabs', 2], ['.lens-bar', 3], ['.side .todo', 4]]);
  await realm.context.close();
}

await browser.close();
if (errors.length) {
  console.log(`ОШИБКИ В КОНСОЛИ (${errors.length}):`);
  for (const e of errors) console.log('  ' + e);
  process.exit(2);
}
