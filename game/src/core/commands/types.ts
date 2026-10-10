import type { Direction, Hex } from '../hex/index.js';
import type { MoveMode } from '../map/movement.js';
import type { ContactLevel } from '../model/Contact.js';
import type { HitZone } from '../model/HitZone.js';
import type { PilotStatus } from '../model/Pilot.js';
import type { UnitId } from '../model/MechUnit.js';
import type { InjuryCause } from '../rules/injury.js';
import type { ToHitFactor } from '../rules/attack.js';
import type { SideRoll } from '../rules/initiative.js';
import type { Side } from '../model/MechUnit.js';

/**
 * Команды — единственный способ изменить BattleState (game_core.md §2).
 * Размеченное объединение: компилятор проверяет полноту switch по kind.
 */
export type Command =
  | {
      readonly kind: 'move';
      readonly unitId: UnitId;
      readonly path: readonly Hex[];
      readonly mode: MoveMode;
    }
  | {
      readonly kind: 'attack';
      readonly unitId: UnitId;
      readonly targetId: UnitId;
      /** Индекс установки в `unit.mounts`: игрок выбирает, чем стрелять. */
      readonly mountIndex: number;
    }
  | {
      /**
       * Разворот на месте.
       *
       * Отдельная команда, а не частный случай хода: в фазе движения фасинг
       * меняется вместе с перемещением, и развернуться, не сходя с клетки,
       * было нечем — притом что поворот в правилах бесплатен
       * (`pathfinder.turnMpCost` = 0) и ничего не стоит балансу.
       *
       * ВАЖНО и записано честно: на шаг 9a фасинг не читает НИ ОДНО правило
       * боя — ни целевое число, ни урон, ни линия видимости. Дуги обстрела,
       * которые рисует карта, пока показывают направление, а не преимущество.
       * Правила дуг и тыловой брони — отдельная работа (см. незакрытое).
       */
      readonly kind: 'turn';
      readonly unitId: UnitId;
      readonly facing: Direction;
    }
  | {
      readonly kind: 'eject';
      readonly unitId: UnitId;
    }
  | {
      /**
       * Сторона выходит из боя (шаг 43).
       *
       * Команда СТОРОНЫ, а не машины, и в `enumerateLegalCommands` её нет:
       * перебор законных ходов ведётся по юниту, а отход — решение отряда
       * целиком. Отдаёт её бот по сработавшей морали
       * (`rules/morale.ts::moraleBreak`), у игрока для этого есть свой выход из
       * контракта (`campaign` → `resolveContract` с `withdrew`).
       *
       * Обратного хода нет: объявленный отход не отменяется. Отряд, передумавший
       * посреди отхода, — это не мораль, а манёвр, и мерить его было бы нечем.
       */
      readonly kind: 'withdrawSide';
      readonly side: Side;
    }
  | {
      /**
       * Сторона выходит из боя ПРЯМО СЕЙЧАС (шаг 65): машины в зоне выхода уходят целыми,
       * остальные остаются на поле и теряются.
       *
       * Отличие от `withdrawSide`: тот объявляет отход, и сторона идёт к краю ходами, пока
       * бой продолжается (так уходит бот по морали). Здесь ходов нет — решение принято, и
       * исход виден сразу. Отдаёт её игрок кнопкой «отвести звено», после предупреждения
       * «в зоне N из M, остальные будут потеряны» (`rules/morale.ts::exitReading`).
       *
       * Обратного хода нет. В `enumerateLegalCommands` команды нет: она про сторону.
       */
      readonly kind: 'evacuate';
      readonly side: Side;
    }
  | { readonly kind: 'endPhase' };

/**
 * События для проигрывания слоем показа. Рендер ничего не пересчитывает.
 *
 * Событие выстрела несёт и намерение, и исход: без этого журнал не сможет
 * объяснить срыв, а необъяснённый срыв читается игроком как жульничество игры
 * (wiki/design/pilots/skills.md, ограничение 2).
 */
