import { HitZone, zoneState, type MechUnit, type Pilot, type PilotStatus } from '../../model/index.js';
import { OUT_AT } from '../../rules/injury.js';
import { awardXp } from '../../rules/skills.js';
import type { BattleBrief } from '../bridge/toBattle.js';
import { unitToRecord, type BattleOutcome, type UnitCombatTally } from '../bridge/fromBattle.js';
import { applyWear, type WearInput, type WearResult } from '../mech/wear.js';
import { withQuality, type MechRecord } from '../mech/MechRecord.js';
import type { CampaignRngSet, CampaignStreamName } from '../rng.js';
import { ECONOMY } from '../../data/index.js';
import { mechValue } from '../market/pricing.js';

/**
 * Послебоевой разбор (шаг 12, часть B архивного плана M9-ангар).
 *
 * Чистая функция от брифинга, итога боя и сида: берёт `BattleOutcome`, отдаёт описание
 * последствий. Не смотрит на время, деньги и UI, ничего не пишет в `CampaignState` — команда
 * кампании (шаг 13, склад/казармы) применяет то, что здесь посчитано.
 *
 * Здесь и только здесь наконец подключаются три вещи, написанные с шага 2 и ни разу не
 * вызванные: `awardXp`/`trainSkill`-цепочка, возвращение катапультировавшегося пилота и сброс
 * `pilot.firstBattle`. Рост навыков посреди боя ломает реплей, поэтому им место именно тут.
 */

export interface DebriefOptions {
  readonly brief: BattleBrief;
  readonly outcome: BattleOutcome;
  readonly rng: CampaignRngSet;
  /**
   * Из какого потока тянуть броски износа. По умолчанию `camp.wear` — поток
   * роты игрока.
   *
   * Заведено шагом 22 ради соперников, и заведено параметром, а не вторым
   * разбором рядом: разбор боя соперника обязан быть ТЕМ ЖЕ, иначе у проекта
   * появится второй набор правил износа. Отдельный поток при этом нужен по той
   * же причине, по которой шаг 21b развёл броски фронта и происшествий: износ
   * машины игрока не должен зависеть от того, сколько боёв отыграли соперники.
   */
  readonly wearStream?: CampaignStreamName;
  /**
   * Работа сделана: контракт закрыт выполненным (`contractResultOf` → `won`).
   *
   * Опыт за это идёт КАЖДОМУ задействованному навыку разом (`contractDone` в
   * `pilots.json`) и составляет становой хребет роста: попадания и добивания
   * растят одну Стрельбу, а звено, которое возит работу, растёт целиком. Без
   * этого Пилотирование и Хладнокровие росли бы с той скоростью, с какой
   * случаются броски на равновесие, — то есть почти никогда.
   *
   * Отход и провал опыта не платят: платят за сделанную работу, а не за вылет.
   */
  readonly contractDone?: boolean;
}

export interface DebriefResult {
  readonly outcome: BattleOutcome;
  readonly heldField: boolean;
  /** Свои машины после разбора: живые и удержанные остовы, с начисленным износом. */
  readonly company: readonly MechRecord[];
  /** Свои машины, чей остов потерян безвозвратно — поле не удержано (решение 3, §7). */
  readonly lostRecordIds: readonly string[];
  /** Вражеские машины, взятые трофеем — в восстановленном классе, с реальными повреждениями. */
  readonly trophies: readonly MechRecord[];
  /** Все свои пилоты по итогам боя, независимо от судьбы их машины. */
  readonly pilots: readonly Pilot[];
  readonly wear: readonly WearResult[];
}

/**
 * Обстановочный статус боя (`ejected`, `out` от временного порога ранений) сворачивается в
 * постоянный: `lost` необратим, иначе состояние решает только счётчик травм. Это и есть
 * «возвращение катапультировавшегося пилота» — не особый случай, а общее правило: пилот,
 * которого не потеряли, в разборе всегда получает статус по травмам, а не по тому, как именно
 * он покинул машину.
 */
function resolvePilotStatus(pilot: Pilot): Pilot {
  if (pilot.status === 'lost') return pilot;
  const status: PilotStatus = pilot.injuries >= OUT_AT ? 'out' : 'active';
  const next = pilot.status === status ? pilot : { ...pilot, status };
  return next.firstBattle ? { ...next, firstBattle: false } : next;
}

function awardTimes(pilot: Pilot, event: string, times: number): Pilot {
  let p = pilot;
  for (let i = 0; i < times; i++) p = awardXp(p, event);
  return p;
}

