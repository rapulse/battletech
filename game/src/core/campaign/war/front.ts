import type { Rng } from '../../rng/index.js';
import { dateOf } from '../clock.js';
import { factionKind, factionPairKey } from '../contracts/relations.js';
import { RELATIONS } from '../contracts/schema.js';
import { liveEnmity, type ReputationState } from '../reputation/state.js';
import { isPlayerActor } from './actors.js';
import { GALAXY } from '../galaxy/catalog.js';
import { developmentOf, focusOf, ownerOf, tributeOf, withDelta, type GalaxyDeltas } from '../galaxy/delta.js';
import { NO_PROFILE_BOOST, spaceportBoostOf, systemProfile, worldProfile } from '../galaxy/profile.js';
import type { WorldFocus } from '../galaxy/schema.js';
import {
  economyOf,
  fundOf,
  prosperityOf,
  withEconomy,
  worldContribution,
  withFund,
  releaseIdleFunds,
  theaterOf,
  withTheaterLoss,
  capitalJumps,
  domainCapitalIndex,
  withPlayerCapitalPinned,
  withConquest,
  type WarState,
} from './economy.js';
import {
  frontShares,
  militiaBacked,
  theaterReadiness,
  type FrontShares,
} from './logistics.js';
import { resolveFrontBattle, type GarrisonClash, type GarrisonInput } from './battle.js';
import {
  boundOrTruced,
  commonEnemyPairs,
  diplomacyTick,
  worldDiplomacy,
  imposeTribute,
  prefersTribute,
  shift,
  type DiplomacyMove,
} from './diplomacy.js';
import { notePlanCapture, planTick, planWeight, type PlanMove } from './plans.js';
import { notePlayerCapture, notePlayerFight, notePlayerLosses, playerWarTick, type PlayerWarEnded } from './playerWar.js';
import { acquiredPatch, LOYALTY_CLEARED } from './loyalty.js';
import { buildingDefence, buildingsLostPatch } from './buildings.js';
import { WAR } from './schema.js';

/**
 * Фронт (шаг 21b) — то, ради чего заводилась экономика 21a.
 *
 * **Участок фронта — это пара соседних систем разных владельцев**, а не линия
 * на карте и не отдельная сущность в состоянии. Их 661 на карте 3053 года, и
 * все они выводятся из каталога и дельт за один проход: хранить фронт незачем,
 * он и есть владение, прочитанное по соседям.
 *
 * Три правила, которые здесь держатся сознательно.
 *
 * 1. **Тикер — не ИИ** (ловушка 1 плана шага 21). Весовые правила и тот же
 *    сидированный ГПСЧ, что у тактического бота: десятки тысяч решений за
 *    кампанию языковой моделью не считают.
 * 2. **Мир не подыгрывает.** Сила сторон на участке выводится из тех же чисел,
 *    что видит игрок: достаток фракции (21a), гарнизон мира, разорение и то,
 *    сколько отложено ДРУГ ПРОТИВ ДРУГА. Отдельной «силы фронта» в состоянии
 *    нет, поэтому расходиться ей не с чем.
 * 3. **Состояние правится приращением.** Профиль системы не хранится
 *    (`galaxy/profile.ts`), и суммировать две тысячи профилей на каждом такте
 *    нельзя: сумма посчитана один раз при основании (`makeWarState`), а такт
 *    правит её ровно на то, что сдвинулось. Тест сверяет приращение с полным
 *    пересчётом — иначе расхождение копилось бы молча.
 */

const F = WAR.front;

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Владельцы всех систем одним массивом.
 *
 * Считается один раз на такт, а не спрашивается заново у каждого соседа:
 * `ownerOf` — это поиск по разрежённой карте дельт, и в двойном цикле по
 * соседям он выполнялся бы двадцать тысяч раз вместо двух.
 */
export function ownerArray(deltas: GalaxyDeltas): string[] {
  const out = new Array<string>(GALAXY.count);
  for (let i = 0; i < GALAXY.count; i++) out[i] = ownerOf(deltas, i);
  return out;
}

/**
 * Участок фронта: чей это мир и кто на него давит.
 *
 * Направленный: «Курита давит на дэвионский Гальтор» и «Дэвион давит на
 * куритянский Люсьен» — два разных участка, и у каждого свои силы. Тем же
 * решением направлен и военный фонд (`economy.ts::WarFunds`).
 */
export interface FrontSector {
  /** Индекс системы, на которую давят. */
  readonly system: number;
  readonly defender: string;
  readonly attacker: string;
  /** Сколько миров нападающего лежит в одном прыжке отсюда. Мера того, чем есть наступать. */
  readonly adjacent: number;
  readonly enmity: number;
  /**
   * Перемирие Тукайида: клан против Сферы не занимает мир, а ходит в НАБЕГ
   * (решение 2). Сфера на клановую территорию не наступает вовсе, и такие
   * участки в список не попадают.
   */
  readonly raid: boolean;
}

/** Действует ли перемирие Тукайида на этот день (`data/war.json` → `front.truceUntilYear`). */
export function truceHolds(day: number): boolean {
  return dateOf(day).year < F.truceUntilYear;
}

/** Сняло ли событие мира перемирие Тукайида с этой пары (шаг 84, «Бульдог»; `war/events.ts`). */
export function truceLiftedFor(war: WarState, a: string, b: string): boolean {
  return war.truceLifted.includes(factionPairKey(a, b));
}

/**
 * Все участки фронта на сегодня.
 *
 * Один проход по каталогу с обходом соседей — 1322 направленных соседства
 * разных владельцев на 2000 систем, из них выше порога вражды около пятисот.
 * Матрица смежности не строится и не будет: соседи каталога уже посчитаны и
 * закэшированы (`GalaxyCatalog.neighbors`).
 */
