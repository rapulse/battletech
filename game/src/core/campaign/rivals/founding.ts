import { Rng } from '../../rng/index.js';
import { foundCompany } from '../company/founding.js';
import { makeCompany, type Company } from '../company/types.js';
import { CONTRACTS } from '../contracts/schema.js';
import { GALAXY } from '../galaxy/catalog.js';
import { systemProfile } from '../galaxy/profile.js';
import { companyRating } from '../contracts/threat.js';
import { makeReputation } from '../reputation/state.js';
import { MRBC_REGISTRY, SECTOR_UNITS, type RegistryRow } from './registry.js';
import { RIVALS, type RegistryUnit, type RivalTier } from './schema.js';
import { NO_RIVALS, type Regiment, type Rival, type RivalsState } from './types.js';

/**
 * Порождение отрядов-соперников (шаг 22, часть A).
 *
 * **Соперники — МЕСТНАЯ конкуренция, и это решение, а не упрощение.** Отрядов
 * наёмников в Сфере тысячи, но моделировать их все незачем: игрок никогда не
 * увидит того, кто работает в двадцати прыжках от него, а восемь тысяч быстрых
 * боёв за кампанию не поместятся ни в какой замер. Поэтому соперники заводятся
 * вокруг стартовой системы роты и остаются наёмниками того же сектора.
 * Оборотная сторона — часть механики, а не её пробел: **от соперников можно
 * улететь**, и рейтинг читается как «в этом секторе тесно» (решение 6).
 *
 * Порождение чистое: сид мира на входе, список отрядов на выходе. Порядок
 * бросков закреплён, как у профиля системы и биржи, — любой новый бросок
 * дописывается В КОНЕЦ.
 */

