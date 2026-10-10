/**
 * Сквозная проверка интерактива: движение, смена фаз, выбор оружия, выстрел.
 *
 * Проверяет поведение, а не картинку: читает строку состояния и боевой журнал.
 * Координаты гексов не зашиты — точки ищутся сканированием канваса, поэтому
 * тест переживает смену вёрстки и масштаба (первая версия ломалась ровно об это).
 *
 * Браузер — уже установленный Chromium-совместимый (см. screenshot.mjs).
 */
/* global document -- он нужен только внутри `page.evaluate`, где код исполняется в браузере */
import { chromium } from '@playwright/test';
import { existsSync } from 'node:fs';

const CANDIDATES = [
  process.env.BROWSER_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Yandex.app/Contents/MacOS/Yandex',
].filter(Boolean);

const executablePath = CANDIDATES.find((p) => existsSync(p));
if (!executablePath) {
  console.error('Не найден браузер на Chromium. Укажите BROWSER_PATH=...');
  process.exit(1);
}

const url = process.argv[2] ?? 'http://localhost:5173/';
const shotDir = process.argv[3] ?? '.';

const browser = await chromium.launch({ executablePath });
const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });

const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));

await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForTimeout(400);

/**
 * Сквозная проверка интерфейса.
 *
 * Два акта, и оба обязательны.
 *
 * **Акт I — БОЙ** (шаг 9, часть E). Полный оборот тактики: выбор машины, ход,
 * смена фазы, ход бота, выстрел с разбором целевого числа, журнал, генератор
 * карты. Идёт в песочнице свободного боя — она для того и оставлена отдельным
 * режимом.
 *
 * **Акт II — ЦИКЛ КАМПАНИИ** (шаг 17a, п. 5). Основание отряда, ангар, биржа,
 * подпись контракта, вывод звена, бой, разбор с выбором трофеев, закрытие
 * контракта и возвращение в ангар. Проверяется ШОВ, а не картинка: что бой
 * доходит до кампании командой, а не в обход неё.
 *
 * **Акт III — ОСТАЛЬНЫЕ ЭКРАНЫ** (шаг 17b, дополнен шагом 19a). Карта, рынок со
 * складом и прилавком машин, мехлаб, лестница цеха, казармы, рота. Проверяется, что каждый экран собрался на настоящих данных ядра и что
 * его действия доходят до состояния: покупка меняет кассу и склад, найм —
 * ростер, перелёт — курс.
 */
const checks = [];
function check(name, condition, detail = '') {
  checks.push({ name, ok: Boolean(condition), detail });
}

/**
 * Итог прогона. Вынесен в функцию, чтобы сценарий мог прекратиться досрочно, но со всем, что
 * успел проверить: без этого пустая биржа после перелёта дала бы не отчёт, а тридцать секунд
 * ожидания несуществующей строки и обрыв.
 */
async function finish() {
  await browser.close();

  const failed = checks.filter((c) => !c.ok);
  for (const c of checks) {
    console.log(`${c.ok ? '  ok  ' : ' ПРОВАЛ'} ${c.name}${c.ok ? '' : `  <- ${c.detail}`}`);
  }
  if (errors.length > 0) {
    console.log(`\nОШИБКИ В КОНСОЛИ (${errors.length}):`);
    for (const e of errors) console.log(`  ${e}`);
  }
  console.log(`\n${checks.length - failed.length}/${checks.length} проверок пройдено`);
  process.exit(failed.length > 0 || errors.length > 0 ? 1 : 0);
}

const text = (sel) => page.locator(sel).first().textContent();

/**
 * Шапка боя: плашки с биомом и сеткой спрятаны под кнопкой «ИНФО» (`Header.svelte`,
 * `detailsOpen`), и читать их можно только раскрытыми. Раскрывает, если закрыты.
 */
async function headerText() {
  const toggle = page.locator('.stat-toggle');
  if (!(await toggle.evaluate((el) => el.classList.contains('open')))) await toggle.click();
  return (await text('.quick-stats')) ?? '';
}
const hud = () => page.locator('.hud').textContent();
const logText = () => page.locator('.log-content').textContent();

// --- Акт I начинается со свободного боя: приложение открывается меню ---
check('главное меню собралось', (await page.locator('.opt-title').count()) >= 3);
await page.locator('.opt-title', { hasText: 'Свободный бой' }).first().click();
await page.waitForTimeout(900);

const board = page.locator('.canvas-container canvas').first();
const box = await board.boundingBox();

/** Провести курсором по сетке и вернуть первую точку, где условие выполнилось. */
async function findPoint(predicate, step = 22) {
  for (let y = box.y + 40; y < box.y + box.height - 120; y += step) {
    for (let x = box.x + 60; x < box.x + box.width - 40; x += step) {
      await page.mouse.move(x, y);
      const t = (await hud()) ?? '';
      const aim = (await page.locator('.aim-dock').count()) > 0
        ? ((await page.locator('.aim-dock').textContent()) ?? '')
        : '';
      if (predicate(t, aim)) return { x, y, hud: t, aim };
    }
  }
  return null;
}

