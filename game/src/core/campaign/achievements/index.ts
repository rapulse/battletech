import { ACHIEVEMENTS, type AchievementCondition, type AchievementDef, type StateCondition } from '../../data/index.js';
import { HitZone } from '../../model/HitZone.js';
import { zoneState, type MechUnit } from '../../model/MechUnit.js';
import type { BattleOutcome, UnitOutcome } from '../bridge/fromBattle.js';
import type { BattleBrief } from '../bridge/toBattle.js';
import { recordChassisDef, type MechRecord } from '../mech/MechRecord.js';
import { stateConditionMet } from '../conditions.js';
import type { CampaignState } from '../state.js';

/**
 * Достижения роты (шаг 69).
 *
 * Только статус: ни одно достижение ничего не даёт в числах, поэтому шаг не
 * трогает баланс и замера не требует. Условия — данные (`data/achievements.json`),
 * здесь по одной маленькой проверке на вид условия.
 *
 * ДВЕ ТОЧКИ ПРОВЕРКИ, и обе в командах, потому что состояние меняется только ими:
 *
 * - `awardBattle` — из расчёта контракта, и только за бой, отыгранный игроком.
 *   Бой, рассчитанный штабом, боевых достижений не даёт и счёт добиваний не
 *   двигает (решение пользователя 2026-09-23: «так интереснее»). Разбор боя
 *   соперника (`rivals/tick.ts`) зовёт `debrief`, а не расчёт контракта, —
 *   поэтому проверка и живёт здесь, а не в разборе: иначе значки получали бы
 *   соперники.
 * - `awardState` — после ЛЮБОЙ принятой команды (`commands/execute.ts::execute`).
 *   Касса, корабль, парк, слава — всё это выводится из состояния, поэтому на
 *   старом сохранении такие достижения откроются задним числом, при первой же
 *   команде.
 *
 * Прогресс не копится отдельно, а выводится из состояния («одни цифры на всех
 * экранах»). Исключение одно — счёт добиваний: истории боёв в состоянии нет, и
 * вывести его неоткуда.
 */

export interface AchievementEntry {
  readonly id: string;
  /** День кампании, в который достижение открыто. */
  readonly day: number;
}

export interface AchievementsState {
  /** Открытые, в порядке открытия. Каждое — не больше одного раза. */
  readonly unlocked: readonly AchievementEntry[];
  /** Вражеских машин, добитых ротой в боях, отыгранных игроком. */
  readonly kills: number;
}

export const EMPTY_ACHIEVEMENTS: AchievementsState = { unlocked: [], kills: 0 };

/** Что знает расчёт контракта о только что отыгранном бое. */
export interface BattleFacts {
  readonly brief: BattleBrief;
  readonly outcome: BattleOutcome;
  /** Контракт выполнен (`won`); исход «сверх задачи» — тоже выполнен. */
  readonly won: boolean;
  /** Исход «выполнено с превышением» (`reputationOutcomeOf` → `beyond`). */
  readonly beyond: boolean;
  /** Трофеи, которые рота забрала целиком или разобрала на поле. */
  readonly taken: readonly MechRecord[];
}

/** Что было до команды: для условий-переходов («заём был — и погашен»). */
export interface StateBefore {
  readonly hadLoan: boolean;
}

const BATTLE_TYPES = new Set<AchievementCondition['type']>([
  'trophy',
  'clanTrophy',
  'enemyDown',
  'headshot',
  'soloWin',
  'outnumbered',
  'wipeout',
  'flawless',
  'beyond',
  'lightWin',
  'giantKill',
  'limpHome',
]);

/** Боевые виды условий — всё, что не выводится из состояния. */
type BattleCondition = Exclude<AchievementCondition, StateCondition | { type: 'loanRepaid' }>;

/** Боевое ли условие: такое проверяется только по отыгранному бою. */
export function isBattleCondition(c: AchievementCondition): c is BattleCondition {
  return BATTLE_TYPES.has(c.type);
}

function tonsOf(record: MechRecord): number {
  return recordChassisDef(record).tons;
}

/** Машины стороны; у `player` — только роты, без звена нанимателя (шаг 73b); без огневых точек. */
function sideUnits(facts: BattleFacts, side: 'player' | 'opfor'): UnitOutcome[] {
  // Огневые точки (шаг 73c) — не машины: ни в потери, ни в добивания.
  return facts.outcome.units.filter((u) => u.side === side && !u.unit.ally && u.unit.frame !== 'emplacement');
}