export function frontSectors(
  war: WarState,
  rep: ReputationState,
  deltas: GalaxyDeltas,
  day: number,
  owners?: readonly string[],
): FrontSector[] {
  const own = owners ?? ownerArray(deltas);
  const truce = truceHolds(day);
  const out: FrontSector[] = [];

  for (let i = 0; i < GALAXY.count; i++) {
    const defender = own[i] as string;
    const defKind = factionKind(defender);
    let seen: Map<string, number> | null = null;

    for (const j of GALAXY.neighbors(i)) {
      const attacker = own[j] as string;
      if (attacker === defender) continue;
      if (seen === null) seen = new Map<string, number>();
      seen.set(attacker, (seen.get(attacker) ?? 0) + 1);
    }
    if (seen === null) continue;

    for (const [attacker, adjacent] of seen) {
      // ПОДЧИНЕНИЕ СНИМАЕТ УЧАСТОК ЦЕЛИКОМ (шаг 26): сюзерен не воюет с
      // вассалом, вассалы одного сюзерена не воюют друг с другом, а пара под
      // договорным перемирием не воюет, пока договор действует. Это и есть
      // единственный способ, которым малая держава выходит из петли «периметр
      // почти как у большой, а армия вчетверо меньше» (§5в): не победой, а
      // подчинением.
      if (boundOrTruced(war, attacker, defender, day)) continue;
      // ЖИВАЯ вражда, а не таблица 3053 года (шаг 26, часть A). Отсюда петля и
      // замыкается: пара, воевавшая десять лет, дерётся ожесточённее, а пара,
      // помирившаяся, перестаёт быть участком фронта вовсе.
      const deep = liveEnmity(rep, attacker, defender);
      if (deep < F.minEnmity) continue;

      // МИР РОТЫ — участок фронта на общих правах с первого мира (шаг 72c):
      // тот же `capture`, тот же `fastResolve`, те же театры. До шага 72c здесь
      // был частный случай «до ступени державы — только набег», и он закрывал
      // одну оборону: наступала рота с первого мира (`notes.md` §7b).

      const attKind = factionKind(attacker);
      const clanOnSphere = attKind === 'clan' && defKind !== 'clan';
      const sphereOnClan = attKind !== 'clan' && defKind === 'clan';
      // Перемирие связывает кланы со Сферой, но не друг с другом: клан против
      // клана внутри зон оккупации — обычный фронт, и вражда Соколы–Волки 0.70
      // уже лежит в данных.
      // ПЕРЕМИРИЕ ТУКАЙИДА РОТЫ НЕ КАСАЕТСЯ (шаг 72d, решение пользователя):
      // его подписали кланы с КомСтаром, держава роты под ним не стоит. Иначе
      // рота воевала бы с кланами по правилам, которые ей не давали, — а
      // исключение только в одну сторону (рота берёт клановые миры, клан в
      // ответ лишь жжёт) было бы дырой. С ротой клан воюет на общих правах в обе
      // стороны.
      // Снятое событием мира для пары (шаг 84) — тоже: «Бульдог» воюет с Ягуарами на общих правах.
      const underTruce =
        truce && !isPlayerActor(attacker) && !isPlayerActor(defender) && !truceLiftedFor(war, attacker, defender);
      // ОТ ЭТОГО МИРА РОТА ОТКАЗАЛАСЬ (шаг 75): её полки на него не наступают,
      // пока не выйдет срок. Защищён только этот мир и только от роты — новый
      // хозяин наступать на соседние миры роты может.
      if (isPlayerActor(attacker) && (deltas[GALAXY.id(i)]?.abandonedUntil ?? -1) > day) continue;
      if (underTruce && sphereOnClan) continue;
      out.push({ system: i, defender, attacker, adjacent, enmity: deep, raid: underTruce && clanOnSphere });
    }
  }
  // Порядок обхода — свойство каталога, но карта соседей внутри системы
  // перебирается вставкой, и её порядок закреплён явно: взвешенный выбор
  // обязан быть воспроизводим, а не «как получилось».
  out.sort((a, b) =>
    a.system !== b.system ? a.system - b.system : a.attacker < b.attacker ? -1 : 1,
  );
  return out;
}

/**
 * Сколько участков фронта у фракции против каждого врага.
 *
 * Это и есть то, что делает «Соколы стягивают силы к Твайкроссу» осмысленным:
 * такт экономики раскладывает военный фонд по НАПРАВЛЕНИЯМ пропорционально
 * вражде И числу участков, а не по одной вражде. Без второго множителя Соколы
 * копили бы против КомСтара, с которым не граничат ни одним миром, ровно
 * столько же, сколько против Волков, чья граница проходит по их зоне.
 */
export function frontWeights(sectors: readonly FrontSector[]): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  for (const s of sectors) {
    // Участок считается ОБЕИМ сторонам: оборона такое же основание копить, как
    // наступление, и мир, который вот-вот отберут, тянет деньги к себе.
    for (const [from, against] of [
      [s.attacker, s.defender],
      [s.defender, s.attacker],
    ] as const) {
      const row = out[from] ?? (out[from] = {});
      row[against] = (row[against] ?? 0) + 1;
    }
  }
  return out;
}

/**
 * Напор фракции по направлению: сколько тактов собственного дохода она отложила
 * против этого врага.
 *
 * **Знаменатель — доход, а не казна и не средний достаток мира**, и это не
 * мелочь: казна ни у кого не тратится (фракция ничего не покупает на рынке
 * роты) и потому растёт линейно и вечно. Любая мера, выведенная из неё,
 * СЪЁЖИВАЕТСЯ со временем — фонды-то расходуются войной, — и напряжённость
 * фронта к десятому году падала бы до нуля тем сильнее, чем дольше идёт война.
 * Замер это и показал: медиана напряжённости 0.216 за первый год против 0.077 за
 * десять. Доход стоит на месте и служит честной линейкой.
 *
 * Числу в C-Bills здесь делать нечего по той же причине: за десять лет оно
 * вырастет на порядок, и порог, выставленный по нему, протухнет.
 */
export function pushOf(war: WarState, from: string, against: string): number {
  const income = economyOf(war, from).income;
  if (income <= 0) return F.pushBase;
  return F.pushBase + fundOf(war, from, against) / (income * F.pushScale);
}

/**
 * Силы сторон на участке и шанс наступающего.
 *
 * Обе стороны считаются ОДНОЙ формулой с точностью до слагаемого, которое им
 * принадлежит: обороняющемуся — гарнизон мира, побитый разорением; наступающему
 * — сколько миров он держит в одном прыжке. Дальше обоих множит достаток их
 * фракции (21a) и то, что они отложили друг против друга.
 *
 * Разорение бьёт по обороне прямо здесь, и это вторая половина решения 6:
 * разорённый мир и приносит меньше (`systemIncome`), и держится хуже.
 */
export interface SectorForces {
  readonly attack: number;
  readonly defence: number;
  /** Шанс наступающего взять мир за одну попытку, 0..1. */
  readonly odds: number;
}

function focusDefence(deltas: GalaxyDeltas, system: number, natural: WorldFocus): number {
  const focus = focusOf(deltas, GALAXY.id(system), natural);
  return (WAR.industry.focusDefence as Record<string, number>)[focus] ?? 1;
}

