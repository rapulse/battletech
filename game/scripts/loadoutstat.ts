/**
 * Аудит процедурных сборок: чем генератор вооружает машины и нормально ли это.
 *
 * Вопрос, на который отвечает прогон: **можно ли по числам сказать, что сотня
 * сгенерированных сборок — нормальная**. Пока такой мерки нет, спор о том,
 * «правильно ли стотонник несёт семь средних лазеров», ведётся на ощущениях, а
 * генератор чинить не по чему. Каждая проверка ниже — не мнение, а величина,
 * посчитанная из самой сборки, с явным коридором.
 *
 * Прогон НЕ ведёт боёв: сборки строятся и считаются арифметикой, поэтому под
 * лимит 1400 тактических боёв (CLAUDE.md) он не идёт и занимает секунды.
 *
 * ПОЛОСЫ — ЧЕТЫРЕ ВЕСОВЫХ КЛАССА ЯДРА (`weightClassOf`, шаг 49): лёгкий,
 * средний, тяжёлый, штурмовой. До шага 49 классов в ядре было три, и скрипт
 * держал свои четыре полосы — стотонник и семидесятитонник вооружаются
 * по-разному. Теперь своих границ здесь нет.
 *
 * Запуск: pnpm loadoutstat [--count N] [--seed N] [--tech is|clan|both]
 *                          [--worst N] [--roles]
 */
import {
  CHASSIS_CATALOG_LIST,
  CONSTRUCTION,
  EQUIPMENT,
  WEAPONS,
} from '../src/core/data/tables.js';
import {
  ASSEMBLY_ROLES,
  AMMO_FOR_WEAPON,
  ammoPerVolley,
  armorPointsPerTon,
  generateAssembly,
  hullReserveOf,
  makePlatform,
  weightClassOf,
  type AssemblyRole,
  type MechAssembly,
} from '../src/core/rules/index.js';
import { Rng } from '../src/core/rng/index.js';
import type { ZoneId } from '../src/core/model/index.js';

const args = process.argv.slice(2);
const num = (flag: string, fallback: number): number => {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] !== undefined ? Number(args[i + 1]) : fallback;
};
const str = (flag: string, fallback: string): string => {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] !== undefined ? String(args[i + 1]) : fallback;
};
const has = (flag: string): boolean => args.includes(flag);

/** Сколько сборок на каждую полосу и техбазу. */
const COUNT = num('--count', 150);
const SEED = num('--seed', 4747);
const TECH = str('--tech', 'both') as 'is' | 'clan' | 'both';
const WORST = num('--worst', 3);
const BY_ROLE = has('--roles');
/**
 * Роли поровну вместо взвешенного жребия.
 *
 * По умолчанию роль НЕ задаётся и генератор тянет её сам, взвешивая по весу
 * машины (`construction.json → roles`) — так парк и выглядит в игре. Ровные
 * роли нужны только для сравнения ролей между собой: иначе у штурмовой полосы
 * разведчиков почти нет и сравнивать не с чем.
 */
const EVEN_ROLES = has('--even-roles');

// ---------------------------------------------------------------------------
// Мерка: что считать нормальной сборкой
// ---------------------------------------------------------------------------

type Band = 'лёгкие' | 'средние' | 'тяжёлые' | 'штурмовые';

const BANDS: readonly Band[] = ['лёгкие', 'средние', 'тяжёлые', 'штурмовые'];

/** Полоса — весовой класс ядра (шаг 49), а не свои границы. */
function bandOf(tonnage: number): Band {
  return ({ light: 'лёгкие', medium: 'средние', heavy: 'тяжёлые', assault: 'штурмовые' } as const)[
    weightClassOf(tonnage)
  ];
}

