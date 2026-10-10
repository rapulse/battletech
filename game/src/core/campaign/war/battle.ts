import { NAMES } from '../../data/index.js';
import { FAST, fastResolve } from '../bridge/fastResolve.js';
import { unitToRecord, type BattleOutcome } from '../bridge/fromBattle.js';
import type { BattleBrief, BattleParticipant } from '../bridge/toBattle.js';
import { buildForce } from '../contracts/opfor.js';
import { forceParts, strengthOf } from '../contracts/power.js';
import { CONTRACTS } from '../contracts/schema.js';
import { factionKind } from '../contracts/relations.js';
import { opforTypeOf, supplyLevel } from '../contracts/supply.js';
import { GALAXY } from '../galaxy/catalog.js';
import type { GalaxyDeltas } from '../galaxy/delta.js';
import { worldProfile } from '../galaxy/profile.js';
import { isPlayerActor } from './actors.js';
import { theaterOf } from './economy.js';
import type { FrontSector, SectorForces } from './front.js';
import { WITHDRAW_RATIO } from '../company/garrison.js';
import { WAR } from './schema.js';

/**
 * Настоящий бой на фронте (шаг 22c).
 *
 * **Что здесь исправлено.** До этого шага исход наступления решала ОДНА СТРОКА:
 * `rng.next() < forces.odds`. Веса считались честно — достаток фракции, военный
 * фонд по направлению, гарнизон мира, разорение, — но дальше кубик заменял
 * собой бой. `war.md` §10 записывал это прямо: «сейчас исход участка решает один
 * бросок против шансов; полноценный расчёт возможен (`fastResolve` в ядре с шага
 * 18), но замера ему нет». Замер теперь есть: полк на полк считается за 27 мс, и
 * причин держать кубик не осталось (решение пользователя 2026-09-04 — «фальши не
 * должно быть нигде, только настоящие бои»).
 *
 * **Чем это НЕ является — вторыми правилами боя.** Состав собирает тот же
 * `contracts/opfor.ts::buildForce`, что и противника на контракт игрока; бой
 * считает тот же `fastResolve`, что и вылет звена; класс исполнения, доктрину и
 * комплектность дают те же таблицы. Отличие ровно одно и оно ЧИСЛО: у армии
 * машин не четыре, а десятки.
 *
 * **Потолок раундов масштабируется, и это не подкрутка.** Сорок раундов из
 * `data/fastresolve.json` откалиброваны шагом 18 под ЗВЕНО. Батальону их не
 * хватает домолотить противника, и бой кончается ничьёй по потолку — замер
 * показал ровно это: 36×36 при сорока раундах даёт ничью, при ста шестидесяти —
 * победу с 36 потерями против 25. Потолок — это «сколько длится столкновение», и
 * полковое сражение длится дольше стычки звена. Он передаётся параметром вызова,
 * поэтому калибровка звена остаётся нетронутой.
 */

const F = WAR.front;

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Сколько машин выводит сторона по своему весу на участке.
 *
 * Веса `sectorForces` — это и есть сила сторон, посчитанная из достатка, фонда,
 * соседства и гарнизона. Здесь они переводятся в машины одним множителем, а не
 * пересчитываются заново: две меры силы на одном участке разошлись бы, и
 * «шанс», который видит игрок в сводке, перестал бы отвечать бою.
 */
export function forceSize(weight: number): number {
  return Math.round(clamp(weight * F.mechsPerWeight, F.forceMin, F.forceMax));
}

/**
 * Сколько машин выводит НАСТУПАЮЩАЯ держава роты (шаг 80): по весу, но не больше, чем стоит на её
 * театре против этого врага, и без пола `forceMin`. Пол заведён для фракций, у которых армия — число,
 * а не машины на месте; у роты он давал восемь «машин», которых нет. Оборона мира роты не режется:
 * она держится ополчением (`militiaBacked`), а ополчение — гарнизон мира, не армия.
 */
