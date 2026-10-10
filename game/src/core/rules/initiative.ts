import type { BattleState, MechUnit, Side } from '../model/index.js';
import { skillLevel } from '../model/Pilot.js';
import type { Rng } from '../rng/index.js';
import { initiativeMod } from './skills.js';

/**
 * Инициатива: 2d6 на сторону плюс модификатор от Тактики лучшего пилота стороны
 * (wiki/design/combat/rules.md).
 *
 * Проигравший ходит **первым**: двигаться, зная манёвр противника, — преимущество.
 * Именно это делает Тактику ценной без прибавок к попаданию.
 */

export interface SideRoll {
  readonly side: Side;
  readonly roll: number;
  readonly mod: number;
  readonly total: number;
  /** Разрешение ничьей. Отдельный бросок, а не имя стороны — см. ниже. */
  readonly tiebreak: number;
}

export interface InitiativeResult {
  readonly rolls: readonly SideRoll[];
  /** Порядок хода: первым идёт проигравший бросок. */
  readonly order: readonly Side[];
}

function bestTactics(units: readonly MechUnit[]): number {
  let best = 0;
  for (const u of units) {
    if (u.destroyed || u.withdrawn || u.pilot.status !== 'active') continue;
    // Расчёт установки (шаги 73c, 73d) стороной не командует.
    if (u.frame === 'emplacement') continue;
    best = Math.max(best, initiativeMod(skillLevel(u.pilot, 'tactics')));
  }
  return best;
}

export function rollInitiative(rng: Rng, state: BattleState): InitiativeResult {
  // Стороны в детерминированном порядке: полагаться на порядок вставки нельзя.
  const sides = [...new Set(state.units.map((u) => u.side))].sort();

  const rolls: SideRoll[] = sides.map((side) => {
    const roll = rng.d2d6();
    const mod = bestTactics(state.units.filter((u) => u.side === side));
    // Ничья разрешается броском, а не именем стороны. Алфавитный порядок дал бы
    // одной и той же стороне преимущество в каждой ничьей — а ничьи на 2d6 часты,
    // и в батч-прогоне это читается как перекос правил.
    return { side, roll, mod, total: roll + mod, tiebreak: rng.d2d6() };
  });

  const order = [...rolls]
    .sort(
      (a, b) =>
        a.total - b.total ||
        a.tiebreak - b.tiebreak ||
        (a.side < b.side ? -1 : a.side > b.side ? 1 : 0),
    )
    .map((r) => r.side);

  return { rolls, order };
}
