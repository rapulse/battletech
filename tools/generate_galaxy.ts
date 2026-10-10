import * as fs from 'node:fs';
import * as path from 'node:path';
import { Rng } from '../game/src/core/rng/Rng.js';

/**
 * Офлайн-генератор каталога галактики (шаг 14, решение 4 §2 `часть2-pipeline.md`).
 *
 * Собирает `game/data/galaxy/systems.json` — СЛОЙ КАНОНА и только его: id, имя,
 * координаты, спектральный класс, владелец на 3025 год, флаги. Всё остальное
 * (население, промышленность, техуровень, класс рынка, гарнизон, биом, климат)
 * НЕ хранится нигде и выводится на лету — `core/campaign/galaxy/profile.ts`.
 *
 * Руками файл не правится, как и `chassis_catalog.json`: правится этот тул.
 *
 * Запуск: cd game && npx vite-node ../tools/generate_galaxy.ts
 *
 * ## Откуда берётся карта
 *
 * ~140 якорных миров прописаны ниже руками — канонические названия и узнаваемая
 * геометрия Внутренней Сферы (Терра в центре, Лиран на северо-западе, Синдикат
 * на северо-востоке, Солнца на юго-востоке, Капелла на юге, Лига на юго-западе,
 * периферия кольцом снаружи). Остальные ~1860 добираются процедурно.
 *
 * Эпоха каталога — **3053 год**: вторжение кланов остановлено на Тукайиде, и
 * четыре зоны оккупации (`OCCUPATION`) накладываются поверх довоенной карты
 * последним слоем.
 *
 * **Координаты якорей — реконструкция, а не канонная таблица.** Взаимное
 * расположение государств и известных миров верное, точные световые годы —
 * приблизительные. Замена на выверенный источник — правка этого массива и
 * повторный прогон тула: ни одна строка кода игры от неё не меняется. Ровно
 * ради этого канон и отделён от вывода.
 */

// --- геометрия карты ----------------------------------------------------------

/** Радиус обжитого круга Домов. За ним начинается периферия. */
const HOUSE_RADIUS = 500;
/** Внешняя граница каталога: дальше миров не порождаем. */
const RIM_RADIUS = 800;
/** Плотность за `HOUSE_RADIUS` падает по экспоненте с этим масштабом. */
const RIM_FALLOFF = 60;
/** Минимальное расстояние между системами, св. лет. */
const MIN_DISTANCE = 4;
/** Дальность прыжка — на ней проверяется сквозная связность каталога. */
const JUMP_RANGE = 30;
/** Сколько систем в каталоге всего. */
const TOTAL_SYSTEMS = 2000;
/** Сид генератора. Каталог обязан быть воспроизводим до последней координаты. */
const GENERATOR_SEED = 20260901;

const FLAG = {
  capital: 1,
  industrial: 2,
  mechFactory: 4,
  blackMarket: 8,
  hpg: 16,
  anchor: 32,
} as const;

type FlagName = keyof typeof FLAG;

const STAR_CLASSES = ['O', 'B', 'A', 'F', 'G', 'K', 'M'] as const;
/** Обитаемые миры смещены к F/G/K — на красных карликах и голубых гигантах живут редко. */
const STAR_WEIGHTS = [1, 2, 5, 16, 33, 29, 14];

interface Anchor {
  readonly name: string;
  readonly faction: string;
  /** Угол в градусах: 0° — восток, отсчёт против часовой стрелки. */
  readonly deg: number;
  /** Расстояние от Терры, св. лет. */
  readonly ly: number;
  readonly flags?: readonly FlagName[];
}

const A = (
  name: string,
  faction: string,
  deg: number,
  ly: number,
  ...flags: FlagName[]
): Anchor => ({ name, faction, deg, ly, flags });

/**
 * Якорные миры. Сектора: Лиран 110–200°, Лига 200–255°, Капелла 255–295°,
 * Солнца 295–20°, Синдикат 20–110°, КомСтар — только Терра.
 */
