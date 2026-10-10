import { key as hexKey, type Hex } from '../hex/index.js';
import type { HexMap, MapDescriptor } from '../map/index.js';
import type { RngSet } from '../rng/index.js';
import { ContactLevel, type ContactMap } from './Contact.js';
import { DESTROY_ALL, type BattleObjective } from './Objective.js';
import type { MechUnit, Side, UnitId } from './MechUnit.js';

/** Место и ход последнего наблюдения чужой машины (шаг 8, часть D). */
export interface LastKnownContact {
  readonly hex: Hex;
  readonly turn: number;
}

/** Фазы хода: инициатива → движение → стрельба → тепло (rules.md). */
export enum Phase {
  Initiative = 0,
  Movement = 1,
  Attack = 2,
  Heat = 3,
}

/**
 * Состояние боя.
 *
 * Юниты держатся в отсортированном по id массиве, а не в объекте: порядок обхода
 * обязан быть явным, иначе детерминизм зависит от порядка вставки (game_core.md §4.7).
 */
export class BattleState {
  readonly map: HexMap;
  readonly rng: RngSet;
  private readonly unitList: MechUnit[] = [];
  private readonly byId = new Map<UnitId, MechUnit>();
  turn = 1;
  phase: Phase = Phase.Initiative;
  /** Порядок хода сторон в этом ходу. Первым идёт проигравший инициативу. */
  order: readonly Side[] = ['opfor', 'player'];
  /**
   * Задача боя (шаг 19b) — единственное место, где Часть 2 меняет боевое ядро.
   *
   * Параметр состояния, а не ветки по типу миссии в правилах: правило «кто
   * победил» обязано остаться одним и для полного боя, и для быстрого расчёта
   * (`rules/objective.ts::judgeObjective`). Умолчание — правило Части 1, и
   * поэтому всякий бой вне кампании остаётся ровно тем, чем был.
   */
  objective: BattleObjective = DESTROY_ALL;
  /**
   * Чем построена карта: сид, размер, биом, версия генератора.
   *
   * В хэш состояния НЕ входит — карта уже входит в него буферами, и описатель
   * дублировал бы её. Нужен показу (какой биом рисовать) и сохранению (по
   * описателю карта восстанавливается, а не хранится целиком).
   */
  mapDescriptor: MapDescriptor | null = null;

  /**
   * Что каждая сторона знает о чужих машинах (шаг 7).
   *
   * Пересчитывается ОДИН раз за ход, в фазе инициативы. Не по запросу и не в
   * каждой фазе: контакт, мигающий внутри хода («увидел — потерял — увидел»),
   * читается как ошибка, а игроку не даёт принять ни одного решения. Внутри
   * хода знание может только пополниться — этим занимается `sawShot`.
   */
  private readonly contactBySide = new Map<Side, Map<UnitId, ContactLevel>>();

  /**
   * Последнее известное место чужой машины (шаг 8, часть D).
   *
   * Обновляется правилом `refreshContacts` каждый раз, когда контакт держится
   * на уровне `Blip` и выше — сенсорный круг уже говорит «кто-то есть на этой
   * клетке», и это честно известное знание, а не подглядывание. Запись не
   * трогается, когда контакт падает до `None`: сторона забыла, ЧТО там сейчас,
   * но помнит, где видела машину В ПОСЛЕДНИЙ РАЗ.
   *
   * Часть состояния боя, а не поле бота: обязана попасть в хэш и пережить
   * реплей — тот же принцип, что и `contactBySide` (шаг 7).
   */
  private readonly lastKnownBySide = new Map<Side, Map<UnitId, LastKnownContact>>();

  /**
   * Стороны, объявившие отход (шаг 43).
   *
   * Состояние боя, а не поле бота: от него зависят и законные ходы, и уход
   * машины с поля, и оно обязано пережить реплей по журналу команд. Пустое
   * множество — обычный бой, и в хэш оно тогда не входит вовсе (`hash.ts`),
   * поэтому закреплённый бой без отхода остаётся тем же.
   */
  private readonly withdrawingSides = new Set<Side>();

  /**
   * Где сторона высадилась: сумма координат и число машин на момент расстановки.
   *
   * Нужно ровно для одного вопроса — «в какую сторону отходить». Своим краем
   * карты считается тот, к которому сторона ближе всего СТАЛА, а не тот, к
   * которому её потом прижали: отход к вражескому краю — это не отход.
   *
   * Копится в `addUnit`, потому что машины добавляются только при сборке боя
   * (`sim/scenario.ts`, `bridge/toBattle.ts`); подкреплений в игре нет, и
   * заводить ради этого отдельный вызов при сборке значило бы завести шов,
   * который однажды забудут позвать.
   */
  private readonly deploymentBySide = new Map<Side, { q: number; r: number; n: number }>();

  constructor(map: HexMap, rng: RngSet) {
    this.map = map;
    this.rng = rng;
  }

  /** Что сторона знает о чужих машинах. Пустая таблица — сторона не видит никого. */
  contacts(side: Side): ContactMap {
    return this.contactBySide.get(side) ?? new Map<UnitId, ContactLevel>();
  }

  /** Что сторона знает об этой конкретной машине. Свои всегда опознаны. */
  contact(side: Side, id: UnitId): ContactLevel {
    const u = this.byId.get(id);
    if (u === undefined) return ContactLevel.None;
    if (u.side === side) return ContactLevel.Identified;
    return this.contactBySide.get(side)?.get(id) ?? ContactLevel.None;
  }