/** Тоннаж машины по её боевому итогу — из записи брифинга, где машина пришла в бой. */
function unitTons(facts: BattleFacts, u: UnitOutcome): number {
  const list = u.side === 'player' ? facts.brief.company : facts.brief.enemy;
  const p = list.find((x) => x.record.id === u.recordId);
  return p === undefined ? 0 : tonsOf(p.record);
}

function legLost(unit: MechUnit): boolean {
  return zoneState(unit, HitZone.LeftLeg).destroyed || zoneState(unit, HitZone.RightLeg).destroyed;
}

/**
 * Ни одной пробитой структуры у своих машин: броня снята — можно, до «мяса»
 * не дошло ни в одной зоне. Сравнение с состоянием ДО боя, а не с паспортом:
 * машина, пришедшая в бой с неотремонтированной ногой, в этом бою её не теряла.
 */
function untouched(facts: BattleFacts): boolean {
  for (const u of sideUnits(facts, 'player')) {
    if (u.unit.destroyed) return false;
    const before = facts.brief.company.find((p) => p.record.id === u.recordId)?.record;
    if (before === undefined) return false;
    for (let i = 0; i < before.condition.zones.length; i++) {
      const was = before.condition.zones[i];
      const now = u.unit.zones[i];
      if (was === undefined || now === undefined) continue;
      if (now.structure < was.structure) return false;
    }
  }
  return true;
}

function battleMet(c: BattleCondition, f: BattleFacts): boolean {
  const own = sideUnits(f, 'player');
  const enemy = sideUnits(f, 'opfor');
  switch (c.type) {
    case 'trophy':
      return f.taken.length > 0;
    case 'clanTrophy':
      return f.taken.some((r) => recordChassisDef(r).techBase === 'clan');
    case 'enemyDown':
      return enemy.some((u) => u.unit.destroyed && unitTons(f, u) >= c.minTons);
    case 'headshot':
      return enemy.some((u) => zoneState(u.unit, HitZone.Head).destroyed);
    case 'soloWin':
      return f.won && f.brief.company.length === 1;
    case 'outnumbered':
      return f.won && f.brief.enemy.length >= c.ratio * f.brief.company.length;
    case 'wipeout':
      return enemy.length >= c.minEnemies && enemy.every((u) => u.unit.destroyed);
    case 'flawless':
      return f.won && untouched(f);
    case 'beyond':
      return f.beyond;
    case 'lightWin':
      return (
        f.won && f.brief.company.length >= c.minMechs && f.brief.company.every((p) => tonsOf(p.record) <= c.maxTons)
      );
    case 'giantKill': {
      const heavy = new Set(enemy.filter((u) => unitTons(f, u) >= c.minVictimTons).map((u) => u.unit.id));
      return own.some((u) => unitTons(f, u) <= c.maxOwnTons && (u.victims ?? []).some((v) => heavy.has(v)));
    }
    case 'limpHome':
      return f.won && own.some((u) => !u.unit.destroyed && legLost(u.unit));
    default:
      return false;
  }
}

/** Виды состояния — общие с главами кампании; здесь только переход «заём погашен». */
function stateMet(c: AchievementCondition, state: CampaignState, before: StateBefore): boolean {
  if (c.type === 'loanRepaid') return before.hadLoan && state.company.loan === undefined;
  if (isBattleCondition(c)) return false;
  return stateConditionMet(c, state);
}

function unlock(state: CampaignState, defs: readonly AchievementDef[]): string[] {
  if (defs.length === 0) return [];
  state.achievements = {
    ...state.achievements,
    unlocked: [...state.achievements.unlocked, ...defs.map((d) => ({ id: d.id, day: state.day }))],
  };
  return defs.map((d) => d.id);
}

function pending(state: CampaignState): AchievementDef[] {
  const have = new Set(state.achievements.unlocked.map((e) => e.id));
  return ACHIEVEMENTS.achievements.filter((a) => !have.has(a.id));
}

/**
 * Боевые достижения и счёт добиваний за бой, отыгранный игроком. Возвращает id
 * открытых сейчас, в порядке данных.
 */
export function awardBattle(state: CampaignState, facts: BattleFacts): string[] {
  const kills = sideUnits(facts, 'player').reduce((sum, u) => sum + u.kills, 0);
  if (kills > 0) state.achievements = { ...state.achievements, kills: state.achievements.kills + kills };
  return unlock(
    state,
    pending(state).filter((a) => isBattleCondition(a.condition) && battleMet(a.condition, facts)),
  );
}

/** Достижения, выводимые из состояния роты. Зовётся после любой принятой команды. */
export function awardState(state: CampaignState, before: StateBefore): string[] {
  return unlock(
    state,
    pending(state).filter((a) => !isBattleCondition(a.condition) && stateMet(a.condition, state, before)),
  );
}