export function sectorForces(
  war: WarState,
  worldSeed: number,
  deltas: GalaxyDeltas,
  sector: FrontSector,
  shares: FrontShares,
  realmDefence = 1,
): SectorForces {
  const profile = worldProfile(worldSeed, deltas, sector.system);
  const ruined = deltas[GALAXY.id(sector.system)]?.ruined ?? 0;

  // Готовность армии множит обе стороны (шаг 22c). До неё сила выводилась из
  // одних ДЕНЕГ, и войну можно было вести бесконечно, не имея чем: бой выбивал
  // машины, а следующее наступление шло тем же весом. Теперь обескровленная
  // фракция и наступает вполсилы, и обороняется хуже — та самая обратная связь,
  // без которой круг «накопили → повоевали → потеряли → восстановили» не
  // замыкался.
  //
  // С шага 27 множит уже не общедержавная готовность, а ГОТОВНОСТЬ ТЕАТРА —
  // полков, стянутых на это направление. Разница в том, чего до шага не было
  // вовсе: разбитая армия слабела ВЕЗДЕ разом, потому что пул был один на всю
  // Сферу, и потерять фронт, оставшись сильной, держава не могла по построению.
  //
  // Наступление множится ОДНОЙ готовностью театра: ополчение никуда не летает,
  // и в чужой мир его не пошлёшь.
  const attack =
    F.attackWeight *
    sector.adjacent *
    prosperityOf(war, sector.attacker) *
    theaterReadiness(war, sector.attacker, sector.defender, shares) *
    pushOf(war, sector.attacker, sector.defender);
  // Фокус мира (шаг 25): крепость держится в полтора раза крепче, рудник — хуже.
  // Это и есть «захват втрое дороже» из дорожной карты, выраженное там, где
  // решается исход, — в весах участка, а не отдельной механикой укреплений.
  //
  // ОБОРОНА — ДВА ЭШЕЛОНА (шаг 27, часть A). Гарнизон мира, побитый разорением,
  // — это ОПОЛЧЕНИЕ: оно выводится из населения и военной промышленности, никуда
  // не летает и держит оборону снизу. Поверх него ложится театр обороняющегося
  // против ЭТОГО нападающего, и множитель устроен так, что при полной готовности
  // театра он равен ровно единице: оборона побитово та же, что до шага 27.
  // Расходятся они только там, где театр разбит, — и вот тогда мир держится
  // ополчением (0.30), а не сдаётся первому же наступлению (0.10).
  //
  // Отсюда и то, что было невыразимо: мир на направлении, куда стянуты полки,
  // держится, а мир на тихом фланге той же державы — нет.
  const defence =
    (F.garrisonBase + profile.garrison * (1 - clamp(ruined, 0, 1))) *
    focusDefence(deltas, sector.system, profile.naturalFocus) *
    // Орбитальная оборона мира роты (шаг 87) — отдельным множителем рядом с фокусом; без неё — ровно единица.
    buildingDefence(deltas, sector.system) *
    // Губернатор сектора (шаг 88, навык tactics) — у мира роты; у остальных — ровно единица.
    realmDefence *
    prosperityOf(war, sector.defender) *
    militiaBacked(theaterReadiness(war, sector.defender, sector.attacker, shares)) *
    pushOf(war, sector.defender, sector.attacker);

  const total = attack + defence;
  return { attack, defence, odds: total <= 0 ? 0 : attack / total };
}

/**
 * Напряжённость участка — то, из чего 21b выводит и опасность, и оплату разом.
 *
 * Решение 7 записи «Восемь решений по тикеру войны»: до этого шага оплата шла
 * от вражды, а опасность — от вида фракции цели, и оттого воевать с пиратами
 * было выгоднее и безопаснее РАЗОМ. Теперь обе величины берутся из одного
 * источника — сил, стянутых сторонами к этому месту.
 *
 * Вражда есть у пары фракций, а фронт есть у МЕСТА: враг за соседней звездой
 * даёт полную напряжённость, враг в двух прыжках — долю `proximityFalloff`, а
 * пираты не дают ничего, потому что у вольницы нет своей стороны фронта.
 *
 * На первый день кампании напряжённость всюду нулевая — фонды пусты, — и это
 * не недоделка: биржа стартует ровно такой, какой её оставил 21a, и разогревается
 * вместе с войной.
 */
export function tensionOf(
  war: WarState,
  rep: ReputationState,
  a: string,
  b: string,
  proximity: number,
): number {
  if (a === b || proximity <= 0) return 0;
  // Живая вражда (шаг 26): биржа греется тем, что происходит, а не тем, что
  // стояло в таблице на 3053 год. Пара, заключившая перемирие, работы больше не
  // выбрасывает — тем же порогом, что и участок фронта.
  const deep = liveEnmity(rep, a, b);
  if (deep < F.minEnmity) return 0;
  const stacked = pushOf(war, a, b) + pushOf(war, b, a) - 2 * F.pushBase;
  return clamp(Math.round(deep * proximity * stacked * F.tensionScale * 1000) / 1000, 0, 1);
}

/**
 * Чья на участке инициатива: доля напора нанимателя в общем напоре сторон.
 *
 * 0.5 — равновесие (никто ничего не отложил либо отложили поровну), выше —
 * копит и готовится наступать эта сторона, ниже — та.
 *
 * Ровно это и решает, КАКУЮ работу выставляет биржа: «тип — наступает
 * наниматель или обороняется» (`wiki/design/campaign/reputation.md`, «Как
 * контракты рождаются из войны»). Считается по фондам и не трогает ни одного
 * профиля системы: биржа зовёт это на каждое предложение.
 */
export function initiativeOf(war: WarState, a: string, b: string): number {
  const pa = pushOf(war, a, b);
  const pb = pushOf(war, b, a);
  const total = pa + pb;
  return total <= 0 ? 0.5 : pa / total;
}

/** Что сдвинул один такт фронта. Из этого собирается сводка новостей (часть D). */
export interface FrontMove {
  readonly systemId: string;
  readonly kind: 'capture' | 'raid';
  readonly attacker: string;
  readonly defender: string;
  /** Разорение мира ПОСЛЕ события, 0..1. */
  readonly ruined: number;
  readonly odds: number;
  /**
   * Что вышло из НАСТОЯЩЕГО боя (шаг 22c): сколько машин вывела каждая сторона
   * и сколько потеряла.
   *
   * До 22c исход решал бросок против `odds`, и рассказывать было нечего. Теперь
   * `odds` остаётся ОЖИДАНИЕМ, посчитанным до боя, а эти четыре числа — тем,
   * чем бой кончился. Разойдись они — так и должно быть: «шанс был 0.62, и вот
   * что вышло» и есть то, ради чего кубик убрали.
   */
  readonly attackerSize: number;
  readonly defenderSize: number;
  readonly attackerLost: number;
  readonly defenderLost: number;
}