/**
 * Коридоры нормальности по полосам.
 *
 * `heavyGunTons` — с какой массы ствол считается тяжёлым для этой полосы. Число
 * разное, и это не произвол: для 30-тонника большой лазер в 5 т — уже главный
 * калибр, для стотонника — вспомогательное оружие.
 *
 * `heavyShare` — какую долю тоннажа вооружения полоса обязана нести в стволах
 * не легче `heavyGunTons`. Это и есть числовой ответ на «соответствует ли
 * калибр классу».
 *
 * `minAlpha` — нижняя планка урона полного залпа: машина обязана представлять
 * угрозу, соразмерную своей цене. Верхней планки НЕТ сознательно: сильный залп
 * сам по себе не порок, а его оборотные стороны ловятся отдельно — тонкой
 * бронёй, перегревом и малым устойчивым залпом. Клановая техбаза бьёт сильнее
 * при том же весе, и это канон, поэтому её планка отдельная.
 */
interface BandCorridor {
  readonly heavyGunTons: number;
  readonly heavyShare: readonly [number, number];
  readonly minAlpha: { readonly is: number; readonly clan: number };
}

const CORRIDOR: Record<Band, BandCorridor> = {
  'лёгкие': { heavyGunTons: 2, heavyShare: [0.0, 0.85], minAlpha: { is: 14, clan: 22 } },
  'средние': { heavyGunTons: 3, heavyShare: [0.25, 0.9], minAlpha: { is: 26, clan: 40 } },
  'тяжёлые': { heavyGunTons: 5, heavyShare: [0.4, 0.95], minAlpha: { is: 40, clan: 60 } },
  'штурмовые': { heavyGunTons: 5, heavyShare: [0.5, 1.0], minAlpha: { is: 55, clan: 80 } },
};

/** Коридоры, общие для всех полос. */
/**
 * Коридор «залп/отвод» — доли нормы генератора, а не числа: норма переезжала
 * (2 → 1, 2026-09-14, порог отключения стал равен отводу), и прошитый [1.5, 2.4]
 * записал в «охлаждение впустую» весь парк. Доли прежние: 1.5/2 и 2.4/2.
 */
const ALPHA_HEAT_RATIO: readonly [number, number] = [
  CONSTRUCTION.reactors.alphaHeatTarget * 0.75,
  CONSTRUCTION.reactors.alphaHeatTarget * 1.2,
];
/** Доля залпа, которую машина может жать каждый ход без нагрева. */
const SUSTAIN_MIN = 0.3;
/** Броня от потолка корпуса. */
const ARMOR_FILL_MIN = 0.95;
/**
 * Сколько тонн навески позволено оставить неистраченными.
 *
 * САМО ПО СЕБЕ ЭТО НЕ ЗАМЕЧАНИЕ (решение пользователя 2026-09-09). Лёгкий
 * каркас (F2, F3) весит меньше и забирает часть ячеек: он МЕНЯЕТ тонны на
 * скорость, и недовес у такой машины — не потеря, а вложение. Порог нужен лишь
 * затем, чтобы вместе со свободными ЯЧЕЙКАМИ отличить вложение от срыва
 * набора: свободно и то и другое разом — значит генератор просто остановился.
 */
const IDLE_TONS_MAX = 1.5;
/**
 * Сколько ячеек под оружие позволено оставить пустыми.
 *
 * Ячейки — первая статья, тоннаж вторая: место, куда можно поставить ствол и не
 * поставили, потеряно безвозвратно, а тонны переходят в скорость.
 */
const IDLE_GUN_SLOTS_MAX = 2;
/** Сколько залпов боезапаса считать достаточным на бой в 18 ходов. */
const VOLLEYS_MIN = 10;

/** Дистанции, на которых считается профиль урона (гексы). */
const RANGE_BANDS = [3, 9, 16] as const;

// ---------------------------------------------------------------------------
// Разбор одной сборки
// ---------------------------------------------------------------------------

/**
 * Голова в счёт свободных ячеек НЕ идёт: `mountRules` пускает туда оружие не
 * крупнее одной ячейки, и три пустых слота в кокпите — норма, а не потеря.
 */
const WEAPON_ZONES: readonly ZoneId[] = ['torso', 'leftArm', 'rightArm'];