// --- 1. Интерфейс собрался и карта сгенерирована ---
check('заголовок показывает биом', (await headerText()).includes('БИОМ'));
check('журнал сообщил о генерации', ((await logText()) ?? '').includes('[ГЕНЕРАЦИЯ]'));
check('журнал сообщил метрики карты', ((await logText()) ?? '').includes('[КАРТА]'));
check('карта связна: недостижимых клеток нет', !((await logText()) ?? '').includes('недостижимо 1'));
// Своя машина опознана полностью — только у неё карточка называет пилота
// (чужая на старте боя это метка или силуэт). По имени юнита проверять нельзя:
// карточка показывает КОД ШАССИ, а не кличку из сценария.
check(
  'выбрана машина игрока',
  ((await text('.unit-class')) ?? '').includes('ПИЛОТ'),
  (await text('.unit-class')) ?? '',
);
check('кукла брони заполнена', (await page.locator('.pd-val').count()) >= 6);
check('вооружение перечислено', (await page.locator('.weapon').count()) >= 2);

// --- 2. Наведение показывает клетку и цену хода ---
const reach = await findPoint((t) => /ГЕКС:\s*\d{4}/.test(t) && /\d+ MP/.test(t));
check('наведение показывает гекс и цену хода', reach !== null, reach?.hud ?? '');

// --- 3. Клик по достижимой клетке двигает робота ---
if (reach) {
  await page.mouse.click(reach.x, reach.y);
  await page.waitForTimeout(250);
  check('ход записан в журнал', /прош[её]л|пробежал|прыгнул/.test((await logText()) ?? ''));
  check('машина отмечена как ходившая', ((await text('.stats-grid')) ?? '').includes('ХОДИЛ'));
}

// --- 4. Полоса режимов движения ---
// Бег выключен в данных (`combat.json -> movement.runAllowed`, решение
// пользователя 2026-09-08), и полоса обязана следовать за правилами: кнопки,
// за которой нет законного хода, быть не должно. Проверяется замысел — что
// режимы берутся из ядра, — а не конкретный их набор.
// Полоса рисуется только при двух и более законных режимах (`UnitCard.svelte`,
// `availableModes.length > 1`): с одним режимом выбирать нечего, и кнопки нет.
// Поэтому проверка следует правилу, а не требует кнопку «ШАГ» всегда.
const modeButtons = page.locator('.actions button.act:not(.turn)');
const modeLabels = (await modeButtons.allTextContents()).map((s) => s.trim());
check(
  'полоса режимов движения следует правилам: нет при одном режиме, есть «ШАГ» при нескольких',
  modeLabels.length === 0 || (modeLabels.length >= 2 && modeLabels.some((l) => l.includes('ШАГ'))),
  modeLabels.length === 0 ? 'один режим — полосы нет' : modeLabels.join(' | '),
);
check(
  'выключенный бег не предлагается кнопкой',
  !modeLabels.some((l) => l.includes('БЕГ')),
  modeLabels.join(' | '),
);

// --- 5. Фаза стрельбы и ход бота ---
await page.locator('.btn-phase').click();
await page.waitForTimeout(2500);
check('фаза сменилась', !((await text('.quick-stats')) ?? '').includes('ХОД: 1 · ИНИЦИАТИВА'));
check('противник ходил сам', /Цель-[A-Z]/.test((await logText()) ?? ''), (await logText())?.slice(-300) ?? '');

// --- 6. Разбор целевого числа до броска ---
await page.locator('.btn-phase').click();
await page.waitForTimeout(2500);
const aimed = await findPoint((_t, aim) => aim.includes('ЦЕЛЬ:'), 14);
check('под курсором показан разбор выстрела', aimed !== null, aimed?.aim ?? '');
if (aimed) {
  check(
    'разбор либо даёт целевое число, либо объясняет отказ',
    /НУЖНО \d+|ВНЕ ДАЛЬНОСТИ|НЕТ ЛИНИИ ОГНЯ/.test(aimed.aim),
    aimed.aim,
  );
}

// --- 7. Боковой профиль рельефа рисуется ---
// Профиль живёт в режиме линии огня, а не в режиме хода: без переключения его
// на экране нет и быть не должно. Прежняя проверка спрашивала о нём из режима
// хода и потому висела на ожидании разметки — найдено при расширении смоука
// на цикл кампании (шаг 17).
await page.locator('.map-controls button', { hasText: '📐' }).click();
await page.waitForTimeout(150);
if (aimed !== null) await page.mouse.move(aimed.x, aimed.y);
await page.waitForTimeout(200);
check('док профиля линии огня на месте', (await page.locator('.los-dock canvas').count()) === 1);
const foot = (await page.locator('.los-foot').textContent()) ?? '';
check('профиль сообщает дистанцию и укрытие', /ДИСТАНЦИЯ: \d+ ГЕКС/.test(foot), foot);
await page.locator('.map-controls button', { hasText: '📐' }).click();
await page.waitForTimeout(150);