const ANCHORS: readonly Anchor[] = [
  // --- КомСтар ---------------------------------------------------------------
  A('Terra', 'comstar', 0, 0, 'capital', 'industrial', 'mechFactory', 'hpg'),

  // --- Лиранское Содружество -------------------------------------------------
  A('Tharkad', 'steiner', 150, 420, 'capital', 'industrial', 'hpg'),
  A('Hesperus II', 'steiner', 140, 330, 'mechFactory', 'industrial'),
  A('Donegal', 'steiner', 160, 380, 'industrial', 'hpg'),
  A('Arcturus', 'steiner', 130, 300, 'industrial', 'hpg'),
  A('Skye', 'steiner', 118, 200, 'industrial', 'hpg'),
  A('Alarion', 'steiner', 175, 430, 'industrial'),
  A('Coventry', 'steiner', 128, 390, 'industrial'),
  A('Solaris VII', 'steiner', 122, 150, 'industrial', 'blackMarket', 'hpg'),
  A('Galatea', 'steiner', 112, 120, 'blackMarket', 'hpg'),
  A('Bolan', 'steiner', 168, 250),
  A('Gallery', 'steiner', 155, 470),
  A('Zurich', 'steiner', 145, 250),
  A('Poulsbo', 'steiner', 190, 350),
  A('Furillo', 'steiner', 135, 230),
  A('Sudeten', 'steiner', 104, 400),
  A('Melissia', 'steiner', 113, 430, 'industrial'),
  A('Twycross', 'steiner', 108, 445),
  A('Somerset', 'steiner', 100, 460),
  A('Wotan', 'steiner', 116, 415),
  A('Loxley', 'steiner', 121, 355),
  A('Gienah', 'steiner', 172, 190),
  A('Blackjack', 'steiner', 158, 165),
  A('Chahar', 'steiner', 190, 300),
  A('Odessa', 'steiner', 165, 320),
  A('Kelenfold', 'steiner', 180, 240),
  A('Trell I', 'steiner', 111, 385),

  // --- Синдикат Дракона ------------------------------------------------------
  A('Luthien', 'kurita', 62, 360, 'capital', 'industrial', 'mechFactory', 'hpg'),
  A('Benjamin', 'kurita', 45, 300, 'industrial', 'hpg'),
  A('Pesht', 'kurita', 75, 400, 'industrial', 'hpg'),
  A('Galedon V', 'kurita', 38, 350, 'industrial', 'hpg'),
  A('Dieron', 'kurita', 40, 130, 'industrial', 'hpg'),
  A('Rasalhague', 'kurita', 90, 330, 'industrial', 'hpg'),
  A('Alshain', 'kurita', 84, 390, 'industrial'),
  A('New Samarkand', 'kurita', 55, 430, 'industrial', 'hpg'),
  A('Proserpina', 'kurita', 50, 250),
  A('Marduk', 'kurita', 35, 230),
  A('Misery', 'kurita', 30, 300),
  A('Wolcott', 'kurita', 68, 470),
  A('Matsuida', 'kurita', 58, 200),
  A('Buckminster', 'kurita', 72, 250),
  A('Kagoshima', 'kurita', 78, 460),
  A('Altair', 'kurita', 34, 90, 'hpg'),
  A('Irurzun', 'kurita', 26, 180),
  A('Algedi', 'kurita', 44, 160),
  A('Tabayama', 'kurita', 66, 300),
  A('An Ting', 'kurita', 30, 260),
  A('Port Moseby', 'kurita', 24, 320),
  A('Shionoha', 'kurita', 95, 250),
  A('Vega', 'kurita', 48, 110),

  // --- Федеративные Солнца ---------------------------------------------------
  A('New Avalon', 'davion', 340, 340, 'capital', 'industrial', 'mechFactory', 'hpg'),
  A('Robinson', 'davion', 5, 290, 'industrial', 'hpg'),
  A('Kathil', 'davion', 330, 300, 'mechFactory', 'industrial'),
  A('Kentares IV', 'davion', 15, 250, 'industrial', 'hpg'),
  A('Galtor III', 'davion', 20, 230),
  A('Quentin', 'davion', 8, 180, 'industrial'),
  A("Mallory's World", 'davion', 350, 200),
  A('Marlette', 'davion', 310, 260),
  A('Filtvelt', 'davion', 325, 430),
  A('Woodbine', 'davion', 355, 420),
  A('Bryceland', 'davion', 12, 350),
  A('Panpour', 'davion', 302, 210),
  A('Xhosa VII', 'davion', 318, 380),
  A('Point Barrow', 'davion', 345, 450),
  A('Crofton', 'davion', 335, 250),
  A("Milligan's World", 'davion', 358, 320),
  A('Delavan', 'davion', 328, 200, 'industrial'),
  A('Layover', 'davion', 348, 390),
  A('Broken Wheel', 'davion', 300, 300),
  A('Tancredi IV', 'davion', 320, 340),
  A('Demeter', 'davion', 12, 430),
  A('Avon', 'davion', 342, 240),
  A('Northwind', 'davion', 300, 120, 'hpg'),
  A('Axton', 'davion', 312, 150),
  A('Sylvan', 'davion', 332, 415),

  // --- Капелланская Конфедерация ---------------------------------------------
  A('Sian', 'liao', 272, 300, 'capital', 'industrial', 'hpg'),
  A('Capella', 'liao', 280, 250, 'industrial', 'hpg'),
  A('St. Ives', 'liao', 288, 220, 'industrial', 'hpg'),
  A('Tikonov', 'liao', 292, 140, 'mechFactory', 'industrial'),
  A('Sarna', 'liao', 268, 160, 'industrial', 'blackMarket', 'hpg'),
  A('Liao', 'liao', 276, 190),
  A('Menke', 'liao', 262, 230),
  A('Betelgeuse', 'liao', 258, 190),
  A('Kaifeng', 'liao', 284, 300),
  A('Hustaing', 'liao', 290, 260),
  A('Ares', 'liao', 265, 270),
  A('Necromo', 'liao', 270, 340, 'industrial'),
  A('Grand Base', 'liao', 278, 350),
  A('Highspire', 'liao', 260, 300),
  A('Tsitsang', 'liao', 286, 180),
  A('Victoria', 'liao', 268, 380),

  // --- Лига Свободных Миров --------------------------------------------------
  A('Atreus', 'marik', 222, 360, 'capital', 'industrial', 'hpg'),
  A('Marik', 'marik', 218, 330, 'industrial', 'hpg'),
  A('Oriente', 'marik', 235, 300, 'industrial', 'hpg'),
  A('Regulus', 'marik', 205, 280, 'industrial', 'hpg'),
  A('Irian', 'marik', 228, 220, 'mechFactory', 'industrial'),
  A('Kalidasa', 'marik', 240, 250),
  A('Sirius', 'marik', 208, 120),
  A('Procyon', 'marik', 214, 140),
  A('Gibson', 'marik', 232, 260, 'industrial'),
  A('Stewart', 'marik', 200, 320),
  A('Andurien', 'marik', 248, 330),
  A('Loyalty', 'marik', 226, 400),
  A('Shiro III', 'marik', 244, 200),
  A('Van Diemen IV', 'marik', 210, 380),
  A('Tamarind', 'marik', 216, 420),
  A('Calloway VI', 'marik', 238, 420),
  A('Campoleone', 'marik', 202, 220),
  A('New Delos', 'marik', 246, 280),
  A('Outreach', 'marik', 216, 95, 'hpg', 'industrial', 'blackMarket'),

  // --- Периферия -------------------------------------------------------------
  A('Taurus', 'taurian', 272, 560, 'capital', 'industrial', 'hpg'),
  A('New Vandenberg', 'taurian', 282, 520),
  A('Sterope', 'taurian', 265, 590),
  A('Perdition', 'taurian', 258, 620),
  A('Samantha', 'taurian', 278, 610),
  A("MacLeod's Land", 'taurian', 288, 560),
  A('Pinard', 'taurian', 268, 650),

  A('Canopus IV', 'canopus', 236, 600, 'capital', 'industrial', 'blackMarket', 'hpg'),
  A('Marantha', 'canopus', 244, 560),
  A('Detroit', 'canopus', 228, 620),
  A('Dunianshire', 'canopus', 250, 640),

  A('Alpheratz', 'outworlds', 12, 580, 'capital', 'hpg'),
  A('Quatre Belle', 'outworlds', 22, 540),
  A('Ramora', 'outworlds', 4, 620),
  A('Sevren', 'outworlds', 30, 600),

  A('Alphard', 'marian', 200, 620, 'capital'),
  A('Lordinax', 'marian', 195, 660),
  A('Pompey', 'marian', 206, 590),

  A('Circinus', 'circinus', 186, 640, 'capital', 'blackMarket'),
  A('Black Earth', 'circinus', 180, 680),

  // Конфедерация Оберона стёрта вторжением 3049 года и в реестре акторов не
  // значится: её миры лежат в зонах Волка и Сокола, а остатки ушли в пираты.
  A('Oberon VI', 'pirates', 96, 610, 'blackMarket'),
  A('Gustrell', 'pirates', 88, 640),
  A('Crellacor', 'pirates', 104, 660),

  A('Antallos', 'pirates', 40, 640, 'blackMarket'),
  A('Butte Hold', 'pirates', 118, 620, 'blackMarket'),

  // --- миры, занятые кланами в 3050–3052 ------------------------------------
  // Владелец здесь указан ДОВОЕННЫЙ — его перепишет наложение зон оккупации
  // (`OCCUPATION`). Смысл в том, чтобы имена этих миров остались сферными:
  // кланы захватили планеты, а не переименовали их.
  A('Tamar', 'steiner', 94, 420, 'industrial', 'hpg'),
  A('Roche', 'steiner', 112, 470),
  A('Irece', 'kurita', 70, 420),
  A('Satalice', 'steiner', 106, 425),
  A('Blair Atholl', 'steiner', 101, 480),
  A('Turtle Bay', 'kurita', 64, 440),
  A('Idlewind', 'kurita', 82, 445),
];

