import { CHASSIS_LIST, SKILL_IDS, TERRAIN, WEAPON_LIST } from '../core/data/tables.js';
import { ZONE_IDS } from '../core/model/HitZone.js';
import { runBattle, type AutoBattleOptions, type BattleReport, type ByClass } from './autoBattle.js';
import { LANCE_VS_LANCE, makeRandomScenario } from './scenario.js';

/**
 * Батч-прогон баланса (game_core.md §12, шаг 2).
 *
 * Смысл в том, чтобы числа в JSON правились по замерам, а не на глаз. Пока нет
 * батча, весь баланс M2–M6 настраивается вслепую, а при чистом ядре это полсотни
 * строк — поэтому он появляется сразу, а не на M8.
 */

export const CSV_COLUMNS = [
  'seed',
  'corners',
  'turns',
  'winner',
  'survivors_player',
  'survivors_opfor',
  'shots',
  'hits',
  'hit_rate',
  'avg_to_hit',
  'hard_target_share',
  'situational_cap_share',
  'capped_share',
  'piloting_checks',
  'falls',
  'botches',
  'botch_rate',
  'poise_saves',
  'damage',
  'head_hits',
  'head_hit_rate',
  'injuries',
  'pilots_out',
  'pilots_ejected',
  'pilots_lost',
  'units_destroyed',
  'criticals',
  'criticals_effective',
  'ammo_explosions',
  'weapons_lost',
  'limbs_lost',
  'legs_lost',
  'shutdowns',
  'stand_ups',
  'jumps',
  'max_heat',
  'avg_heat',
  'avg_walk_mp',
  'trophies',
  'immobilized',
  'cockpit_breaches',
  'cockpit_breaches_lost',
  'first_contact_turn',
  'first_shot_turn',
  'contact_blip',
  'contact_silhouette',
  'contact_identified',
  'shots_at_blip',
  'shots_at_silhouette',
  'pulse_shots',
  'pulse_hits',
  'pulse_hit_rate',
  'avg_range',
  'run_share',
  'full_volley_share',
  'voluntary_ejections',
  'formation_together_share',
  'new_contacts_opened',
  'contacts_lost',
  'contact_dropped_below_silhouette',
  'hash',
] as const;

function ratio(a: number, b: number): string {
  return b === 0 ? '0' : (a / b).toFixed(4);
}

export function csvRow(r: BattleReport, corners: CornerLayout = 'base'): string {
  const s = r.stats;
  return [
    r.seed,
    corners,
    r.turns,
    r.winner,
    r.survivors['player'] ?? 0,
    r.survivors['opfor'] ?? 0,
    s.shots,
    s.hits,
    ratio(s.hits, s.shots),
    ratio(s.toHitTargetSum, s.shots),
    ratio(s.shotsHardTarget, s.shots),
    ratio(s.shotsSituationalCapped, s.shots),
    ratio(s.shotsCapped, s.shots),
    s.pilotingChecks,
    s.falls,
    s.botches,
    ratio(s.botches, s.shots),
    s.poiseSaves,
    s.damage,
    s.headHits,
    // Доля попаданий в кокпит от всех попаданий по зонам — то число, под которое
    // подобраны вероятности ранений. Если оно уедет, ранения обязаны быть пересчитаны.
    ratio(s.headHits, s.hits),
    s.injuries,
    s.pilotsOut,
    s.pilotsEjected,
    s.pilotsLost,
    s.unitsDestroyed,
    s.criticals,
    s.criticalsEffective,
    s.ammoExplosions,
    s.weaponsLost,
    s.limbsLost,
    s.legsLost,
    s.shutdowns,
    s.standUps,
    s.jumps,
    s.maxHeat,
    ratio(s.heatSum, s.heatSamples),
    ratio(s.walkMpSum, s.walkMpSamples),
    s.trophies,
    s.immobilized,
    s.cockpitBreaches,
    s.cockpitBreachesLost,
    s.firstContactTurn,
    s.firstShotTurn,
    s.contactSamples[1],
    s.contactSamples[2],
    s.contactSamples[3],
    s.shotsAtBlip,
    s.shotsAtSilhouette,
    s.pulseShots,
    s.pulseHits,
    ratio(s.pulseHits, s.pulseShots),
    ratio(s.rangeSum, s.rangeSamples),
    ratio(s.runMoves, s.moveActions),
    ratio(s.fullVolleys, s.volleyOpportunities),
    s.voluntaryEjections,
    ratio(s.formationTogether, s.formationSamples),
    s.newContactsOpened,
    s.contactsLost,
    s.contactDroppedBelowSilhouette,
    r.hash,
  ].join(',');
}