// --- 8. Смена биома перегенерирует карту ---
await page.locator('.tab', { hasText: 'ГЕНЕРАТОР' }).click();
await page.waitForTimeout(150);
await page.selectOption('#gen-biome', 'lunar');
await page.locator('button', { hasText: 'ПЕРЕГЕНЕРИРОВАТЬ' }).first().click();
await page.waitForTimeout(900);
check('биом сменился', (await headerText()).includes('LUNAR'));
check('замер карты показан игроку', ((await page.locator('.metric-row').first().textContent()) ?? '').includes('Укрытие'));

await page.screenshot({ path: `${shotDir}/smoke-battle.png` });

// =====================================================================
// АКТ II — ЦИКЛ КАМПАНИИ (шаг 17)
// =====================================================================

await page.locator('.outcome-btn', { hasText: 'ВЫЙТИ В МЕНЮ' }).click();
await page.waitForTimeout(400);

// --- 9. Основание отряда ---
await page.locator('.opt-title', { hasText: 'Основать отряд' }).first().click();
await page.waitForTimeout(300);
check('экран основания показывает стартовую роту', (await page.locator('.pack .kv').count()) === 3);
check('герб можно выбрать', (await page.locator('.emb').count()) === 16);
await page.locator('.emb').nth(4).click();
// Сид кампании СЛУЧАЕН при каждом открытии экрана, а мир зависит от сида: у одного мира рядом
// с Outreach есть работа, у другого её нет (местные отряды разбирают предложения). Смоук вписывает
// свой сид — тем же полем, каким пользуется игрок, — и потому идёт по одной и той же дороге: мир,
// в котором ближайший очаг беззакония даёт работу. Пустая биржа после перелёта тогда — поломка.
await page.locator('#company-seed').fill('205894');
await page.locator('button.btn-gold').first().click();
await page.waitForTimeout(700);

// --- 10. Ангар: парк и стапели — РАЗНЫЕ вещи ---
check('ангар открылся', (await page.locator('.hangar').count()) === 1);
check('в парке три подержанные машины', (await page.locator('.mech-card').count()) === 3);
// Число стапелей задаётся классом судна (`data/economy.json`), а не константой
// смоука: «Леопард» держит два, и проверять надо ЗАМЫСЕЛ полосы — что она
// отдельная от парка и на старте пуста, — а не конкретную цифру.
{
  const bays = await page.locator('.bay').count();
  const busy = await page.locator('.bay.busy').count();
  check('полоса стапелей отдельная и пустая', bays >= 1 && busy === 0, `стапелей: ${bays}, занято: ${busy}`);
}
check('кукла брони показывает зоны', (await page.locator('.pd-val').count()) >= 6);
check(
  'касса и содержание в шапке',
  /\d/.test((await page.locator('.sum').textContent()) ?? '') &&
    ((await page.locator('.upkeep').textContent()) ?? '').includes('C-Bills'),
);

// --- 11. Биржа контрактов ---
// Вкладки адресуются по `data-screen`, а не по номеру: список растёт, и номер
// начинает указывать не туда молча.
const tab = (screen) => page.locator(`nav.tabs button[data-screen="${screen}"]`);

// --- 10b. Мехлаб: снять ствол и поставить машину в цех (шаг 19a) ---
await tab('mechlab').click();
await page.waitForTimeout(400);
check('мехлаб открылся со списком парка', (await page.locator('.mechlab .mech-card').count()) >= 3);
// Переоснащают только машину в ПАСПОРТНОМ состоянии — правило ядра
// (`company/refit.ts`), и поэтому проверка стоит ДО первого контракта: после
// боя половина звена побита, и мехлаб честно откажет. Машина всё равно ищется,
// а не берётся первая попавшаяся: правило важнее порядка карточек.
const cards = page.locator('.mechlab .mech-card');
let refitMech = -1;
for (let i = 0; i < (await cards.count()); i++) {
  await cards.nth(i).click();
  await page.waitForTimeout(200);
  if ((await page.locator('.mechlab .center .warn').count()) === 0) {
    refitMech = i;
    break;
  }
}
check('в парке нашлась машина в паспортном состоянии', refitMech >= 0);
check('чертёж разложен по зонам', (await page.locator('.zone-block').count()) === 6);