// --- имена --------------------------------------------------------------------

/**
 * Шаблон имени процедурного мира.
 *
 * Основа берётся по КУЛЬТУРЕ ВЛАДЕЛЬЦА: у Куриты японские названия, у Ляо
 * китайские, у Штайнера немецкие, у Дэвиона англо-саксонские, у Марика
 * греко-латинские, на периферии — грубые фронтирные. Это бесплатный способ
 * сделать карту читаемой: по одному имени видно, чья это сторона Сферы.
 */
type Culture = 'germanic' | 'japanese' | 'anglo' | 'chinese' | 'hellenic' | 'frontier';

const CULTURE_OF: Record<string, Culture> = {
  steiner: 'germanic',
  kurita: 'japanese',
  davion: 'anglo',
  liao: 'chinese',
  marik: 'hellenic',
  comstar: 'anglo',
  // Периферийные государства — не сплошной фронтир: у Конкордата и Альянса
  // имена англо-саксонские, у Магистрата и Мариан — греко-латинские, и только
  // за их границами начинается настоящее захолустье с грубыми названиями.
  taurian: 'anglo',
  outworlds: 'anglo',
  canopus: 'hellenic',
  marian: 'hellenic',
};

/** Дома и КомСтар — те, кому принадлежит «своя» культура имён на карте 3025. */
const HOUSES = new Set(['steiner', 'kurita', 'davion', 'liao', 'marik', 'comstar']);