/** Сид порождения. Замешивается id системы, а не индекс, — тем же правилом, что в `galaxy/profile.ts`. */
function spawnSeed(worldSeed: number, anchorId: string, n: number): number {
  let h = (worldSeed >>> 0) ^ 0x27d4eb2f;
  const text = `${anchorId}|${n}|rivals`;
  for (let i = 0; i < text.length; i++) {
    h = Math.imul(h ^ text.charCodeAt(i), 0x85ebca6b);
    h ^= h >>> 13;
  }
  h = Math.imul(h ^ (h >>> 16), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

function weightedPick<T>(rng: Rng, items: readonly T[], weight: (item: T) => number): T {
  let total = 0;
  for (const item of items) total += Math.max(0, weight(item));
  let roll = rng.next() * total;
  for (const item of items) {
    roll -= Math.max(0, weight(item));
    if (roll <= 0) return item;
  }
  return items[items.length - 1] as T;
}

/**
 * Куда наёмнику имеет смысл сесть: системы в пределах `spawnJumps` от опорной.
 *
 * Вес — число предложений биржи класса рынка (`data/contracts.json` →
 * `board.offersByClass`), то есть ровно то, ради чего наёмники и стоят в
 * системе. Второй меры «где есть работа» здесь не заводится: она бы разошлась
 * с самой биржей.
 */
export function spawnCandidates(anchorId: string, jumps: number): number[] {
  const start = GALAXY.require(anchorId);
  const seen = new Set<number>([start]);
  const out: number[] = [start];
  let frontier: number[] = [start];
  for (let depth = 0; depth < jumps; depth++) {
    const next: number[] = [];
    for (const i of frontier) {
      for (const j of GALAXY.neighbors(i)) {
        if (seen.has(j)) continue;
        seen.add(j);
        next.push(j);
        out.push(j);
      }
    }
    frontier = next;
  }
  return out;
}

function pickSystem(rng: Rng, worldSeed: number, candidates: readonly number[]): string {
  const i = weightedPick(rng, candidates, (n) => {
    const cls = systemProfile(worldSeed, n).marketClass;
    return CONTRACTS.board.offersByClass[cls];
  });
  return GALAXY.id(i);
}

/**
 * Куда сесть отряду, живущему НЕ рядом с игроком.
 *
 * Отряды расселяются по всей Сфере, а не вокруг стартовой системы роты
 * (решение пользователя 2026-09-04). Прежнее расселение по трём прыжкам было
 * подпоркой под замер: оно держало конкуренцию видимой, но означало, что
 * тысяча наёмников Сферы стоит в одном секторе и биржа игрока выгребается
 * подчистую. Замер это и показал: при трёхстах отрядах у роты не оставалось
 * НИ ОДНОГО контракта — `payout_in_mechs` падал в ноль.
 *
 * Место всё равно не равновероятно: вес — число предложений биржи класса рынка,
 * то есть ровно то, ради чего наёмник в системе и стоит. Столица тянет втрое
 * сильнее захолустья, и отряды сами собой густеют там, где работа.
 */
function pickAnywhere(rng: Rng, worldSeed: number): string {
  // Перебирать две тысячи систем на каждый отряд незачем: взвешенный выбор из
  // случайной выборки даёт то же распределение по классам рынка при постоянной
  // цене. Выборка берётся с запасом, чтобы редкие столицы не выпадали вовсе.
  const sample: number[] = [];
  for (let n = 0; n < 48; n++) sample.push(rng.int(0, GALAXY.count - 1));
  return pickSystem(rng, worldSeed, sample);
}

function tierOf(id: string): RivalTier {
  const tier = RIVALS.tiers.find((t) => t.id === id);
  if (tier === undefined) throw new RangeError(`В data/rivals.json нет ступени «${id}»`);
  return tier;
}

/**
 * Кто именно приходит в сектор: имя, герб и ступень.
 *
 * Сперва берутся свободные отряды РОТНОГО масштаба из реестра MRBC — они и есть
 * пул имён сектора, и ступень у каждого записана рядом с именем: «Грубияны
 * Хансена» не могут выйти зелёным звеном, а «Карающие Ангелы» — гвардией.
 * Ступень, разыгранная кубиком, сделала бы таблицу случайной при канонических
 * именах, и это читалось бы хуже, чем выдуманные имена.
 *
 * Когда свободных не осталось (отряды разоряются, на их место приходят новые),
 * в сектор идёт ОТКОМАНДИРОВАНИЕ великого полка — «3-я рота «Гончих Келла»» с
 * его гербом. Это и лор-правда (полки дробятся по контрактам, и рота Гончих —
 * ровно тот соперник, которого рота игрока может встретить), и способ не
 * выдумывать имён под уже нарисованные гербы.
 */
interface UnitIdentity {
  readonly name: string;
  readonly emblem: number;
  readonly tier: RivalTier;
  readonly unitId: string;
  readonly registered: boolean;
}

/**
 * Кто именно приходит: имя, герб, ступень и значится ли отряд в реестре MRBC.
 *
 * Сперва берутся свободные канонические отряды РОТНОГО масштаба — их восемь, и
 * ступень у каждого записана рядом с именем: «Грубияны Хансена» не могут выйти
 * зелёным звеном, а «Карающие Ангелы» — гвардией. Ступень, разыгранная кубиком,
 * сделала бы таблицу случайной при канонических именах.
 *
 * Дальше идут **вольные отряды с номерами** — те самые тысячи, которых в Сфере
 * на порядки больше, чем строк в реестре. Они не значатся в MRBC, герба у них
 * нет (`emblem` = −1), и в таблице игрок увидит их только когда они стоят с ним
 * в одной системе. Живут при этом наравне со всеми: берут работу, дерутся тем
 * же расчётом, разоряются.
 */
function pickUnit(rng: Rng, taken: ReadonlySet<string>, index: number): UnitIdentity {
  const free = SECTOR_UNITS.filter((u) => !taken.has(u.name));
  if (free.length > 0) {
    const unit = rng.pick(free) as RegistryUnit;
    return {
      name: unit.name,
      emblem: unit.emblem,
      tier: tierOf(unit.tier as string),
      unitId: unit.id,
      registered: true,
    };
  }

  // Ступень вольного отряда разыгрывается, в отличие от канонических: имени,
  // с которым она могла бы разойтись, у него нет.
  const tiers = RIVALS.tiers;
  const tier = tiers[rng.int(0, tiers.length - 1)] as RivalTier;
  return {
    name: RIVALS.freeName.replace('{n}', String(index)),
    emblem: -1,
    tier,
    unitId: '',
    registered: false,
  };
}

/**
 * Один отряд.
 *
 * Собирается ТЕМ ЖЕ `foundCompany`, что и рота игрока: ступень из
 * `data/rivals.json` подставляет ему другие потолки тира, выучки и
 * комплектности — и только их. Ни одной строки правил основания, написанной
 * отдельно для соперника, здесь нет и быть не должно.
 */
export function foundRival(
  worldSeed: number,
  anchorId: string,
  index: number,
  taken: ReadonlySet<string>,
): Rival {
  const rng = new Rng(spawnSeed(worldSeed, anchorId, index));
  const unit = pickUnit(rng, taken, index);
  const tier = unit.tier;
  const id = `R${index}`;

  const founded = foundCompany(rng.int(0, 0x7fffffff), {
    weightClasses: tier.weightClasses,
    maxReactorTier: tier.maxReactorTier,
    maxFrameTier: tier.maxFrameTier,
    pilotTierMin: tier.pilotTierMin,
    pilotTierMax: tier.pilotTierMax,
    outfit: {
      armorShare: [tier.armorShare[0], tier.armorShare[1]],
      missingItems: [tier.missingItems[0], tier.missingItems[1]],
    },
    idPrefix: id,
  });

  const company: Company = makeCompany({
    mechs: founded.mechs,
    pilots: founded.pilots,
    cbills: tier.cbills,
    // Герб роты игрока и герб наёмного отряда — разные наборы (`ui/company.jpg`
    // против `ui/mercenaries.jpg`), и хранить их в одном поле нельзя: они
    // ссылаются в разные атласы. Здесь остаётся номер из набора игрока, не
    // используемый показом, а настоящий герб отряда лежит в `Rival.emblem`.
    emblem: 0,
    commander: unit.name,
  });

  return {
    id,
    name: unit.name,
    unitId: unit.unitId,
    emblem: unit.emblem,
    tier: tier.id,
    registered: unit.registered,
    company,
    // `anchorId` пустой — отряд садится где угодно в Сфере; заданный — рядом с
    // ним. Первое нужно стартовому расселению, второе — формированию нового
    // отряда на месте распущенного.
    systemId:
      anchorId === ''
        ? pickAnywhere(rng, worldSeed)
        : pickSystem(rng, worldSeed, spawnCandidates(anchorId, RIVALS.spawnJumps)),
    reputation: makeReputation(),
    contracts: 0,
    wins: 0,
    ratingBefore: companyRating(company).total,
  };
}

/**
 * Великий полк на день основания: канонический состав из реестра.
 *
 * Стоит на своей канонической базе (шаг 82): Гончие Келла — на Арк-Рояле, Горцы — на
 * Нортвинде. До шага 82 все семь основывались в шести прыжках от Аутрича — вокруг
 * мира старта роты, у Марика, — и весь поток подрядов за десять лет уходил Марику. К
 * фронту полк идёт сам (`regiments.ts::regimentTick`); база без работы — мир Драгун,
 * тыл — отпускает его в первую же декаду.
 */
export function foundRegiment(unit: RegistryRow): Regiment {
  const great = RIVALS.registry.find((u) => u.id === unit.id)?.great;
  if (great === undefined) throw new RangeError(`У полка «${unit.id}» нет состава в data/rivals.json`);
  return {
    id: unit.id,
    name: unit.name,
    emblem: unit.emblem,
    cert: unit.cert,
    base: unit.base,
    holdsWorld: unit.holdsWorld,
    fullMechs: great.mechs,
    mechs: great.mechs,
    // Полк начинает при деньгах: он не новичок, за ним годы контрактов.
    cbills: Math.round(great.mechs * RIVALS.regiment.mechCost * 0.2),
    quality: great.quality,
    tons: great.tons,
    skill: great.skill,
    systemId: great.baseSystemId,
    employer: GALAXY.ownerId(GALAXY.require(great.baseSystemId)),
    contracts: 0,
    wins: 0,
    ratingBefore: unit.rating,
  };
}

/**
 * Стартовое население мира наёмников.
 *
 * `companies` отрядов ротного масштаба (первые — канонические из реестра,
 * остальные вольные с номерами) плюс все великие полки. Зовётся из конструктора
 * `CampaignState`, а не командой, — тем же правилом, по которому там же
 * ставится первая зарплата: `execute()` остаётся точкой изменения УЖЕ
 * СУЩЕСТВУЮЩЕГО состояния, а не его инициализации.
 */
export function foundRivals(worldSeed: number, anchorId: string): RivalsState {
  const list: Rival[] = [];
  const taken = new Set<string>();
  for (let n = 1; n <= RIVALS.companies; n++) {
    // Стартовое расселение идёт по ВСЕЙ Сфере, а не вокруг роты: `anchorId`
    // здесь намеренно пуст. Он остаётся у `foundRival` для другого случая —
    // когда новый отряд формируется на месте распущенного.
    const rival = foundRival(worldSeed, '', n, taken);
    taken.add(rival.name);
    list.push(rival);
  }
  void anchorId;
  const regiments = MRBC_REGISTRY.map((u) => foundRegiment(u));
  return { ...NO_RIVALS, list, regiments, nextId: RIVALS.companies + 1 };
}