// Снимается ОРУЖИЕ, а не пачка боезапаса: строки БК идут в торсе первыми, и
// снятие пачки оставляет орудие без боекомплекта — сборка честно не проходит
// валидатор, и проверка падала не на переоснащении, а на своём же выборе
// строки. Оружие отличается тем, что у него есть строка чисел (`.item-body
// .dim`), у боезапаса её нет.
const removable = page
  .locator('.item-row')
  .filter({ has: page.locator('.item-body .dim') })
  .first()
  .locator('.btn-danger');
if (refitMech >= 0 && (await removable.count()) > 0) {
  await removable.click();
  await page.waitForTimeout(250);
  const planText = (await page.locator('.plan').textContent()) ?? '';
  check('наряд цеха назвал цену и срок', /C-Bills/.test(planText), planText.slice(0, 120));

  const applyBtn = page.locator('.mechlab .wide');
  const enabled = await applyBtn.isEnabled();
  check('переоснащение можно поставить в цех', enabled);
  if (enabled) {
    await applyBtn.click();
    await page.waitForTimeout(400);
    await tab('hangar').click();
    await page.waitForTimeout(300);
    check(
      'работа переоснащения заняла стапель',
      ((await page.locator('.bay-list').textContent()) ?? '').includes('Переоснащение'),
      (await page.locator('.bay-list').textContent()) ?? '',
    );
    // Работа отменяется тут же: дальше по сценарию рота выходит на контракт, а
    // машина в цеху к вылету не годится — проверять надо мехлаб, а не то, как
    // звено собирается из двух машин вместо трёх.
    const cancel = page.locator('.bay .btn-danger').first();
    if ((await cancel.count()) > 0) await cancel.click();
    await page.waitForTimeout(300);
  }
}

/*
 * ПЕРЕЛЁТ К РАБОТЕ. Рота начинает на Outreach, а это не пограничный мир: пиратов
 * рядом нет, фронт далеко, и биржа стартового мира пуста (`contractBoard` даёт ноль
 * предложений на любой день). Раньше весь контрактный круг из-за этого
 * ПРОПУСКАЛСЯ; теперь смоук летит туда, куда полетел бы игрок.
 *
 * Мир для выбора берётся ТЕМ ЖЕ слоем карты, которым пользуется игрок: «Пираты»
 * подсвечивает очаги беззакония, а работа на тихом краю сферы — именно оттуда.
 * Смоук не перебирает системы вслепую и не зовёт ядро в обход экрана: он читает
 * подсвеченные слоем точки на канвасе, щёлкает по ним и выбирает по тому, что
 * написано в досье (ближайший, из ближайших — самый опасный).
 */
async function flyToWork() {
  await tab('starmap').click();
  await page.waitForTimeout(700);
  await page.locator('.starmap .controls .btn', { hasText: 'Пираты' }).click();
  await page.waitForTimeout(200);

  // Точки слоя: янтарное кольцо очага (`StarMapScreen.svelte`, слой пиратов) собирается
  // в кучки по клеткам 14×14, ближайшие к роте — первыми: карта открывается по центру на ней.
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
    return [...grid.values()]
      .filter((g) => g.n >= 6)
      .map((g) => ({
        x: r.left + g.sx / g.n,
        y: r.top + g.sy / g.n,
        dist: Math.hypot(g.sx / g.n - width / 2, g.sy / g.n - height / 2),
      }))
      .sort((a, b) => a.dist - b.dist)
      .slice(0, 25);
  });

  let best = null;
  for (const spot of spots) {
    await page.mouse.click(spot.x, spot.y);
    const info = await page.evaluate(() => {
      const d = document.querySelector('.dossier');
      const row = (root, label) =>
        [...d.querySelectorAll(root)].find((e) => e.textContent.includes(label))?.textContent ?? '';
      return {
        name: d.querySelector('.p-name')?.textContent?.trim() ?? '',
        jumps: Number(/\d+/.exec(row('.row-kv', 'Прыжков'))?.[0] ?? NaN),
        risk: Number(/(\d+)\s*%/.exec(row('.kv', 'Пиратская угроза'))?.[1] ?? 0),
      };
    });
    if (!Number.isFinite(info.jumps) || info.risk < 25) continue;
    if (best === null || info.jumps < best.jumps || (info.jumps === best.jumps && info.risk > best.risk)) {
      best = { ...info, spot };
    }
  }
  if (best === null) return { arrived: false, detail: `слой пиратов показал точек: ${spots.length}, годной среди них нет` };

  await page.mouse.click(best.spot.x, best.spot.y);
  await page.waitForTimeout(150);
  await page.locator('.dossier .btn.jump').click();
  await page.waitForTimeout(300);
  // Время идёт командой, как у игрока: кнопки суток в шапке, а не перемотка состояния.
  let place = '';
  for (let i = 0; i < 6; i++) {
    place = (await page.locator('.place-row').first().textContent()) ?? '';
    if (place.includes(best.name) && !place.includes('В пути')) break;
    await page.locator('.step').nth(1).click();
    await page.waitForTimeout(400);
  }
  return {
    arrived: place.includes(best.name) && !place.includes('В пути'),
    detail: `${best.name}: ${best.jumps} прыж., пиратская угроза ${best.risk} %; в шапке: ${place.replace(/\s+/g, ' ').trim()}`,
  };
}