export function realmAttackSize(weight: number, theater: number): number {
  return Math.max(0, Math.min(Math.round(Math.min(weight * F.mechsPerWeight, F.forceMax)), Math.floor(theater)));
}

/** Сколько раундов длится столкновение такого размера. */
export function battleRounds(units: number): number {
  const scale = clamp(units / F.roundScaleUnits, 1, F.roundScaleMax);
  return Math.round(FAST.rounds * scale);
}

/**
 * Столкновение звена роты с отрядом противника внутри боя фронта (шаг 86, проект державы §5.1).
 * Бриф и исход — те же, что у авторасчёта контракта: по ним команда списывает урон и пилотов роты.
 */
export interface CompanyClash {
  readonly brief: BattleBrief;
  readonly outcome: BattleOutcome;
  /** Сколько машин противника отделилось против роты. */
  readonly detachment: number;
  /** Сколько из них рота выбила — их нет в главном бою. */
  readonly knocked: number;
}

export interface FrontBattleResult {
  /** Взял ли нападающий мир. */
  readonly won: boolean;
  /**
   * Сколько машин выбито у каждой стороны — из этого читается цена наступления. Машины армии: потери
   * роты — в `company`. У обороны сюда входит и выбитое ротой.
   */
  readonly attackerLost: number;
  readonly defenderLost: number;
  /** Машины армии нападающего — без звена роты. */
  readonly attackerSize: number;
  readonly defenderSize: number;
  /** Столкновение роты; нет поля — рота в бою не была. */
  readonly company?: CompanyClash;
  /**
   * Гарнизон мира роты на стороне обороны (шаг 86b): его столкновение — или отход без боя по политике
   * «отходить» (`withdrew`, тогда `clash` нет). Нет поля — гарнизона в бою не было.
   */
  readonly garrison?: GarrisonClash;
}

/** Гарнизон роты в бою за свой мир (шаг 86b): столкновение или отход. */
export interface GarrisonClash {
  readonly clash?: CompanyClash;
  /** Сила всей стороны нападающего ÷ сила всей обороны (ополчение и гарнизон) — по ней решается отход. */
  readonly ratio: number;
  /** Нападающий вдвое сильнее всей обороны, политика «отходить» — гарнизон ушёл без боя. */
  readonly withdrew: boolean;
  /** Сколько машин нападающий отделил против гарнизона. */
  readonly detachment: number;
}

/** Гарнизон мира на стороне обороны (шаг 86b): годные машины и можно ли отойти по политике. */
export interface GarrisonInput {
  readonly lance: readonly BattleParticipant[];
  /** Политика «отходить» и есть куда (свой мир в прыжке). */
  readonly mayWithdraw: boolean;
}

/** Потолок отряда против роты — потолок поля, верх лестницы масштаба контракта (24 машины, батальон). */
const FIELD_MAX = Math.max(...CONTRACTS.opfor.scales.map((s) => s.units[1]));

/**
 * Пол отряда против роты — равный бой (решение пользователя 2026-10-01): столько первых машин обороны,
 * сколько вместе не сильнее роты, но не меньше одной. Сила — та же мера, что у доли
 * (`forceParts`/`strengthOf`).
 *
 * Первая версия брала пол по лестнице масштаба контракта (против звена из трёх машин — три), и зонд
 * показал цену: машины армии тяжелее машин роты основания, отряд выходил в 1.6–3.9 раза сильнее, и
 * рота выигрывала 3 столкновения из 20, теряя по 1.85 машины (`notes.md` §10zl).
 */
export function detachmentFloor(company: readonly BattleParticipant[], defender: readonly BattleParticipant[]): number {
  const ours = strengthOf(forceParts(company));
  let k = 1;
  while (k < defender.length && strengthOf(forceParts(defender.slice(0, k + 1))) <= ours) k++;
  return Math.min(k, defender.length);
}