const SYLLABLES: Record<Culture, { pre: readonly string[]; suf: readonly string[]; spaced?: boolean }> = {
  germanic: {
    pre: ['Aar', 'Berg', 'Dorn', 'Eis', 'Frei', 'Gart', 'Hels', 'Kirch', 'Lind', 'Mark', 'Nord', 'Ost', 'Raben', 'Stein', 'Thal', 'Vald', 'Wetz', 'Zell', 'Braun', 'Gold', 'Hoch', 'Weiss', 'Roth', 'Kalt', 'Sturm', 'Greif', 'Falk'],
    suf: ['berg', 'burg', 'stadt', 'heim', 'feld', 'au', 'wald', 'stein', 'thal', 'hafen', 'furt', 'bruck', 'moor', 'see'],
  },
  japanese: {
    pre: ['Aka', 'Fuji', 'Hiro', 'Ise', 'Kaga', 'Kuro', 'Mina', 'Nara', 'Oki', 'Sado', 'Shira', 'Taka', 'Tsuru', 'Yama', 'Yoshi', 'Naga', 'Hoshi', 'Kane', 'Mori', 'Ryu', 'Shino', 'Toya'],
    suf: ['shima', 'kawa', 'moto', 'saki', 'mura', 'hara', 'gawa', 'dera', 'zaki', 'take', 'no', 'ryu'],
  },
  anglo: {
    pre: ['Ash', 'Bel', 'Carn', 'Dun', 'Ell', 'Fair', 'Grant', 'Hart', 'Kend', 'Lam', 'Mor', 'Or', 'Pem', 'Rand', 'Somer', 'Til', 'Wynd', 'Brad', 'Clay', 'Har', 'Nor', 'West'],
    suf: ['ford', 'ton', 'shire', 'vale', 'mont', 'ridge', 'bury', 'haven', 'court', 'field', 'wick', 'croft'],
  },
  chinese: {
    pre: ['Bao', 'Chen', 'Dan', 'Feng', 'Gui', 'Han', 'Jin', 'Kai', 'Liu', 'Ming', 'Nan', 'Ping', 'Qin', 'Shan', 'Tai', 'Wu', 'Xin', 'Yu', 'Zhen', 'Hua', 'Long', 'Mei'],
    suf: ['ling', 'zhou', 'shan', 'hai', 'yang', 'tang', 'feng', 'xia', 'gang', 'du'],
  },
  hellenic: {
    pre: ['Ach', 'Bell', 'Cyn', 'Del', 'Eri', 'Hel', 'Iri', 'Kall', 'Lyc', 'Mel', 'Nem', 'Oly', 'Pel', 'Rhod', 'Sel', 'Thes', 'Xan', 'Zeph', 'Ther', 'Pan', 'Chal', 'Myc'],
    suf: ['ia', 'os', 'on', 'us', 'ades', 'ene', 'ora', 'ys', 'ion', 'ara'],
  },
  frontier: {
    pre: ['Bad', 'Black', 'Cinder', 'Dust', 'Grim', 'Iron', 'Last', 'Long', 'Rust', 'Salt', 'Slag', 'Stone', 'Wolf', 'Ash', 'Gallows', 'Bitter', 'Cold', 'Broken', 'Hard', 'Dead End'],
    suf: ['Gulch', 'Rock', 'Reef', 'Drift', 'Verge', 'Marches', 'Hollow', 'Cross', 'Run', 'Bluff', 'Landing', 'Watch'],
    spaced: true,
  },
};

/** Настоящие названия звёзд — общий пласт поверх культур, как и в каноне Сферы. */
const ASTRAL = [
  'Alrakis', 'Alhena', 'Zosma', 'Denebola', 'Mizar', 'Talitha', 'Merak', 'Phecda', 'Sabik',
  'Unukalhai', 'Zavijava', 'Alula', 'Nashira', 'Chertan', 'Errai', 'Marfik', 'Rasalas', 'Subra',
  'Tania', 'Segin', 'Ruchbah', 'Achird', 'Almach', 'Baten', 'Cursa', 'Dabih', 'Enif', 'Furud',
  'Gomeisa', 'Homam', 'Izar', 'Jabbah', 'Kraz', 'Lesath', 'Matar', 'Nekkar', 'Okab', 'Pherkad',
  'Rukbat', 'Sadr', 'Tarazed', 'Wasat', 'Yildun', 'Zaurak', 'Sheratan', 'Mebsuta', 'Alcor',
  'Kornephoros', 'Sualocin', 'Muphrid',
];