interface Audit {
  readonly code: string;
  readonly band: Band;
  readonly tech: 'is' | 'clan';
  readonly role: AssemblyRole;
  readonly tonnage: number;
  readonly guns: number;
  readonly weaponTons: number;
  readonly meanGunTons: number;
  readonly heavyShare: number;
  readonly alpha: number;
  readonly alphaHeat: number;
  readonly dissipation: number;
  readonly heatRatio: number;
  readonly sustainShare: number;
  readonly armorFill: number;
  readonly idleTons: number;
  readonly idleWeaponSlots: number;
  readonly needDensity: number;
  readonly gotDensity: number;
  readonly frameTier: number;
  readonly sinkTons: number;
  readonly sinkSlots: number;
  readonly volleys: number;
  readonly damageAt: readonly number[];
  readonly jumps: boolean;
  readonly jumpCount: number;
  readonly electronics: readonly string[];
  readonly weapons: readonly string[];
  readonly fails: readonly string[];
}

/**
 * Устойчивый залп — сколько урона машина выдаёт, оставаясь в нуле по нагреву.
 *
 * Считается жадно: оружие сортируется по урону на очко тепла, набирается пока
 * тепло не упрётся в отвод. Именно эта величина отвечает на «не перегреется ли
 * противник»: машина с альфой 60 и устойчивым залпом 6 стреляет один раз и
 * потом три хода стоит и остывает.
 */
function sustainedDamage(weapons: readonly string[], dissipation: number): number {
  const defs = weapons
    .map((id) => WEAPONS.get(id))
    .filter((w): w is NonNullable<typeof w> => w !== undefined)
    .map((w) => ({
      dmg: w.damage * (w.shots ?? 1),
      heat: w.heat,
    }))
    .sort((a, b) => (b.heat === 0 ? Infinity : b.dmg / b.heat) - (a.heat === 0 ? Infinity : a.dmg / a.heat));

  let heat = 0;
  let dmg = 0;
  for (const d of defs) {
    if (heat + d.heat > dissipation) continue;
    heat += d.heat;
    dmg += d.dmg;
  }
  return dmg;
}