/**
 * Бой фронта, где держава роты — одна из сторон (шаг 78), при ЛЮБОМ исходе.
 *
 * `FrontMove` рождается только у выигранного наступления, и до шага 78 проигранный бой роты и
 * отбитая оборона её мира не оставляли следа: армия таяла, а игрок не видел ни одного боя. Бои
 * фракций между собой сюда не идут — они в сводке захватами, и ещё пять строк за декаду утопили бы
 * ленту. Числа боя — те же, что у `FrontMove`: силы до боя и то, чем бой кончился.
 */
export interface FrontClash {
  readonly systemId: string;
  readonly attacker: string;
  readonly defender: string;
  /** `captured` — мир сменил владельца, `tributed` — обложен данью, `repelled` — наступление отбито. */
  readonly outcome: 'captured' | 'tributed' | 'repelled';
  readonly odds: number;
  readonly attackerSize: number;
  readonly defenderSize: number;
  readonly attackerLost: number;
  readonly defenderLost: number;
  /** Гарнизон роты в этом бою (шаг 86b): столкновение или отход. Разбор — у вызывающего. */
  readonly garrison?: GarrisonClash;
}

/**
 * Гарнизон мира роты для боя такта (шаг 86b): годные прибывшие машины и можно ли отойти. Такт не читает
 * состояние кампании — гарнизон ему даёт вызывающий; `deltas` — карта на момент боя (отход — на свой мир).
 */
export type GarrisonSource = (system: number, deltas: GalaxyDeltas) => GarrisonInput | undefined;

export interface FrontTickResult {
  readonly war: WarState;
  readonly deltas: GalaxyDeltas;
  /**
   * Матрица отношений фракций ПОСЛЕ такта (шаг 26).
   *
   * До шага 26 её двигал вызывающий (`commands/execute.ts` перебирал `moves` и
   * уводил пары вниз). Теперь подвижек шесть родов, четыре из них рождаются
   * внутри такта дипломатии и вызывающему не видны вовсе, — и правило «матрицу
   * пишет только такт фронта» держится тем, что такт её и возвращает, а не тем,
   * что кто-то снаружи помнит, как её надо подвинуть.
   */
  readonly reputation: ReputationState;
  readonly moves: readonly FrontMove[];
  /** Бои с державой роты при любом исходе (шаг 78). */
  readonly clashes: readonly FrontClash[];
  /** Войны роты, кончившиеся в этот такт без команды мира (шаг 79). */
  readonly warsEnded: readonly PlayerWarEnded[];
  /** Что случилось с замыслами государств (шаг 23, часть B): объявлено, взято, выдохлось. */
  readonly plans: readonly PlanMove[];
  /** Что случилось с подчинением (шаг 26): дань, протекторат, договор — и их истечение. */
  readonly diplomacy: readonly DiplomacyMove[];
}

/**
 * Такт фронта (задача очереди `frontTick`, раз в декаду).
 *
 * Идёт СЛЕДОМ за тактом экономики того же дня: фракции сперва копят, потом
 * воюют накопленным. Порядок держится номером постановки в очередь
 * (`state.ts`), а не совпадением.
 *
 * **Броски здесь есть, в отличие от такта экономики, и их ровно три вида:**
 * сколько наступлений разыграть, какой участок выбрать (взвешенно по силе
 * наступающего) и удалось ли (против `odds`). Больше случайности в мире нет:
 * кто где сильнее, решают числа, а не кубик.
 *
 * Порядок бросков закреплён, как у биржи и профиля системы: любой новый бросок
 * дописывается В КОНЕЦ, иначе весь мир на старых сохранениях станет другим при
 * неизменных данных.
 */