export interface BatchSummary {
  readonly battles: number;
  readonly draws: number;
  readonly winsPlayer: number;
  readonly winsOpfor: number;
  readonly avgTurns: number;
  readonly hitRate: number;
  readonly botchRate: number;
  /**
   * Боевая математика попадания (шаг 29): среднее целевое число, доля выстрелов
   * с целью 11-12 и доля выстрелов, где сумма модификаторов упёрлась в потолок.
   * Последнее число — прямая мерка правки шага 30.
   */
  readonly avgToHit: number;
  readonly hardTargetShare: number;
  /** Доля выстрелов, где обстановка упёрлась в свой потолок: правило, а не сбой. */
  readonly situationalCapShare: number;
  /** Доля выстрелов за краем шкалы 2d6: обязана быть близкой к нулю. */
  readonly cappedShare: number;
  readonly avgOverflow: number;
  /** Бросков на равновесие и падений за бой — мерка спама проверок (шаг 30). */
  readonly pilotingChecksPerBattle: number;
  readonly fallsPerBattle: number;
  /**
   * На 100 ходов машины в строю, по весовому классу (индекс `WeightClass`):
   * бросков на равновесие от урона за ход и падений от них. Критерий порогов
   * `piloting.fallDamageByClass` — `wiki/overview/corridors.md` (2026-09-15).
   */
  readonly damageChecksPer100TurnsByClass: readonly number[];
  readonly damageFallsPer100TurnsByClass: readonly number[];
  /** Ходов в строю по классу — объём выборки под строкой выше. */
  readonly unitTurnsByClass: readonly number[];
  readonly headHitRate: number;
  readonly injuriesPerBattle: number;
  readonly pilotsOutPerBattle: number;
  readonly pilotsEjectedPerBattle: number;
  readonly pilotsLostPerBattle: number;
  /** Механики шага 4: без этих строк непонятно, случаются ли они вообще. */
  readonly criticalsPerBattle: number;
  readonly criticalsEffectiveShare: number;
  readonly ammoExplosionsPerBattle: number;
  readonly weaponsLostPerBattle: number;
  readonly limbsLostPerBattle: number;
  /** Из limbsLostPerBattle — отдельно ноги (шаг 6, часть F). */
  readonly legsLostPerBattle: number;
  readonly shutdownsPerBattle: number;
  readonly standUpsPerBattle: number;
  /** Прыжков за бой — проверка, что часть C (двигатели по машине) случается. */
  readonly jumpsPerBattle: number;
  readonly shotsPerUnitTurn: number;
  readonly avgHeat: number;
  readonly maxHeat: number;
  /** Средний MP ходьбы по всем машинам, с учётом повреждений (часть B/D). */
  readonly avgWalkMp: number;
  readonly trophiesPerBattle: number;
  /** Доля выбывших машин, доставшихся победителю трофеем, а не грудой. */
  readonly trophyShare: number;
  /** Обездвиженных (нога/гироскоп) за бой — узкое подмножество трофеев. */
  readonly immobilizedPerBattle: number;
  /** Пробитий кокпита за бой — сколько раз бросали 1d6 на остекление (шаг 6). */
  readonly cockpitBreachesPerBattle: number;
  /** Доля пробитий, стоивших пилота: проверка, что порог 1d6 работает как задумано. */
  readonly cockpitBreachLostShare: number;
  /** Ход первого контакта и ход первого выстрела (шаг 7). Совпали — сенсоры коротки. */
  readonly firstContactTurn: number;
  readonly firstShotTurn: number;
  /** Доли наблюдений по уровням: засветка, силуэт, опознан. Сумма — 1. */
  readonly contactShareBlip: number;
  readonly contactShareSilhouette: number;
  readonly contactShareIdentified: number;
  /** Доля выстрелов, сделанных по неопознанной цели. */
  readonly blindShotShare: number;
  /** Доля попаданий импульсным оружием от всех его выстрелов (шаг 8, A3). */
  readonly pulseHitRate: number;
  /** Средняя дистанция выстрела в гексах — по ней видна личность (шаг 8, B). */
  readonly avgRange: number;
  /** Доля ходов бегом от всех совершённых движений. */
  readonly runShare: number;
  /** Доля возможностей стрелять всем, чем доставало, использованных полностью. */
  readonly fullVolleyShare: number;
  /** Добровольных катапультирований за бой (не считая вынужденных). */
  readonly voluntaryEjectionsPerBattle: number;
  /** Доля концов хода, когда живая машина стоит рядом (≤3 гекса) с союзником. */
  readonly formationTogetherShare: number;
  /** Новых контактов (с `None` до чего-то) за бой — случается ли разведка. */
  readonly newContactsOpenedPerBattle: number;
  /** Потерянных контактов за бой — была ли памяти о контакте причина сработать. */
  readonly contactsLostPerBattle: number;
  /** Мигания ниже силуэта за бой (проверка `contactFloorAtSilhouette`) — по замыслу всегда 0. */
  readonly contactDroppedBelowSilhouettePerBattle: number;
  /**
   * Доля боёв, в которых сторона ОБЪЯВИЛА отход, доля боёв, где хоть одна
   * машина реально ушла с поля, и сколько таких машин за бой (шаг 43).
   *
   * Три числа, а не одно, и каждое отвечает на свой вопрос. Объявление —
   * «сломалась ли мораль вообще»; оно случается почти в каждом бою, потому что
   * почти в каждом бою одна из сторон в какой-то момент рассыпается. Уход —
   * «успели ли дойти до края»; именно он и меняет и трофеи, и длину боя.
   */
  readonly withdrawalShare: number;
  readonly escapedShare: number;
  readonly withdrawnUnitsPerBattle: number;
}