const PLACES = ['Rest', 'Landing', 'Folly', 'Hope', 'Reach', 'Stand', 'Crossing', 'Bounty', 'Wager', 'Retreat', 'Gamble', 'Pride'];
const ROMAN = ['II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
const EPITHET = ['Prime', 'Minor', 'Major', 'Secundus', 'Tertius'];

function root(rng: Rng, culture: Culture): string {
  if (rng.next() < 0.18) return rng.pick(ASTRAL);
  const table = SYLLABLES[culture];
  const pre = rng.pick(table.pre);
  const suf = rng.pick(table.suf);
  return table.spaced === true ? `${pre} ${suf}` : `${pre}${suf}`;
}

/** Один бросок шаблона. Уникальность обеспечивает вызывающий. */
function makeName(rng: Rng, culture: Culture): string {
  const r = root(rng, culture);
  const roll = rng.int(0, 99);
  // Основа из двух слов («Iron Gulch») принимает только короткие шаблоны:
  // «St. Wolf Watch's Rest» — не название мира, а опечатка.
  const compound = r.includes(' ');
  if (roll < 55) return r;
  if (roll < 64) return `New ${r}`;
  if (roll < 76) return `${r} ${rng.pick(ROMAN)}`;
  if (compound) return r;
  if (roll < 84) return `${r}'s ${rng.pick(PLACES)}`;
  if (roll < 89) return `St. ${r}`;
  if (roll < 96) return `${r} ${rng.pick(EPITHET)}`;
  return `${r}-${rng.int(2, 9)}`;
}

/** id системы — латинский слаг её имени. Читаемый ключ дельт и сообщений журнала. */
function slug(name: string): string {
  return name
    .toLowerCase()
    .replace(/['’.]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// --- сборка каталога ----------------------------------------------------------

interface Sys {
  id: string;
  name: string;
  x: number;
  y: number;
  star: number;
  faction: string;
  flags: number;
}

function dist(a: Sys, b: Sys): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function weightedPick(rng: Rng, weights: readonly number[]): number {
  const total = weights.reduce((s, w) => s + w, 0);
  let roll = rng.next() * total;
  for (let i = 0; i < weights.length; i++) {
    roll -= weights[i] as number;
    if (roll <= 0) return i;
  }
  return weights.length - 1;
}

const rng = new Rng(GENERATOR_SEED);

const systems: Sys[] = [];
const usedNames = new Set<string>();
const usedIds = new Set<string>();

for (const a of ANCHORS) {
  const rad = (a.deg * Math.PI) / 180;
  const id = slug(a.name);
  if (usedIds.has(id)) throw new Error(`Повтор якорного id: ${id}`);
  usedIds.add(id);
  usedNames.add(a.name);
  let flags = FLAG.anchor;
  for (const f of a.flags ?? []) flags |= FLAG[f];
  systems.push({
    id,
    name: a.name,
    x: Math.cos(rad) * a.ly,
    y: Math.sin(rad) * a.ly,
    star: weightedPick(rng, STAR_WEIGHTS),
    faction: a.faction,
    flags,
  });
}

const anchorCount = systems.length;

/** Плотность обитаемых миров: ровная внутри круга Домов, экспоненциально падает наружу. */
function density(r: number): number {
  return r <= HOUSE_RADIUS ? 1 : 0.9 * Math.exp(-(r - HOUSE_RADIUS) / RIM_FALLOFF) + 0.015;
}

let guard = 0;
while (systems.length < TOTAL_SYSTEMS) {
  if (++guard > TOTAL_SYSTEMS * 500) throw new Error('Не удалось набрать каталог: слишком тесно');
  const r = RIM_RADIUS * Math.sqrt(rng.next());
  if (rng.next() > density(r)) continue;
  const th = rng.next() * Math.PI * 2;
  const candidate: Sys = {
    id: '',
    name: '',
    x: Math.cos(th) * r,
    y: Math.sin(th) * r,
    star: weightedPick(rng, STAR_WEIGHTS),
    faction: '',
    flags: 0,
  };
  let tooClose = false;
  for (const s of systems) {
    if (dist(s, candidate) < MIN_DISTANCE) {
      tooClose = true;
      break;
    }
  }
  if (tooClose) continue;
  systems.push(candidate);
}

// --- владение: взвешенная диаграмма Вороного по якорям ------------------------

/**
 * Владельца процедурного мира задаёт ближайший якорь, поделённый на его вес:
 * столица тянет дальше рядового мира. КомСтар из розыгрыша исключён намеренно —
 * в 3025 ему принадлежит одна Терра, а не окрестности.
 */
function anchorWeight(flags: number): number {
  if ((flags & FLAG.capital) !== 0) return 1.35;
  if ((flags & (FLAG.industrial | FLAG.mechFactory)) !== 0) return 1.15;
  return 1;
}

const claimers = systems
  .slice(0, anchorCount)
  .filter((s) => s.faction !== 'comstar')
  .map((s) => ({ x: s.x, y: s.y, faction: s.faction, w: anchorWeight(s.flags) }));

/** Дальше этого от любого якоря государства нет: мир ничей или пиратский. */
const UNCLAIMED_LY = 175;

for (let i = anchorCount; i < systems.length; i++) {
  const s = systems[i] as Sys;
  let best = Number.POSITIVE_INFINITY;
  let owner = 'independent';
  for (const c of claimers) {
    const score = Math.hypot(s.x - c.x, s.y - c.y) / c.w;
    if (score < best) {
      best = score;
      owner = c.faction;
    }
  }
  s.faction = best > UNCLAIMED_LY ? (rng.next() < 0.35 ? 'pirates' : 'independent') : owner;
}

// --- зоны оккупации кланов (3050–3052) ----------------------------------------

/**
 * Вторжение кланов, замороженное перемирием Тукайида (май 3052).
 *
 * Кланы пришли с антиспинвардного края карты и прорубили четыре зоны оккупации
 * в лиранском и куритском приграничье, смяв по дороге периферийные государства
 * на своём пути (Конфедерация Оберона в реестре акторов поэтому и не значится).
 * Наложение идёт ПОСЛЕ раздачи довоенных владельцев и после имён: клан
 * захватил планету, а не переименовал её, и имя обязано остаться сферным.
 *
 * `share` — второй клан, которому досталась часть той же зоны. Это не
 * выдумка ради разнообразия, а канон: Стальная Гадюка вошла в зону 
 * Кречета и держала свои миры вперемешку с соколиными (кончилось это тем, что
 * Сокол вышиб Гадюку из Сферы уже после нашей эпохи), Новая Кошка так же
 * делила зону с Дымчатым Ягуаром.
 *
 * Углы и радиусы, как и все координаты якорей, — реконструкция расположения, а
 * не выверенная таблица: важно, что зоны лежат дугой по краю Лирана и Синдиката
 * в правильном порядке и в правильном соседстве.
 */
interface Zone {
  readonly clan: string;
  /** Сектор [от, до) в градусах. */
  readonly from: number;
  readonly to: number;
  /** Ближе этого к Терре клан не прошёл. */
  readonly inner: number;
  /** Клан, делящий ту же зону, и доля миров, доставшаяся ему. */
  readonly share?: { readonly clan: string; readonly part: number };
}

const OCCUPATION: readonly Zone[] = [
  { clan: 'jade_falcon', from: 99, to: 125, inner: 370, share: { clan: 'steel_viper', part: 0.3 } },
  { clan: 'wolf', from: 86, to: 99, inner: 320 },
  { clan: 'ghost_bear', from: 78, to: 86, inner: 330 },
  { clan: 'smoke_jaguar', from: 60, to: 78, inner: 385, share: { clan: 'nova_cat', part: 0.3 } },
];

/**
 * Миры, которых наложение не касается.
 *
 * Волкотт — не оговорка: Синдикат отбил его и удержал, оставшись островом
 * внутри зоны Дымчатого Ягуара. Это ровно тот случай, ради которого владение
 * не обязано быть связным, и проверить его лучше на канонном примере, чем
 * обнаружить ошибкой в шаге 21.
 */
const OCCUPATION_EXEMPT = new Set([
  'wolcott',
  // Ни одна столица Великого Дома не пала: кланов остановили задолго до них.
  // Здесь это не украшение, а предохранитель — сектор Ягуара в первом варианте
  // накрыл Лютиен ровно по внутренней границе, и проверка ссылок это поймала.
  'tharkad',
  'luthien',
  'new-avalon',
  'sian',
  'atreus',
  'terra',
]);

/**
 * Владельцы, назначенные вне всякой географии. Накладываются ПОСЛЕ зон.
 *
 * Столицы кланов перечислены здесь по необходимости, а не для порядка: делёж
 * общей зоны идёт по хэшу id, и он честно уносил Пешт Новой Кошке, а Ирече —
 * Ягуару, то есть ровно наоборот тому, что записано в реестре акторов. Столица
 * клана обязана принадлежать этому клану, и решается это не подгонкой хэша, а
 * явным назначением.
 */
const REASSIGN: Record<string, string> = {
  // Аутрич — мир Волчьих Драгун с 3030-х: наёмный отряд владеет системой той же
  // ссылкой в реестр, что и Великий Дом.
  outreach: 'dragoons',
  sudeten: 'jade_falcon',
  roche: 'steel_viper',
  tamar: 'wolf',
  alshain: 'ghost_bear',
  pesht: 'smoke_jaguar',
  irece: 'nova_cat',
};

/** Столицы, которые появились вместе с новыми владельцами. */
const NEW_CAPITALS = ['sudeten', 'tamar', 'alshain', 'pesht', 'irece', 'roche', 'outreach'];

function occupy(): void {
  for (const s of systems) {
    if (OCCUPATION_EXEMPT.has(s.id)) continue;
    let deg = (Math.atan2(s.y, s.x) * 180) / Math.PI;
    if (deg < 0) deg += 360;
    const r = Math.hypot(s.x, s.y);
    for (const z of OCCUPATION) {
      if (deg < z.from || deg >= z.to || r < z.inner) continue;
      s.faction = z.clan;
      if (z.share !== undefined) {
        // Дележ детерминирован от id, а не от порядка обхода: миры двух кланов
        // обязаны лежать вперемешку одинаково при каждом прогоне тула.
        let h = 0x9e3779b9;
        for (let i = 0; i < s.id.length; i++) h = Math.imul(h ^ s.id.charCodeAt(i), 0x85ebca6b) >>> 0;
        if ((h % 1000) / 1000 < z.share.part) s.faction = z.share.clan;
      }
      break;
    }
  }

  for (const s of systems) {
    const to = REASSIGN[s.id];
    if (to !== undefined) s.faction = to;
  }

  for (const id of NEW_CAPITALS) {
    const s = systems.find((x) => x.id === id);
    if (s === undefined) throw new Error(`Нет системы под столицу: ${id}`);
    s.flags |= FLAG.capital;
  }
}

// --- имена процедурных миров ---------------------------------------------------

for (let i = anchorCount; i < systems.length; i++) {
  const s = systems[i] as Sys;
  const culture = CULTURE_OF[s.faction] ?? 'frontier';
  let name = '';
  for (let attempt = 0; attempt < 24; attempt++) {
    name = makeName(rng, culture);
    if (!usedNames.has(name) && !usedIds.has(slug(name))) break;
    name = '';
  }
  if (name === '') {
    // Запасной ход: имя от индекса. Ни разу не понадобилось на текущем сиде,
    // но каталог не имеет права зависеть от везения бросков.
    name = `${root(rng, culture)} ${i}`;
  }
  usedNames.add(name);
  s.name = name;
  s.id = slug(name);
  usedIds.add(s.id);
}

// --- флаги процедурных миров ---------------------------------------------------

for (let i = anchorCount; i < systems.length; i++) {
  const s = systems[i] as Sys;
  const isHouse = HOUSES.has(s.faction);
  if (rng.next() < (isHouse ? 0.1 : 0.03)) s.flags |= FLAG.hpg;
  if (rng.next() < (isHouse ? 0.05 : 0.01)) s.flags |= FLAG.industrial;
  if (rng.next() < (isHouse ? 0.02 : 0.06)) s.flags |= FLAG.blackMarket;
}

// Оккупация накладывается ПОСЛЕ имён: захваченный мир сохраняет сферное имя.
occupy();

// --- связность: любая система достижима из любой при дальности 30 св. лет ------

function components(): number[] {
  const comp = new Array<number>(systems.length).fill(-1);
  let next = 0;
  for (let i = 0; i < systems.length; i++) {
    if (comp[i] !== -1) continue;
    const stack = [i];
    comp[i] = next;
    while (stack.length > 0) {
      const cur = stack.pop() as number;
      const a = systems[cur] as Sys;
      for (let j = 0; j < systems.length; j++) {
        if (comp[j] !== -1) continue;
        if (dist(a, systems[j] as Sys) <= JUMP_RANGE) {
          comp[j] = next;
          stack.push(j);
        }
      }
    }
    next++;
  }
  return comp;
}

let passes = 0;
for (;;) {
  const comp = components();
  const sizes = new Map<number, number>();
  for (const c of comp) sizes.set(c, (sizes.get(c) ?? 0) + 1);
  if (sizes.size === 1) break;
  if (++passes > 40) throw new Error('Связность не сходится');

  let main = 0;
  let mainSize = -1;
  for (const [c, n] of sizes) {
    if (n > mainSize) {
      mainSize = n;
      main = c;
    }
  }

  // Оторванный мир подтягивается к ближайшему из основной компоненты, а не
  // выбрасывается: каталог обязан быть ровно на TOTAL_SYSTEMS систем.
  for (let i = 0; i < systems.length; i++) {
    if (comp[i] === main) continue;
    const s = systems[i] as Sys;
    let bestJ = -1;
    let bestD = Number.POSITIVE_INFINITY;
    for (let j = 0; j < systems.length; j++) {
      if (comp[j] !== main) continue;
      const d = dist(s, systems[j] as Sys);
      if (d < bestD) {
        bestD = d;
        bestJ = j;
      }
    }
    if (bestJ === -1) continue;
    const m = systems[bestJ] as Sys;
    const k = (JUMP_RANGE - 3) / bestD;
    s.x = m.x + (s.x - m.x) * k;
    s.y = m.y + (s.y - m.y) * k;
    // Подтягивание могло посадить мир на соседа — отодвигаем по кругу вокруг цели.
    for (let tries = 0; tries < 32; tries++) {
      let clash = false;
      for (let j = 0; j < systems.length; j++) {
        if (j === i) continue;
        if (dist(s, systems[j] as Sys) < MIN_DISTANCE) {
          clash = true;
          break;
        }
      }
      if (!clash) break;
      const ang = Math.atan2(s.y - m.y, s.x - m.x) + 0.2;
      const rad = Math.hypot(s.y - m.y, s.x - m.x);
      s.x = m.x + Math.cos(ang) * rad;
      s.y = m.y + Math.sin(ang) * rad;
    }
  }
}

// --- канонические базы наёмных полков (шаг 82) ---------------------------------

/**
 * Базы великих полков, которых нет среди якорей: процедурный мир нужного владельца,
 * ближайший к канонической точке, получает каноническое имя. Не новый якорь — новый
 * якорь сдвинул бы весь поток бросков и с ним всю карту. Проход стоит ПОСЛЕ связности
 * (координаты окончательные) и к ГПСЧ не обращается: остальные 1997 миров не меняются.
 * Климат задаёт `data/galaxy/galaxy.json` → `canonicalBiomes`, а не этот тул.
 */
const RENAMED_BASES: readonly { readonly name: string; readonly faction: string; readonly deg: number; readonly ly: number }[] = [
  // Кордон Арк-Рояла — лиранский край у зон оккупации Волков и Нефритовых Соколов.
  { name: 'Arc-Royal', faction: 'steiner', deg: 125, ly: 365 },
  // Гленгари — провинция Скай.
  { name: 'Glengarry', faction: 'steiner', deg: 120, ly: 225 },
  // Дедесис — Федеративные Солнца, у Кэтила (решение пользователя 2026-09-30).
  { name: 'Dedesis', faction: 'davion', deg: 325, ly: 280 },
];

for (const base of RENAMED_BASES) {
  const rad = (base.deg * Math.PI) / 180;
  const point = { x: Math.cos(rad) * base.ly, y: Math.sin(rad) * base.ly };
  let best: Sys | null = null;
  let bestD = Number.POSITIVE_INFINITY;
  for (let i = anchorCount; i < systems.length; i++) {
    const s = systems[i] as Sys;
    if (s.faction !== base.faction || RENAMED_BASES.some((b) => b.name === s.name)) continue;
    const d = Math.hypot(s.x - point.x, s.y - point.y);
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  }
  if (best === null) throw new Error(`Нет мира «${base.faction}» под базу ${base.name}`);
  const id = slug(base.name);
  if (usedIds.has(id)) throw new Error(`Повтор id базы: ${id}`);
  usedIds.delete(best.id);
  usedIds.add(id);
  best.name = base.name;
  best.id = id;
}

// --- проверка ссылок ----------------------------------------------------------

// Владелец каждой системы обязан существовать в реестре акторов. Проверка стоит
// здесь, а не только в загрузчике игры: тул, написавший каталог с висячей
// ссылкой, должен падать сам, а не через минуту в чужом стеке.
{
  const registry = JSON.parse(
    fs.readFileSync(path.resolve(import.meta.dirname, '../game/data/galaxy/factions.json'), 'utf8'),
  ) as { factions: { id: string }[] };
  const known = new Set(registry.factions.map((f) => f.id));
  const missing = [...new Set(systems.map((s) => s.faction))].filter((f) => !known.has(f));
  if (missing.length > 0) {
    throw new Error(`Владельцы, которых нет в factions.json: ${missing.join(', ')}`);
  }

  // И обратная сверка: столица фракции обязана ей же и принадлежать. Без неё
  // делёж общей зоны молча уносит столицу соседу.
  const owners = new Map(systems.map((s) => [s.id, s.faction]));
  for (const f of registry.factions as { id: string; capital?: string }[]) {
    if (f.capital === undefined) continue;
    const owner = owners.get(f.capital);
    if (owner !== f.id) {
      throw new Error(`Столица «${f.capital}» фракции «${f.id}» принадлежит «${owner ?? 'никому'}»`);
    }
  }
}

// --- запись -------------------------------------------------------------------

const round = (v: number): number => Math.round(v * 100) / 100;

const out = {
  $comment:
    'СГЕНЕРИРОВАНО tools/generate_galaxy.ts — руками не править. Слой канона: id, имя, координаты (св. лет от Терры), спектральный класс, владелец на 3053 (после Тукайида, с зонами оккупации кланов), флаги. Всё остальное выводится (core/campaign/galaxy/profile.ts) и нигде не хранится.',
  $flags: 'битовая маска: 1 столица, 2 промышленный узел, 4 завод боевых машин, 8 чёрный рынок, 16 станция HPG, 32 якорный мир',
  generatorSeed: GENERATOR_SEED,
  jumpRangeLy: JUMP_RANGE,
  starClasses: STAR_CLASSES,
  columns: {
    id: systems.map((s) => s.id),
    name: systems.map((s) => s.name),
    x: systems.map((s) => round(s.x)),
    y: systems.map((s) => round(s.y)),
    star: systems.map((s) => s.star),
    owner: systems.map((s) => s.faction),
    flags: systems.map((s) => s.flags),
  },
};

const target = path.resolve(import.meta.dirname, '../game/data/galaxy/systems.json');
fs.writeFileSync(target, `${JSON.stringify(out)}\n`, 'utf8');

// --- отчёт --------------------------------------------------------------------

const byFaction = new Map<string, number>();
for (const s of systems) byFaction.set(s.faction, (byFaction.get(s.faction) ?? 0) + 1);

let minPair = Number.POSITIVE_INFINITY;
for (let i = 0; i < systems.length; i++) {
  for (let j = i + 1; j < systems.length; j++) {
    const d = dist(systems[i] as Sys, systems[j] as Sys);
    if (d < minPair) minPair = d;
  }
}

console.log(`Записано: ${target}`);
console.log(`Систем: ${systems.length} (якорей ${anchorCount}), проходов связности: ${passes}`);
console.log(`Минимальное расстояние между парой: ${minPair.toFixed(2)} св. лет`);
console.log(`Размер файла: ${(fs.statSync(target).size / 1024).toFixed(0)} КБ`);
console.log('Владения:');
for (const [f, n] of [...byFaction].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${f.padEnd(14)} ${String(n).padStart(4)}  ${((n / systems.length) * 100).toFixed(1)} %`);
}