export function frontTick(
  war: WarState,
  deltas: GalaxyDeltas,
  rep: ReputationState,
  worldSeed: number,
  day: number,
  rng: Rng,
  garrisonOf?: GarrisonSource,
  realmDefence?: (system: number) => number,
): FrontTickResult {
  const healed = healRuin(war, deltas, worldSeed);
  let nextWar = healed.war;
  let nextDeltas = healed.deltas;

  // ПОДЧИНЕНИЕ СЧИТАЕТСЯ ПЕРВЫМ (шаг 26) — до замыслов и до наступлений.
  // Порядок здесь и есть порядок круга: истекло и распалось → кто кому подчинён
  // сегодня → государства выбирают цель → идёт рейд по целям. Список участков
  // ниже строится уже с оглядкой на протектораты и перемирия этой декады, а не
  // прошлой.
  const diplomatic = diplomacyTick(nextWar, nextDeltas, rep, day);
  nextWar = diplomatic.war;
  nextDeltas = diplomatic.deltas;
  let nextRep = diplomatic.reputation;
  const diplomacy: DiplomacyMove[] = [...diplomatic.moves];
  // ВОЙНА И МИР РОТЫ (шаг 76) — сразу после дипломатии фракций и до списка
  // участков: война, объявленная роте сегодня, даёт фронт в ту же декаду.
  const playerDiplomacy = playerWarTick(nextWar, nextRep, nextDeltas, day);
  nextWar = playerDiplomacy.war;
  nextRep = playerDiplomacy.reputation;
  diplomacy.push(...playerDiplomacy.moves);

  const sectors = frontSectors(nextWar, nextRep, nextDeltas, day);
  // Доли направлений во фронте считаются ОДИН РАЗ на такт и передаются вниз:
  // они знаменатель готовности театра, а звать их на каждый из пятисот участков
  // значило бы пересчитывать весь фронт пятьсот раз за декаду.
  const shares = frontShares(frontWeights(sectors));
  const moves: FrontMove[] = [];
  // Выигранные наступления — все, чем бы они ни кончились. Матрицу двигает сам
  // ФАКТ боя, а не его исход: дань, захват и набег одинаково означают, что
  // между этими двумя стреляли. По `moves` эту подвижку считать нельзя — дань
  // владельца не меняет и события хода не рождает.
  const clashes: FrontSector[] = [];
  const realmClashes: FrontClash[] = [];
  if (sectors.length === 0) {
    const world = worldDiplomacy(nextWar, nextRep, nextDeltas, worldSeed, day, shares);
    diplomacy.push(...world.moves);
    return {
      war: world.war,
      deltas: nextDeltas,
      reputation: world.reputation,
      moves,
      clashes: realmClashes,
      warsEnded: playerDiplomacy.ended,
      plans: [],
      diplomacy,
    };
  }

  // ГОСУДАРСТВА ВЫБИРАЮТ ЦЕЛЬ — и делают это ДО наступлений той же декады
  // (шаг 23, часть B). Порядок здесь и есть порядок круга из постановки задачи:
  // силы накапливаются → государства выбирают цель → идёт рейд по целям.
  const planned = planTick(nextWar, sectors, day, rng);
  nextWar = planned.war;

  const attempts = rng.int(F.attemptsMin, F.attemptsMax);
  const garrisoned = new Set<number>();
  for (let n = 0; n < attempts; n++) {
    const sector = pickSector(nextWar, sectors, rng);
    if (sector === null) break;

    // Список участков считается ОДИН РАЗ на такт, а взятый мир меняет владельца
    // прямо посреди такта: без этой проверки второе наступление той же декады
    // отняло бы уже отнятый мир у прежнего владельца ещё раз, и доход фракции
    // разошёлся бы с картой. Замер поймал это на десятилетнем прогоне —
    // 17 миллионов расхождения там, где обязан быть ноль.
    //
    // Попытка при этом СГОРАЕТ, а не переигрывается: наступление, опоздавшее к
    // уже занятому миру, — обычное дело на войне, и переигрывать его значило бы
    // выдать фронту бесплатный второй бросок.
    if (ownerOf(nextDeltas, sector.system) !== sector.defender) continue;

    const forces = sectorForces(nextWar, worldSeed, nextDeltas, sector, shares, realmDefence?.(sector.system) ?? 1);
    // ЗДЕСЬ БЫЛ КУБИК. До шага 22c стояло `rng.next() < forces.odds`: веса
    // считались честно, а бой заменялся броском. Теперь участок разыгрывается
    // тем же `fastResolve` и тем же сборщиком состава, что и вылет роты
    // (`war/battle.ts`), — решение пользователя 2026-09-04, «фальши не должно
    // быть нигде».
    // ГАРНИЗОН РОТЫ (шаг 86b) дерётся за свой мир один раз за такт: второе наступление той же декады на
    // удержанный мир идёт без него — машины уже побиты, а их разбор делает вызывающий после такта.
    const garrison =
      garrisonOf !== undefined && isPlayerActor(sector.defender) && !garrisoned.has(sector.system)
        ? garrisonOf(sector.system, nextDeltas)
        : undefined;
    if (garrison !== undefined) garrisoned.add(sector.system);
    const fought = resolveFrontBattle(sector, forces, nextWar, worldSeed, nextDeltas, day, 'front', [], garrison);
    const won = fought.won;
    // Бой с ротой заводит запись войны, если её не было: пираты и кланы — враги
    // роты от рождения, объявлять им войну незачем (шаг 76).
    nextWar = notePlayerFight(nextWar, sector.attacker, sector.defender, day);

    // Наступление стоит денег обеим сторонам независимо от исхода: без стока
    // фонды росли бы вечно, и «копит против Куриты» перестало бы что-либо
    // значить — направление, по которому воюют десять лет, читалось бы так же,
    // как направление, где не было ни одного выстрела.
    nextWar = spend(nextWar, sector.attacker, sector.defender, F.attemptCost + (won ? F.captureCost : 0));
    nextWar = spend(nextWar, sector.defender, sector.attacker, F.attemptCost);
    // Выбитые машины уходят из ТЕАТРА обеих сторон — это и есть цена войны,
    // которой до 22c не было: бои считались, а терять было нечего. С шага 27
    // они списываются с направления, а не с общего пула, и списываются только
    // если на направлении что-то было: машины, которых там не стояло, потерять
    // там нельзя — за них дралось ополчение, которого фронт не считает.
    const beforeLoss = nextWar;
    nextWar = withTheaterLoss(nextWar, sector.attacker, sector.defender, fought.attackerLost);
    nextWar = withTheaterLoss(nextWar, sector.defender, sector.attacker, fought.defenderLost);
    // Потери утомляют стороны войны роты (шаг 81); бои без роты усталости не знают.
    nextWar = notePlayerLosses(
      beforeLoss,
      nextWar,
      sector.attacker,
      sector.defender,
      fought.attackerSize,
      fought.defenderSize,
    );
    // Бой с ротой — событие при любом исходе (шаг 78); исход дописывается ниже, когда он известен.
    const withRealm = isPlayerActor(sector.attacker) || isPlayerActor(sector.defender);
    const clash = (outcome: FrontClash['outcome']): FrontClash => ({
      systemId: GALAXY.id(sector.system),
      attacker: sector.attacker,
      defender: sector.defender,
      outcome,
      odds: Math.round(forces.odds * 1000) / 1000,
      attackerSize: fought.attackerSize,
      defenderSize: fought.defenderSize,
      attackerLost: fought.attackerLost,
      defenderLost: fought.defenderLost,
      ...(fought.garrison === undefined ? {} : { garrison: fought.garrison }),
    });
    if (!won) {
      if (withRealm) realmClashes.push(clash('repelled'));
      continue;
    }

    // ЗАХВАТ ИЛИ ДАНЬ (шаг 26, часть B) — выбор, которого у победителя не было.
    // Веса решают, что выгоднее: отнять мир (гарнизон, администрация,
    // разорение) или обложить его данью и оставить прежнему хозяину.
    //
    // Клановый набег под перемирием Тукайида данью НЕ кончается: это дело чести
    // молодого воина, а не сбор податей, и превращать четверть карты в
    // клановую налоговую базу шаг 26 не собирался. На мир роты набегов нет
    // вовсе (шаги 72c, 72d): он участок фронта на общих правах, и дань с него
    // берут обычной победой.
    const mayTribute = !sector.raid;
    const tributed =
      mayTribute && prefersTribute(nextWar, nextRep, worldSeed, nextDeltas, sector);

    clashes.push(sector);
    // Набега с ротой не бывает (`frontSectors`: перемирие Тукайида роты не касается), поэтому исход
    // боя с ней — захват или дань.
    if (withRealm) realmClashes.push(clash(tributed ? 'tributed' : 'captured'));
    const applied = sector.raid
      ? raid(nextWar, nextDeltas, worldSeed, sector, rng)
      : tributed
        ? null
        : capture(nextWar, nextDeltas, worldSeed, sector, rng, day);
    if (applied !== null) {
      nextWar = applied.war;
      nextDeltas = applied.deltas;
      moves.push({
        ...applied.move,
        odds: Math.round(forces.odds * 1000) / 1000,
        attackerSize: fought.attackerSize,
        defenderSize: fought.defenderSize,
        attackerLost: fought.attackerLost,
        defenderLost: fought.defenderLost,
      });
    }
    if (tributed) {
      const imposed = imposeTribute(
        nextWar,
        nextDeltas,
        nextRep,
        sector.attacker,
        sector.system,
        day,
      );
      nextWar = imposed.war;
      nextDeltas = imposed.deltas;
      nextRep = imposed.reputation;
      diplomacy.push(imposed.move);
    }
    // Взятый мир засчитывается в замысел ТОЛЬКО если отнят у того, против кого
    // замысел объявлен: попутный захват у третьей стороны к главному удару
    // отношения не имеет (`plans.ts::notePlanCapture`). Ни набег, ни дань не
    // засчитываются — владельца они не меняют, а замысел считает именно миры.
    if (!sector.raid && !tributed) {
      nextWar = notePlanCapture(nextWar, sector.attacker, sector.defender);
      // Счёт войны роты (шаг 76): из него выводятся условия мира.
      nextWar = notePlayerCapture(nextWar, sector.attacker, sector.defender, day, GALAXY.id(sector.system));
    }
  }

  // МАТРИЦА ДВИГАЕТСЯ ЗДЕСЬ, И ТОЛЬКО ЗДЕСЬ (шаг 26, часть A завершает то, что
  // начал 21b). Каналов теперь два, а не один.
  //
  // Вниз: каждое наступление уводит воевавшую пару на `relationPerMove`, и
  // набег на чужого данника — ещё и отдельно, крупнее: иначе дань ничего не
  // стоила бы тому, кто её не платит.
  //
  // Вверх: подчинение и договоры (внутри такта дипломатии) плюс общий враг —
  // две державы, наступавшие на третью в одну декаду. Тяги к базовой линии нет
  // и не будет: мир помнит не 3053 год, а то, что произошло (разбор —
  // `decayReputation`).
  for (const c of clashes) {
    nextRep = shift(nextRep, c.attacker, c.defender, -F.relationPerMove);
    // Ударил по чужому даннику — поссорился с тем, кому тот платит. Без этой
    // строки дань не стоила бы ничего тому, кто её не платит, и держава,
    // подчинившая соседа, не имела бы никакой причины его защищать.
    const patron = tributeOf(nextDeltas, GALAXY.id(c.system), day);
    if (patron !== undefined && patron !== c.attacker && patron !== c.defender) {
      nextRep = shift(nextRep, c.attacker, patron, -RELATIONS.moves.raidOnTributary);
    }
  }
  for (const [a, b] of commonEnemyPairs(clashes)) {
    nextRep = shift(nextRep, a, b, RELATIONS.moves.commonEnemy);
  }

  // ДИПЛОМАТИЯ МИРА (шаг 83) — когда захваты и потери этой декады уже известны: угроза, коалиции,
  // второй фронт, торговля; память захватов тает. Подписанное снимает участки со следующей декады.
  const world = worldDiplomacy(nextWar, nextRep, nextDeltas, worldSeed, day, shares);
  nextWar = world.war;
  nextRep = world.reputation;
  diplomacy.push(...world.moves);

  // РОСПУСК ПО БЕЗДЕЙСТВИЮ (шаг 26) — последним, когда уже известно, на каких
  // направлениях в эту декаду стреляли. Разбор — `economy.ts::releaseIdleFunds`.
  const active = new Set<string>();
  for (const c of clashes) {
    active.add(`${c.attacker}>${c.defender}`);
    active.add(`${c.defender}>${c.attacker}`);
  }
  nextWar = releaseIdleFunds(nextWar, active);

  return {
    war: nextWar,
    deltas: nextDeltas,
    reputation: nextRep,
    moves,
    clashes: realmClashes,
    warsEnded: playerDiplomacy.ended,
    plans: planned.moves,
    diplomacy,
  };
}