export interface BatchResult {
  readonly header: string;
  readonly rows: readonly string[];
  readonly summary: BatchSummary;
}

export interface BatchOptions extends Omit<AutoBattleOptions, 'seed' | 'keepLog'> {
  readonly from: number;
  readonly to: number;
  /** Обратный вызов прогресса: каждые `every` боёв. */
  readonly onProgress?: (done: number, total: number) => void;
  readonly progressEvery?: number;
  /**
   * Каждый сид играется дважды: как записан и с обменянными стартовыми углами.
   * По умолчанию включено — без этого батч мерит перевес рельефа, а не правила.
   *
   * С шага 9a обмен идёт СТАРТОВЫМИ ЗОНАМИ генератора (`swapZones`), а не
   * координатами в описании машин: координаты писались под демонстрационную
   * карту, а зоны генератор строит сам и делает их симметричными относительно
   * центра. Тот же приём отвечает и на вопрос «честна ли карта»: разница долей
   * побед между раскладами `base` и `swap` — это и есть перекос карты числом
   * (шаг 9a, часть E).
   *
   * Пара, а не половина прогона (изменено в шаге 8). Раньше зеркалились
   * нечётные сиды, то есть ДРУГИЕ карты: перевес угла гасился статистически и
   * оставлял в итоге ±3 п.п. болтанки — на эталонном копье он стоит 6–8 п.п.,
   * и два прогона по 1400 сидов расходились сильнее, чем правила, которые они
   * мерили. В паре обе стороны играют один и тот же сид, одну и ту же карту и
   * одних и тех же пилотов, отличаясь только углом старта, и перевес угла
   * сокращается точно. Боёв выходит вдвое больше сидов — это цена точности
   * ориентира «стороны 50/50», по которому сдаётся каждый шаг.
   */
  readonly mirrorCorners?: boolean;
  /** Процедурная генерация случайных копий из каталога 850 шасси (шаг 4). */
  readonly random?: boolean;
}

/** Какими углами сыгран бой: как записано в сценарии или наоборот. */
export type CornerLayout = 'base' | 'swap';