export type BattleEvent =
  | {
      readonly kind: 'turned';
      readonly unitId: UnitId;
      readonly from: Direction;
      readonly to: Direction;
    }
  | {
      readonly kind: 'moved';
      readonly unitId: UnitId;
      readonly path: readonly Hex[];
      readonly facing: Direction;
      readonly mode: MoveMode;
      readonly mpSpent: number;
      readonly submerged: 0 | 1 | 2;
      /** Сколько бросков пилотирования потребовал маршрут. */
      readonly pilotingChecks: number;
    }
  | {
      readonly kind: 'shot';
      readonly unitId: UnitId;
      readonly targetId: UnitId;
      readonly weapon: string;
      /** Целевое число и из чего оно сложилось. */
      readonly toHitTarget: number;
      readonly factors: readonly ToHitFactor[];
      /** База от навыка Стрельба — первое слагаемое разбора. */
      readonly toHitBase: number;
      /** Сколько срезал потолок обстановки (`maxSituational`) — правило шага 30. */
      readonly toHitSituationalCut: number;
      /**
       * Сколько срезал потолок целевого числа (`COMBAT.toHit.maxTarget`) —
       * край шкалы 2d6.
       *
       * Ноль в подавляющем большинстве выстрелов, и так и должно быть: ненулевое
       * значение означает, что выстрел вышел за пределы того, что кубик умеет
       * выразить. Ровно это делало попадание по быстрой цели лотереей 1:36 и не
       * было видно ни в журнале, ни в замере до шага 29.
       */
      readonly toHitOverflow: number;
      /** Дистанция выстрела в гексах — для замера средней дистанции боя (шаг 8, B). */
      readonly range: number;
      readonly roll: number;
      /** Название таблицы зон: Above, Below или Main */
      readonly zoneTable?: 'Above' | 'Below' | 'Main';
      /** Этап 1: бросок прошёл. */
      readonly intentHit: boolean;
      /** Собранность вытянула промах ровно на единицу. */
      readonly poiseSaved: boolean;
      /** Этап 3: пилот сорвал уже удавшееся. */
      readonly botched: boolean;
      readonly botchChance: number;
      readonly botchReasons: readonly string[];
      readonly composure: number;
      /**
       * Итог после всех трёх этапов. У ракетной пачки — «долетела хоть одна»:
       * по нему гаснет луч и засчитывается добивание.
       */
      readonly hit: boolean;
      /**
       * Ракетная пачка (шаг 66b): сколько ракет долетело из скольких выпущено.
       * `undefined` у некластерного оружия — там `roll`/`intentHit`/`hit` выше
       * по-прежнему описывают всю атаку одним броском, как раньше.
       *
       * У пачки `roll`, `intentHit`, `poiseSaved`, `botched`, `botchChance`,
       * `botchReasons`, `composure` описывают ПЕРВУЮ ракету (шаг 66c): её судьба
       * — это прежний один бросок на залп, по ней начисляется опыт пилота.
       */
      readonly clusterLanded?: number;
      readonly clusterTotal?: number;
    }
  | {
      readonly kind: 'damaged';
      readonly unitId: UnitId;
      readonly zone: HitZone;
      /** Заявленная зона была разрушена, урон ушёл сквозным. */
      readonly transferredFrom: HitZone | null;
      readonly amount: number;
      readonly armorAfter: number;
      readonly structureAfter: number;
      readonly armorHeld: boolean;
      readonly zoneDestroyed: boolean;
    }
  | {
      readonly kind: 'pilotingCheck';
      readonly unitId: UnitId;
      readonly hex: Hex;
      /** Целевое число 2d6 от навыка Пилотирование плюс обстановка. */
      readonly target: number;
      readonly roll: number;
      readonly passed: boolean;
      /** Почему бросок потребовался: река, спуск, бег по пересечённой. */
      readonly reason: string;
    }
  | {
      readonly kind: 'moveBotched';
      readonly unitId: UnitId;
      readonly botchChance: number;
      readonly composure: number;
      readonly botchReasons: readonly string[];
      /** Сколько гексов не дошёл; 0 — вместо этого добавился бросок пилотирования. */
      readonly hexesShort: number;
    }
  | { readonly kind: 'weaponLost'; readonly unitId: UnitId; readonly weapon: string; readonly zone: HitZone }
  | { readonly kind: 'fell'; readonly unitId: UnitId }
  | {
      readonly kind: 'pilotInjured';
      readonly unitId: UnitId;
      readonly pilotId: string;
      readonly cause: InjuryCause;
      readonly chance: number;
      readonly injuries: number;
      readonly status: PilotStatus;
    }
  | {
      readonly kind: 'pilotEjected';
      readonly unitId: UnitId;
      readonly pilotId: string;
      readonly trigger: 'voluntary' | 'torso' | 'head';
      readonly chance: number;
      readonly roll: number;
      readonly success: boolean;
      /** Ранение при приземлении идёт отдельным `pilotInjured` — здесь только факт. */
      readonly landingInjured: boolean;
    }
  | {
      /**
       * Броня головы пробита — 1d6 решает, ушёл снаряд в приборы или в
       * остекление (шаг 6). Событие пишется и при удачном для пилота броске:
       * правило «каждый бросок объяснён» требует видеть попытку, а не только
       * её плохой исход.
       */
      readonly kind: 'cockpitBreach';
      readonly unitId: UnitId;
      readonly pilotId: string;
      readonly roll: number;
      readonly lostFrom: number;
      readonly pilotLost: boolean;
    }
  | {
      readonly kind: 'pilotLost';
      readonly unitId: UnitId;
      readonly pilotId: string;
      /**
       * `cockpitBreach` — выстрел прошёл сквозь остекление, уходить было уже некому;
       * `cockpit` — разрушена катапульта вместе с кокпитом;
       * `ejectionFailed` — уйти не успел по другому поводу;
       * `injuries` — набран порог ранений.
       */
      readonly reason: 'cockpitBreach' | 'cockpit' | 'ejectionFailed' | 'injuries';
    }
  | {
      readonly kind: 'critical';
      readonly unitId: UnitId;
      readonly zone: HitZone;
      readonly slotIndex: number;
      readonly slotKind: string;
      readonly itemId?: string | undefined;
      readonly effect: string;
      readonly weaponLost?: string | undefined;
    }
  | {
      readonly kind: 'ammoExplosion';
      readonly unitId: UnitId;
      readonly zone: HitZone;
      readonly ammoId: string;
      readonly damage: number;
      readonly contained: boolean;
      readonly transferred: boolean;
    }
  | {
      readonly kind: 'shutdown';
      readonly unitId: UnitId;
      readonly heat: number;
      /** Предел машины в этот момент (отвод + запас корпуса) — край её шкалы. */
      readonly limit: number;
    }
  | {
      readonly kind: 'restarted';
      readonly unitId: UnitId;
    }
  | {
      /** Сторона `side` обнаружила засаду до её включения (шаг 73a). */
      readonly kind: 'ambushSpotted';
      readonly side: Side;
      readonly unitId: UnitId;
    }
  | {
      /**
       * Засада включилась (шаг 73a). `instant` — необнаруженная: стреляет в
       * этой же фазе; иначе — перезапуском, огонь со следующего хода.
       */
      readonly kind: 'ambushWoke';
      readonly unitId: UnitId;
      readonly instant: boolean;
    }
  | {
      readonly kind: 'stoodUp';
      readonly unitId: UnitId;
    }
  | {
      readonly kind: 'unitDestroyed';
      readonly unitId: UnitId;
      readonly reason:
        | 'torso'
        | 'cockpit'
        | 'pilotOut'
        | 'ejected'
        | 'reactor'
        | 'ammoExplosion'
        | 'leg'
        | 'gyro';
    }
  | {
      /**
       * Сторона узнала о чужой машине больше — или потеряла её из виду
       * (шаг 7). Пишется только на СМЕНУ уровня: событие «контакт по-прежнему
       * есть» каждый ход по каждой машине сделало бы журнал нечитаемым.
       */
      readonly kind: 'contactChanged';
      readonly side: Side;
      readonly unitId: UnitId;
      readonly from: ContactLevel;
      readonly to: ContactLevel;
    }
  | {
      readonly kind: 'initiative';
      /**
       * Перед какой фазой брошено (решение пользователя 2026-09-15): инициатива
       * бросается дважды за ход — перед движением и перед стрельбой.
       */
      readonly phase: 'movement' | 'attack';
      readonly rolls: readonly SideRoll[];
      /** Порядок в этой фазе: первым идёт проигравший бросок. */
      readonly order: readonly Side[];
    }
  | {
      /** Сторона объявила отход (шаг 43). Числа — то, из чего сложилось решение. */
      readonly kind: 'sideWithdrawing';
      readonly side: Side;
      readonly units: number;
      readonly pressure: number;
      readonly resolve: number;
    }
  | {
      /**
       * Машина дошла до своего края карты и снята с поля ЦЕЛОЙ (шаг 43).
       *
       * Не `unitDestroyed`: ушедшая машина остаётся у своего хозяина и трофеем
       * не становится. Ровно в этом и цена промедления игрока — успел добить
       * или обездвижить, трофей твой; не успел — ушёл своим ходом.
       */
      readonly kind: 'unitWithdrew';
      readonly unitId: UnitId;
      readonly side: Side;
    }
  | {
      /**
       * Машина не дошла до зоны выхода, когда сторона вышла из боя (шаг 65), и осталась на
       * поле. Для остального правила боя она выбыла: `destroyed`, как при потере пилота, —
       * разбор списывает её так же, как любую потерянную вместе с полем.
       */
      readonly kind: 'unitAbandoned';
      readonly unitId: UnitId;
      readonly side: Side;
    }
  | { readonly kind: 'phaseEnded'; readonly turn: number }
  | { readonly kind: 'turnStarted'; readonly turn: number };