/**
 * Какой участок разыгрывается этой попыткой.
 *
 * Взвешенно по силе наступающего, а не перебором всех пятисот с выбором
 * лучшего: перебор дал бы один и тот же самый жирный участок каждый такт, пока
 * он не падёт, и фронт двигался бы строкой, а не полосой. Вес считается по
 * дешёвым величинам — достаток и фонд, — и профиль системы не трогает вовсе:
 * две тысячи профилей на такт стоили бы дороже всего остального шага.
 */
function pickSector(war: WarState, sectors: readonly FrontSector[], rng: Rng): FrontSector | null {
  let total = 0;
  const weights = new Array<number>(sectors.length);
  for (let i = 0; i < sectors.length; i++) {
    const s = sectors[i] as FrontSector;
    // ПУСТОЙ ТЕАТР РОТЫ НЕ НАСТУПАЕТ (шаг 80). Пол готовности `armyMinShare` — предохранитель
    // фракций от обвала; у роты он давал бесплатную армию: держава без единой машины наступала и
    // брала миры (проба: 8 миров у Куриты за полтора года при армии 0). Вес ноль — участок не
    // выбирается, бросок выбора остаётся один.
    if (isPlayerActor(s.attacker) && theaterOf(war, s.attacker, s.defender) <= 0) {
      weights[i] = 0;
      continue;
    }
    // Замысел государства (шаг 23, часть B) множит вес участка, попавшего в
    // зону главного удара. ПЕРЕВЕС, а не запрет: наступить в другом месте
    // фракция по-прежнему может, и фронт остаётся полосой, а не строкой.
    const w =
      s.enmity *
      s.adjacent *
      prosperityOf(war, s.attacker) *
      pushOf(war, s.attacker, s.defender) *
      planWeight(war, s);
    weights[i] = w;
    total += w;
  }
  if (total <= 0) return null;

  let roll = rng.next() * total;
  for (let i = 0; i < sectors.length; i++) {
    roll -= weights[i] as number;
    if (roll <= 0) return sectors[i] as FrontSector;
  }
  return sectors[sectors.length - 1] as FrontSector;
}

/** Списать долю фонда направления. Ноль удаляет запись — дисциплина разрежённости. */
export function spendFrontFund(war: WarState, from: string, against: string, share: number): WarState {
  return spend(war, from, against, share);
}

function spend(war: WarState, from: string, against: string, share: number): WarState {
  const have = fundOf(war, from, against);
  if (have <= 0) return war;
  return withFund(war, from, against, have * (1 - clamp(share, 0, 1)));
}