/**
 * Сколько машин противник отделяет против роты (шаг 86): его доля, равная доле роты в силе своей
 * стороны, не меньше равного боя (`detachmentFloor`) и не больше потолка поля и всей обороны. Доля —
 * силы `forceParts`/`strengthOf` (огонь и живучесть, пилоты), одной мерой на роту и на армию. Отряд —
 * первые машины обороны, в порядке `buildForce`.
 */
export function detachmentSize(
  company: readonly BattleParticipant[],
  army: readonly BattleParticipant[],
  defender: readonly BattleParticipant[],
): number {
  const ours = strengthOf(forceParts(company));
  const theirs = strengthOf(forceParts(army));
  const share = ours + theirs <= 0 ? 0 : ours / (ours + theirs);
  const want = Math.max(Math.round(share * defender.length), detachmentFloor(company, defender));
  return Math.min(want, FIELD_MAX, defender.length);
}

/** Выбита ли машина в бою: разрушена или пилот не в строю — тем же правилом, что потери врага на работе дома. */
function knockedOut(u: BattleOutcome['units'][number]): boolean {
  return u.unit.destroyed || u.unit.pilot.status !== 'active';
}

/**
 * Разыграть наступление боем.
 *
 * Сид выводится из мира, дня и участка, а не из потока состояния: бой фронта —
 * свойство МИРА на этот такт, и переигрывать его пересчётом нельзя. Поток
 * `camp.war` при этом уже потрачен на выбор участка — тем же порядком, что у
 * биржи: что разыгрывать, решает кампания, а как это выглядит — мир.
 */
