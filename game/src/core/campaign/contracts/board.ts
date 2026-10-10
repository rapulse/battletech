import { QUALITY_CLASS_IDS, type QualityClass } from '../../model/QualityClass.js';
import { Rng } from '../../rng/index.js';
import { GALAXY } from '../galaxy/catalog.js';
import { isSurveyed, ownerOf, withDelta, type GalaxyDeltas } from '../galaxy/delta.js';
import { intelBand, intelMissChance, intelOf, roundTons } from './intel.js';
import { worldProfile } from '../galaxy/profile.js';
import {
  advanceFactor,
  gatedEmployer,
  hostileFloor,
  missionAllowed,
  payoutFactor,
  salvageFactor,
} from '../reputation/access.js';
import { NO_REPUTATION, liveEnemiesOf, liveEnmity, standingOf, type ReputationState } from '../reputation/state.js';
import { enemiesOf, enmity as enmityOf, factionKind } from './relations.js';
import { opforTypeOf, supplyCount, supplyLevel, supplyThreat } from './supply.js';
import {
  PLAYER_ACTOR_ID,
  initiativeOf,
  isPlayerActor,
  nextToDomain,
  playerWarOf,
  secessionTarget,
  tensionOf,
  type WarState,
} from '../war/index.js';
import { REFERENCE_MECH_VALUE } from './reference.js';
import { fortressFor, type ContractFortress } from './emplacements.js';
import {
  frontierIndex,
  neighbourFactions,
  pirateRisk,
  clearedOf,
  denBounty,
  denPayers,
  PIRATE_FACTION,
  type HostileNeighbour,
} from './pirates.js';
import { REPUTATION } from '../reputation/schema.js';
import {
  CONTRACTS,
  MISSION_TYPES,
  SCALE_IDS,
  type MissionType,
  type OpforType,
  type ScaleId,
} from './schema.js';

/**
 * Биржа контрактов (шаг 16).
 *
 * **Не хранится.** Выводится из `(worldSeed, systemId, декада)` чистой функцией
 * — ровно тем же приёмом, что ассортимент лавки (`market/stock.ts`) и профиль
 * системы (`galaxy/profile.ts`), и по той же причине: список контрактов,
 * попавший в сохранение, растит снимок с числом посещённых систем, а перезаход
 * на экран становится способом переиграть неудачное предложение (ловушка 1
 * брифинга).
 *
 * В снимок уходит только факт взятия — id контракта и декада, в дельте системы.
 *
 * Броски идут из СВОЕГО ГПСЧ, выведенного из сида мира, а не из потока
 * `camp.contracts` состояния: поток продвигался бы от каждого взгляда на биржу,
 * и одна и та же система выглядела бы по-разному в зависимости от того, сколько
 * раз игрок на неё посмотрел. Поток `camp.contracts` расходуется там, где бросок
 * действительно принадлежит кампании, а не миру, — при сборке состава
 * противника на вылет (`opfor.ts`).
 */

/** Номер декады биржи по дню кампании. Первая декада — 0. */
export function contractDecadeOf(day: number): number {
  return Math.floor(day / CONTRACTS.board.decadeDays);
}

/** Первый день декады: до него список предложений не меняется. */
export function contractDecadeStart(decade: number): number {
  return decade * CONTRACTS.board.decadeDays;
}

/**
 * Сид биржи. Замешивается id системы, а не её индекс в каталоге, — по той же
 * причине, что в `galaxy/profile.ts`: индекс сдвинется при первом пополнении
 * каталога, а id переживает перегенерацию.
 */