/**
 * Опыт за бой (брифинг шага 12, пункт 4; дополнено 2026-09-10).
 *
 * Каждый навык растёт от СВОЕЙ работы — это и есть правило вики
 * (`design/pilots/skills.md`): стрелял — Стрельба, удержался на ногах —
 * Пилотирование, вёл звено первым ходом — Тактика, не сорвался под давлением —
 * Хладнокровие, вернулся с поля — Выносливость. Общего котла нет намеренно:
 * иначе один гринг одного действия качал бы всё сразу.
 *
 * До 2026-09-10 из семи описанных событий начислялись три, и Тактика,
 * Хладнокровие, Техника и Выносливость не росли НИКОГДА — таблица в данных
 * была, а звать её было некому.
 *
 * `battleSurvived` даётся за возвращение с поля, а не за участие: пилот,
 * которого рота потеряла, опыта не получает — учиться уже некому. Раненому
 * начисляется: он вернулся, просто в лазарет.
 */
function awardCombatXp(pilot: Pilot, tally: UnitCombatTally): Pilot {
  let p = pilot;
  p = awardTimes(p, 'hit', tally.hits);
  p = awardTimes(p, 'pilotingPassed', tally.pilotingPassed);
  p = awardTimes(p, 'kill', tally.kills);
  p = awardTimes(p, 'initiativeWon', tally.initiativeWins);
  p = awardTimes(p, 'heldUnderPressure', tally.composureHeld);
  if (p.status !== 'lost') p = awardXp(p, 'battleSurvived');
  return p;
}

/**
 * Сколько износа набрала запись за этот бой.
 *
 * Сравнение идёт с состоянием ДО боя, а не с паспортом: `destroyedZones` считает только зоны,
 * разрушенные ИМЕННО сейчас — иначе не отремонтированная с прошлого боя нога засчитывалась бы
 * заново на каждом разборе.
 */
function computeWearInput(before: MechRecord, after: MechRecord, unit: MechUnit, overheatTurns: number): WearInput {
  let structureLost = 0;
  let destroyedZones = 0;
  before.condition.zones.forEach((z, i) => {
    const now = after.condition.zones[i];
    if (now === undefined) return;
    structureLost += Math.max(0, z.structure - now.structure);
    if (!z.destroyed && now.destroyed) destroyedZones += 1;
  });
  return { structureLost, overheatTurns, reactorHits: unit.reactorHits, destroyedZones };
}

/** Трофей не «плюс робот» — конкретная машина с реальными повреждениями, снятая с поля побитой. */
function makeTrophyRecord(before: MechRecord, unit: MechUnit, battleSeed: number): MechRecord {
  let record = unitToRecord(unit, before);
  record = {
    ...record,
    // Без «:» — им размечает сторону `battleUnitId` (`bridge/toBattle.ts`), и id с
    // двоеточием не сможет вернуться в бой вторым контрактом (эта ветка не была
    // нагружена до шага 13: до него трофеи в бою не участвовали).
    id: `trophy-${battleSeed}-${before.id}`,
    // Без пометки «Трофей: » (решение пользователя 2026-09-18): имя — просто
    // название модели, то же, что у любой другой машины из каталога.
    name: before.name,
    pilotId: null,
    battles: 0,
    wear: { reactor: 0, frame: 0 },
  };
  record = withQuality(record, 'reactor', 'recovered');
  record = withQuality(record, 'frame', 'recovered');
  return record;
}

/** Целые торс и кокпит — тот же критерий трофея, что откалиброван в `sim/autoBattle.ts` (6.5 % / 11.5 %, шаг 5). */
function isSalvageable(unit: MechUnit): boolean {
  return !zoneState(unit, HitZone.Torso).destroyed && !zoneState(unit, HitZone.Head).destroyed;
}

export function debrief(opts: DebriefOptions): DebriefResult {
  const { brief, outcome } = opts;
  const heldField = outcome.heldField;
  const wearRng = opts.rng.stream(opts.wearStream ?? 'camp.wear');

  // Рота — сторона `player` БЕЗ звена нанимателя (шаг 73b): его машины роте не
  // принадлежат и в её потери, износ и опыт не входят.
  const companyOut = new Map(
    outcome.units.filter((u) => u.side === 'player' && !u.unit.ally).map((u) => [u.recordId, u]),
  );

  const company: MechRecord[] = [];
  const lostRecordIds: string[] = [];
  const wear: WearResult[] = [];
  const pilots: Pilot[] = [];

  for (const participant of brief.company) {
    const before = participant.record;
    const uo = companyOut.get(before.id);
    if (uo === undefined) throw new Error(`В итогах боя нет машины состава ${before.id}`);
    const { unit } = uo;

    let pilot = awardCombatXp(resolvePilotStatus(unit.pilot), uo);
    if (opts.contractDone === true && pilot.status !== 'lost') pilot = awardXp(pilot, 'contractDone');
    pilots.push(pilot);

    if (unit.destroyed && !heldField) {
      lostRecordIds.push(before.id);
      continue;
    }

    const record = unitToRecord(unit, before);
    const input = computeWearInput(before, record, unit, uo.overheatTurns);
    const wr = applyWear(record, input, wearRng);
    wear.push(wr);
    company.push(wr.record);
  }

  return {
    outcome,
    heldField,
    company,
    lostRecordIds,
    trophies: collectTrophies(brief, outcome, heldField),
    pilots,
    wear,
  };
}

