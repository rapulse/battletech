import { COMBAT, CONSTRUCTION, EQUIPMENT } from '../data/tables.js';
import { MoveMode } from '../map/index.js';
import { HitZone } from '../model/HitZone.js';
import { zoneState, type MechUnit } from '../model/MechUnit.js';
import { heatLimits, heatMpPenalty } from './heat.js';

/**
 * Прыжковый бюджет — сумма `jumpMP` установленных и не разрушенных
 * прыжковых двигателей (шаг 6, часть C). Нет двигателей — нет прыжка: до
 * этого шага прыжок был `2` у всех по весовому классу, установленное железо
 * не читалось (`[Ждёт правил]`, game_core.md §12).
 */
export function jumpBudget(unit: MechUnit): number {
  let total = 0;
  for (const zoneSlots of unit.slots) {
    for (const slot of zoneSlots) {
      if (slot.kind !== 'jump_jet' || slot.destroyed || slot.id === undefined) continue;
      total += EQUIPMENT.get(slot.id)?.jumpMP ?? 0;
    }
  }
  return total;
}

/**
 * Сколько ног пробито до структуры (не только брони). Каноническое правило
 * BattleTech отдельное от критов привода: сама пробитая структура ноги стоит
 * 1 MP ходьбы, попал ли крит по приводу или нет — источники штрафа не
 * заменяют друг друга, а складываются.
 */
function legStructureHits(unit: MechUnit): number {
  const left = zoneState(unit, HitZone.LeftLeg);
  const right = zoneState(unit, HitZone.RightLeg);
  let hits = 0;
  if (left.structure < left.maxStructure) hits++;
  if (right.structure < right.maxStructure) hits++;
  return hits;
}

/**
 * Бюджет MP на ход для выбранного режима движения.
 *
 * Ходьба и бег считаются по машине, а не по весовому классу (шаг 6, часть B):
 * `walkMP` выведен из тира реактора при создании юнита (`makeUnit`), бег —
 * тот же `walkMP` с множителем `construction.json`. Тир реактора, за который
 * платят массой, наконец что-то даёт в бою.
 *
 * Повреждения роняют подвижность (шаг 6, часть D, дополнено после разбора
 * скриншота с «ходит как новый» несмотря на пробитую ногу): перебитый привод
 * ноги снимает 1 MP ходьбы за попадание, пробитая до структуры нога снимает
 * ещё 1 MP сама по себе (см. `legStructureHits`) — это два разных источника,
 * складываются, а не взаимозаменяемы, первый крит гироскопа снимает 1 MP
 * бега сверху штрафа к Пилотированию, который у него уже есть. MP не уходит
 * в ноль: машина с нулём MP не может ни отойти, ни довернуться — нижняя
 * граница 1 у ходьбы и бега записана явно.
 */
/**
 * РЕЖИМЫ ДВИЖЕНИЯ, КОТОРЫЕ ИГРА ПРЕДЛАГАЕТ (решение пользователя 2026-09-08).
 *
 * Бег выключен флагом `combat.json → movement.runAllowed`, а не вырезан из
 * правил: `mpBudget(Run)` продолжает считать бюджет, и включить режим обратно —
 * одна правка в данных. Причина выключения — не сам бег, а его цена на тесной
 * карте: `walkMP × 1.5` позволяет лёгкой машине пересечь три четверти поля
 * 15×15 первым же ходом, и бой начинается свалкой в углу вместо расстановки.
 * Вместе с этим флагом карта под бой выросла (`contracts.json → map`), и оба
 * решения работают в одну сторону: у манёвра появляется дистанция и время.
 *
 * Список — ОДИН на всю игру: его читают и перебор законных ходов (бот,
 * автобой), и полоса кнопок в интерфейсе. Два списка разошлись бы на первом же
 * новом режиме.
 */
export const MOVE_MODES: readonly MoveMode[] = COMBAT.movement.runAllowed
  ? [MoveMode.Walk, MoveMode.Run, MoveMode.Jump]
  : [MoveMode.Walk, MoveMode.Jump];

/**
 * Режимы, которые доступны ИМЕННО этой машине: общий список минус прыжок, если
 * прыгать нечем. Интерфейс по нему решает, есть ли вообще выбор: при одном
 * режиме полоса кнопок и слова «выберите режим» — лишний шаг для игрока.
 */
export function offeredMoveModes(unit: MechUnit): MoveMode[] {
  return MOVE_MODES.filter((mode) => mode !== MoveMode.Jump || mpBudget(unit, MoveMode.Jump) > 0);
}

export function mpBudget(unit: MechUnit, mode: MoveMode): number {
  // Неподвижная установка (шаги 73c, 73d) не ходит вовсе. Отдельной строкой, а не
  // через `walkMP` = 0: ниже действует «хоть гекс, но ползёт» (`Math.max(1, …)`)
  // для подбитой машины, и установка получала очко хода и шагала.
  if (unit.frame === 'emplacement') return 0;
  const heatPenalty = heatMpPenalty(unit.heat, heatLimits(unit).limit);

  switch (mode) {
    case MoveMode.Walk: {
      const legHits = unit.legActuatorHits[0] + unit.legActuatorHits[1] + legStructureHits(unit);
      return Math.max(1, unit.walkMP - legHits - heatPenalty);
    }
    case MoveMode.Run: {
      const legHits = unit.legActuatorHits[0] + unit.legActuatorHits[1] + legStructureHits(unit);
      const walk = Math.max(1, unit.walkMP - legHits);
      const gyroPenalty = unit.gyroHits > 0 ? 1 : 0;
      return Math.max(1, Math.floor(walk * CONSTRUCTION.reactors.runMultiplier) - gyroPenalty - heatPenalty);
    }
    case MoveMode.Jump:
      return jumpBudget(unit);
  }
}

/**
 * Модификатор к попаданию за собственное движение (rules.md):
 * стоял 0 / шёл +1 / бежал +2 / прыгал +3.
 */
export function attackerMoveMod(mode: MoveMode, hexesMoved: number): number {
  if (mode === MoveMode.Jump) return 3;
  if (hexesMoved === 0) return 0;
  return mode === MoveMode.Run ? 2 : 1;
}

/** Модификатор к попаданию ПО цели за её движение: 0-2 → 0, 3-4 → +1, 5-6 → +2, 7-9 → +3. */
export function targetMoveMod(hexesMoved: number): number {
  if (hexesMoved <= 2) return 0;
  if (hexesMoved <= 4) return 1;
  if (hexesMoved <= 6) return 2;
  return 3;
}