export function resolveFrontBattle(
  sector: FrontSector,
  forces: SectorForces,
  war: Parameters<typeof supplyLevel>[0],
  worldSeed: number,
  deltas: GalaxyDeltas,
  day: number,
  /**
   * Метка боя в сиде. `front` — бой такта; приказ армии роты (проект державы, шаг 3) даёт свою,
   * чтобы приказ в день такта на том же участке не повторял бой такта один в один.
   */
  tag = 'front',
  /**
   * Звено роты на стороне нападающего (шаг 86): машины ангара с пилотами. Пусто — бой как прежде,
   * побитово: ни сида, ни состава столкновение не трогает.
   */
  company: readonly BattleParticipant[] = [],
  /**
   * Гарнизон роты на стороне обороны (шаг 86b) — зеркало `company`. Нет — бой как прежде, побитово.
   */
  garrison?: GarrisonInput,
): FrontBattleResult {
  const profile = worldProfile(worldSeed, deltas, sector.system);
  const ruined = deltas[GALAXY.id(sector.system)]?.ruined ?? 0;

  const attackerSize = isPlayerActor(sector.attacker)
    ? realmAttackSize(forces.attack, theaterOf(war, sector.attacker, sector.defender))
    : forceSize(forces.attack);
  const defenderSize = forceSize(forces.defence);

  const seed = battleSeed(worldSeed, sector, day, tag);
  const attackerSupply = supplyLevel(war, sector.attacker, profile, 0);
  const defenderSupply = supplyLevel(war, sector.defender, profile, ruined);

  // Нападающий приходит со своей территории, поэтому разорение ЭТОГО мира его
  // снабжения не касается; обороняющийся живёт тем, что здесь осталось.
  const attacker: BattleParticipant[] = buildForce(
    {
      count: attackerSize,
      factionId: sector.attacker,
      biome: profile.biome,
      opforType: opforTypeOf(sector.attacker, profile.garrison, attackerSupply),
      techBase: factionKind(sector.attacker) === 'clan' ? 'clan' : 'is',
      supply: attackerSupply,
      tonnageCap: F.armyTonnageCap,
      idPrefix: `FA-${seed}`,
      callsign: NAMES.defaults.frontAttackerCallsign,
    },
    seed,
  );
  const defender: BattleParticipant[] = buildForce(
    {
      count: defenderSize,
      factionId: sector.defender,
      biome: profile.biome,
      opforType: opforTypeOf(sector.defender, profile.garrison, defenderSupply),
      techBase: factionKind(sector.defender) === 'clan' ? 'clan' : 'is',
      supply: defenderSupply,
      tonnageCap: F.armyTonnageCap,
      idPrefix: `FD-${seed}`,
      callsign: NAMES.defaults.frontDefenderCallsign,
    },
    (seed ^ 0x5f356495) >>> 0,
  );

  // Нападающий встаёт стороной `player` не из вежливости: `fastResolve` знает
  // ровно две стороны, и какая из них чья — конвенция моста, а не правило боя
  // (`bridge/toBattle.ts`). Здесь «player» читается как «тот, кто наступает».
  const brief: BattleBrief = {
    mapSeed: seed,
    battleSeed: seed,
    map: { biome: profile.biome },
    company: attacker,
    enemy: defender,
    // **Сражение кончается переломом, а не истреблением.** Первая версия 22c
    // отдавала армиям задачу по умолчанию — «вывести противника целиком», — и
    // при высоком потолке раундов стороны молотили друг друга до конца:
    // ПОБЕДИТЕЛЬ при 108×108 терял 71 машину из 108, а полки наёмников
    // перемалывались за полгода. Настоящее сражение кончается тем, что одна
    // сторона перестаёт держать строй.
    //
    // Это НЕ новое правило боя: `cripple` — та же задача шага 19b, которой
    // кончаются рейд и разведка, и считает её тот же `judgeObjective`. Меняется
    // доля, а не механика.
    objective: { kind: 'cripple', share: F.breakShare },
  };

  // СТОЛКНОВЕНИЕ РОТЫ (шаг 86, проект державы §5.1) играется первым: от обороны отделяется отряд по
  // доле роты в силе своей стороны, рота бьётся с ним авторасчётом, и выбитое ею в главный бой не
  // идёт. Уцелевшие машины отряда возвращаются в главный бой такими, какими вышли из столкновения.
  // Сид — свой, от того же мира, дня и участка: столкновение воспроизводимо и не сдвигает главный бой.
  let clash: CompanyClash | undefined;
  let mainDefender: readonly BattleParticipant[] = defender;
  if (company.length > 0 && defender.length > 0) {
    const detachment = detachmentSize(company, attacker, defender);
    const fought = clashWith(company, defender, detachment, battleSeed(worldSeed, sector, day, `${tag}|company`), profile.biome);
    clash = fought.clash;
    mainDefender = fought.rest;
  }
  const knocked = clash?.knocked ?? 0;

  // ГАРНИЗОН РОТЫ (шаг 86b) — то же правило зеркально: отряд нападающего по доле гарнизона в силе
  // обороны, пол — равный бой. Политика «отходить» уводит гарнизон без боя, если вся сторона нападающего
  // вдвое сильнее всей обороны (ополчение и гарнизон): мир так и так не удержать.
  let held: GarrisonClash | undefined;
  let mainAttacker: readonly BattleParticipant[] = attacker;
  if (garrison !== undefined && garrison.lance.length > 0 && attacker.length > 0) {
    const detachment = detachmentSize(garrison.lance, defender, attacker);
    const defenceStrength = strengthOf(forceParts(defender)) + strengthOf(forceParts(garrison.lance));
    const ratio = defenceStrength <= 0 ? Infinity : strengthOf(forceParts(attacker)) / defenceStrength;
    if (garrison.mayWithdraw && ratio >= WITHDRAW_RATIO) {
      held = { withdrew: true, detachment, ratio };
    } else {
      const fought = clashWith(
        garrison.lance,
        attacker,
        detachment,
        battleSeed(worldSeed, sector, day, `${tag}|garrison`),
        profile.biome,
      );
      held = { clash: fought.clash, withdrew: false, detachment, ratio };
      mainAttacker = fought.rest;
    }
  }
  const repelled = held?.clash?.knocked ?? 0;
  const extras = {
    ...(clash === undefined ? {} : { company: clash }),
    ...(held === undefined ? {} : { garrison: held }),
  };

  // Рота выбила всю оборону — главного боя нет, мир берёт армия, если она здесь есть.
  if (mainDefender.length === 0) {
    return { won: attackerSize > 0, attackerLost: 0, defenderLost: knocked, attackerSize, defenderSize, ...extras };
  }
  // Гарнизон выбил всё наступление — главного боя нет, мир удержан.
  if (mainAttacker.length === 0) {
    return { won: false, attackerLost: repelled, defenderLost: 0, attackerSize, defenderSize, ...extras };
  }

  const outcome = fastResolve(
    clash === undefined && held?.clash === undefined
      ? brief
      : { ...brief, company: mainAttacker, enemy: mainDefender },
    {
      ...FAST,
      rounds: battleRounds((held?.clash === undefined ? attackerSize : mainAttacker.length) + mainDefender.length),
    },
  );

  const lost = (side: 'player' | 'opfor'): number =>
    outcome.units.filter((u) => u.side === side && u.unit.destroyed).length;

  return {
    // Ничья по потолку раундов — это НЕ взятие мира: наступление, которое не
    // смогло сломить гарнизон, откатывается. Ровно то же правило, что у роты:
    // поле остаётся за тем, кто на нём стоял.
    won: outcome.winner === 'player',
    attackerLost: repelled + lost('player'),
    defenderLost: knocked + lost('opfor'),
    attackerSize,
    defenderSize,
    ...extras,
  };
}