  /**
   * Записать новую таблицу контактов стороны.
   *
   * Считает её правило (`core/rules/detection.ts`), а не состояние: модель
   * хранит знание, правило его добывает. Иначе `model/` начал бы зависеть от
   * `rules/`, и направление зависимостей в ядре перевернулось бы.
   */
  setContacts(side: Side, contacts: Map<UnitId, ContactLevel>): void {
    this.contactBySide.set(side, contacts);
  }

  /** Последнее известное место машины для стороны. `undefined` — ни разу не видели. */
  lastKnownContact(side: Side, id: UnitId): LastKnownContact | undefined {
    return this.lastKnownBySide.get(side)?.get(id);
  }

  /** Все запомненные позиции стороны — перебор для бота (шаг 8, часть D). */
  lastKnownContacts(side: Side): ReadonlyMap<UnitId, LastKnownContact> {
    return this.lastKnownBySide.get(side) ?? new Map<UnitId, LastKnownContact>();
  }

  /**
   * Запомнить место машины. Вызывается правилом (`refreshContacts`), когда
   * контакт держится на `Blip` и выше — модель хранит знание, правило решает,
   * когда его обновлять (тот же принцип, что у `setContacts`).
   */
  recordLastKnownContact(side: Side, id: UnitId, hex: Hex, turn: number): void {
    let bySide = this.lastKnownBySide.get(side);
    if (bySide === undefined) {
      bySide = new Map<UnitId, LastKnownContact>();
      this.lastKnownBySide.set(side, bySide);
    }
    bySide.set(id, { hex, turn });
  }

  /** Юниты в детерминированном порядке — по возрастанию id. */
  get units(): readonly MechUnit[] {
    return this.unitList;
  }

  /** Сторона объявила отход. Обратного хода нет: передумавший отряд — не отход, а манёвр. */
  startWithdrawal(side: Side): void {
    this.withdrawingSides.add(side);
  }

  /** Отходит ли сторона. */
  isWithdrawing(side: Side): boolean {
    return this.withdrawingSides.has(side);
  }

  /** Стороны в отходе, по алфавиту — детерминизм обхода и сериализации. */
  withdrawing(): Side[] {
    return [...this.withdrawingSides].sort();
  }

  /**
   * Средняя клетка расстановки стороны. `null` — машин такой стороны не было.
   */
  deploymentCentre(side: Side): { q: number; r: number } | null {
    const acc = this.deploymentBySide.get(side);
    if (acc === undefined || acc.n === 0) return null;
    return { q: acc.q / acc.n, r: acc.r / acc.n };
  }

  addUnit(unit: MechUnit): void {
    if (this.byId.has(unit.id)) throw new Error(`Юнит с таким id уже есть: ${unit.id}`);
    if (!this.map.contains(unit.hex)) throw new RangeError(`Юнит вне карты: ${unit.id}`);
    if (this.unitAt(unit.hex) !== undefined) {
      throw new Error(`Клетка занята: q=${unit.hex.q}, r=${unit.hex.r}`);
    }
    this.byId.set(unit.id, unit);
    this.unitList.push(unit);
    this.unitList.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

    // Засадная машина стоит не в стартовой зоне, а в стороне, на диагонали (шаг 73a),
    // а укрепление к высадке не относится вовсе (шаг 73d): сторона высадилась там,
    // где высадились её машины, и свой край для отхода они сдвигать не должны.
    if (unit.dormant || unit.frame === 'emplacement') return;
    const acc = this.deploymentBySide.get(unit.side) ?? { q: 0, r: 0, n: 0 };
    this.deploymentBySide.set(unit.side, {
      q: acc.q + unit.hex.q,
      r: acc.r + unit.hex.r,
      n: acc.n + 1,
    });
  }

  getUnit(id: UnitId): MechUnit | undefined {
    return this.byId.get(id);
  }

  requireUnit(id: UnitId): MechUnit {
    const u = this.byId.get(id);
    if (u === undefined) throw new Error(`Нет такого юнита: ${id}`);
    return u;
  }

  /** Замена юнита новым состоянием. Юниты неизменяемы — меняется ссылка. */
  replaceUnit(unit: MechUnit): void {
    const idx = this.unitList.findIndex((u) => u.id === unit.id);
    if (idx < 0) throw new Error(`Нет такого юнита: ${unit.id}`);
    this.unitList[idx] = unit;
    this.byId.set(unit.id, unit);
  }

  unitAt(hex: Hex): MechUnit | undefined {
    const k = hexKey(hex);
    return this.unitList.find((u) => hexKey(u.hex) === k);
  }

  /**
   * Юниты, способные действовать: не выведены, не ушли с поля и пилот в строю.
   *
   * Ушедшая своим ходом машина (шаг 43) цела, но её на поле нет — считать её в
   * строю значило бы, что отход противника не кончает бой никогда.
   */
  get active(): readonly MechUnit[] {
    return this.unitList.filter((u) => !u.destroyed && !u.withdrawn && u.pilot.status === 'active');
  }

  /** Стороны, у которых остались боеспособные роботы. */
  sidesAlive(): Side[] {
    return [...new Set(this.active.map((u) => u.side))].sort();
  }

  /** Юниты в порядке хода этого хода: сначала сторона, проигравшая инициативу. */
  unitsInOrder(): MechUnit[] {
    const rank = new Map<Side, number>(this.order.map((s, i) => [s, i]));
    return [...this.unitList].sort(
      (a, b) =>
        (rank.get(a.side) ?? 99) - (rank.get(b.side) ?? 99) ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );
  }

  /** Клетки, занятые юнитами, кроме указанного. Для пасфайндера. */
  occupiedExcept(id: UnitId): Set<number> {
    const out = new Set<number>();
    for (const u of this.unitList) if (u.id !== id) out.add(hexKey(u.hex));
    return out;
  }
}
