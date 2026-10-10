import { key as hexKey } from '../hex/index.js';
import { MoveMode, pathTo, reachable } from '../map/index.js';
import { isOperational, zoneState } from '../model/MechUnit.js';
import { Phase, type BattleState, type UnitId } from '../model/index.js';
import { MOVE_MODES, mpBudget, toHitBreakdown } from '../rules/index.js';
import type { Command } from './types.js';

/**
 * Перебор допустимых команд юнита.
 *
 * Порядок результата детерминирован: режим движения, затем координаты клетки.
 * ИИ выбирает максимум по оценке, и при равных оценках выбор обязан быть
 * воспроизводимым.
 */
export function enumerateLegalCommands(state: BattleState, unitId: UnitId): Command[] {
  const unit = state.getUnit(unitId);
  if (unit === undefined) return [];

  const out: Command[] = [];

  // Ушедшая с поля машина не делает ничего: её на карте больше нет (шаг 43).
  if (unit.withdrawn) return [{ kind: 'endPhase' }];

  if (state.phase === Phase.Movement && !unit.prone && unit.moveMode === null) {
    const blocked = state.occupiedExcept(unitId);

    // Список режимов — из правил (`MOVE_MODES`), а не перечислением здесь:
    // выключенный бег обязан пропасть и у бота, и у игрока одинаково.
    for (const mode of MOVE_MODES) {
      // Тот же mpBudget, что и в executeMove: перебор не имеет права предложить
      // маршрут, который исполнение потом отклонит (шаг 6, часть B).
      const budget = mpBudget(unit, mode);
      // Нечем прыгать — режима нет вовсе (шаг 6, часть C).
      if (mode === MoveMode.Jump && budget <= 0) continue;

      const result = reachable(state.map, unit.hex, {
        mode,
        mpBudget: budget,
        startFacing: unit.facing,
        blocked,
      });

      const targets = [...result.byHex.values()].sort(
        (a, b) => a.hex.q - b.hex.q || a.hex.r - b.hex.r,
      );

      for (const cell of targets) {
        // Оставаться на месте — не ход; такой вариант даёт команда endPhase.
        if (hexKey(cell.hex) === hexKey(unit.hex)) continue;
        const path = pathTo(result, cell.hex).map((c) => c.hex);
        if (path.length < 2) continue;
        out.push({ kind: 'move', unitId, path, mode });
      }
    }
  }

  // Катапультирование не зависит ни от позы, ни от того, ходил ли уже юнит:
  // повален и обездвижен — как раз тот случай, когда уходят. Иначе модификатор
  // «лежит» в ejectionOdds оказался бы недостижимым.
  if (state.phase === Phase.Movement && unit.pilot.status === 'active' && !unit.destroyed) {
    out.push({ kind: 'eject', unitId });
  }

  if (state.phase === Phase.Attack && isOperational(unit) && !unit.prone) {
    // Порядок: сначала цели по id, внутри цели — установки по индексу. ИИ берёт
    // максимум по оценке, и при равных оценках выбор обязан быть воспроизводимым.
    for (const target of state.units) {
      if (target.side === unit.side || target.destroyed || target.withdrawn) continue;

      for (let i = 0; i < unit.mounts.length; i++) {
        const mount = unit.mounts[i];
        if (mount === undefined) continue;
        if (mount.destroyed || zoneState(unit, mount.zone).destroyed) continue;
        if (mount.firedThisTurn) continue;
        if (mount.ammo !== null && mount.ammo <= 0) continue;

        // Отсев по видимости и дальности здесь, а не в ИИ: иначе перебор предлагал бы
        // заведомо невозможные выстрелы, и каждый потребитель фильтровал бы их сам.
        // Уровень контакта берётся тот же, что и в исполнении: перебор не имеет
        // права предложить выстрел по цели, о которой сторона не знает (шаг 7).
        const contact = state.contact(unit.side, target.id);
        const bd = toHitBreakdown(state.map, unit, target, mount.weapon, mount.zone, contact, state.units);
        if (bd.impossible) continue;

        out.push({ kind: 'attack', unitId, targetId: target.id, mountIndex: i });
      }
    }
  }

  out.push({ kind: 'endPhase' });
  return out;
}