interface Applied {
  readonly war: WarState;
  readonly deltas: GalaxyDeltas;
  // Ход события знает про мир (кто, куда, насколько разорено), а числа боя
  // приходят от `resolveFrontBattle` и приписываются в `frontTick`: захват и
  // набег не должны знать, чем именно бой кончился, — они знают только, что он
  // выигран.
  readonly move: Omit<FrontMove, 'odds' | 'attackerSize' | 'defenderSize' | 'attackerLost' | 'defenderLost'>;
}

/**
 * Мир сменил владельца.
 *
 * Экономика правится ПРИРАЩЕНИЕМ: доход и содержание этого мира уходят от
 * прежнего владельца к новому, и число миров у обоих сдвигается на единицу.
 * Полный пересчёт по каталогу дал бы то же число ценой двух тысяч профилей — и
 * ровно это `makeWarState` и делает, но один раз за кампанию.
 */
export function applySystemCapture(
  war: WarState,
  deltas: GalaxyDeltas,
  worldSeed: number,
  system: number | string,
  attacker: string,
  defender: string,
  rng: Rng,
  day: number,
): Applied {
  const sysIndex = typeof system === 'number' ? system : GALAXY.require(system);
  const id = GALAXY.id(sysIndex);
  const profile = worldProfile(worldSeed, deltas, sysIndex);
  const isCapital = GALAXY.hasFlag(sysIndex, 'capital');
  const wasRuined = deltas[id]?.ruined ?? 0;
  const ruined = clamp(
    Math.round((wasRuined + F.captureRuinMin + rng.next() * (F.captureRuinMax - F.captureRuinMin)) * 1000) /
      1000,
    0,
    1,
  );

  // Фокус мира при смене хозяина НЕ сбрасывается — заводы и рудники остаются на
  // месте, — но незавершённая переделка отменяется ниже: новый хозяин не
  // доводит до конца стройку прежнего.
  const focus = focusOf(deltas, id, profile.naturalFocus);
  // ПЛЕЧО СЧИТАЕТСЯ ОБЕИМ СТОРОНАМ ПО ИХ СОБСТВЕННЫМ СТОЛИЦАМ (шаг 27), и это
  // единственная величина мира, у которой при смене флага меняется не только
  // размер, но и СМЫСЛ: приграничный мир Куриты лежит у самой границы Дэвиона,
  // и Дэвиону он обходится дешевле, чем обходился Курите, — или наоборот.
  // Взять «плечо мира» одно на обе стороны значило бы, что захват не меняет
  // содержания вовсе.
  const wasJumps = capitalJumps(deltas, sysIndex, defender);
  const nowJumps = capitalJumps(deltas, sysIndex, attacker);
  // Прибавка космопорта роты (`galaxy/profile.ts::spaceportBoostOf`) действует, пока мир у роты: новому
  // владельцу вклад считается по профилю уже без неё — ровно тот, что даст полный пересчёт экономики.
  const nowProfile =
    spaceportBoostOf(deltas, sysIndex) === NO_PROFILE_BOOST
      ? profile
      : systemProfile(worldSeed, sysIndex, developmentOf(deltas, id));
  const nowFocus = nowProfile === profile ? focus : focusOf(deltas, id, nowProfile.naturalFocus);
  const was = worldContribution(profile, isCapital, wasRuined, focus, wasJumps);
  const now = worldContribution(nowProfile, isCapital, ruined, nowFocus, nowJumps);

  const from = economyOf(war, defender);
  let next = withEconomy(war, defender, {
    income: from.income - was.income,
    upkeep: from.upkeep - was.upkeep,
    capacity: from.capacity - was.capacity,
    lift: from.lift - was.lift,
    worlds: from.worlds - 1,
  });
  const to = economyOf(next, attacker);
  next = withEconomy(next, attacker, {
    income: to.income + now.income,
    upkeep: to.upkeep + now.upkeep,
    capacity: to.capacity + now.capacity,
    lift: to.lift + now.lift,
    worlds: to.worlds + 1,
  });

  // Мир, отбитый ПРЕЖНИМ хозяином, теряет запись о владельце целиком: дельта
  // хранит только то, чем мир отличается от канона, и «владелец тот же, что и
  // был» — не отличие. Та же дисциплина, что у `withStanding`, `withFund` и
  // `withRelation`; без неё за десять лет войны в снимке копились бы сотни
  // записей, не несущих ни одного бита.
  const owner = attacker === GALAXY.ownerId(sysIndex) ? undefined : attacker;

  // Столица роты не переезжает от захвата (шаг 76): рота, берущая мир, сперва
  // закрепляет ту столицу, что у неё была; рота, теряющая столицу, передаёт её
  // первому из оставшихся миров вместе с днём последнего переноса.
  const before = isPlayerActor(attacker) ? withPlayerCapitalPinned(deltas) : deltas;
  const lostSince =
    isPlayerActor(defender) && domainCapitalIndex(before) === sysIndex ? before[id]?.realmCapitalSince : undefined;
  const after = withDelta(before, id, {
    owner,
    ruined,
    focusTo: undefined,
    focusUntil: undefined,
    // Столица роты, взятая врагом, перестаёт быть столицей: флаг не
    // возвращается сам, если мир когда-нибудь отобьют (шаг 72a).
    realmCapitalSince: undefined,
    realmCapital: undefined,
    abandonedUntil: undefined,
    // Лояльность (шаг 85): взятый ротой мир стартует как взятый силой, ушедший от роты её теряет.
    ...(isPlayerActor(attacker) ? acquiredPatch('force', defender) : LOYALTY_CLEARED),
    // Постройки роты (шаг 87): мир ушёл от роты — недострой пропадает, готовые уцелевают броском и спят.
    ...(isPlayerActor(defender) ? buildingsLostPatch(worldSeed, deltas, id, day).patch : {}),
  });

  return {
    // Взятый силой мир — в память захватов (шаг 83): из неё угроза и перемирие второго фронта. Здесь,
    // а не у вызывающих: этим путём берут мир фронт, приказ армии роты и контракт на захват.
    war: withConquest(next, attacker, defender),
    deltas: isPlayerActor(defender) || isPlayerActor(attacker) ? withPlayerCapitalPinned(after, lostSince) : after,
    move: {
      systemId: id,
      kind: 'capture',
      attacker,
      defender,
      ruined,
    },
  };
}

function capture(
  war: WarState,
  deltas: GalaxyDeltas,
  worldSeed: number,
  sector: FrontSector,
  rng: Rng,
  day: number,
): Applied {
  return applySystemCapture(war, deltas, worldSeed, sector.system, sector.attacker, sector.defender, rng, day);
}