function auditAssembly(a: MechAssembly): Audit {
  const platform = makePlatform(a.techBase, a.tonnage, reactorTierOf(a), frameTierOf(a), a.quality);
  const band = bandOf(a.tonnage);
  const corr = CORRIDOR[band];

  const weaponIds = a.items.filter((it) => WEAPONS.has(it.id)).map((it) => it.id);
  const defs = weaponIds.map((id) => WEAPONS.get(id)!);

  const weaponTons = defs.reduce((s, w) => s + w.mass, 0);
  const alpha = defs.reduce((s, w) => s + w.damage * (w.shots ?? 1), 0);
  const alphaHeat = defs.reduce((s, w) => s + w.heat, 0);
  const heavyTons = defs.filter((w) => w.mass >= corr.heavyGunTons).reduce((s, w) => s + w.mass, 0);

  let sinkPts = 0;
  let sinkTons = 0;
  let sinkSlots = 0;
  let jumps = false;
  let jumpCount = 0;
  const electronics: string[] = [];
  for (const it of a.items) {
    const eq = EQUIPMENT.get(it.id);
    if (eq === undefined) continue;
    if (eq.category === 'heatsink') {
      sinkPts += eq.heatDissipation ?? 1;
      sinkTons += eq.mass;
      sinkSlots += eq.slots;
    }
    if (eq.category === 'jump_jet') {
      jumps = true;
      jumpCount++;
    }
    if (eq.category === 'electronics' || eq.category === 'protection') electronics.push(eq.code);
  }
  const dissipation = platform.baseHeatDiss + sinkPts;

  // Броня: сколько поставлено против потолка корпуса.
  const maxArmorTons = platform.maxArmorPts / armorPointsPerTon(a.techBase);
  const armorFill = maxArmorTons > 0 ? a.armorTons / maxArmorTons : 1;

  // Неистраченное. Тонны считаются от навески за вычетом всего поставленного;
  // ячейки — только в зонах, куда вообще идёт оружие: свободная ячейка в ноге
  // не значит, что туда влезет пушка (`mountRules`).
  const usedTons = a.items.reduce(
    (s, it) => s + (WEAPONS.get(it.id)?.mass ?? EQUIPMENT.get(it.id)?.mass ?? 0),
    0,
  );
  // `payloadMass` считается БЕЗ штатной брони (её вычли ещё на платформе),
  // поэтому вернуть её в бюджет обязательно — иначе неистраченное уходит в
  // минус ровно на штатную броню.
  const idleTons = platform.payloadMass + platform.defArmorMass - a.armorTons - usedTons;

  const slotsFree: Record<string, number> = { ...platform.freeSlots };
  for (const it of a.items) {
    const slots = WEAPONS.get(it.id)?.slots ?? EQUIPMENT.get(it.id)?.slots ?? 0;
    slotsFree[it.zone] = (slotsFree[it.zone] ?? 0) - slots;
  }
  const idleWeaponSlots = WEAPON_ZONES.reduce((s, z) => s + Math.max(0, slotsFree[z] ?? 0), 0);

  // Боезапас: на сколько залпов хватает самому голодному стволу. Оружие без
  // боезапаса в счёт не идёт — энергетическому патроны не нужны.
  let volleys = Infinity;
  const fedCounts = new Map<string, number>();
  for (const id of weaponIds) {
    const ammoId = AMMO_FOR_WEAPON[id];
    if (ammoId !== undefined) fedCounts.set(ammoId, (fedCounts.get(ammoId) ?? 0) + 1);
  }
  for (const [ammoId, gunCount] of fedCounts) {
    const tons = a.items.filter((it) => it.id === ammoId).length;
    const shots = (EQUIPMENT.get(ammoId)?.shots ?? 0) * tons;
    // Делить выстрелы на расход залпа обязательно: у Ultra AC сдвоенный огонь
    // съедает два выстрела за раз (`ammoPerVolley`). До 2026-09-16 здесь стояло
    // голое число выстрелов, и аудит отвечал «боезапаса хватает» ровно там, где
    // в бою ствол сох, — потому что бой считал расход иначе, чем цех.
    const perVolley = ammoPerVolley(
      WEAPONS.get(weaponIds.find((id) => AMMO_FOR_WEAPON[id] === ammoId) ?? '') ?? {
        shots: 1,
        cluster: false,
      },
    );
    volleys = Math.min(volleys, shots / perVolley / gunCount);
  }

  // Профиль урона по дистанциям: сколько урона доступно на 3, 9 и 16 гексах.
  // Он ловит абсурд, которого не видно ни по альфе, ни по массе: машину, у
  // которой главный калибр бьёт на двадцать, а всё остальное — на четыре.
  const damageAt = RANGE_BANDS.map((r) =>
    defs
      .filter((w) => w.long >= r && (w.minRange ?? 0) <= r)
      .reduce((s, w) => s + w.damage * (w.shots ?? 1), 0),
  );

  // Плотность навески — тонн на ячейку. Это та величина, об которую машина на
  // самом деле упирается: тоннаж кончается позже объёма. Платформе с большой
  // навеской и малым числом ячеек нужны ПЛОТНЫЕ детали, иначе вес некуда деть.
  // Требуемая плотность — весь свободный вес, делённый на весь свободный объём;
  // фактическая — то, что генератор в машину действительно поставил.
  const freeSlotsTotal = Object.values(platform.freeSlots).reduce((s, n) => s + n, 0);
  const needDensity =
    freeSlotsTotal > 0 ? (platform.payloadMass + platform.defArmorMass - maxArmorTons) / freeSlotsTotal : 0;
  const usedSlots = a.items.reduce(
    (s, it) => s + (WEAPONS.get(it.id)?.slots ?? EQUIPMENT.get(it.id)?.slots ?? 0),
    0,
  );
  const gotDensity = usedSlots > 0 ? (usedTons - 0) / usedSlots : 0;

  // Залп против ПРЕДЕЛА (отвод + запас корпуса) — туда целится генератор.
  const heatLimit = dissipation + hullReserveOf(platform.weightClass);
  const heatRatio = heatLimit > 0 ? alphaHeat / heatLimit : Infinity;
  const sustainShare = alpha > 0 ? sustainedDamage(weaponIds, dissipation) / alpha : 0;
  const heavyShare = weaponTons > 0 ? heavyTons / weaponTons : 0;

  const fails: string[] = [];
  if (heavyShare < corr.heavyShare[0]) fails.push('калибр мелок');
  // Однобокость — это не «много тяжёлого тоннажа», а «кроме главного калибра
  // ничего нет»: два ППК и пара средних лазеров нормальны, один АП/20 в пустой
  // машине — нет. Поэтому проверяются число стволов и доля залпа за одним типом.
  const byType = new Map<string, number>();
  for (const w of defs) byType.set(w.id, (byType.get(w.id) ?? 0) + w.damage * (w.shots ?? 1));
  const topTypeShare = alpha > 0 ? Math.max(...[...byType.values()]) / alpha : 0;
  if (weaponIds.length < 3 && topTypeShare > 0.8) fails.push('калибр однобок');

  if (alpha < corr.minAlpha[a.techBase]) fails.push('залп слаб');
  if (heatRatio > ALPHA_HEAT_RATIO[1]) fails.push('перегрев');
  if (heatRatio < ALPHA_HEAT_RATIO[0]) fails.push('охлаждение впустую');
  if (sustainShare < SUSTAIN_MIN) fails.push('нечем стрелять каждый ход');
  if (armorFill < ARMOR_FILL_MIN) fails.push('броня недобрана');
  // Свободны разом и вес, и объём — набор сорвался, а не разменял одно на
  // другое. Одна свободная статья из двух замечанием не считается.
  if (idleWeaponSlots > IDLE_GUN_SLOTS_MAX && idleTons > IDLE_TONS_MAX) {
    fails.push('набор сорвался');
  }
  if (volleys < VOLLEYS_MIN) fails.push('боезапас мал');
  if (Math.max(...damageAt) < alpha * 0.6) fails.push('залп несвязен');

  return {
    code: a.chassisCode,
    band,
    tech: a.techBase,
    role: a.role,
    tonnage: a.tonnage,
    guns: weaponIds.length,
    weaponTons,
    meanGunTons: weaponIds.length > 0 ? weaponTons / weaponIds.length : 0,
    heavyShare,
    alpha,
    alphaHeat,
    dissipation,
    heatRatio,
    sustainShare,
    armorFill,
    idleTons,
    idleWeaponSlots,
    needDensity,
    gotDensity,
    frameTier: frameTierOf(a),
    sinkTons,
    sinkSlots,
    volleys: Number.isFinite(volleys) ? volleys : 99,
    damageAt,
    jumps,
    jumpCount,
    electronics,
    weapons: weaponIds,
    fails,
  };
}