const flight = await flyToWork();
check('перелёт: слой «Пираты» указал мир с работой, курс проложен, рота прибыла', flight.arrived, flight.detail);

await tab('contracts').click();
await page.waitForTimeout(400);
const offers = await page.locator('.offer').count();
// Пустая биржа ПОСЛЕ перелёта — не повод пропускать круг, а поломка: смоук обязан падать.
check(
  'биржа предлагает работу',
  offers > 0,
  `предложений: ${offers}; ${flight.detail}; экран: ${((await page.locator('.contracts').innerText()) ?? '').replace(/\\s+/g, ' ').slice(0, 260)}`,
);
if (offers === 0) await finish();

check('разведданные показывают тип отряда и число машин', (await page.locator('.dossier .kv').count()) >= 6);
check(
  'класс машин противника скрыт до разведки',
  ((await page.locator('.quality-row').textContent()) ?? '').includes('не разведана'),
);

// 11a и 11b читаются ДО подписи: после неё предложение уходит с биржи, и досье выбирает другое.
// --- 11a. Последствия для обеих сторон видны ДО подписи (шаг 20) ---
//
// Принципиальная проверка, а не косметическая: игрок обязан выбирать сторону
// осознанно, а не узнавать о последствиях постфактум (`reputation.md`).
const consequences = (await page.locator('.dossier .block').last().textContent()) ?? '';
check(
  'карточка контракта называет последствия для обеих сторон',
  /Чем это отзовётся/.test(consequences) && /[+−-]\d/.test(consequences),
  consequences.replace(/\s+/g, ' ').slice(0, 120),
);

// --- 11b. Задача боя видна до подписи (шаг 19b) ---
const objectiveLine = (await page.locator('.objective').first().textContent()) ?? '';
check(
  'досье называет задачу боя',
  /Задача боя:/.test(objectiveLine) &&
    /(Продержаться|Вывести)/.test(objectiveLine),
  objectiveLine,
);

await page.locator('.btn.sign').click();
await page.waitForTimeout(400);
check('контракт подписан: появился баннер', (await page.locator('.active-banner').count()) === 1);
check(
  'аванс зачислен в журнал',
  ((await page.locator('.ticker-text').textContent()) ?? '').includes('Аванс'),
  (await page.locator('.ticker-text').textContent()) ?? '',
);

// --- 11c. Экран отношений (шаг 20) ---
await tab('relations').click();
await page.waitForTimeout(300);
const relRows = await page.locator('.relations .row').count();
check('экран отношений перечисляет все фракции', relRows >= 15, `строк: ${relRows}`);
check(
  'оси отряда показаны отдельно от фракций',
  ((await page.locator('.axes').textContent()) ?? '').includes('Известность'),
);
const repJournal = (await page.locator('.journal').textContent()) ?? '';
check(
  'журнал репутации ведётся с первого изменения',
  repJournal.length > 0,
  repJournal.replace(/\s+/g, ' ').slice(0, 100),
);
// --- 11d. Экран войны (шаг 21b) ---
//
// Сводка на первый день кампании пуста намеренно: фронт двигается раз в декаду,
// а рота ещё не прокрутила ни одной. Проверяется, что экран СОБРАЛСЯ на
// настоящих данных ядра — перечислил фракции с их направлениями, — и что он
// честно говорит про перемирие Тукайида, а не молчит.
await tab('war').click();
await page.waitForTimeout(300);
const warFactions = await page.locator('.war .faction').count();
check('экран войны перечисляет фракции с их фронтами', warFactions >= 15, `строк: ${warFactions}`);
const truceLine = (await page.locator('.war .truce').textContent()) ?? '';
check('экран войны называет перемирие Тукайида', /Тукайид/.test(truceLine), truceLine.slice(0, 80));
// Замысел государства (шаг 23, часть B). На первый день кампании объявленных
// наступлений НЕТ ни на одном сиде, и это не пустой экран, а порядок круга:
// фонды пусты, накопить ещё не успели. Панель обязана сказать это словами.
const plansPanel = (await page.locator('.war .plans').textContent()) ?? '';
check(
  'экран войны показывает, кто куда наступает',
  plansPanel.length > 0 && /наступлени/i.test(plansPanel),
  plansPanel.slice(0, 80),
);

await tab('contracts').click();
await page.waitForTimeout(300);