/**
 * Клановый набег: владелец не меняется, промышленность горит.
 *
 * Перемирие Тукайида связывает кланы со Сферой, но не связывает молодого воина,
 * которому нужно родовое имя, а договор навесили старики (решение 2). Для
 * игрока это растущая угроза, а не декорация в четверти карты: разорённый
 * набегом мир беднеет, хуже держится и выбрасывает на биржу самую тяжёлую
 * работу, какая в Сфере бывает.
 */
function raid(
  war: WarState,
  deltas: GalaxyDeltas,
  worldSeed: number,
  sector: FrontSector,
  rng: Rng,
): Applied {
  const id = GALAXY.id(sector.system);
  const wasRuined = deltas[id]?.ruined ?? 0;
  const ruined = clamp(
    Math.round((wasRuined + F.raidRuinMin + rng.next() * (F.raidRuinMax - F.raidRuinMin)) * 1000) / 1000,
    0,
    1,
  );

  return {
    war: shiftRuin(war, deltas, sector.defender, worldSeed, sector.system, wasRuined, ruined),
    deltas: withDelta(deltas, id, { ruined }),
    move: { systemId: id, kind: 'raid', attacker: sector.attacker, defender: sector.defender, ruined },
  };
}

/**
 * Разорение мира изменилось: доход и МОЩНОСТЬ владельца правятся ровно на
 * разницу.
 *
 * Мощность добавлена шагом 25, и это то звено, которого войне не хватало:
 * сожжённый промышленный узел перестаёт снабжать фронт немедленно, а не через
 * падение дохода на несколько процентов. Содержание при этом не двигается —
 * разорённый мир держать так же дорого (решение 6 шага 21b).
 */
/**
 * Разорение мира сдвинулось — поправить экономику владельца ПРИРАЩЕНИЕМ.
 *
 * Экспортируется с шага 37a: пиратский набег жжёт мир той же рукой, что и
 * клановый (`raid`), и вторая функция «применить разорение» разошлась бы с этой
 * молча — ровно так же, как разошлись бы два определения фронта.
 */
export function shiftRuin(
  war: WarState,
  deltas: GalaxyDeltas,
  owner: string,
  worldSeed: number,
  system: number,
  wasRuined: number,
  ruined: number,
): WarState {
  const profile = worldProfile(worldSeed, deltas, system);
  const isCapital = GALAXY.hasFlag(system, 'capital');
  const focus = focusOf(deltas, GALAXY.id(system), profile.naturalFocus);
  const before = worldContribution(profile, isCapital, wasRuined, focus);
  const after = worldContribution(profile, isCapital, ruined, focus);
  const eco = economyOf(war, owner);
  return withEconomy(war, owner, {
    income: eco.income + after.income - before.income,
    capacity: eco.capacity + after.capacity - before.capacity,
    // Подъёмная сила бьётся разорением наравне с мощностью: сожжённый порт
    // полков не возит. Содержание — по-прежнему нет (решение 6 шага 21b), и
    // плечо тут не меняется: мир никуда не переехал.
    lift: eco.lift + after.lift - before.lift,
  });
}

/**
 * Заживление разорения — годами, а не декадами (решение 6).
 *
 * Идёт по разрежённой карте дельт, а не по каталогу: разорённых миров десятки,
 * и перебирать ради них две тысячи систем незачем. Запись, зажившая до нуля,
 * из дельты УДАЛЯЕТСЯ — иначе разрежённость протекла бы через первую же
 * закончившуюся войну.
 */
function healRuin(
  war: WarState,
  deltas: GalaxyDeltas,
  worldSeed: number,
): { war: WarState; deltas: GalaxyDeltas } {
  if (F.healPerTick <= 0) return { war, deltas };
  let nextWar = war;
  let nextDeltas = deltas;

  for (const id of Object.keys(deltas).sort()) {
    const was = deltas[id]?.ruined;
    if (was === undefined || was <= 0) continue;
    const now = Math.round(Math.max(0, was - F.healPerTick) * 1000) / 1000;
    if (now === was) continue;
    const i = GALAXY.index(id);
    if (i < 0) continue;
    nextWar = shiftRuin(nextWar, nextDeltas, ownerOf(nextDeltas, i), worldSeed, i, was, now);
    nextDeltas = withDelta(nextDeltas, id, { ruined: now === 0 ? undefined : now });
  }
  return { war: nextWar, deltas: nextDeltas };
}

/**
 * Какая доля миров фракции выжжена войной — сумма разорений, делённая на число
 * миров.
 *
 * **Это и есть то, чем ступень «разорена» отличается от ступени «стеснена»**, и
 * различить их иначе не вышло. Соблазн был прямой: сделать «разорена» нижней
 * ступенью ДОСТАТКА. Замер отверг его дважды. При пороге 0.7 независимые миры
 * читались разорёнными на 69 сидах из 200 в ПЕРВЫЙ день кампании (это нашёл ещё
 * 21a). А когда 21b снял ограничение полосы и посмотрел на настоящий разброс,
 * оказалось, что дна у бедности и дна у войны почти не разнести: минимум на
 * старте 0.328, минимум после двенадцати лет войны 0.200, и любой порог между
 * ними держится на удаче конкретного сида.
 *
 * Разорение же на первый день кампании равно нулю у ВСЕХ и на любом сиде — не
 * по калибровке, а по построению: `ruined` пишет только фронт. Слово «разорена»
 * поэтому означает войну ровно и всегда.
 *
 * Считается по разрежённой карте дельт, а не по каталогу: разорённых миров
 * десятки, и перебирать ради них две тысячи систем незачем.
 */
export function ruinShareOf(deltas: GalaxyDeltas, factionId: string, worlds: number): number {
  if (worlds <= 0) return 0;
  let total = 0;
  for (const id of Object.keys(deltas)) {
    const ruined = deltas[id]?.ruined;
    if (ruined === undefined || ruined <= 0) continue;
    if (ownerOf(deltas, id) === factionId) total += ruined;
  }
  return total / worlds;
}

/**
 * Вклад роты в войну (решение 5, часть C шага 21b).
 *
 * Выигранный контракт добавляет нанимателю в фонд ПРОТИВ ЦЕЛИ долю гонорара.
 * Четыре машины не выигрывают войну: доля подобрана так, чтобы вклад читался в
 * сводке и не был виден на карте, — рота, взявшая двадцать контрактов подряд у
 * одного Дома, не должна двигать фронт сама.
 */
export function withCompanyEffort(war: WarState, employer: string, target: string, payout: number): WarState {
  if (employer === target || payout <= 0 || F.companyShare <= 0) return war;
  return withFund(war, employer, target, fundOf(war, employer, target) + payout * F.companyShare);
}