/**
 * Тир реактора и каркаса берутся из кода платформы: сама сборка их не хранит,
 * а платформу для замера надо восстановить точно ту же.
 */
function reactorTierOf(a: MechAssembly): number {
  return Number(/R(\d)/.exec(a.chassisCode)?.[1] ?? 3);
}
function frameTierOf(a: MechAssembly): number {
  return Number(/F(\d)/.exec(a.chassisCode)?.[1] ?? 2);
}

// ---------------------------------------------------------------------------
// Прогон
// ---------------------------------------------------------------------------

const techs: readonly ('is' | 'clan')[] = TECH === 'both' ? ['is', 'clan'] : [TECH];
const rng = new Rng(SEED);

const audits: Audit[] = [];
let broken = 0;

for (const tech of techs) {
  for (const band of BANDS) {
    const platforms = CHASSIS_CATALOG_LIST.filter(
      (c) => c.techBase === tech && bandOf(c.tonnage) === band,
    );
    if (platforms.length === 0) continue;
    for (let i = 0; i < COUNT; i++) {
      const p = platforms[rng.int(0, platforms.length - 1)]!;
      const role = EVEN_ROLES ? ASSEMBLY_ROLES[rng.int(0, ASSEMBLY_ROLES.length - 1)]! : undefined;
      try {
        audits.push(
          auditAssembly(
            generateAssembly(role === undefined ? { chassisCode: p.code } : { chassisCode: p.code, role }, rng),
          ),
        );
      } catch {
        broken++;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Печать
// ---------------------------------------------------------------------------

const mean = (xs: readonly number[]): number =>
  xs.length === 0 ? 0 : xs.reduce((s, x) => s + x, 0) / xs.length;
const pct = (x: number): string => `${(x * 100).toFixed(0)} %`;
const f1 = (x: number): string => x.toFixed(1);

console.log(
  `\nАудит вооружения: ${audits.length} сборок, сид ${SEED}, ` +
    `по ${COUNT} на полосу и техбазу${broken > 0 ? `, брак ${broken}` : ''}`,
);
console.log(
  'Полоса — мерка замера, а не правило игры: ядро делит парк на три класса, ' +
    'здесь их четыре (штурмовая полоса выделена от 80 т).\n',
);

for (const tech of techs) {
  const label = tech === 'is' ? 'Сфера' : 'Кланы';
  console.log(`════ ${label} ${'═'.repeat(72)}`);
  console.log(
    'полоса      стволов  ср.ствол  тяж.доля   залп  залп/отвод  устойч.  ' +
      'урон 3/9/16   броня  вхолостую  ячеек  охлаждение т/яч.  плотность',
  );

  for (const band of BANDS) {
    const g = audits.filter((a) => a.tech === tech && a.band === band);
    if (g.length === 0) continue;
    const d3 = mean(g.map((a) => a.damageAt[0]!));
    const d9 = mean(g.map((a) => a.damageAt[1]!));
    const d16 = mean(g.map((a) => a.damageAt[2]!));
    console.log(
      `${band.padEnd(11)} ${f1(mean(g.map((a) => a.guns))).padStart(6)}  ` +
        `${f1(mean(g.map((a) => a.meanGunTons))).padStart(7)} т  ` +
        `${pct(mean(g.map((a) => a.heavyShare))).padStart(6)}  ` +
        `${f1(mean(g.map((a) => a.alpha))).padStart(5)}  ` +
        `×${f1(mean(g.map((a) => a.heatRatio))).padStart(9)}  ` +
        `${pct(mean(g.map((a) => a.sustainShare))).padStart(6)}  ` +
        `${f1(d3).padStart(4)}/${f1(d9).padStart(4)}/${f1(d16).padStart(4)}  ` +
        `${pct(mean(g.map((a) => a.armorFill))).padStart(5)}  ` +
        `${f1(mean(g.map((a) => a.idleTons))).padStart(6)} т  ` +
        `${f1(mean(g.map((a) => a.idleWeaponSlots))).padStart(5)}  ` +
        `${f1(mean(g.map((a) => a.sinkTons))).padStart(9)}/${f1(mean(g.map((a) => a.sinkSlots)))}  ` +
        `надо ${f1(mean(g.map((a) => a.needDensity)))} / есть ${f1(mean(g.map((a) => a.gotDensity)))}`,
    );
  }

  // Частота оружия по полосам — то, ради чего замер и заводился.
  console.log('\n  Оружие на машину (среднее число стволов данного типа):');
  for (const band of BANDS) {
    const g = audits.filter((a) => a.tech === tech && a.band === band);
    if (g.length === 0) continue;
    const freq = new Map<string, number>();
    for (const a of g) for (const id of a.weapons) freq.set(id, (freq.get(id) ?? 0) + 1);
    const line = [...freq.entries()]
      .sort((x, y) => y[1] - x[1])
      .map(([id, n]) => `${WEAPONS.get(id)?.code ?? id} ${(n / g.length).toFixed(2)}`)
      .join('  ');
    console.log(`  ${band.padEnd(11)} ${line}`);
    const missing = [...WEAPONS.values()]
      .filter((w) => w.techBase === tech && !freq.has(w.id))
      .map((w) => w.code);
    if (missing.length > 0) console.log(`  ${''.padEnd(11)} не встретилось: ${missing.join(', ')}`);
  }

  // Оборудование по полосам. Приборы ставятся ПО РОЛИ (разведчик несёт пробник,
  // застрельщик и разведчик — ЭПП), а роль взвешена весом машины, поэтому
  // проверять их надо там же, где и калибр: правка весов ролей способна выдавить
  // приборы из парка целиком, и заметить это по оружию нельзя.
  console.log('\n  Оборудование (доля машин, несущих его):');
  for (const band of BANDS) {
    const g = audits.filter((a) => a.tech === tech && a.band === band);
    if (g.length === 0) continue;
    const eq = new Map<string, number>();
    for (const a of g) for (const c of new Set(a.electronics)) eq.set(c, (eq.get(c) ?? 0) + 1);
    const jump = g.filter((a) => a.jumps).length;
    const line = [...eq.entries()]
      .sort((x, y) => y[1] - x[1])
      .map(([c, k]) => `${c} ${pct(k / g.length)}`)
      .join('  ');
    console.log(
      `  ${band.padEnd(11)} ППД ${pct(jump / g.length).padStart(5)} ` +
        `(в среднем ${f1(mean(g.map((a) => a.jumpCount)))} шт)   ${line || 'приборов нет'}`,
    );
  }

  // Разнообразие: доля самой частой связки. Одинаковый парк — та же болезнь,
  // что и мелкий калибр, только с другой стороны.
  console.log('\n  Разнообразие (доля самой частой связки оружия в полосе):');
  for (const band of BANDS) {
    const g = audits.filter((a) => a.tech === tech && a.band === band);
    if (g.length === 0) continue;
    const sig = new Map<string, number>();
    for (const a of g) {
      const key = [...a.weapons].sort().join('+');
      sig.set(key, (sig.get(key) ?? 0) + 1);
    }
    const top = [...sig.entries()].sort((x, y) => y[1] - x[1])[0]!;
    const codes = top[0]
      .split('+')
      .map((id) => WEAPONS.get(id)?.code ?? id)
      .join(' + ');
    console.log(
      `  ${band.padEnd(11)} ${pct(top[1] / g.length).padStart(5)} — ${codes || '(без оружия)'}`,
    );
  }
  console.log('');
}

// Приговор по каждой проверке.
console.log(`════ Что не сходится ${'═'.repeat(66)}`);
const allFails = new Map<string, number>();
for (const a of audits) for (const f of a.fails) allFails.set(f, (allFails.get(f) ?? 0) + 1);
const clean = audits.filter((a) => a.fails.length === 0).length;
console.log(`Сборок без единого замечания: ${clean} из ${audits.length} (${pct(clean / audits.length)})\n`);

console.log('проверка                        всего   лёгкие  средние  тяжёлые  штурмовые');
for (const [f, n] of [...allFails.entries()].sort((x, y) => y[1] - x[1])) {
  const byBand = BANDS.map((b) => {
    const g = audits.filter((a) => a.band === b);
    const bad = g.filter((a) => a.fails.includes(f)).length;
    return g.length === 0 ? '   —' : pct(bad / g.length).padStart(6);
  });
  console.log(`${f.padEnd(30)} ${pct(n / audits.length).padStart(5)}   ${byBand.join('   ')}`);
}

console.log(`\n════ Каркас: во что уходит недовес ${'═'.repeat(56)}`);
console.log(
  'Лёгкий каркас (F2, F3) весит меньше и забирает ячейки — тонны меняются на\n' +
    'скорость. Проверка модели: недовес обязан расти к F3, а свободные ячейки — падать.\n',
);
console.log('полоса       каркас  сборок  вхолостую  своб.ячеек  ср.ствол   залп');
for (const band of BANDS) {
  for (const ft of [1, 2, 3]) {
    const g = audits.filter((a) => a.band === band && a.frameTier === ft);
    if (g.length === 0) continue;
    console.log(
      `${band.padEnd(12)} F${ft}    ${String(g.length).padStart(5)}  ` +
        `${f1(mean(g.map((a) => a.idleTons))).padStart(7)} т  ` +
        `${f1(mean(g.map((a) => a.idleWeaponSlots))).padStart(9)}  ` +
        `${f1(mean(g.map((a) => a.meanGunTons))).padStart(6)} т  ` +
        `${f1(mean(g.map((a) => a.alpha))).padStart(5)}`,
    );
  }
}

if (WORST > 0) {
  console.log(`\n════ Худшие сборки ${'═'.repeat(68)}`);
  const worst = [...audits].sort((a, b) => b.fails.length - a.fails.length).slice(0, WORST * 2);
  for (const a of worst.slice(0, WORST)) {
    console.log(
      `\n  ${a.code} ${a.role} — ${a.fails.join(', ')}\n` +
        `    ${a.weapons.map((id) => WEAPONS.get(id)?.code ?? id).join(' + ') || '(без оружия)'}\n` +
        `    залп ${a.alpha} (тепло ${a.alphaHeat} / отвод ${a.dissipation} = ×${f1(a.heatRatio)}), ` +
        `устойчиво ${pct(a.sustainShare)}, ср.ствол ${f1(a.meanGunTons)} т, ` +
        `броня ${pct(a.armorFill)}, вхолостую ${f1(a.idleTons)} т и ${a.idleWeaponSlots} яч., ` +
        `плотность надо ${f1(a.needDensity)} / есть ${f1(a.gotDensity)} т на ячейку`,
    );
  }
}

if (BY_ROLE) {
  console.log(`\n════ По ролям ${'═'.repeat(73)}`);
  console.log('роль          сборок  ср.ствол   залп  урон 3/9/16   прыжков  замечаний');
  for (const role of ASSEMBLY_ROLES) {
    const g = audits.filter((a) => a.role === role);
    if (g.length === 0) continue;
    console.log(
      `${role.padEnd(13)} ${String(g.length).padStart(5)}  ` +
        `${f1(mean(g.map((a) => a.meanGunTons))).padStart(6)} т  ` +
        `${f1(mean(g.map((a) => a.alpha))).padStart(5)}  ` +
        `${f1(mean(g.map((a) => a.damageAt[0]!))).padStart(4)}/` +
        `${f1(mean(g.map((a) => a.damageAt[1]!))).padStart(4)}/` +
        `${f1(mean(g.map((a) => a.damageAt[2]!))).padStart(4)}  ` +
        `${pct(g.filter((a) => a.jumps).length / g.length).padStart(7)}  ` +
        `${f1(mean(g.map((a) => a.fails.length))).padStart(6)}`,
    );
  }

  // Абсурд роли и веса: то, ради чего заводится часть C шага 47.
  const scoutHeavy = audits.filter((a) => a.role === 'scout' && a.tonnage >= 80).length;
  const juggLight = audits.filter((a) => a.role === 'juggernaut' && a.tonnage <= 35).length;
  console.log(
    `\n  Штурмовых разведчиков: ${scoutHeavy}, лёгких юггернаутов: ${juggLight} ` +
      `(из ${audits.length} сборок)`,
  );
}

console.log(
  `\nМерка: alphaHeatTarget=${CONSTRUCTION.reactors.alphaHeatTarget}, ` +
    `коридор залп/отвод ×${ALPHA_HEAT_RATIO[0]}…×${ALPHA_HEAT_RATIO[1]}, ` +
    `устойчивый залп ≥${pct(SUSTAIN_MIN)} альфы, броня ≥${pct(ARMOR_FILL_MIN)}, ` +
    `набор сорван при >${IDLE_TONS_MAX} т И >${IDLE_GUN_SLOTS_MAX} ячейках разом, ` +
    `боезапас ≥${VOLLEYS_MIN} залпов.\n`,
);