// --- 12. Вывод звена ---
await page.locator('.ab-right button.btn-primary').click();
await page.waitForTimeout(300);
check('окно высадки перечисляет парк', (await page.locator('.deploy-row').count()) === 3);
check(
  'у высадки две дороги: на поле и расчётом (шаг 18)',
  (await page.locator('.deploy-actions button', { hasText: 'Рассчитать бой' }).count()) === 1,
);
// Первый контракт считается, а не отыгрывается (шаг 18): «Рассчитать бой» обязан довести дело
// ровно туда же, куда доводит отыгранный бой, — до разбора с выбором трофеев. Отыгранный бой с
// отходом идёт вторым: после честного «да» на высадке рота теряет машины вне зоны выхода (шаг 65),
// и на следующий контракт выводить было бы некого.
await page.locator('.deploy-actions button', { hasText: 'Рассчитать бой' }).click();
// Ждём разбор ПО УСЛОВИЮ, а не по таймеру: с 2026-09-09 штаб отыгрывает бой
// целиком, и звено против звена считается доли секунды, а рота — секунды.
await page.locator('.debrief').waitFor({ timeout: 30_000 }).catch(() => {});
check('расчёт боя открыл разбор, минуя поле', (await page.locator('.debrief').count()) === 1);
check('поля боя при этом не было', (await page.locator('.canvas-container canvas').count()) === 0);
await page.locator('.btn-gold.finish').click();
await page.waitForTimeout(600);
await page.locator('.btn-primary.finish').click();
await page.waitForTimeout(500);
check('рассчитанный контракт закрылся так же, как отыгранный',
  (await page.locator('.active-banner').count()) === 0);


// --- 12b. Второй контракт: бой на поле ---
await tab('contracts').click();
await page.waitForTimeout(400);
// Биржа может оказаться пустой: часть работы забирают местные отряды
// (`board.localsTake`, шаг 22c), а взятое в этой декаде вычеркнуто. Игрок в
// такой день ждёт следующую декаду — смок делает то же, а не падает.
for (let waited = 0; waited < 4 && (await page.locator('.btn.sign').count()) === 0; waited++) {
  await page.locator('.step').nth(2).click();
  await page.waitForTimeout(500);
  await tab('contracts').click();
  await page.waitForTimeout(400);
}
check('на бирже нашлась работа (пусть и не с первой декады)', (await page.locator('.btn.sign').count()) > 0);
await page.locator('.btn.sign').first().click();
await page.waitForTimeout(300);
await page.locator('.ab-right button.btn-primary').click();
await page.waitForTimeout(300);
await page.locator('.deploy-actions button.btn-primary').click();
await page.waitForTimeout(1400);
check('бой по контракту открылся', (await page.locator('.canvas-container canvas').count()) >= 1);
check('генератор карты в бою по контракту не рисуется',
  (await page.locator('.tab', { hasText: 'ГЕНЕРАТОР' }).count()) === 0);
check('шапка кампании в бою не показывается',
  (await page.locator('nav.tabs').count()) === 0);

// --- 13. Отход и разбор ---
// Блок исхода свёрнут (`BattleWorkspace.svelte`, `outcomeOpen`): раскрывается щелчком по заголовку.
await page.locator('.outcome-toggle').click();
// Отход — с предупреждением (шаг 65): сколько машин в зоне выхода и сколько будет потеряно.
await page.locator('.outcome-btn.danger', { hasText: 'ОТВЕСТИ ЗВЕНО' }).click();
await page.waitForTimeout(300);
const warning = (await page.locator('.outcome-hint.warn').textContent()) ?? '';
check('перед отходом сказано, сколько машин в зоне выхода', warning.includes('зоне выхода'), warning);
await page.screenshot({ path: `${shotDir}/smoke-withdraw.png` });
await page.locator('.confirm-row .outcome-btn', { hasText: 'НЕТ' }).click();
await page.waitForTimeout(200);
check(
  'ответ «нет» оставляет бой: кнопка отхода снова на месте',
  (await page.locator('.outcome-btn.danger', { hasText: 'ОТВЕСТИ ЗВЕНО' }).count()) === 1,
);
await page.locator('.outcome-btn.danger', { hasText: 'ОТВЕСТИ ЗВЕНО' }).click();
await page.locator('.confirm-row .outcome-btn.danger', { hasText: 'ДА' }).click();
await page.waitForTimeout(700);
check('разбор открылся', (await page.locator('.debrief').count()) === 1);
check(
  'отход прочитан как исход, а не поражение',
  ((await page.locator('.hdr').textContent()) ?? '').includes('Отход'),
  (await page.locator('.hdr').textContent()) ?? '',
);
check(
  'трофеи с неудержанного поля не предлагаются',
  ((await page.locator('.block').first().textContent()) ?? '').includes('удержанного поля'),
);

await page.locator('.btn-gold.finish').click();
await page.waitForTimeout(700);
check('контракт закрыт: показан расчёт', (await page.locator('.btn-primary.finish').count()) === 1);
check(
  'закрытие контракта записано в журнал',
  ((await page.locator('.ticker-text').textContent()) ?? '').includes('Контракт закрыт'),
  (await page.locator('.ticker-text').textContent()) ?? '',
);