export function runBatch(opts: BatchOptions): BatchResult {
  const rows: string[] = [];
  const seeds = opts.to - opts.from + 1;
  const every = opts.progressEvery ?? 250;

  let draws = 0;
  let winsPlayer = 0;
  let winsOpfor = 0;
  let turns = 0;
  let shots = 0;
  let hits = 0;
  let toHitTargetSum = 0;
  let hardTargets = 0;
  let situationalCapped = 0;
  let cappedShots = 0;
  let overflowSum = 0;
  let pilotingChecks = 0;
  let falls = 0;
  let botches = 0;
  let headHits = 0;
  let injuries = 0;
  let pilotsOut = 0;
  let pilotsEjected = 0;
  let pilotsLost = 0;
  let criticals = 0;
  let criticalsEffective = 0;
  let ammoExplosions = 0;
  let weaponsLost = 0;
  let limbsLost = 0;
  let legsLost = 0;
  let shutdowns = 0;
  let standUps = 0;
  let jumps = 0;
  let heatSum = 0;
  let heatSamples = 0;
  const damageChecksByClass: ByClass = [0, 0, 0, 0];
  const damageFallsByClass: ByClass = [0, 0, 0, 0];
  const unitTurnsByClass: ByClass = [0, 0, 0, 0];
  let walkMpSum = 0;
  let walkMpSamples = 0;
  let maxHeat = 0;
  let trophies = 0;
  let withdrawalBattles = 0;
  let escapedBattles = 0;
  let withdrawnUnits = 0;
  let unitsDestroyed = 0;
  let immobilized = 0;
  let cockpitBreaches = 0;
  let cockpitBreachesLost = 0;
  let firstContact = 0;
  let firstShot = 0;
  let firstContactBattles = 0;
  let firstShotBattles = 0;
  const contactSamples = [0, 0, 0, 0];
  let blindShots = 0;
  let pulseShots = 0;
  let pulseHits = 0;
  let rangeSum = 0;
  let rangeSamples = 0;
  let moveActions = 0;
  let runMoves = 0;
  let volleyOpportunities = 0;
  let fullVolleys = 0;
  let voluntaryEjections = 0;
  let formationTogether = 0;
  let formationSamples = 0;
  let newContactsOpened = 0;
  let contactsLost = 0;
  let contactDroppedBelowSilhouette = 0;

  const base = opts.units ?? LANCE_VS_LANCE;
  const mirror = opts.mirrorCorners !== false;
  const layouts: CornerLayout[] = mirror ? ['base', 'swap'] : ['base'];
  const total = seeds * layouts.length;

  for (let seed = opts.from; seed <= opts.to; seed++) {
    for (const corners of layouts) {
      // Процедурный сценарий собирается заново по сиду и даёт ОДНИ И ТЕ ЖЕ
      // машины обоим боям пары: отличается только угол старта.
      const units = opts.random ? (makeRandomScenario(seed).units ?? LANCE_VS_LANCE) : base;
      const report = runBattle({
        ...opts,
        units,
        seed,
        swapZones: corners === 'swap',
        keepLog: false,
      });
      rows.push(csvRow(report, corners));

      if (report.winner === 'draw') draws += 1;
      else if (report.winner === 'player') winsPlayer += 1;
      else winsOpfor += 1;

      turns += report.turns;
      shots += report.stats.shots;
      hits += report.stats.hits;
      toHitTargetSum += report.stats.toHitTargetSum;
      hardTargets += report.stats.shotsHardTarget;
      situationalCapped += report.stats.shotsSituationalCapped;
      cappedShots += report.stats.shotsCapped;
      overflowSum += report.stats.toHitOverflowSum;
      pilotingChecks += report.stats.pilotingChecks;
      falls += report.stats.falls;
      botches += report.stats.botches;
      headHits += report.stats.headHits;
      injuries += report.stats.injuries;
      pilotsOut += report.stats.pilotsOut;
      pilotsEjected += report.stats.pilotsEjected;
      pilotsLost += report.stats.pilotsLost;
      criticals += report.stats.criticals;
      criticalsEffective += report.stats.criticalsEffective;
      ammoExplosions += report.stats.ammoExplosions;
      weaponsLost += report.stats.weaponsLost;
      limbsLost += report.stats.limbsLost;
      legsLost += report.stats.legsLost;
      shutdowns += report.stats.shutdowns;
      standUps += report.stats.standUps;
      jumps += report.stats.jumps;
      heatSum += report.stats.heatSum;
      heatSamples += report.stats.heatSamples;
      for (const c of [0, 1, 2, 3] as const) {
        damageChecksByClass[c] += report.stats.damageChecksByClass[c];
        damageFallsByClass[c] += report.stats.damageFallsByClass[c];
        unitTurnsByClass[c] += report.stats.unitTurnsByClass[c];
      }
      walkMpSum += report.stats.walkMpSum;
      walkMpSamples += report.stats.walkMpSamples;
      if (report.stats.maxHeat > maxHeat) maxHeat = report.stats.maxHeat;
      trophies += report.stats.trophies;
      if (report.stats.sidesWithdrawn > 0) withdrawalBattles += 1;
      if (report.stats.unitsWithdrawn > 0) escapedBattles += 1;
      withdrawnUnits += report.stats.unitsWithdrawn;
      unitsDestroyed += report.stats.unitsDestroyed;
      immobilized += report.stats.immobilized;
      cockpitBreaches += report.stats.cockpitBreaches;
      cockpitBreachesLost += report.stats.cockpitBreachesLost;
      if (report.stats.firstContactTurn > 0) {
        firstContact += report.stats.firstContactTurn;
        firstContactBattles += 1;
      }
      if (report.stats.firstShotTurn > 0) {
        firstShot += report.stats.firstShotTurn;
        firstShotBattles += 1;
      }
      for (let i = 0; i < 4; i++) contactSamples[i]! += report.stats.contactSamples[i]!;
      blindShots += report.stats.shotsAtBlip + report.stats.shotsAtSilhouette;
      pulseShots += report.stats.pulseShots;
      pulseHits += report.stats.pulseHits;
      rangeSum += report.stats.rangeSum;
      rangeSamples += report.stats.rangeSamples;
      moveActions += report.stats.moveActions;
      runMoves += report.stats.runMoves;
      volleyOpportunities += report.stats.volleyOpportunities;
      fullVolleys += report.stats.fullVolleys;
      voluntaryEjections += report.stats.voluntaryEjections;
      formationTogether += report.stats.formationTogether;
      formationSamples += report.stats.formationSamples;
      newContactsOpened += report.stats.newContactsOpened;
      contactsLost += report.stats.contactsLost;
      contactDroppedBelowSilhouette += report.stats.contactDroppedBelowSilhouette;
    }
    const done = (seed - opts.from + 1) * layouts.length;
    if (opts.onProgress !== undefined && done % every === 0) opts.onProgress(done, total);
  }

  const contactSeen = contactSamples[1]! + contactSamples[2]! + contactSamples[3]!;

  return {
    header: CSV_COLUMNS.join(','),
    rows,
    summary: {
      battles: total,
      draws,
      winsPlayer,
      winsOpfor,
      avgTurns: total === 0 ? 0 : turns / total,
      hitRate: shots === 0 ? 0 : hits / shots,
      botchRate: shots === 0 ? 0 : botches / shots,
      avgToHit: shots === 0 ? 0 : toHitTargetSum / shots,
      hardTargetShare: shots === 0 ? 0 : hardTargets / shots,
      situationalCapShare: shots === 0 ? 0 : situationalCapped / shots,
      cappedShare: shots === 0 ? 0 : cappedShots / shots,
      avgOverflow: cappedShots === 0 ? 0 : overflowSum / cappedShots,
      pilotingChecksPerBattle: total === 0 ? 0 : pilotingChecks / total,
      fallsPerBattle: total === 0 ? 0 : falls / total,
      headHitRate: hits === 0 ? 0 : headHits / hits,
      injuriesPerBattle: total === 0 ? 0 : injuries / total,
      pilotsOutPerBattle: total === 0 ? 0 : pilotsOut / total,
      pilotsEjectedPerBattle: total === 0 ? 0 : pilotsEjected / total,
      pilotsLostPerBattle: total === 0 ? 0 : pilotsLost / total,
      criticalsPerBattle: total === 0 ? 0 : criticals / total,
      criticalsEffectiveShare: criticals === 0 ? 0 : criticalsEffective / criticals,
      ammoExplosionsPerBattle: total === 0 ? 0 : ammoExplosions / total,
      weaponsLostPerBattle: total === 0 ? 0 : weaponsLost / total,
      limbsLostPerBattle: total === 0 ? 0 : limbsLost / total,
      legsLostPerBattle: total === 0 ? 0 : legsLost / total,
      shutdownsPerBattle: total === 0 ? 0 : shutdowns / total,
      standUpsPerBattle: total === 0 ? 0 : standUps / total,
      jumpsPerBattle: total === 0 ? 0 : jumps / total,
      shotsPerUnitTurn: heatSamples === 0 ? 0 : shots / heatSamples,
      damageChecksPer100TurnsByClass: damageChecksByClass.map((n, c) => {
        const t = unitTurnsByClass[c] ?? 0;
        return t === 0 ? 0 : (100 * n) / t;
      }),
      damageFallsPer100TurnsByClass: damageFallsByClass.map((n, c) => {
        const t = unitTurnsByClass[c] ?? 0;
        return t === 0 ? 0 : (100 * n) / t;
      }),
      unitTurnsByClass,
      avgHeat: heatSamples === 0 ? 0 : heatSum / heatSamples,
      maxHeat,
      avgWalkMp: walkMpSamples === 0 ? 0 : walkMpSum / walkMpSamples,
      trophiesPerBattle: total === 0 ? 0 : trophies / total,
      trophyShare: unitsDestroyed === 0 ? 0 : trophies / unitsDestroyed,
      immobilizedPerBattle: total === 0 ? 0 : immobilized / total,
      cockpitBreachesPerBattle: total === 0 ? 0 : cockpitBreaches / total,
      cockpitBreachLostShare: cockpitBreaches === 0 ? 0 : cockpitBreachesLost / cockpitBreaches,
      firstContactTurn: firstContactBattles === 0 ? 0 : firstContact / firstContactBattles,
      firstShotTurn: firstShotBattles === 0 ? 0 : firstShot / firstShotBattles,
      contactShareBlip: contactSeen === 0 ? 0 : contactSamples[1]! / contactSeen,
      contactShareSilhouette: contactSeen === 0 ? 0 : contactSamples[2]! / contactSeen,
      contactShareIdentified: contactSeen === 0 ? 0 : contactSamples[3]! / contactSeen,
      blindShotShare: shots === 0 ? 0 : blindShots / shots,
      pulseHitRate: pulseShots === 0 ? 0 : pulseHits / pulseShots,
      avgRange: rangeSamples === 0 ? 0 : rangeSum / rangeSamples,
      runShare: moveActions === 0 ? 0 : runMoves / moveActions,
      fullVolleyShare: volleyOpportunities === 0 ? 0 : fullVolleys / volleyOpportunities,
      voluntaryEjectionsPerBattle: total === 0 ? 0 : voluntaryEjections / total,
      formationTogetherShare: formationSamples === 0 ? 0 : formationTogether / formationSamples,
      newContactsOpenedPerBattle: total === 0 ? 0 : newContactsOpened / total,
      contactsLostPerBattle: total === 0 ? 0 : contactsLost / total,
      contactDroppedBelowSilhouettePerBattle: total === 0 ? 0 : contactDroppedBelowSilhouette / total,
      withdrawalShare: total === 0 ? 0 : withdrawalBattles / total,
      escapedShare: total === 0 ? 0 : escapedBattles / total,
      withdrawnUnitsPerBattle: total === 0 ? 0 : withdrawnUnits / total,
    },
  };
}

/**
 * Что загружено — в шапку прогона, чтобы CSV был опознаваем. Жила в
 * `core/data/tables.ts` до шага 52: вывод замеров в терминал — дело симулятора,
 * а не ядра.
 */
function dataSummary(): string {
  return [
    `рельеф: ${TERRAIN.length}`,
    `оружие: ${WEAPON_LIST.length}`,
    `шасси: ${CHASSIS_LIST.length}`,
    `навыки: ${SKILL_IDS.length}`,
    `зоны: ${ZONE_IDS.length}`,
  ].join(', ');
}

/** Шапка CSV: без неё через месяц не понять, какими данными считали. */
export function csvPreamble(opts: BatchOptions): string {
  return [
    `# сиды ${opts.from}..${opts.to}`,
    `# данные: ${dataSummary()}`,
    `# ходов максимум: ${opts.maxTurns ?? 40}`,
  ].join('\n');
}