/** Свой поток союзного звена (шаг 73b): бросок на него не сдвигает биржу. */
function alliesSeed(worldSeed: number, systemId: string, decade: number): number {
  let h = (worldSeed >>> 0) ^ 0x7f4a7c15;
  const text = `${systemId}|${decade}|allies`;
  for (let i = 0; i < text.length; i++) {
    h = Math.imul(h ^ text.charCodeAt(i), 0x85ebca6b);
    h ^= h >>> 13;
  }
  h = Math.imul(h ^ (h >>> 16), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/**
 * Звено нанимателя для предложения (шаг 73b) или `undefined`.
 *
 * Звено — не больше `allies.maxShare` силы противника по простой оценке: число
 * машин берётся от половины противника вниз, пока доля не уложится. Средняя
 * машина считается так же, как у противника (`opforMechThreat`: тип части ×
 * снабжение × тоннаж), а тоннаж у обоих один, поэтому он сокращается.
 */
export function alliesFor(
  roll: number,
  mission: MissionType,
  employer: string,
  garrison: number,
  employerSupply: number,
  opforType: OpforType,
  supply: number,
  opforUnits: number,
): ContractAllies | undefined {
  if (roll >= CONTRACTS.missions[mission].allyChance) return undefined;
  const type = opforTypeOf(employer, garrison, employerSupply);
  const ours = CONTRACTS.opfor.types[type].threat * supplyThreat(employerSupply);
  const theirs = CONTRACTS.opfor.types[opforType].threat * supplyThreat(supply) * opforUnits;
  if (ours <= 0 || theirs <= 0) return undefined;
  let units = Math.floor(opforUnits * CONTRACTS.allies.maxShare);
  while (units > 0 && (units * ours) / theirs > CONTRACTS.allies.maxShare) units--;
  if (units === 0) return undefined;
  return {
    units,
    opforType: type,
    techBase: factionKind(employer) === 'clan' ? 'clan' : 'is',
    supply: employerSupply,
    share: Math.round(((units * ours) / theirs) * 1000) / 1000,
  };
}

function boardSeed(worldSeed: number, systemId: string, decade: number): number {
  let h = (worldSeed >>> 0) ^ 0x1b873593;
  const text = `${systemId}|${decade}|contracts`;
  for (let i = 0; i < text.length; i++) {
    h = Math.imul(h ^ text.charCodeAt(i), 0x85ebca6b);
    h ^= h >>> 13;
  }
  h = Math.imul(h ^ (h >>> 16), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/**
 * Предложение биржи.
 *
 * **Силы противника описаны здесь абсолютно** (`opforUnits`, `opforTons`,
 * `opforType`, `supply`), а не долей от того, кто на предложение смотрит.
 *
 * До шага 44 они были относительными: число машин считалось от длины
 * выведенного звена, потолок их тоннажа равнялся среднему тоннажу этого же
 * звена. Замысел был честный — «не давать генератору порождать заведомо
 * непроходимые составы» (ловушка 2 брифинга шага 16), — но цена оказалась выше
 * пользы: мир зеркалил роту. Купил тяжёлые машины — противник стал тяжёлым;
 * привёз больше машин — врагов стало больше; за больший бой платили столько же.
 * Рост отменял сам себя, и покупать вместительный корабль было незачем.
 *
 * Ловушка 2 при этом никуда не делась, но закрывается она не зеркалом, а
 * РАЗБРОСОМ и ОТБОРОМ: на бирже одновременно висит и патруль на две машины, и
 * ротная работа, а «брать только то, что вытянешь» — уже готовый механизм
 * (`threat.ts::contractThreat`), которым пользуются и игрок, и соперники, и
 * бот-менеджер замера. Непроходимое предложение — это не поломка, а работа не по
 * зубам, и она обязана быть видна ДО подписи.
 *
 * Состав материализуется на вылете (`opfor.ts::buildOpfor`), но по числам,
 * записанным здесь: предложение есть обещание.
 */
export interface Contract {
  readonly id: string;
  readonly systemId: string;
  /** Наниматель: владелец системы на сегодня (с учётом дельты, шаг 21 её и двигает). */
  readonly employer: string;
  readonly target: string;
  /** Глубина вражды нанимателя и цели, 0..1. Ею открываются типы миссий. */
  readonly enmity: number;
  readonly mission: MissionType;
  readonly opforType: OpforType;
  readonly opforTechBase: 'is' | 'clan';
  /**
   * Снабжение части противника (шаг 21a): экономика фракции цели, помноженная
   * на военпром и разорение этого мира.
   *
   * Лежит НА КОНТРАКТЕ, а не пересчитывается при вылете, по той же причине, что
   * и `strength`: предложение — это обещание, и состав, собранный на вылете,
   * обязан отвечать тому, что игроку показали. Экономика фракции успевает
   * сдвинуться за декаду, пока контракт висит на бирже.
   */
  readonly supply: number;
  /**
   * Напряжённость участка, 0..1 (шаг 21b): сколько сил стороны стянули друг
   * против друга здесь и сейчас.
   *
   * **Из неё берутся И опасность работы, И её цена** — решение 7 записи «Восемь
   * решений по тикеру войны». До этого шага оплата шла от вражды, а опасность от
   * вида фракции цели, и оттого воевать с пиратами было выгоднее и безопаснее
   * РАЗОМ: среди посильных контрактов пиратский платил 149 520 против 127 794 у
   * работы против Дома, которая в полтора раза тяжелее.
   *
   * Ноль означает «войны здесь нет»: пиратский налёт, тихая граница, тыл.
   * Такая работа тоже бывает — но рождает её не фронт, и платят за неё как за
   * полицейскую операцию.
   */
  readonly tension: number;
  /**
   * Напряжённость работы: гарнизон системы и разброс биржи, 0.25..4.
   *
   * ТИП РАБОТЫ СЮДА БОЛЬШЕ НЕ ВХОДИТ (шаг 56). Он входил до шага 44, когда
   * `strength` правила ЧИСЛО машин противника; после того как число стало
   * свойством предложения, тип остался множить одну лишь цену — вторым
   * множителем поверх `payFactor`, за который игрок ничего не получал. Теперь
   * тип работы правит цену ровно одной ручкой (`missions[].payFactor`), а здесь
   * осталось то, что и называется напряжённостью работы: насколько силён
   * гарнизон мира и как легла биржа.
   *
   * Читаемую до боя опасность (`threat.ts::contractThreat`) это поле не правит
   * и не правило с шага 44: опасность считается по составу.
   */
  readonly strength: number;
  /**
   * Сколько машин выставит противник (шаг 44, план Б).
   *
   * **Свойство ПРЕДЛОЖЕНИЯ, а не смотрящего.** До этого шага число считалось от
   * длины выведенного звена, и мир зеркалил роту: привёз больше машин — врагов
   * стало больше, и вырасти было некуда. Теперь работа описана до того, как её
   * кто-нибудь возьмёт, — по тому же правилу, по которому на контракте уже
   * записаны `supply`, `opforType` и `payout`: предложение есть обещание.
   */
  readonly opforUnits: number;
  /**
   * Потолок тоннажа машин противника (шаг 44, план Б).
   *
   * Вторая половина той же правки: раньше он равнялся среднему тоннажу звена, и
   * стартовая тройка не могла встретить ничего тяжелее себя. Теперь вес идёт от
   * типа части и гарнизона мира — и тяжёлая работа существует на бирже до того,
   * как рота до неё дорастёт.
   */
  readonly opforTons: number;
  /**
   * ДОСТОВЕРНОСТЬ РАЗВЕДДАННЫХ, 0..1 (шаг 57): насколько `opforUnits` и
   * `opforTons` — правда.
   *
   * Объявленный состав это СВОДКА НАНИМАТЕЛЯ, а не то, что обязательно выйдет
   * на поле. Единица — данные точны; 0.3 — «примерно двойка, примерно
   * средние». Сам разброс разыгрывается на вылете (`opfor.ts::actualForce`) по
   * этому числу и сиду вылета, а цена и читаемая опасность считаются по
   * объявленным числам: платят за работу, а не за сюрприз.
   */
  readonly intel: number;
  /** Ступень масштаба, которой разыграна эта работа. Для экрана и для замера. */
  readonly scale: ScaleId;
  /**
   * Что стоит на кону (шаг 44e).
   *
   * `none` — обычная работа: платят, дают трофеи, двигают репутацию.
   * `sector` — работа, чей исход двигает ФЛАГ ПЛАНЕТЫ. Такой признак получает
   * только крупная работа на горячем участке: рота и выше, наступление или
   * оборона, напряжённость не ниже порога из данных.
   *
   * Признак лежит на предложении, а не выводится при разборе, по общему правилу
   * биржи: игроку сказали, что стоит на кону, ДО подписи. Такая работа —
   * «только на поле» (шаг 74, `fieldOnly`).
   */
  readonly stakes: ContractStakes;
  /** Биом планеты: карта боя строится по нему (брифинг, п. 3). */
  readonly biome: string;
  readonly payout: number;
  readonly advance: number;
  readonly penalty: number;
  readonly salvageShare: number;
  readonly durationDays: number;
  /** День, до которого предложение висит на бирже (конец декады). */
  readonly offerUntil: number;
  /**
   * Искупительный контракт (2026-09-14): враждебный наниматель предлагает работу
   * против пиратов без оплаты, аванса и трофеев, а платит отношением
   * (`reputation/accrual.ts::atonementGain`). У обычных контрактов поля нет вовсе.
   */
  readonly atonement?: true;
  /**
   * Подавить восстание (шаг 85): работа на восставшем мире роты против ополчения прежнего владельца.
   * Без гонорара; победа поднимает лояльность мира и кончает восстание (`war/loyalty.ts`).
   */
  readonly revolt?: true;
  /**
   * Пираты у дома (шаг 89): оборона мира роты против вольницы после прорвавшегося набега. Без гонорара; победа
   * вычищает мир (`pirates.ts::withPirateClearing`) и снимает работу.
   */
  readonly homeRaid?: true;
  /**
   * Работа державы на мире врага (шаг 90): на пограничном мире фракции, с которой у державы запись войны, — работа
   * роты против владельца. Без гонорара, трофеи обычные; победа идёт в счёт войны и в право флага на этот мир
   * (`SystemDelta.realmWon`).
   */
  readonly warWork?: true;
  /**
   * Союзное звено нанимателя (шаг 73b). Нет поля — рота работает одна, как у
   * всех контрактов до шага. Гонорар, аванс, неустойка и доля трофеев в этом
   * контракте уже уменьшены на долю союзников — карточка показывает их как есть.
   */
  readonly allies?: ContractAllies;
  /**
   * Укрепление (шаг 73d): объекты-цели и бункеры. Нет поля — поле без
   * укреплений, задача боя — обычная задача типа работы. Гонорар в таком
   * контракте уже с надбавкой `fortified.payFactor` и, как у всякой работы
   * «только на поле», `fieldOnly.payBonus` (шаг 74).
   */
  readonly fortified?: ContractFortress;
}

/**
 * Звено нанимателя по предложению (шаг 73b): сколько машин и какой части.
 *
 * Полоса тоннажа — та же, что у противника (`opforTons`): звено набирается на
 * тот же участок и под ту же работу. Тип части, техбаза и снабжение — свои,
 * нанимателя. `share` — доля силы звена от силы противника по простой оценке
 * (`threat.ts`), не выше `allies.maxShare`; ею уменьшены деньги контракта.
 */
export interface ContractAllies {
  readonly units: number;
  readonly opforType: OpforType;
  readonly techBase: 'is' | 'clan';
  readonly supply: number;
  readonly share: number;
}

/** Что стоит на кону: обычная работа или судьба сектора (шаг 44e). */
export type ContractStakes = 'none' | 'sector';

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Вес типа миссии при такой инициативе на участке (шаг 21b).
 *
 * `posture` типа — +1 наступление, −1 оборона, 0 разведка (`data/contracts.json`).
 * Инициатива 0.5 — равновесие: веса всех типов равны единице, и выбор
 * возвращается ровно к тому равновероятному, каким он был до шага 21b. Дальше
 * сторона, стянувшая больше, чаще нанимает на наступление, а та, что слабее, —
 * на оборону.
 *
 * Не ноль внизу: даже давящая сторона иногда нанимает гарнизон, и обнулённый
 * вес превратил бы биржу горячего участка в один тип работы.
 */
function postureWeight(mission: MissionType, initiative: number): number {
  const posture = CONTRACTS.missions[mission].posture;
  if (posture === 0) return 1;
  return Math.max(0.1, 1 + posture * CONTRACTS.board.posturePull * (2 * initiative - 1));
}


/** Взвешенный выбор по списку с весами. Порядок берётся из данных, а не из объекта. */
function weightedPick<T>(rng: Rng, items: readonly T[], weight: (item: T) => number): T {
  let total = 0;
  for (const it of items) total += weight(it);
  if (total <= 0) return items[items.length - 1] as T;
  let roll = rng.next() * total;
  for (const it of items) {
    roll -= weight(it);
    if (roll <= 0) return it;
  }
  return items[items.length - 1] as T;
}

/** Типы миссий, которые открывает такая глубина вражды. Всегда хотя бы гарнизонная (проверено при загрузке). */
export function missionsAt(enmity: number): readonly MissionType[] {
  return MISSION_TYPES.filter((m) => enmity >= CONTRACTS.missions[m].enmityMin);
}

/**
 * Глубина вражды, которую видит биржа СЕГОДНЯ, — статичная плюс напряжённость
 * участка (шаг 21b).
 *
 * Это и есть то место, где контракты перестают выводиться из статичной таблицы
 * (`wiki/design/campaign/contracts.md`, «Вражда»). Таблица `relations.json`
 * описывает, кто с кем в состоянии войны В ПРИНЦИПЕ; напряжённость описывает,
 * что на этом участке происходит на этой декаде. Штурм открывается с 0.75, а
 * вражда Домов между собой 0.74–0.95 — то есть ровно на границе: пока фронт
 * стоял, штурмов на бирже было 0.1 % от всех предложений по карте, и это главное
 * число, ради которого шаг делается.
 *
 * Пиратов это не двигает: у вольницы напряжённость нулевая по построению, и
 * штурм их логова не откроется никогда, сколько бы Дома вокруг ни воевали.
 *
 * **Называлась `liveEnmity` до шага 26 и переименована им.** Слово «живая
 * вражда» шаг 26 занял под другое и более важное: вражду, прочитанную из
 * МАТРИЦЫ отношений вместо статичной таблицы 3053 года
 * (`reputation/state.ts::liveEnmity`). Здесь же речь о вражде, ПОДОГРЕТОЙ
 * напряжённостью участка на эту декаду, — величина биржи, а не мира. Два разных
 * понятия под одним именем однажды разошлись бы молча.
 */
export function heatedEnmity(enmity: number, tension: number): number {
  return clamp(enmity + tension * CONTRACTS.board.tensionEnmity, 0, 1);
}

/**
 * Сколько предложений держит система за декаду.
 *
 * Класс рынка — та же шкала благополучия, что у лавки. Станция HPG добавляет
 * больше всего: это свежая биржа MRBC вместо местных слухов
 * (`wiki/design/campaign/planets.md` §4).
 */
function offerCount(i: number, marketClass: keyof typeof CONTRACTS.board.offersByClass): number {
  return (
    CONTRACTS.board.offersByClass[marketClass] +
    (GALAXY.hasFlag(i, 'hpg') ? CONTRACTS.board.hpgBonus : 0) +
    (GALAXY.hasFlag(i, 'blackMarket') ? CONTRACTS.board.blackMarketBonus : 0)
  );
}

/** Ступень лестницы масштаба по имени. Порядок и полнота списка проверены схемой. */
function scaleStep(id: ScaleId): (typeof CONTRACTS.opfor.scales)[number] {
  const step = CONTRACTS.opfor.scales.find((s) => s.id === id);
  if (step === undefined) throw new RangeError(`Ступень масштаба не описана в данных: ${id}`);
  return step;
}

/**
 * Масштаб работы: сколько машин выставит противник (шаг 44, план Б).
 *
 * **Разыгрывается от МИРА, а не от роты.** Вес ступени складывается из трёх
 * слагаемых данных: постоянного, за гарнизон системы и за напряжённость участка
 * (`contracts.json → opfor.scales`). Ступени ниже своего `garrisonMin` не
 * существует вовсе: усиливать некого там, где гарнизона нет.
 *
 * Тип работы ставит потолок (`missions.*.maxScale`): разведка боем кончается
 * копьём, рейд — усиленным отрядом, батальон бывает только обороной ключевого
 * мира или штурмом.
 *
 * Снабжение остаётся ровно тем, чем было до шага: бедная фракция берёт ЧИСЛОМ
 * (`supply.ts::supplyCount`), богатая — качеством. Оно и было единственным, что
 * в старой формуле численности не зависело от игрока.
 */
function drawScale(rng: Rng, mission: MissionType, garrison: number, tension: number): ScaleId {
  const row = CONTRACTS.missions[mission];
  const ceiling = SCALE_IDS.indexOf(row.maxScale);
  // Пол масштаба (шаг 56): штурм и оборона ключевой системы не бывают работой
  // против одной машины. Патрульная ступень весит на лестнице больше всех, и
  // без этой границы самый дорогой тип работы выпадал патрулём в каждом шестом
  // предложении.
  const floor = row.minScale === undefined ? 0 : SCALE_IDS.indexOf(row.minScale);
  const ids: ScaleId[] = [];
  const weights: number[] = [];
  let total = 0;
  for (let i = floor; i <= ceiling; i++) {
    const step = scaleStep(SCALE_IDS[i] as ScaleId);
    if (garrison < step.garrisonMin) continue;
    const w = step.base + step.perGarrison * garrison + step.perTension * tension;
    if (w <= 0) continue;
    ids.push(step.id);
    weights.push(w);
    total += w;
  }
  if (ids.length === 0) return (row.minScale ?? 'patrol') as ScaleId;
  let roll = rng.next() * total;
  for (let i = 0; i < ids.length; i++) {
    roll -= weights[i] as number;
    if (roll <= 0) return ids[i] as ScaleId;
  }
  return ids[ids.length - 1] as ScaleId;
}

/**
 * Какого масштаба работа ВООБЩЕ бывает на таком мире (шаг 44c).
 *
 * Верхняя ступень лестницы, у которой при таком гарнизоне и такой
 * напряжённости ненулевой вес. Нужна звёздной карте: масштаб — свойство мира, и
 * игрок обязан понимать, куда лететь за крупной работой, ДО перелёта. Иначе
 * ротную работу пришлось бы искать перебором двух тысяч систем.
 *
 * Это ОБЕЩАНИЕ МИРА, а не содержимое биржи: на конкретной декаде в конкретной
 * системе крупного предложения может не оказаться. Биржа по-прежнему выводится
 * только на месте — карта отвечает «здесь такое бывает», а не «здесь такое
 * лежит».
 */
export function scaleOutlook(garrison: number, tension: number): ScaleId {
  let best: ScaleId = 'patrol';
  for (const id of SCALE_IDS) {
    const step = scaleStep(id);
    if (garrison < step.garrisonMin) continue;
    if (step.base + step.perGarrison * garrison + step.perTension * tension <= 0) continue;
    best = id;
  }
  return best;
}

/** Число машин противника на этой ступени: полоса ступени, поправленная снабжением. */
/**
 * Сколько машин выставит противник.
 *
 * **Долевая задача требует минимум ДВУХ машин (шаг 56).** «Вывести из строя
 * 50 % машин противника и уйти» против одной машины — это разгром с другой
 * подписью, и такой была треть долевых предложений биржи (33 из 134 в смотре).
 * Нижняя граница стоит ЗДЕСЬ, до расчёта оплаты, а не в правиле задачи: цена
 * считается от того, что записано в предложении, и подпирать число машин после
 * неё значило бы платить за патруль, а выводить на поле двойку.
 */
function drawUnits(rng: Rng, scale: ScaleId, supply: number, mission: MissionType): number {
  const [lo, hi] = scaleStep(scale).units;
  const drawn = lo + Math.round(rng.next() * (hi - lo));
  const floor = CONTRACTS.missions[mission].objective.kind === 'cripple' ? 2 : 1;
  return clamp(Math.round(drawn * supplyCount(supply)), floor, CONTRACTS.opfor.maxUnits);
}

/**
 * Потолок тоннажа машин противника: тип части плюс надбавка за гарнизон.
 *
 * Тип части уже собрал в себе и вид фракции, и силу гарнизона, и снабжение
 * (`supply.ts::opforTypeOf`) — вес идёт за ним, а не заводит вторую лестницу.
 */
function drawTons(rng: Rng, opforType: OpforType, garrison: number): number {
  const t = CONTRACTS.opfor.tons;
  const [lo, hi] = t.byType[opforType];
  const drawn = (lo + rng.next() * (hi - lo)) * (1 + t.perGarrison * garrison);
  // КРАТНО ПЯТИ (шаг 57, решение пользователя). Тоннаж машины в BattleTech
  // всегда кратен пяти, и «до 54 т» в условиях работы читалось как опечатка:
  // такой машины не бывает. Округление стоит здесь, у самого броска, чтобы
  // объявленный потолок и фактический (`opfor.ts::actualForce`) мерились одной
  // шкалой.
  return roundTons(clamp(drawn, 20, 100));
}


/**
 * Решает ли исход этой работы судьбу сектора (шаг 44e).
 *
 * Три условия, и все три — из данных (`opfor.sector`): масштаб не ниже ротного,
 * тип работы наступательный или оборонительный, участок горячий. Ни одно из них
 * не про игрока: как и весь шаг 44, ставка — свойство работы, а не того, кто за
 * неё взялся.
 *
 * Броска здесь нет намеренно. Редкость такой работы обеспечена редкостью самой
 * ступени (ротная — полпроцента биржи, батальонная — две десятых), и лишний
 * бросок поверх этого только размыл бы обещание: «на этом участке решается
 * судьба мира» должно следовать из того, ЧТО за работа, а не из монетки.
 */
function stakesOf(scale: ScaleId, mission: MissionType, tension: number): ContractStakes {
  const rules = CONTRACTS.opfor.sector;
  if (SCALE_IDS.indexOf(scale) < SCALE_IDS.indexOf(rules.minScale)) return 'none';
  if (!(rules.missions as readonly MissionType[]).includes(mission)) return 'none';
  return tension >= rules.minTension ? 'sector' : 'none';
}

/**
 * Работа «только на поле» (шаг 74): укреплённая или решающая судьбу сектора.
 *
 * Такую работу игрок отыгрывает на карте — авто-расчёт штабом для неё закрыт
 * (`commands/execute.ts::executeDeploy`), а гонорар выше на
 * `fieldOnly.payBonus`. Признак ВЫВОДИТСЯ из полей контракта, а не хранится:
 * сохранения не меняются, и разойтись с условиями он не может. Случайной доли
 * нет намеренно — игрок видит, почему именно эта работа.
 */
export function fieldOnly(contract: {
  readonly fortified?: ContractFortress | undefined;
  readonly stakes: ContractStakes;
}): boolean {
  return contract.fortified !== undefined || contract.stakes === 'sector';
}

/**
 * Оплата контракта — В ЕДИНИЦАХ ЭТАЛОННОЙ МАШИНЫ, а не абсолютным числом.
 *
 * Это и есть главное решение шага 16, записанное во входе брифинга: цена
 * контракта считается от `mechValue`, а не подбирается так, чтобы сойтись с
 * ценами ремонта. Множители по порядку: доля эталона за средний контракт → тип
 * миссии → фактическая сила противника → ОПАСНОСТЬ ПРОТИВНИКА (шаг 21b) →
 * НАПРЯЖЁННОСТЬ УЧАСТКА (шаг 21b) → гарнизон системы → благополучие рынка →
 * разброс от сида биржи.
 *
 * **Два последних множителя чинят решение 7** — то, что нашёл замер шага 20:
 * оплата шла от вражды, а опасность от вида фракции цели, и между собой они не
 * были связаны никак. Пиратское ополчение (угроза 0.70) платило столько же,
 * сколько гвардия Дома (1.35), — то есть «пираты выгоднее и безопаснее разом», и
 * бот, берущий самый денежный из посильных, был просто прав. Теперь опасность
 * считается ТОЙ ЖЕ формулой, которой её читает бот и игрок
 * (`threat.ts::contractThreat`): тип части × снабжение × количество. Заплатка
 * множителем по типу отряда была отвергнута прямо — она перебалансировала бы
 * экономику дважды подряд.
 */
function dangerFactor(opforType: OpforType, supply: number): number {
  const p = CONTRACTS.payout;
  // Численная надбавка за бедность (`supplyCount`) отсюда УБРАНА шагом 44:
  // с этого шага число машин записано в предложении и оплачивается отдельным
  // множителем `forceFactor`, а бедность фракции уже учтена внутри него —
  // разыгранное число прошло через тот же `supplyCount`. Оставить обе значило бы
  // платить за одно и то же дважды.
  const raw = (CONTRACTS.opfor.types[opforType].threat / p.opforReference) * supplyThreat(supply);
  return Math.pow(Math.max(raw, 0.01), p.dangerWeight);
}

/**
 * Множитель оплаты за РАЗМЕР работы (шаг 44, план Б).
 *
 * До этого шага размер боя в цену не входил вовсе: гонорар считался от типа
 * работы, опасности части, напряжённости участка и класса рынка. Пока противник
 * был долей от звена, разброс размеров укладывался в полторы машины, и это
 * сходилось. С абсолютными контрактами на бирже висит и патруль на две машины, и
 * ротная работа на двенадцать — за ту же цену это было бы не «выбор», а ловушка.
 *
 * Мера силы — МАШИНО-ТОННЫ: число машин на среднюю машину состава. Нормируется
 * на `forceReference` — замеренную медиану биржи, — поэтому средняя работа стоит
 * ровно столько, сколько стоила до шага, и вся прежняя калибровка экономики
 * остаётся в силе. Крупная становится дороже, мелкая — дешевле, и обе по одной
 * формуле.
 */
function forceFactor(units: number, tonsCap: number): number {
  const p = CONTRACTS.payout;
  const avgTons = tonsCap * (1 + CONTRACTS.opfor.tons.floor) / 2;
  return Math.pow((units * avgTons) / p.forceReference, p.forceWeight);
}

function payoutOf(
  mission: MissionType,
  strength: number,
  danger: number,
  force: number,
  tension: number,
  garrison: number,
  marketClass: keyof typeof CONTRACTS.payout.byMarketClass,
  rng: Rng,
): number {
  const p = CONTRACTS.payout;
  const spread = 1 + (rng.next() * 2 - 1) * p.spread;
  return Math.round(
    REFERENCE_MECH_VALUE *
      p.referenceShare *
      CONTRACTS.missions[mission].payFactor *
      Math.pow(strength, p.strengthWeight) *
      danger *
      force *
      (1 + p.tensionBonus * tension) *
      (1 + p.garrisonBonus * garrison) *
      p.byMarketClass[marketClass] *
      spread,
  );
}

/**
 * Список контрактов, предлагаемых в системе на этот день.
 *
 * Чистая функция от `(сид мира, дельты, система, день, репутация)` — четвёртый
 * вход брифинга шага 16 приехал шагом 20 и стоит здесь целиком.
 *
 * **Репутация фильтрует и умножает, но НЕ БРОСАЕТ.** Все броски идут ровно в
 * том же порядке и от того же сида, что и до шага 20, а отношение с
 * известностью только вычёркивают готовые предложения и правят их числа. Иначе
 * состав биржи менялся бы от каждого закрытого контракта, и «взял работу — и
 * весь список стал другим» читалось бы как поломка генератора, а не как
 * последствие выбора.
 *
 * Порядок бросков зафиксирован: любой новый бросок дописывается В КОНЕЦ тела
 * цикла, иначе вся биржа всех систем на старых сохранениях станет другой при
 * неизменных данных. То же правило, что у `systemProfile` и `marketStock`.
 */
export function contractBoard(
  worldSeed: number,
  deltas: GalaxyDeltas,
  systemId: string,
  day: number,
  rep?: ReputationState,
  war?: WarState,
): readonly Contract[] {
  const out: Contract[] = [];
  for (const offer of buildOffers(worldSeed, deltas, systemId, day, rep, war)) {
    if (offer.allowed) out.push(offer.contract);
  }
  return out;
}

/**
 * Одно предложение и приговор порога по нему.
 *
 * Вычеркнутые предложения доходят до вызывающего, а не пропадают внутри цикла,
 * и это не мелочь: «сколько работы этот наниматель отряду НЕ даёт» — прямой
 * индикатор тупика, ради которого в замер и заведён столбец
 * `offers_blocked_share`. Считать его разностью двух вызовов нельзя: вызов без
 * репутации — это не «биржа без порога», а биржа отряда с нулевой репутацией,
 * то есть тот же порог, только по нулям. Ровно на этом первый замер шага 20
 * показал ноль закрытых предложений там, где порог прятал пятую часть списка.
 */
export interface JudgedOffer {
  readonly contract: Contract;
  readonly allowed: boolean;
  /** Закрыто войной, а не порогом: наниматель воюет с державой роты (шаг 79). */
  readonly employerAtWar?: true;
}

/**
 * ВРАГ НЕ НАНИМАЕТ РОТУ (шаг 79). Наниматель, у которого запись войны с державой роты, работы ей не
 * даёт — ни обычной, ни награды за логово, ни искупления: мир с ним — через дипломатию, а не через
 * работу. Проба: Курита, воюя с державой, предлагала роте гарнизон на своём мире. Броски предложения
 * при этом идут как прежде — вычеркнуть строку и не бросить за неё кубики значило бы переставить
 * остаток биржи.
 */
function employerAtWar(war: WarState | undefined, employer: string): boolean {
  return war !== undefined && playerWarOf(war, employer) !== undefined;
}

/**
 * Биржа вместе с приговором порога по каждому предложению.
 *
 * Нужна замеру шага 21b: «доля штурмов» — свойство МИРА, а «доля штурмов,
 * доступных этой роте» — свойство её репутации, и это два разных числа. До
 * шага 21b их было не различить: наружу выходил только отфильтрованный список,
 * и мир, начавший порождать тяжёлую работу, читался бы как не начавший, пока
 * рота не набрала известности.
 */
export function judgedContracts(
  worldSeed: number,
  deltas: GalaxyDeltas,
  systemId: string,
  day: number,
  rep?: ReputationState,
  war?: WarState,
): readonly JudgedOffer[] {
  return buildOffers(worldSeed, deltas, systemId, day, rep, war);
}

function buildOffers(
  worldSeed: number,
  deltas: GalaxyDeltas,
  systemId: string,
  day: number,
  rep?: ReputationState,
  war?: WarState,
): readonly JudgedOffer[] {
  const regular = regularOffers(worldSeed, deltas, systemId, day, rep, war);
  const atonement = atonementOffers(worldSeed, deltas, systemId, day, rep, war);
  const bounty = bountyOffers(worldSeed, deltas, systemId, day, rep, war);
  const revolt = revoltOffers(worldSeed, deltas, systemId, day, rep, war);
  const raid = homeRaidOffers(worldSeed, deltas, systemId, day, rep, war);
  const warWork = warWorkOffers(worldSeed, deltas, systemId, day, rep, war);
  return atonement.length === 0 && bounty.length === 0 && revolt.length === 0 && raid.length === 0 && warWork.length === 0
    ? regular
    : [...regular, ...atonement, ...bounty, ...revolt, ...raid, ...warWork];
}

/** Сид награды за логово: свой, чтобы не сдвинуть ни одного броска обычной биржи и искупления. */
function bountySeed(worldSeed: number, systemId: string, decade: number): number {
  let h = (worldSeed >>> 0) ^ 0x3c6ef372;
  const text = `${systemId}|${decade}|bounty`;
  for (let i = 0; i < text.length; i++) {
    h = Math.imul(h ^ text.charCodeAt(i), 0x85ebca6b);
    h ^= h >>> 13;
  }
  h = Math.imul(h ^ (h >>> 16), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/**
 * НАГРАДА ЗА ЛОГОВО (шаг 72f, решение пользователя 2026-09-23).
 *
 * Биржу системы держит её владелец, и на мире вольницы это сама вольница:
 * работы ПРОТИВ неё там не было вовсе. Логово нельзя было вычистить, а
 * пиратский мир — захватить (условие захвата — вычищенность, шаг 38).
 *
 * Теперь на таком мире работу против вольницы выставляет СОСЕДНЯЯ держава —
 * та, чьи миры вольница грабит: наниматель тянется из соседей в пределах
 * `enemyRangeJumps` весом их близости. Держава роты и сама вольница
 * нанимателями не бывают. Платят как за обычную работу, с отношением к
 * нанимателю и порогом доступа.
 *
 * Каждое предложение ВЫЖИВАЕТ с вероятностью (1 − вычищенность): чем чище
 * логово, тем меньше за него платят, и досуха вычищенный мир награды не даёт.
 *
 * Разыгрывается СВОИМ ГПСЧ и дописывается В КОНЕЦ списка — тем же приёмом, что
 * искупление: ни один бросок обычной биржи не сдвигается.
 */
function bountyOffers(
  worldSeed: number,
  deltas: GalaxyDeltas,
  systemId: string,
  day: number,
  rep?: ReputationState,
  war?: WarState,
): readonly JudgedOffer[] {
  const count = CONTRACTS.pirates.bountyOffers;
  const i = GALAXY.require(systemId);
  const payers = denPayers(deltas, i);
  if (payers.length === 0) return [];

  const profile = worldProfile(worldSeed, deltas, i);
  const ruined = deltas[systemId]?.ruined ?? 0;
  const garrison = profile.garrison * clamp(1 - clamp(ruined, 0, 1), 0, 1);
  const decade = contractDecadeOf(day);
  const rng = new Rng(bountySeed(worldSeed, systemId, decade));
  const offerUntil = contractDecadeStart(decade + 1) - 1;
  const alive = denBounty(deltas, i);
  const supply = war === undefined ? 1 : supplyLevel(war, PIRATE_FACTION, profile, ruined);
  const opforType = opforTypeOf(PIRATE_FACTION, garrison, supply);
  const fame = rep?.fame ?? 0;
  const reliability = rep?.reliability ?? REPUTATION.axes.reliabilityStart;
  const o = CONTRACTS.opfor;

  const out: JudgedOffer[] = [];
  for (let n = 0; n < count; n++) {
    const payer = weightedPick(rng, payers, (p) => p.proximity);
    const employer = payer.id;
    const standing = rep === undefined ? 0 : standingOf(rep, employer);
    const enmity = enmityOf(employer, PIRATE_FACTION);
    const open = missionsAt(enmity);
    const missions: readonly MissionType[] = open.length > 0 ? open : ['garrison'];
    const mission = missions[Math.floor(rng.next() * missions.length)] as MissionType;
    const row = CONTRACTS.missions[mission];
    const spread = 1 + (rng.next() * 2 - 1) * o.strengthSpread;
    const strength = clamp((1 + garrison * o.garrisonWeight) * spread, 0.25, 4);
    const scale = drawScale(rng, mission, garrison, 0);
    const opforUnits = drawUnits(rng, scale, supply, mission);
    const opforTons = drawTons(rng, opforType, garrison);
    const base = payoutOf(
      mission,
      strength,
      dangerFactor(opforType, supply),
      forceFactor(opforUnits, opforTons),
      0,
      garrison,
      profile.marketClass,
      rng,
    );
    // Выживание — последним броском тела, как у пиратской работы обычной биржи.
    if (rng.next() >= alive) continue;
    // Враждебный наниматель не платит вовсе: с ним разговор — искупление на его бирже.
    if (rep !== undefined && standing < hostileFloor()) continue;

    const payout = Math.round(base * payoutFactor(standing));
    const atWar = employerAtWar(war, employer);
    out.push({
      allowed: !atWar && missionAllowed(mission, employer, standing, fame),
      ...(atWar ? { employerAtWar: true as const } : {}),
      contract: {
        id: `B${decade}-${n}`,
        systemId,
        employer,
        target: PIRATE_FACTION,
        enmity,
        mission,
        opforType,
        supply,
        tension: 0,
        opforTechBase: 'is',
        strength: Math.round(strength * 1000) / 1000,
        opforUnits,
        opforTons,
        intel: intelOf({
          mission,
          target: PIRATE_FACTION,
          tension: 0,
          standing,
          hpg: GALAXY.hasFlag(i, 'hpg'),
          surveyed: isSurveyed(deltas, systemId),
        }),
        scale,
        // Судьбу сектора награда не решает: мир вольницы наниматель не занимает.
        stakes: 'none',
        biome: profile.biome,
        payout,
        advance: Math.round(payout * row.advanceShare * advanceFactor(reliability)),
        penalty: Math.round(payout * row.penaltyShare),
        salvageShare: Math.min(1, Math.round(row.salvageShare * salvageFactor(standing) * 1000) / 1000),
        durationDays: row.days,
        offerUntil,
      },
    });
  }
  return out;
}

/** Сид искупительных предложений: свой, чтобы не сдвинуть ни одного броска обычной биржи. */
function atonementSeed(worldSeed: number, systemId: string, decade: number): number {
  let h = (worldSeed >>> 0) ^ 0x6a09e667;
  const text = `${systemId}|${decade}|atonement`;
  for (let i = 0; i < text.length; i++) {
    h = Math.imul(h ^ text.charCodeAt(i), 0x85ebca6b);
    h ^= h >>> 13;
  }
  h = Math.imul(h ^ (h >>> 16), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/**
 * ИСКУПЛЕНИЕ (решение пользователя 2026-09-14).
 *
 * Наниматель, у которого отношение к роте ниже нижнего порога доступа
 * (`hostileFloor`), обычной работы не даёт вовсе. Без этого он оставался бы
 * вечным врагом: жирные контракты стоят на границе, значит против кого-то, и
 * игрок был бы вынужден выбрать Дом, с которым не будет дел всю кампанию.
 *
 * Такой Дом выставляет на СВОЕЙ бирже работу против пиратов — «докажи
 * лояльность»: без оплаты, аванса, неустойки и трофеев. Плата — отношение,
 * и растёт она со сложностью (`accrual.ts::atonementGain`).
 *
 * Разыгрывается СВОИМ ГПСЧ и дописывается В КОНЕЦ списка: ни один бросок
 * обычной биржи не сдвигается, и на старых сохранениях её состав прежний.
 */
function atonementOffers(
  worldSeed: number,
  deltas: GalaxyDeltas,
  systemId: string,
  day: number,
  rep?: ReputationState,
  war?: WarState,
): readonly JudgedOffer[] {
  const count = REPUTATION.atonement.offers;
  if (rep === undefined || count <= 0) return [];
  const i = GALAXY.require(systemId);
  const employer = ownerOf(deltas, i);
  if (employer === PIRATE_FACTION || !gatedEmployer(employer)) return [];
  if (standingOf(rep, employer) >= hostileFloor()) return [];
  if (employerAtWar(war, employer)) return [];

  const profile = worldProfile(worldSeed, deltas, i);
  const ruined = deltas[systemId]?.ruined ?? 0;
  const garrison = profile.garrison * clamp(1 - clamp(ruined, 0, 1), 0, 1);
  const decade = contractDecadeOf(day);
  const rng = new Rng(atonementSeed(worldSeed, systemId, decade));
  const offerUntil = contractDecadeStart(decade + 1) - 1;

  const enmity = enmityOf(employer, PIRATE_FACTION);
  const open = missionsAt(enmity);
  const missions: readonly MissionType[] = open.length > 0 ? open : ['garrison'];
  const supply = war === undefined ? 1 : supplyLevel(war, PIRATE_FACTION, profile, ruined);
  const opforType = opforTypeOf(PIRATE_FACTION, garrison, supply);
  const o = CONTRACTS.opfor;

  const out: JudgedOffer[] = [];
  for (let n = 0; n < count; n++) {
    const mission = missions[Math.floor(rng.next() * missions.length)] as MissionType;
    const row = CONTRACTS.missions[mission];
    const spread = 1 + (rng.next() * 2 - 1) * o.strengthSpread;
    const strength = clamp((1 + garrison * o.garrisonWeight) * spread, 0.25, 4);
    const scale = drawScale(rng, mission, garrison, 0);
    const opforUnits = drawUnits(rng, scale, supply, mission);
    const opforTons = drawTons(rng, opforType, garrison);
    out.push({
      allowed: true,
      contract: {
        id: `A${decade}-${n}`,
        systemId,
        employer,
        target: PIRATE_FACTION,
        enmity,
        mission,
        opforType,
        supply,
        tension: 0,
        opforTechBase: 'is',
        strength: Math.round(strength * 1000) / 1000,
        opforUnits,
        opforTons,
        intel: intelOf({
          mission,
          target: PIRATE_FACTION,
          tension: 0,
          standing: standingOf(rep, employer),
          hpg: GALAXY.hasFlag(i, 'hpg'),
          surveyed: isSurveyed(deltas, systemId),
        }),
        scale,
        // Судьбу сектора искупление не решает: это проверка лояльности, а не фронт.
        stakes: 'none',
        biome: profile.biome,
        payout: 0,
        advance: 0,
        penalty: 0,
        salvageShare: 0,
        durationDays: row.days,
        offerUntil,
        atonement: true,
      },
    });
  }
  return out;
}

/** Сид восстания: свой, чтобы не сдвинуть ни одного броска обычной биржи, искупления и награды. */
function revoltSeed(worldSeed: number, systemId: string, decade: number): number {
  let h = (worldSeed >>> 0) ^ 0x510e527f;
  const text = `${systemId}|${decade}|revolt`;
  for (let i = 0; i < text.length; i++) {
    h = Math.imul(h ^ text.charCodeAt(i), 0x85ebca6b);
    h ^= h >>> 13;
  }
  h = Math.imul(h ^ (h >>> 16), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/**
 * ПОДАВИТЬ ВОССТАНИЕ (шаг 85, решения пользователя 2026-10-01).
 *
 * Восставший мир роты (`war/loyalty.ts`) выставляет на своей бирже одну оборону против ополчения
 * прежнего владельца: восстание поднимают местные, поэтому часть — ополчение и техника Внутренней Сферы,
 * даже если мир взят у клана. Сила — по гарнизону мира, как у обычной работы. Гонорара, аванса и
 * неустойки нет: держава себе не платит; трофеи обычные. Флаг работа не двигает — исход решает
 * лояльность, а срок восстания ведёт такт.
 *
 * Своим ГПСЧ и в конец списка — тем же приёмом, что искупление и награда за логово. Местные отряды её не
 * разбирают (`availableContracts`).
 */
/** Работа «подавить восстание» этой декады на мире, если мир восстал (шаг 86b: её противника бьёт гарнизон). */
export function revoltContract(
  worldSeed: number,
  deltas: GalaxyDeltas,
  systemId: string,
  day: number,
  rep?: ReputationState,
  war?: WarState,
): Contract | undefined {
  return revoltOffers(worldSeed, deltas, systemId, day, rep, war)[0]?.contract;
}

function revoltOffers(
  worldSeed: number,
  deltas: GalaxyDeltas,
  systemId: string,
  day: number,
  rep?: ReputationState,
  war?: WarState,
): readonly JudgedOffer[] {
  const i = GALAXY.require(systemId);
  const employer = ownerOf(deltas, i);
  if (!isPlayerActor(employer) || deltas[systemId]?.revoltSince === undefined) return [];

  const target = secessionTarget(deltas, i);
  const profile = worldProfile(worldSeed, deltas, i);
  const ruined = deltas[systemId]?.ruined ?? 0;
  const garrison = profile.garrison * clamp(1 - clamp(ruined, 0, 1), 0, 1);
  const decade = contractDecadeOf(day);
  const rng = new Rng(revoltSeed(worldSeed, systemId, decade));
  const offerUntil = contractDecadeStart(decade + 1) - 1;
  const mission: MissionType = 'defense';
  const row = CONTRACTS.missions[mission];
  const supply = war === undefined ? 1 : supplyLevel(war, target, profile, ruined);
  const opforType: OpforType = 'militia';
  const o = CONTRACTS.opfor;
  const spread = 1 + (rng.next() * 2 - 1) * o.strengthSpread;
  const strength = clamp((1 + garrison * o.garrisonWeight) * spread, 0.25, 4);
  const scale = drawScale(rng, mission, garrison, 0);
  const opforUnits = drawUnits(rng, scale, supply, mission);
  const opforTons = drawTons(rng, opforType, garrison);
  return [
    {
      allowed: true,
      contract: {
        id: `R${decade}`,
        systemId,
        employer,
        target,
        enmity: rep === undefined ? enmityOf(employer, target) : liveEnmity(rep, employer, target),
        mission,
        opforType,
        supply,
        tension: 0,
        opforTechBase: 'is',
        strength: Math.round(strength * 1000) / 1000,
        opforUnits,
        opforTons,
        intel: intelOf({
          mission,
          target,
          tension: 0,
          standing: rep === undefined ? 0 : standingOf(rep, employer),
          hpg: GALAXY.hasFlag(i, 'hpg'),
          surveyed: isSurveyed(deltas, systemId),
        }),
        scale,
        stakes: 'none',
        biome: profile.biome,
        payout: 0,
        advance: 0,
        penalty: 0,
        salvageShare: row.salvageShare,
        durationDays: row.days,
        offerUntil,
        revolt: true,
      },
    },
  ];
}

/**
 * Пираты у дома (шаг 89): истёкшие сроки и сроки миров, ушедших от роты, снимаются; каждый прорвавшийся набег на мир
 * роты ставит `raidedUntil` — конец декады через `pirates.homeRaidDecades` декад. Без миров роты под набегом и без
 * сроков в дельтах — карта та же.
 */
export function postHomeRaids(
  deltas: GalaxyDeltas,
  raids: readonly { readonly systemId: string; readonly owner: string }[],
  day: number,
): { deltas: GalaxyDeltas; posted: { systemId: string; until: number }[] } {
  let out = deltas;
  for (const id of Object.keys(deltas)) {
    const until = deltas[id]?.raidedUntil;
    if (until !== undefined && (until < day || !isPlayerActor(ownerOf(deltas, GALAXY.require(id))))) {
      out = withDelta(out, id, { raidedUntil: undefined });
    }
  }
  const posted: { systemId: string; until: number }[] = [];
  for (const r of raids) {
    if (!isPlayerActor(r.owner)) continue;
    const until = contractDecadeStart(contractDecadeOf(day) + CONTRACTS.pirates.homeRaidDecades) - 1;
    out = withDelta(out, r.systemId, { raidedUntil: until });
    posted.push({ systemId: r.systemId, until });
  }
  return { deltas: out, posted };
}

/** Сид работы «пираты у дома»: свой, чтобы не сдвинуть ни одного броска прочих работ мира. */
function homeRaidSeed(worldSeed: number, systemId: string, decade: number): number {
  let h = (worldSeed >>> 0) ^ 0x3c6ef372;
  const text = `${systemId}|${decade}|homeRaid`;
  for (let i = 0; i < text.length; i++) {
    h = Math.imul(h ^ text.charCodeAt(i), 0x85ebca6b);
    h ^= h >>> 13;
  }
  h = Math.imul(h ^ (h >>> 16), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/**
 * ПИРАТЫ У ДОМА (шаг 89, решения пользователя 2026-10-02).
 *
 * Прорвавшийся набег на мир роты (`war/development.ts`, `raidedUntil`) выставляет на бирже этого мира оборону против
 * вольницы на `pirates.homeRaidDecades` декад — тем же приёмом, что восстание: без гонорара, аванса и неустойки
 * (держава себе не платит), трофеи обычные, своим ГПСЧ и в конец списка. Сила — по гарнизону мира. Победа вычищает
 * мир, как выигранный пиратский контракт, и снимает работу; гарнизон бьёт её сам (`execute.ts`).
 */
export function homeRaidContract(
  worldSeed: number,
  deltas: GalaxyDeltas,
  systemId: string,
  day: number,
  rep?: ReputationState,
  war?: WarState,
): Contract | undefined {
  return homeRaidOffers(worldSeed, deltas, systemId, day, rep, war)[0]?.contract;
}

function homeRaidOffers(
  worldSeed: number,
  deltas: GalaxyDeltas,
  systemId: string,
  day: number,
  rep?: ReputationState,
  war?: WarState,
): readonly JudgedOffer[] {
  const i = GALAXY.require(systemId);
  const employer = ownerOf(deltas, i);
  const until = deltas[systemId]?.raidedUntil;
  if (!isPlayerActor(employer) || until === undefined || until < day) return [];

  const profile = worldProfile(worldSeed, deltas, i);
  const ruined = deltas[systemId]?.ruined ?? 0;
  const garrison = profile.garrison * clamp(1 - clamp(ruined, 0, 1), 0, 1);
  const decade = contractDecadeOf(day);
  const rng = new Rng(homeRaidSeed(worldSeed, systemId, decade));
  const offerUntil = Math.min(until, contractDecadeStart(decade + 1) - 1);
  const mission: MissionType = 'defense';
  const row = CONTRACTS.missions[mission];
  const supply = war === undefined ? 1 : supplyLevel(war, PIRATE_FACTION, profile, ruined);
  const opforType = opforTypeOf(PIRATE_FACTION, garrison, supply);
  const o = CONTRACTS.opfor;
  const spread = 1 + (rng.next() * 2 - 1) * o.strengthSpread;
  const strength = clamp((1 + garrison * o.garrisonWeight) * spread, 0.25, 4);
  const scale = drawScale(rng, mission, garrison, 0);
  const opforUnits = drawUnits(rng, scale, supply, mission);
  const opforTons = drawTons(rng, opforType, garrison);
  return [
    {
      allowed: true,
      contract: {
        id: `P${decade}`,
        systemId,
        employer,
        target: PIRATE_FACTION,
        enmity: rep === undefined ? enmityOf(employer, PIRATE_FACTION) : liveEnmity(rep, employer, PIRATE_FACTION),
        mission,
        opforType,
        supply,
        tension: 0,
        opforTechBase: 'is',
        strength: Math.round(strength * 1000) / 1000,
        opforUnits,
        opforTons,
        intel: intelOf({
          mission,
          target: PIRATE_FACTION,
          tension: 0,
          standing: rep === undefined ? 0 : standingOf(rep, employer),
          hpg: GALAXY.hasFlag(i, 'hpg'),
          surveyed: isSurveyed(deltas, systemId),
        }),
        scale,
        stakes: 'none',
        biome: profile.biome,
        payout: 0,
        advance: 0,
        penalty: 0,
        salvageShare: row.salvageShare,
        durationDays: row.days,
        offerUntil,
        homeRaid: true,
      },
    },
  ];
}

/** Сид работы державы на мире врага (шаг 90): свой, чтобы не сдвинуть ни одного броска прочих работ мира. */
function warWorkSeed(worldSeed: number, systemId: string, decade: number): number {
  let h = (worldSeed >>> 0) ^ 0x9b05688c;
  const text = `${systemId}|${decade}|warWork`;
  for (let i = 0; i < text.length; i++) {
    h = Math.imul(h ^ text.charCodeAt(i), 0x85ebca6b);
    h ^= h >>> 13;
  }
  h = Math.imul(h ^ (h >>> 16), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/** Задачи работы державы на мире врага: держава наступает, а не обороняется. */
const WAR_WORK_MISSIONS: readonly MissionType[] = ['raid', 'recon', 'assault'];

/**
 * РАБОТА ДЕРЖАВЫ НА МИРЕ ВРАГА (шаг 90, `notes.md` §10zu п. 4).
 *
 * Биржу мира держит его владелец, и работы ПРОТИВ него на его мире не было: право флага на мир врага рота
 * набирала работой на самого врага до войны. Теперь на пограничном мире фракции, с которой у державы есть запись
 * войны (`playerWarOf`), не столице, держава выставляет `board.warWorkOffers` работ роты против владельца — по
 * образцу восстания и «пиратов у дома»: без гонорара, аванса и неустойки, трофеи обычные, своим ГПСЧ и в конец
 * списка, местные их не разбирают. Противник — гарнизон мира по типу его владельца (гвардия, клан). Победа идёт в
 * счёт войны и в `SystemDelta.realmWon` — право флага (`commands/execute.ts::executeConquerWorld`).
 */
function warWorkOffers(
  worldSeed: number,
  deltas: GalaxyDeltas,
  systemId: string,
  day: number,
  rep?: ReputationState,
  war?: WarState,
): readonly JudgedOffer[] {
  if (war === undefined) return [];
  const i = GALAXY.require(systemId);
  const target = ownerOf(deltas, i);
  if (isPlayerActor(target) || GALAXY.hasFlag(i, 'capital')) return [];
  if (playerWarOf(war, target) === undefined || !nextToDomain(deltas, i)) return [];

  const profile = worldProfile(worldSeed, deltas, i);
  const ruined = deltas[systemId]?.ruined ?? 0;
  const garrison = profile.garrison * clamp(1 - clamp(ruined, 0, 1), 0, 1);
  const decade = contractDecadeOf(day);
  const rng = new Rng(warWorkSeed(worldSeed, systemId, decade));
  const offerUntil = contractDecadeStart(decade + 1) - 1;
  const supply = supplyLevel(war, target, profile, ruined);
  const opforType = opforTypeOf(target, garrison, supply);
  const o = CONTRACTS.opfor;
  const out: JudgedOffer[] = [];
  for (let n = 0; n < CONTRACTS.board.warWorkOffers; n++) {
    const mission = WAR_WORK_MISSIONS[Math.floor(rng.next() * WAR_WORK_MISSIONS.length)] as MissionType;
    const row = CONTRACTS.missions[mission];
    const spread = 1 + (rng.next() * 2 - 1) * o.strengthSpread;
    const strength = clamp((1 + garrison * o.garrisonWeight) * spread, 0.25, 4);
    const scale = drawScale(rng, mission, garrison, 0);
    const opforUnits = drawUnits(rng, scale, supply, mission);
    const opforTons = drawTons(rng, opforType, garrison);
    out.push({
      allowed: true,
      contract: {
        id: `W${decade}-${n}`,
        systemId,
        employer: PLAYER_ACTOR_ID,
        target,
        enmity: rep === undefined ? enmityOf(PLAYER_ACTOR_ID, target) : liveEnmity(rep, PLAYER_ACTOR_ID, target),
        mission,
        opforType,
        supply,
        tension: 0,
        opforTechBase: factionKind(target) === 'clan' ? 'clan' : 'is',
        strength: Math.round(strength * 1000) / 1000,
        opforUnits,
        opforTons,
        intel: intelOf({
          mission,
          target,
          tension: 0,
          standing: 0,
          hpg: GALAXY.hasFlag(i, 'hpg'),
          surveyed: isSurveyed(deltas, systemId),
        }),
        scale,
        stakes: 'none',
        biome: profile.biome,
        payout: 0,
        advance: 0,
        penalty: 0,
        salvageShare: row.salvageShare,
        durationDays: row.days,
        offerUntil,
        warWork: true,
      },
    });
  }
  return out;
}

function regularOffers(
  worldSeed: number,
  deltas: GalaxyDeltas,
  systemId: string,
  day: number,
  rep?: ReputationState,
  war?: WarState,
): readonly JudgedOffer[] {
  const i = GALAXY.require(systemId);
  const profile = worldProfile(worldSeed, deltas, i);
  const employer = ownerOf(deltas, i);
  const ruined = deltas[systemId]?.ruined ?? 0;

  // Кто рядом и насколько близко (шаг 21b). Из близости и накопленных фондов
  // выводится напряжённость участка — та самая, из которой берутся и опасность
  // работы, и её цена.
  const nearby = neighbourFactions(deltas, i, CONTRACTS.board.enemyRangeJumps);
  // МИР РОТЫ (шаг 85): враги державы — по ЖИВОЙ матрице отношений, а не по таблице 3053 года. В таблице
  // держава — «наёмник», и Дом, с которым она воюет, стоял бы там на 0.10, ниже порога биржи: биржа
  // своего мира пустовала, пока держава воевала (`notes.md` §10zg п. 6).
  const own = isPlayerActor(employer);
  const enemies = (own && rep !== undefined
    ? liveEnemiesOf(rep, employer, CONTRACTS.board.minEnmity)
    : enemiesOf(employer, CONTRACTS.board.minEnmity)
  )
    .filter((e) => nearby.has(e.id))
    .map((e) => {
      const proximity = nearby.get(e.id) as number;
      const tension =
        war === undefined ? 0 : tensionOf(war, rep ?? NO_REPUTATION, employer, e.id, proximity);
      return {
        ...e,
        proximity,
        tension,
        live: heatedEnmity(e.enmity, tension),
        // Инициатива: кто из двоих отложил против другого больше. Ею взвешивается
        // тип работы — наступает наниматель или обороняется.
        initiative: war === undefined ? 0.5 : initiativeOf(war, employer, e.id),
      };
    });
  if (enemies.length === 0) return [];

  // ФРОНТ И ТЫЛ (шаг 37). Фронтовой индекс выводится из того же соседства, что
  // уже посчитано выше, — ни одного лишнего обхода карты. Пираты из него
  // исключены по построению: вольница фронтом не бывает, и если бы она сюда
  // попадала, каждая система на карте оказалась бы фронтовой, а тыла не
  // осталось бы вовсе.
  const hostiles: HostileNeighbour[] = enemies.map((e) => ({
    id: e.id,
    proximity: e.proximity,
    tension: e.tension,
  }));
  const frontier = frontierIndex(hostiles);
  const risk = pirateRisk(frontier, {
    marketClass: profile.marketClass,
    garrison: profile.garrison,
    ruined,
    owner: employer,
    blackMarket: GALAXY.hasFlag(i, 'blackMarket'),
    cleared: clearedOf(deltas, systemId),
  });

  /**
   * Вес противника при розыгрыше предложения.
   *
   * Для всех, кроме пиратов, это живая вражда, как и было. Для пиратов — она же,
   * помноженная на пиратский риск МЕСТА: на горячей границе он ноль, и вольница
   * с биржи исчезает вовсе, в глубоком тылу он близок к единице, и работа там
   * почти вся пиратская. Это и есть весь шаг 37 в одной строке: пиратов не
   * прибавилось и не убавилось, они СОБРАЛИСЬ в тыл.
   *
   * Вырожденного случая «все веса нулевые» здесь быть не может: риск падает до
   * нуля только вместе с фронтовым индексом, дошедшим до единицы, а тот
   * поднимает единица непиратский враг с ненулевой враждой.
   */
  const weightOf = (e: { id: string; live: number }): number =>
    e.id === PIRATE_FACTION ? e.live * risk : e.live;

  // Те, с кем здесь действительно ФРОНТ. Работу против них горячая граница
  // добавляет СВЕРХ обычной, а не вместо неё: замер шага 20 показал, что работы
  // не против пиратов нет в двух третях систем, и виной тому не фронт, а
  // география — вглубь территории Дома другого актора в двух прыжках нет. Тыл
  // поэтому и остаётся тылом, а фронт становится местом, куда за войной надо
  // ЛЕТЕТЬ.
  const frontEnemies = enemies.filter((e) => e.tension > 0);
  let frontPull = 0;
  for (const e of frontEnemies) frontPull += e.tension;

  const decade = contractDecadeOf(day);
  const rng = new Rng(boardSeed(worldSeed, systemId, decade));
  const allyRng = new Rng(alliesSeed(worldSeed, systemId, decade));
  const offerUntil = contractDecadeStart(decade + 1) - 1;
  // Разорение бьёт по бирже и по гарнизону (решение 6): у разорённого мира
  // меньше денег на наём и меньше войск, чтобы за него драться. Доход и
  // снабжение оно уже сняло на шаге 21a — это две оставшиеся половины.
  const ruinFactor = 1 - CONTRACTS.board.ruinWeight * clamp(ruined, 0, 1);
  const garrison = profile.garrison * clamp(1 - clamp(ruined, 0, 1), 0, 1);
  const baseOffers = Math.max(1, Math.round(offerCount(i, profile.marketClass) * ruinFactor));
  const b = CONTRACTS.board;
  const extra =
    frontEnemies.length === 0
      ? 0
      : Math.min(b.frontOffersMax, Math.round(b.frontOffers * frontPull * ruinFactor));
  const fame = rep?.fame ?? 0;
  // РАБОТА НОВИЧКУ (2026-10-04): малоизвестному отряду биржа добавляет пиратской работы — там, где пираты в
  // соседях. Прибавка убывает с известностью и исчезает к порогу тяжёлой работы (`noviceFame`): дальше стимул
  // лететь за работой остаётся прежним. Строки дописываются в КОНЕЦ биржи — обычная работа и её броски прежние;
  // бросок выживания по пиратскому риску и вычистка мира действуют на них так же.
  const pirateEnemy = enemies.find((e) => e.id === PIRATE_FACTION);
  const novice =
    pirateEnemy === undefined ? 0 : Math.round(baseOffers * b.noviceOffers * Math.max(0, 1 - fame / b.noviceFame));
  const count = baseOffers + extra + novice;

  // Репутация у НАНИМАТЕЛЯ: он один на всю биржу системы — это её владелец.
  const standing = rep === undefined ? 0 : standingOf(rep, employer);
  const reliability = rep?.reliability ?? REPUTATION.axes.reliabilityStart;
  const pay = payoutFactor(standing);
  const salvage = salvageFactor(standing);
  const advance = advanceFactor(reliability);

  const out: JudgedOffer[] = [];
  for (let n = 0; n < count; n++) {
    // Против кого работа. Первые `base` предложений — обычная работа системы, и
    // в ней участвуют все соседи, включая пиратов; надбавка за горячую границу
    // разыгрывается только среди тех, с кем здесь фронт. Вес — ЖИВАЯ вражда, а не
    // табличная (шаг 21b): где фронт горит, работы против той стороны больше.
    // Один бросок на строку и всегда, своим потоком (шаг 73b): строка,
    // вычеркнутая ниже, не сдвигает жребий союзников у следующих.
    const allyRoll = allyRng.next();
    const picked =
      n >= baseOffers + extra && pirateEnemy !== undefined
        ? pirateEnemy
        : weightedPick(rng, n < baseOffers ? enemies : frontEnemies, weightOf);
    const target = picked.id;
    const enmity = own && rep !== undefined ? liveEnmity(rep, employer, target) : enmityOf(employer, target);
    const tension = picked.tension;

    // Снабжение считается ПО ЦЕЛИ, а не по нанимателю: на поле выходит часть
    // противника, и её снаряжает его казна, а не та, что платит роте.
    const supply = war === undefined ? 1 : supplyLevel(war, target, profile, ruined);
    const opforType = opforTypeOf(target, garrison, supply);

    // Какой ТИП работы — «наступает наниматель или обороняется». До шага 21b тип
    // брался равновероятно из открытых враждой, и штурм встречался у отступающей
    // стороны ровно так же часто, как у давящей. При равном напоре (в том числе
    // в первый день кампании, когда никто ничего не отложил) веса равны, и выбор
    // возвращается к равновероятному.
    const available = missionsAt(picked.live);
    const mission = weightedPick(rng, available, (m) => postureWeight(m, picked.initiative));
    const row = CONTRACTS.missions[mission];

    const o = CONTRACTS.opfor;
    const spread = 1 + (rng.next() * 2 - 1) * o.strengthSpread;
    const strength = clamp((1 + garrison * o.garrisonWeight) * spread, 0.25, 4);

    // МАСШТАБ РАБОТЫ (шаг 44, план Б) — три броска, и они стоят ДО оплаты,
    // потому что оплата с этого шага считается от описанных сил: кто платит за
    // работу, платит за её размер.
    const scale = drawScale(rng, mission, garrison, tension);
    const opforUnits = drawUnits(rng, scale, supply, mission);
    const opforTons = drawTons(rng, opforType, garrison);

    const base = payoutOf(
      mission,
      strength,
      dangerFactor(opforType, supply),
      forceFactor(opforUnits, opforTons),
      tension,
      garrison,
      profile.marketClass,
      rng,
    );

    // Приговор порога выносится ПОСЛЕ всех бросков предложения: вычеркнуть
    // строку и не бросить за неё кубики — разные вещи, и вторая переставила бы
    // весь остаток списка.
    const atWar = employerAtWar(war, employer);
    // Держава себе работу не закрывает: порог отношения меряет роту к самой себе (шаг 85).
    const allowed = own || (!atWar && missionAllowed(mission, employer, standing, fame));
    const employerSupply = war === undefined ? 1 : supplyLevel(war, employer, profile, ruined);
    const allies = alliesFor(allyRoll, mission, employer, garrison, employerSupply, opforType, supply, opforUnits);
    const fortified = fortressFor(worldSeed, systemId, decade, n, mission, scale);
    // Работа дома флаг не двигает (шаг 85): её вклад в войну — счёт, усталость и театр врага.
    const stakes = own ? 'none' : stakesOf(scale, mission, tension);
    // Звено нанимателя делает свою часть работы, и платит за неё наниматель сам;
    // укреплённая работа дороже (шаг 73d); работа «только на поле» — ещё на
    // надбавку за обязательный выход на карту (шаг 74).
    // ДЕРЖАВА СЕБЕ НЕ ПЛАТИТ (шаг 85, решение пользователя): у работы на мире роты нет гонорара, аванса
    // и неустойки — иначе это деньги из ниоткуда. Трофеи обычные. Бросок оплаты выше всё равно сделан:
    // вычеркнуть его — переставить остаток биржи.
    const payout = own
      ? 0
      : Math.round(
          base *
            pay *
            (1 - (allies?.share ?? 0)) *
            (fortified === undefined ? 1 : CONTRACTS.fortified.payFactor) *
            (fieldOnly({ fortified, stakes }) ? 1 + CONTRACTS.fieldOnly.payBonus : 1),
        );

    // ВЫЧИЩЕННЫЙ МИР ПЕРЕСТАЁТ ДАВАТЬ РАБОТУ (шаг 37a), и убавляется у него
    // именно ПИРАТСКАЯ работа, а не заменяется на другую.
    //
    // Веса выше на это не способны, и это не мелочь, а суть: в глубоком тылу
    // вольница — ЕДИНСТВЕННЫЙ противник в двух прыжках, и как её ни взвешивай,
    // выбрать больше не из кого. Поэтому предложение против пиратов ещё и
    // ВЫЖИВАЕТ с вероятностью пиратского риска: на нетронутом мире почти всякое,
    // на вычищенном досуха — ни одного, и биржа там пустеет.
    //
    // Ровно это и есть «стимул лететь дальше» из замысла: мир, который рота
    // вычистила, кормить её перестаёт. Отдельной выталкивающей механики не
    // требуется.
    //
    // ПОЛА У ЭТОГО НЕТ, и это решение пользователя 2026-09-07, а не недосмотр.
    // Первая версия ставила порог выживания в четверть, чтобы биржа мира не
    // могла обнулиться целиком: без него пустыми оказались 332 системы из 2000,
    // и среди них Аутрич, Тарканд и Лютьен — столицы с HPG. Ответ был прямой:
    // «да, на самом деле это норм». И он верен — работы там нет не потому, что
    // механика сломалась, а потому, что на столице Драгун с их гарнизоном
    // вольнице делать нечего, а чужих флагов в двух прыжках нет. Мир без работы
    // — законный житель карты; лишняя ручка ради его спасения была бы враньём.
    //
    // Бросок стоит ПОСЛЕДНИМ в теле цикла — по тому же правилу, по которому
    // сюда дописывается любой новый: иначе вся биржа всех систем на старых
    // сохранениях стала бы другой при неизменных данных.
    if (target === PIRATE_FACTION && rng.next() >= risk) continue;

    out.push({
      allowed,
      ...(atWar ? { employerAtWar: true as const } : {}),
      contract: {
        id: `K${decade}-${n}`,
        systemId,
        employer,
        target,
        enmity,
        mission,
        opforType,
        supply,
        tension,
        opforTechBase: factionKind(target) === 'clan' ? 'clan' : 'is',
        strength: Math.round(strength * 1000) / 1000,
        opforUnits,
        opforTons,
        // Достоверность сводки (шаг 57). Считается ЗДЕСЬ, а не на вылете, и
        // ложится в контракт: разведать систему после подписи уже поздно.
        intel: intelOf({
          mission,
          target,
          tension,
          standing,
          hpg: GALAXY.hasFlag(i, 'hpg'),
          surveyed: isSurveyed(deltas, systemId),
        }),
        scale,
        stakes,
        biome: profile.biome,
        payout,
        // Аванс — от НАДЁЖНОСТИ, а не от отношения (`reputation.md`): наниматель
        // платит вперёд тому, кто дорабатывает до конца, а не тому, кого любит.
        advance: Math.round(payout * row.advanceShare * advance),
        penalty: Math.round(payout * row.penaltyShare),
        salvageShare: Math.min(
          1,
          Math.round(row.salvageShare * salvage * (allies === undefined ? 1 : CONTRACTS.allies.salvageFactor) * 1000) /
            1000,
        ),
        durationDays: row.days,
        offerUntil,
        ...(allies === undefined ? {} : { allies }),
        ...(fortified === undefined ? {} : { fortified }),
      },
    });
  }
  return out;
}

/**
 * Биржа за вычетом уже взятого.
 *
 * `taken` действителен только для своей декады: список из прошлой декады не
 * вычёркивает ничего, потому что и предложения там были другие. Тот же приём,
 * что у `availableStock`.
 */
/**
 * Разобрали ли это предложение МЕСТНЫЕ отряды (решение пользователя 2026-09-04).
 *
 * Наёмных отрядов в Сфере тысячи; поимённо мы держим три десятка, и замер
 * показал, чем кончается попытка держать больше: триста отрядов, расселённых по
 * двум тысячам миров, отнимают у роты ОДИН контракт за кампанию. Чтобы на мире
 * игрока стояло в среднем два чужих отряда, их нужно четыре тысячи — и тогда
 * встаёт задача калибровать их передвижение, у которой нет ни цели, ни мерила
 * (`wiki/decisions.md`).
 *
 * Поэтому часть работы просто НЕ ДОХОДИТ до биржи: её взяли те, кого мы не
 * моделируем. Это честная абстракция, а не фальшь, — в отличие от выдуманного
 * числа она описывает то, что в мире действительно происходит.
 *
 * Бросок выводится из мира, системы, декады и id предложения СВОИМ ГПСЧ и не
 * трогает поток биржи: иначе он сдвинул бы все остальные броски, и состав
 * предложений изменился бы весь целиком. Один и тот же мир в одну и ту же
 * декаду недосчитывается одних и тех же строк, сколько на него ни смотри.
 */
export function takenByLocals(worldSeed: number, systemId: string, decade: number, id: string): boolean {
  if (CONTRACTS.board.localsTake <= 0) return false;
  let h = (worldSeed >>> 0) ^ 0x2545f491;
  const text = `${systemId}|${decade}|${id}|locals`;
  for (let i = 0; i < text.length; i++) {
    h = Math.imul(h ^ text.charCodeAt(i), 0x85ebca6b);
    h ^= h >>> 13;
  }
  h = Math.imul(h ^ (h >>> 16), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 0x100000000 < CONTRACTS.board.localsTake;
}

export function availableContracts(
  worldSeed: number,
  deltas: GalaxyDeltas,
  systemId: string,
  day: number,
  taken: readonly string[] = [],
  rep?: ReputationState,
  war?: WarState,
): readonly Contract[] {
  const gone = new Set(taken);
  const decade = contractDecadeOf(day);
  // Искупление местные отряды не разбирают: это разговор Дома с этой ротой, а не
  // работа на рынке.
  return contractBoard(worldSeed, deltas, systemId, day, rep, war).filter(
    (c) =>
      !gone.has(c.id) &&
      (c.atonement === true ||
        c.revolt === true ||
        c.homeRaid === true ||
        c.warWork === true ||
        !takenByLocals(worldSeed, systemId, decade, c.id)),
  );
}

/**
 * Что биржа не показала и почему — для экрана контрактов.
 *
 * Порог, который молча стирает половину списка, читается как пустая биржа, а не
 * как последствие выбора стороны. Игрок обязан видеть, что работа тут ЕСТЬ, но
 * этот наниматель её ему не даст.
 */
export interface BlockedOffers {
  /** Сколько предложений вычеркнул порог доступности или война (всё закрытое). */
  readonly count: number;
  /** Из них — закрыто войной нанимателя с державой роты (шаг 79). */
  readonly atWar: number;
  /** Владелец биржи — наниматель её обычной работы. */
  readonly employer: string;
  /** Сколько их было ВСЕГО до порога — знаменатель доли закрытой биржи. */
  readonly total: number;
  /** Гейтится ли этот наниматель вообще: у пиратов и независимых политики нет. */
  readonly gated: boolean;
  readonly standing: number;
  readonly fame: number;
}

export function blockedOffers(
  worldSeed: number,
  deltas: GalaxyDeltas,
  systemId: string,
  day: number,
  rep: ReputationState,
  war?: WarState,
): BlockedOffers {
  const employer = ownerOf(deltas, GALAXY.require(systemId));
  const offers = buildOffers(worldSeed, deltas, systemId, day, rep, war);
  let count = 0;
  let atWar = 0;
  for (const offer of offers) {
    if (!offer.allowed) count++;
    if (offer.employerAtWar === true) atWar++;
  }
  return {
    count,
    atWar,
    employer,
    total: offers.length,
    gated: gatedEmployer(employer),
    standing: standingOf(rep, employer),
    fame: rep.fame,
  };
}

/**
 * Что игрок видит о контракте ДО боя (решение 4 §7 пайплайна).
 *
 * Тип отряда виден всегда — «периферийная банда на трофеях» и «гвардейский
 * полк» это разные числа, а не разная подпись. Точный класс исполнения машин
 * противника — только после разведки системы (`Survey`): иначе либо сюрприз
 * без планирования, либо планирование без риска.
 */
export interface ContractIntel {
  readonly opforType: OpforType;
  readonly techBase: 'is' | 'clan';
  /** Сколько машин выйдет. Число записано в предложении и от размера вылета не зависит (шаг 44). */
  readonly expectedUnits: number;
  /** Потолок тоннажа их машин: «выйдут лёгкие» и «выйдут штурмовые» — разные работы. */
  readonly tonnageCap: number;
  /** Ступень масштаба работы — от патруля до батальона. */
  readonly scale: ScaleId;
  /** Классы исполнения, которые бывают у такой части. `null` — система не разведана. */
  readonly quality: readonly QualityClass[] | null;
  /**
   * Достоверность сводки, 0..1 (шаг 57): насколько двум числам выше можно
   * верить. Единица — данные точны.
   */
  readonly reliability: number;
  /**
   * Полоса, в которой может оказаться ФАКТ: от самого удачного жребия до
   * самого неудачного. Игрок обязан знать, чем рискует, до подписи — даже не
   * зная, чем кончится.
   */
  readonly unitsRange: readonly [number, number];
  readonly tonsRange: readonly [number, number];
  /**
   * Шанс, что факт разойдётся со сводкой хотя бы одним числом, 0..1.
   *
   * Полоса сама по себе перестала различать работы (2026-09-21): после
   * вероятностного округления «может быть 3–5» стоит и у сводки на 95 %, и у
   * сводки на 50 %, а вот шанс попасть в край у них разный на порядок. Число
   * показывается рядом с полосой, иначе достоверность читается украшением.
   */
  readonly missChance: number;
}

export function contractIntel(contract: Contract, surveyed: boolean): ContractIntel {
  const type = CONTRACTS.opfor.types[contract.opforType];
  const band = intelBand(contract);
  return {
    opforType: contract.opforType,
    techBase: contract.opforTechBase,
    expectedUnits: opforCount(contract),
    tonnageCap: contract.opforTons,
    scale: contract.scale,
    quality: surveyed ? QUALITY_CLASS_IDS.filter((cls) => type.quality[cls] > 0) : null,
    reliability: contract.intel,
    unitsRange: band.units,
    tonsRange: band.tons,
    missChance: intelMissChance(contract),
  };
}

/**
 * Сколько машин выставит противник.
 *
 * С шага 44 (план Б) это просто чтение того, что записано в предложении: число
 * разыграно биржей и от размера вылета не зависит. Функция оставлена швом —
 * через неё смотрят и оценка до боя, и сборка состава, и экран, — чтобы место
 * оставалось одно.
 */
export function opforCount(contract: Contract): number {
  return contract.opforUnits;
}