await page.locator('.btn-primary.finish').click();
await page.waitForTimeout(500);
check('цикл замкнулся: снова ангар', (await page.locator('.hangar').count()) === 1);
check('контракт снят: баннера больше нет', (await page.locator('.active-banner').count()) === 0);

// --- 14. Время идёт командой, а не само ---
// Календарь и кнопки прокрутки живут в шапке, а не на экране контрактов:
// проверка идёт и тогда, когда контрактный круг пропущен.
const dayBefore = (await page.locator('.place-row').nth(1).textContent()) ?? '';
await page.locator('.step').nth(1).click();
await page.waitForTimeout(400);
const dayAfter = (await page.locator('.place-row').nth(1).textContent()) ?? '';
check('прокрутка суток двигает календарь', dayBefore !== dayAfter, `${dayBefore} → ${dayAfter}`);

await page.screenshot({ path: `${shotDir}/smoke.png` });

// =====================================================================
// АКТ III — ОСТАЛЬНЫЕ ЭКРАНЫ КАМПАНИИ (шаг 17b)
// =====================================================================

// --- 15. Казармы: ростер, навыки, найм ---
await tab('barracks').click();
await page.waitForTimeout(400);
const pilotsBefore = await page.locator('.roster .row').count();
check('казармы показывают ростер', pilotsBefore === 3, `пилотов: ${pilotsBefore}`);
// Список строится по данным: показываются навыки, у которых есть источник опыта
// (`pilots.json → progression.xp`). Их шесть — пять кокпитных и Выносливость.
check('навыки пилота перечислены', (await page.locator('.skill').count()) === 6);
check(
  'уровень навыка виден числом',
  /\d/.test((await page.locator('.s-level').first().textContent()) ?? ''),
);
// НАЙМ ИДЁТ В ДВА ХОДА (переработка 2026-09-10): объявление показывает
// кандидата, и только «Принять» ставит его в ростер. Проверяется весь путь:
// перебор → карточка → решение.
await page.locator('.hire .btn-gold').click();
await page.waitForTimeout(2000);
check('объявление привело кандидата', (await page.locator('.hire .cand').count()) === 1);
check(
  'у кандидата есть имя, дом и решение',
  ((await page.locator('.hire .c-name').textContent()) ?? '').trim().length > 3 &&
    (await page.locator('.hire .c-actions .btn').count()) === 2,
  (await page.locator('.hire .c-name').textContent()) ?? '',
);
check('пока не решено, в роте по-прежнему трое', (await page.locator('.roster .row').count()) === pilotsBefore);
await page.locator('.hire .c-actions .btn-gold').click();
await page.waitForTimeout(500);
check(
  'найм добавил пилота в роту',
  (await page.locator('.roster .row').count()) === pilotsBefore + 1,
);
check('вторая попытка сразу не даётся', await page.locator('.hire .btn-gold.btn-wide').isDisabled());

// --- 16. Рынок: прилавок, покупка, склад ---
await tab('market').click();
await page.waitForTimeout(400);
const lots = await page.locator('.lot').count();
check('прилавок выводит ассортимент', lots > 0, `лотов: ${lots}`);
check('склад роты пуст до первой покупки', (await page.locator('.entry').count()) === 0);

const affordable = page.locator('.lot').filter({ has: page.locator('button:not([disabled])') }).first();
if ((await affordable.count()) > 0) {
  await affordable.locator('button').click();
  await page.waitForTimeout(400);
  check('покупка положила запись на склад', (await page.locator('.entry').count()) === 1);
  check(
    'скупщик даёт меньше, чем просит лавка',
    ((await page.locator('.entry-actions .btn').first().textContent()) ?? '').includes('Продать'),
  );
}

// --- 16b. Прилавок машин (шаг 19a) ---
const mechTab = page.locator('.tabs .tab').filter({ hasText: 'Машины' }).first();
if ((await mechTab.count()) > 0) {
  await mechTab.click();
  await page.waitForTimeout(300);
  const mechLots = await page.locator('.lot').count();
  check('прилавок машин собрался', mechLots >= 0, `лотов машин: ${mechLots}`);
}

// --- 16d. Лестница цеха: кнопка на месте и объясняет цену (шаг 19a) ---
await tab('hangar').click();
await page.waitForTimeout(300);
const bayUpgrade = page.locator('.bay-upgrade');
check('полоса стапелей предлагает расширение', (await bayUpgrade.count()) === 1);
check(
  'расширение цеха названо ценой и сроком',
  /стапел|предел|расширен/i.test((await bayUpgrade.textContent()) ?? ''),
  (await bayUpgrade.textContent()) ?? '',
);