export enum RejectReason {
  NoSuchUnit = 'noSuchUnit',
  UnitShutdown = 'unitShutdown',
  WrongPhase = 'wrongPhase',
  EmptyPath = 'emptyPath',
  PathNotFromUnit = 'pathNotFromUnit',
  NotAdjacent = 'notAdjacent',
  Impassable = 'impassable',
  Occupied = 'occupied',
  NotEnoughMp = 'notEnoughMp',
  AlreadyMoved = 'alreadyMoved',
  Prone = 'prone',
  NoSuchTarget = 'noSuchTarget',
  SameSide = 'sameSide',
  NoSuchWeapon = 'noSuchWeapon',
  WeaponUnavailable = 'weaponUnavailable',
  NoLineOfSight = 'noLineOfSight',
  /** Сторона не знает о такой цели: контакта нет вовсе (шаг 7). */
  NoContact = 'noContact',
  OutOfRange = 'outOfRange',
  AlreadyFired = 'alreadyFired',
  UnitDestroyed = 'unitDestroyed',
  TargetDestroyed = 'targetDestroyed',
  PilotUnfit = 'pilotUnfit',
  AlreadyEjected = 'alreadyEjected',
  /** Сторона уже объявила отход: решение не отменяется и не повторяется (шаг 43). */
  AlreadyWithdrawing = 'alreadyWithdrawing',
  /** Отходить некому: у стороны не осталось машин на поле. */
  NoSuchSide = 'noSuchSide',
}

export type CommandResult =
  | { readonly ok: true; readonly events: readonly BattleEvent[] }
  | { readonly ok: false; readonly reason: RejectReason };

export function ok(events: BattleEvent[]): CommandResult {
  return { ok: true, events };
}

export function reject(reason: RejectReason): CommandResult {
  return { ok: false, reason };
}