/**
 * Что с поля можно увезти трофеем.
 *
 * Отдельная экспортируемая функция, а не кусок `debrief`, и это нужно экрану
 * дебрифинга (шаг 17): он показывает список ДО того, как игрок подтвердит
 * разбор, а сам `debrief` тянет броски износа и звать его ради предпросмотра
 * нельзя. Здесь бросков нет вовсе — трофей выводится из финального состояния
 * вражеской машины.
 *
 * **Трофей берут только с УДЕРЖАННОГО поля**, и это то же решение 3 §7
 * пайплайна, что уже решало судьбу своих остовов, — просто дочитанное до конца.
 * Остов, который некому вывезти, ничем не отличается от чужого: разбитая
 * вражеская машина остаётся там, откуда рота ушла. Правило дописано шагом 16
 * вместе с отступлением: до него исход «поле не удержано» встречался только в
 * поражении, где трофеи и так тонули в потерях, и разницы было не видно.
 */
export function collectTrophies(
  brief: BattleBrief,
  outcome: BattleOutcome,
  heldField: boolean,
): MechRecord[] {
  if (!heldField) return [];
  const enemyOut = new Map(
    outcome.units.filter((u) => u.side === 'opfor').map((u) => [u.recordId, u]),
  );
  const trophies: MechRecord[] = [];
  for (const participant of brief.enemy) {
    const uo = enemyOut.get(participant.record.id);
    if (uo === undefined || !uo.unit.destroyed || !isSalvageable(uo.unit)) continue;
    trophies.push(makeTrophyRecord(participant.record, uo.unit, brief.battleSeed));
  }
  return trophies;
}

/**
 * Id своих машин, что возвращаются с поля живыми или удержанными остовами —
 * тот же критерий, что и `debrief.company`, но без бросков износа.
 *
 * Отдельная функция по той же причине, что и у `collectTrophies`: свободные
 * места под трофеи (`ResolveContract`, лимит вместимости десантного корабля)
 * нужно знать ДО решения принять или отклонить команду, а решение обязано
 * ничего не тратить из ГПСЧ, если команда в итоге отклонена.
 */
export function survivingCompanyIds(
  brief: BattleBrief,
  outcome: BattleOutcome,
  heldField: boolean,
): readonly string[] {
  const companyOut = new Map(
    outcome.units.filter((u) => u.side === 'player' && !u.unit.ally).map((u) => [u.recordId, u]),
  );
  const ids: string[] = [];
  // Выбывшие на ПОТЕРЯННОМ поле: часть остовов всё-таки вывозит дропшип
  // (шаг 35, questions.md п. 22).
  //
  // До этого шага проигранный бой списывал каждую выбывшую машину в ноль, и
  // одно поражение после десяти побед оставляло роту без парка и без денег на
  // покупку даже лёгкого тридцатитонника — тупик, из которого нет ни одного
  // хода. Право на ошибку в тактической кампании означает откат назад, к
  // дешёвым машинам и тяжёлым контрактам, а не программный тупик.
  //
  // Отбор ДЕТЕРМИНИРОВАННЫЙ и по ценности: экипаж эвакуации цепляет то, что
  // дороже, и броска здесь быть не может — эта функция зовётся до решения
  // принять команду и обязана не трогать ГПСЧ.
  const lost = heldField
    ? []
    : brief.company
        .filter((p) => companyOut.get(p.record.id)?.unit.destroyed === true)
        .map((p) => p.record)
        .sort((a, b) => mechValue(b) - mechValue(a));
  const recovered = new Set(
    lost.slice(0, Math.floor(lost.length * ECONOMY.salvage.wreckRecoveryShare)).map((r) => r.id),
  );

  for (const participant of brief.company) {
    const uo = companyOut.get(participant.record.id);
    if (uo === undefined) continue;
    if (uo.unit.destroyed && !heldField && !recovered.has(participant.record.id)) continue;
    ids.push(participant.record.id);
  }
  return ids;
}