// --- 17. Звёздная карта: каталог, выбор системы, курс ---
await tab('starmap').click();
await page.waitForTimeout(700);
check('карта нарисовалась', (await page.locator('.starmap canvas').count()) === 1);
check(
  'досье показывает систему стоянки',
  ((await page.locator('.p-name').textContent()) ?? '').length > 0,
);
check(
  'непроразведанная система не выдаёт точных чисел',
  ((await page.locator('.dossier').textContent()) ?? '').includes('разведка'),
);
// Напряжённость участка (шаг 21b) — без разведки, как достаток владельца:
// где стоят армии, наёмник знает из сводок MRBC, а не из штабных карт.
check(
  'досье называет напряжённость участка',
  ((await page.locator('.dossier').textContent()) ?? '').includes('Напряжённость'),
);

// Развитие мира (шаг 23, часть A) — без разведки, как класс рынка и полоса
// гарнизона: что мир отстроили или выжгли, читается из сводок, а не из переписи.
check(
  'досье называет развитие мира',
  ((await page.locator('.dossier').textContent()) ?? '').includes('Развитие'),
);

// Слой фронта (шаг 22d): без него горячую границу на двух тысячах систем не найти.
const heatBtn = page.locator('.starmap .controls .btn').filter({ hasText: 'Фронт' });
check('на карте есть переключатель фронта', (await heatBtn.count()) === 1);
check(
  'легенда объясняет горячую границу',
  ((await page.locator('.starmap .legend').textContent()) ?? '').includes('Горячая граница'),
);

// Щелчок по карте выбирает систему: координаты не зашиты — ищем сканированием.
const map = page.locator('.starmap canvas');
const mapBox = await map.boundingBox();
let picked = false;
for (let y = mapBox.y + 60; y < mapBox.y + mapBox.height - 60 && !picked; y += 17) {
  for (let x = mapBox.x + 60; x < mapBox.x + mapBox.width - 60 && !picked; x += 17) {
    await page.mouse.click(x, y);
    await page.waitForTimeout(60);
    if (((await page.locator('.dossier').textContent()) ?? '').includes('Прыжков')) picked = true;
  }
}
check('щелчок по карте выбирает систему и считает курс', picked);
if (picked) {
  const jump = (await page.locator('.dossier .block').last().textContent()) ?? '';
  check('курс сообщает прыжки, срок и цену', /Прыжков[\s\S]*Время в пути[\s\S]*Расход/.test(jump));
}

// --- 17b. Рейтинг MRBC: соперники в таблице (шаг 22) ---
await tab('rating').click();
await page.waitForTimeout(400);
const ratingRows = await page.locator('.rating .row').count();
check('в таблице MRBC не одна строка, а рота и соперники', ratingRows > 1, `строк: ${ratingRows}`);
check('строка роты подсвечена в общей таблице', (await page.locator('.rating .row.own').count()) === 1);
check('строка роты видна без прокрутки', await page.locator('.rating .row.own').first().isVisible());
check(
  'у соперников есть место стоянки',
  ((await page.locator('.rating .rows .row').first().textContent()) ?? '').trim().length > 0,
);
// Реестр MRBC двухчастный (шаг 22): канонические великие полки сверху дают
// масштаб, сектор снизу — настоящих конкурентов.
// Единый список: полки и роты в одной таблице, отсортированные по силе.
const listText = (await page.locator('.rating .rows').textContent()) ?? '';
check('в списке есть великие полки', /Драгуны|Гончие|Горцы/.test(listText));
check('полк назван составом в полках или батальонах', /\d+ п\.|\d+ бат\./.test(listText));
// Верх списка НЕ уезжает при заходе: первая версия экрана прокручивала к строке
// роты и уносила с собой Волчьих Драгун — проверка ровно на это.
{
  const first = await page.locator('.rating .rows .row').first().boundingBox();
  const list = await page.locator('.rating .rows').boundingBox();
  check('первая строка видна сразу, а не уехала за край', first.y >= list.y - 1, `${first.y} / ${list.y}`);
}
// Досье: щелчок по чужой строке переключает правую панель.
await page.locator('.rating .rows .row:not(.own)').first().click();
await page.waitForTimeout(300);
const dossier = (await page.locator('.rating .dossier').textContent()) ?? '';
check('щелчок открывает досье отряда', /Парк|Пилотов|Состав/.test(dossier), dossier.slice(0, 80));
check('кассы соперника в досье нет', !/C-Bills/.test(dossier));

// --- 18. Рота: содержание и сохранение ---
await tab('company').click();
await page.waitForTimeout(400);
check('рота показывает разбор содержания', (await page.locator('.row-kv').count()) >= 4);
check(
  'сохранение и выгрузка на месте',
  (await page.locator('.save-row .btn').count()) === 3,
);

// --- Итог ---
await page.screenshot({ path: `${shotDir}/smoke-campaign.png` });
await finish();