/**
 * Столкновение звена роты (в приказе — шаг 86, в гарнизоне — шаг 86b) с отрядом из первых `detachment`
 * машин противника. Возвращает разбор и противника для главного боя: уцелевшие отряда — побитыми, следом
 * те, кто в отряд не попал.
 */
function clashWith(
  lance: readonly BattleParticipant[],
  enemy: readonly BattleParticipant[],
  detachment: number,
  seed: number,
  biome: ReturnType<typeof worldProfile>['biome'],
): { readonly clash: CompanyClash; readonly rest: readonly BattleParticipant[] } {
  const cbrief: BattleBrief = {
    mapSeed: seed,
    battleSeed: seed,
    map: { biome },
    company: lance,
    enemy: enemy.slice(0, detachment),
    objective: { kind: 'cripple', share: F.breakShare },
  };
  const cout = fastResolve(cbrief, { ...FAST, rounds: battleRounds(lance.length + detachment) });
  const byId = new Map(cout.units.filter((u) => u.side === 'opfor').map((u) => [u.recordId, u]));
  const survivors: BattleParticipant[] = [];
  for (const p of cbrief.enemy) {
    const u = byId.get(p.record.id);
    if (u === undefined) throw new Error(`В итогах столкновения роты нет машины ${p.record.id}`);
    if (!knockedOut(u)) survivors.push({ record: unitToRecord(u.unit, p.record), pilot: u.unit.pilot });
  }
  return {
    clash: { brief: cbrief, outcome: cout, detachment, knocked: detachment - survivors.length },
    rest: [...survivors, ...enemy.slice(detachment)],
  };
}

/** Сид боя участка. Замешивается id системы, а не индекс, — правилом `galaxy/profile.ts`. */
function battleSeed(worldSeed: number, sector: FrontSector, day: number, tag: string): number {
  let h = (worldSeed >>> 0) ^ 0x3b9aca07;
  const text = `${GALAXY.id(sector.system)}|${sector.attacker}|${sector.defender}|${day}|${tag}`;
  for (let i = 0; i < text.length; i++) {
    h = Math.imul(h ^ text.charCodeAt(i), 0x85ebca6b);
    h ^= h >>> 13;
  }
  h = Math.imul(h ^ (h >>> 16), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}
