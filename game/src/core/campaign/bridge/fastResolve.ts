import fastJson from '../../../../data/fastresolve.json';
import { z } from 'zod';
import { chassis, COMBAT, weapon } from '../../data/tables.js';
import { Direction } from '../../hex/index.js';
import { HitZone, ZONE_COUNT } from '../../model/HitZone.js';
import {
  spendAmmo,
  zoneState,
  type MechUnit,
  type Side,
  type UnitId,
} from '../../model/MechUnit.js';
import { Rng, RngSet } from '../../rng/index.js';
import { resolveSalvo, rollZone, type ZoneRoll } from '../../rules/attack.js';
import { heatLimits, heatToHitMod } from '../../rules/heat.js';
import { triggerAmmoExplosion } from '../../rules/critical.js';
import { applyDamage } from '../../rules/damage.js';
import { unitPilotingTarget } from '../../rules/execution.js';
import { rollInjury } from '../../rules/injury.js';
import { pilotGunneryBase } from '../../rules/skills.js';
import { judgeObjective, progressOf } from '../../rules/objective.js';
import { moraleReadingOf } from '../../rules/morale.js';
import { DESTROY_ALL, type ObjectiveVerdict } from '../../model/Objective.js';
import { EMPTY_TALLY, outcomeOf, type BattleOutcome, type UnitCombatTally } from './fromBattle.js';
import { battleUnitId, participantToUnit, type BattleBrief } from './toBattle.js';
import { makeEmplacement, makeStructure, sideGunnery } from '../../rules/emplacement.js';

/**
 * Быстрый расчёт боя (шаг 18, M10-A).
 *
 * **Что это.** `BattleBrief → BattleOutcome` без розыгрыша ходов: ни карты, ни
 * фаз, ни инициативы, ни движения, ни линии видимости, ни бота. Стороны
 * обмениваются огнём условными раундами, пока одна не выбывает или пока не
 * выйдет потолок раундов — ничья по потолку читается тем же организованным
 * отходом, что и ничья полного боя (`commands/execute.ts::contractResultOf`).
 *
 * **Зачем сразу две вещи.** Это фича «авто-расчёт боя» из M10 — кнопка «не хочу
 * отыгрывать эту стычку руками» — и одновременно то, что снимает потолок с
 * замера кампании: полный бой стоит около сотни миллисекунд, и лимит в 1400
 * боёв за прогон (CLAUDE.md) упирается ровно в него. Одна механика на две
 * задачи — решение 7 §2 пайплайна.
 *
 * **Чем он НЕ является — второй копией боевых правил.** Урон, сквозные
 * попадания, криты, детонация боезапаса, пробитие кокпита, ранения и
 * катапультирование считают те же самые функции ядра, что и в полном бою:
 * `applyDamage`, `rollZone`, `resolveSalvo` (выделен из `resolveAttack` этим же
 * шагом, ровно по границе карты). Быстрый расчёт заменяет собой **только
 * карту** — и то, что из неё следует: дальность, укрытие, движение, выбор
 * позиции. Всё это свёрнуто в горстку коэффициентов (`data/fastresolve.json`),
 * и подбираются они не на глаз, а прогоном `pnpm fastcalib`: ловушка шага 18
 * ровно об этом — быстрый расчёт, оптимистичнее полного, утащит за собой всю
 * последующую настройку экономики.
 *
 * **Что заведомо теряется.** Всё, что в полном бою решает карта: рельеф, биом,
 * высоты (быстрый расчёт бросает зону всегда по ровной таблице), выбор
 * дистанции, строй, обнаружение, срыв исполнения и падения. Поэтому расхождение
 * замеряется, а не предполагается нулевым, — и допуск записан в тесте.
 *
 * **Детерминизм.** Один и тот же брифинг даёт один и тот же исход: сид тот же,
 * что у полного боя, потоки выведены из него же. На этом стоит и
 * `ResolveContract` (он пересобирает брифинг того же боя), и повторяемость
 * замера.
 */

const fastFileSchema = z
  .object({
    /** Потолок условных раундов. Дошли до него — ничья, то есть отход. */
    rounds: z.number().int().positive(),
    /** Одна поправка к попаданию вместо всей карты. */
    toHitPenalty: z.number(),
    /** Доля установок, которым было чем и по кому стрелять в этом раунде. */
    fireChance: z.number().min(0).max(1),
    /** Насколько выше порога отключения машина готова себя загнать. */
    heatOverrun: z.number().nonnegative(),
    /** Тепло за ход от собственного движения. */
    moveHeat: z.number().nonnegative(),
    /** Вероятность продолжить бить ту же цель, что и в прошлом раунде. */
    focus: z.number().min(0).max(1),
    /** Сколько машин сторона может навести на одну машину противника за раунд. */
    engagedPerFoe: z.number().positive(),
    /** Как часто поле оказывается на ступень выгоднее одной из сторон. */
    fortuneSpread: z.number().min(0).max(1),
    /** Бросков на удержание равновесия за раунд. */
    pilotingChecksPerRound: z.number().nonnegative(),
    /** Сколько раундов сторона отходит, прежде чем сойти с поля (шаг 43). */
    withdrawRounds: z.number().int().nonnegative(),
  })
  .strict();

export type FastResolveTuning = z.infer<typeof fastFileSchema>;

/**
 * Ключи, начинающиеся с `$`, — пояснения внутри данных, общая конвенция всех
 * таблиц проекта. Они снимаются ДО разбора, а сама схема остаётся строгой:
 * перечислять `$comment`, `$comment2`, `$comment3`… в схеме значит ломать
 * загрузку каждый раз, когда в файл дописали абзац.
 */
function withoutComments(raw: unknown): unknown {
  if (typeof raw !== 'object' || raw === null) return raw;
  return Object.fromEntries(Object.entries(raw).filter(([k]) => !k.startsWith('$')));
}

export const FAST: FastResolveTuning = (() => {
  try {
    return fastFileSchema.parse(withoutComments(fastJson));
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`Ошибка в игровых данных (data/fastresolve.json):\n${detail}`);
  }
})();

/** Годная к выстрелу установка: цела, зона цела, боезапас есть. */
function usableMounts(unit: MechUnit): number[] {
  const out: number[] = [];
  unit.mounts.forEach((m, i) => {
    if (m.destroyed) return;
    if (zoneState(unit, m.zone).destroyed) return;
    if (m.ammo !== null && m.ammo <= 0) return;
    out.push(i);
  });
  return out;
}

/**
 * Целевое число выстрела без карты.
 *
 * База навыка и те штрафы, которые в быстром расчёте настоящие (собственное
 * тепло, выбитые сенсоры), плюс `toHitPenalty` — свёрнутая карта. Зажимается
 * тем же коридором `minTarget..maxTarget`, что и полный разбор: это правило
 * боя, а не часть приближения.
 */
export function fastToHitTarget(
  attacker: MechUnit,
  tuning: FastResolveTuning = FAST,
  fortune = 0,
): number {
  const raw =
    pilotGunneryBase(attacker.pilot) +
    tuning.toHitPenalty +
    fortune +
    heatToHitMod(attacker.heat, heatLimits(attacker).limit) +
    attacker.sensorHits * COMBAT.critical.sensors.toHitPenaltyPerHit;
  return Math.max(COMBAT.toHit.minTarget, Math.min(COMBAT.toHit.maxTarget, raw));
}

/**
 * Изменяемый двойник `UnitCombatTally` — тот же приём, что в `sim/tally.ts`.
 *
 * `initiativeWins` и `composureHeld` здесь всегда нули, и это не забывчивость:
 * у быстрого расчёта нет ни ходов с бросками инициативы, ни разбора срыва —
 * есть только машины и то, что с ними стало. Опыт по ним получают те, кто
 * дрался по-настоящему; быстрым расчётом считаются соперники и батч-замеры, у
 * которых пилоты не учатся вовсе.
 */
interface MutableTally {
  hits: number;
  pilotingPassed: number;
  kills: number;
  initiativeWins: number;
  composureHeld: number;
  overheatTurns: number;
}

export interface FastResolveResult {
  readonly outcome: BattleOutcome;
  /** Сколько условных раундов заняло. Аналог `turns` полного боя. */
  readonly rounds: number;
}

/**
 * Цель раунда: любая живая машина другой стороны, объект-цель (шаг 73d) — с
 * весом `ai.objectiveWeight`, как в полном бою. Без объектов веса равны, и
 * выбор ровно тот же, что `foes[floor(roll × n)]`, — жребий не сдвигается.
 */
function pickFoe(foes: readonly MechUnit[], roll: number): MechUnit {
  const weight = (u: MechUnit): number => (u.objectiveTarget ? COMBAT.ai.objectiveWeight : 1);
  const total = foes.reduce((sum, u) => sum + weight(u), 0);
  let left = roll * total;
  for (const u of foes) {
    left -= weight(u);
    if (left < 0) return u;
  }
  return foes[foes.length - 1] as MechUnit;
}

function isActive(u: MechUnit): boolean {
  return !u.destroyed && !u.withdrawn && u.pilot.status === 'active';
}

/**
 * Коэффициенты приходят параметром, а не берутся только из файла, ровно ради
 * калибровки: `pnpm fastcalib --sweep` перебирает их десятками наборов за один
 * прогон, и делать это правкой `data/fastresolve.json` между запусками значило
 * бы подбирать вслепую. Игра и замер зовут функцию без второго аргумента и
 * получают то, что записано в данных.
 */
export function fastResolveDetailed(
  brief: BattleBrief,
  tuning: FastResolveTuning = FAST,
): FastResolveResult {
  // Машины собираются тем же `recordToUnit`, что и для полного боя: класс
  // исполнения, навеска, накопленные повреждения и остаток боезапаса обязаны
  // прийти в расчёт ровно теми же. Гекс и направление — заглушки: карты здесь
  // нет, и ни одно правило быстрого расчёта их не читает.
  const HOME = { q: 0, r: 0 };
  let units: MechUnit[] = [
    ...brief.company.map((p) => participantToUnit(p, HOME, Direction.NW, 'player')),
    ...(brief.allies ?? []).map((p) => ({ ...participantToUnit(p, HOME, Direction.NW, 'player'), ally: true })),
    ...brief.enemy.map((p) => participantToUnit(p, HOME, Direction.NW, 'opfor')),
  ];
  // Огневые точки (шаг 73c) и укрепление (шаг 73d) — те же участники, что в
  // полном бою: так же спят и стреляют со средней Стрельбой своей стороны.
  const mechsOnly = units;
  const opforGunnery = sideGunnery(mechsOnly, 'opfor');
  units = [
    ...units,
    ...(brief.emplacements ?? []).map((e, i) => ({
      ...makeEmplacement({
        id: battleUnitId('opfor', e.id),
        side: 'opfor',
        kind: e.kind,
        hex: HOME,
        facing: Direction.NW,
        seed: (brief.battleSeed ^ (i + 1) * 0x9e37) >>> 0,
        gunnery: opforGunnery,
      }),
      dormant: true,
      shutdown: true,
    })),
    ...(brief.structures ?? []).map((s, i) => {
      const unit = makeStructure({
        id: battleUnitId(s.side, s.id),
        side: s.side,
        structure: s.structure,
        weapons: s.weapons,
        hex: HOME,
        facing: Direction.NW,
        seed: (brief.battleSeed ^ (i + 17) * 0x9e37) >>> 0,
        gunnery: sideGunnery(mechsOnly, s.side),
      });
      const sleeps = s.side === 'opfor' && !unit.objectiveTarget;
      return { ...unit, ally: s.side === 'player', ...(sleeps ? { dormant: true, shutdown: true } : {}) };
    }),
  ];

  // Боевой набор потоков, а не свой: `resolveSalvo` — это боевое правило, и
  // броски внутри него обязаны идти теми же именованными потоками, что в бою.
  // Сид сдвинут от боевого, потому что расчёты одного брифинга не обязаны
  // совпадать бросок в бросок — они обязаны совпадать распределениями.
  const rng = new RngSet((brief.battleSeed ^ 0x1f2e3d4c) >>> 0);
  const order = rng.stream('initiative');
  const toHit = rng.stream('toHit');
  const location = rng.stream('hitLocation');
  const skill = rng.stream('skill');
  const crits = rng.stream('crits');
  // Выбор цели и то, какие стволы дотянулись, — не боевое правило, а замена
  // карты, поэтому отдельный ГПСЧ, а не поток боевого набора.
  const engage = new Rng((brief.battleSeed ^ 0x5bf03635) >>> 0);

  /**
   * Кому досталось поле — единственный след карты в быстром расчёте.
   *
   * Средних показателей эта поправка не двигает (она симметрична и в нуле по
   * матожиданию), а нужна ради ХВОСТОВ. Полный бой изредка проигрывается не
   * потому, что звено слабее, а потому, что противник сел на высоту, звено
   * вышло из леса по частям, а между ними легла река. Быстрый расчёт без этого
   * почти не проигрывает: на средних он сходился, а разорившихся рот в замере
   * кампании выходило вдвое меньше — то есть ровно та оптимистичность, о
   * которой предупреждает ловушка шага, только спрятанная в редкое событие, а
   * не в среднее.
   *
   * Бросок один на бой: поле не переигрывается посреди боя. Поправка ЦЕЛАЯ и
   * ровно в одну ступень, а коэффициент — её ВЕРОЯТНОСТЬ. Дробная поправка
   * здесь бессмысленна: целевое число сравнивается с 2d6, и «плюс три
   * десятых» даёт ровно тот же бой, что «плюс девять десятых», — значение
   * имеет только знак. Ступень же стоит дорого (на целевом числе 8 это
   * 72 % попаданий против 58 %, и в разные стороны у сторон сразу), поэтому
   * дозируется она частотой, а не размером.
   */
  const fortune =
    engage.next() < tuning.fortuneSpread ? (engage.next() < 0.5 ? 1 : -1) : 0;
  const fortuneOf = (side: Side): number => (side === 'player' ? fortune : -fortune);

  const tallies = new Map<UnitId, MutableTally>();
  const at = (id: UnitId): MutableTally => {
    let t = tallies.get(id);
    if (t === undefined) {
      t = { ...EMPTY_TALLY };
      tallies.set(id, t);
    }
    return t;
  };

  const index = new Map<UnitId, number>(units.map((u, i) => [u.id, i]));
  const put = (u: MechUnit): void => {
    units[index.get(u.id) as number] = u;
  };
  const live = (id: UnitId): MechUnit => units[index.get(id) as number] as MechUnit;

  /**
   * Кто из стороны вообще вступает в бой в этом раунде.
   *
   * Единственная НЕсимметричная поправка — и без неё быстрый расчёт врал в одну
   * и ту же сторону, сколько ни крути остальные коэффициенты: любая
   * симметричная ручка (точность, доля стреляющих стволов, тепло) меняет обе
   * стороны разом и оставляет СООТНОШЕНИЕ обмена нетронутым, а расходилось
   * именно оно — своих машин рота теряла вдвое меньше, чем в полном бою.
   *
   * Причина расхождения физическая, и в полном бою она видна: **сторона,
   * которой больше, не может навести на противника все стволы разом.** Фронт
   * узкий, линии перекрыты своими же, часть звена не дошла, часть держится
   * позади. Тот, кого меньше, наоборот, весь под огнём и весь стреляет. На
   * карте это решается само; здесь — числом `engagedPerFoe`: сколько машин
   * имеет смысл наводить на одну машину противника. Кто именно остался вне
   * боя в этом раунде, решает жребий — в полном бою это решает рельеф.
   */
  const engagedThisRound = (ready: readonly MechUnit[]): Set<UnitId> => {
    const out = new Set<UnitId>();
    for (const side of ['player', 'opfor'] as const) {
      const mine = ready.filter((u) => u.side === side);
      const cap = Math.max(1, Math.ceil((ready.length - mine.length) * tuning.engagedPerFoe));
      if (mine.length <= cap) {
        for (const u of mine) out.add(u.id);
        continue;
      }
      // Перемешивание Фишера — Йетса тем же ГПСЧ, что решает выбор цели: это
      // не боевой бросок, а замена карты.
      const pool = [...mine];
      for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(engage.next() * (i + 1));
        [pool[i], pool[j]] = [pool[j] as MechUnit, pool[i] as MechUnit];
      }
      for (const u of pool.slice(0, cap)) out.add(u.id);
    }
    return out;
  };

  /** По кому машина била в прошлом раунде — вход в сосредоточенный огонь. */
  const aimedAt = new Map<UnitId, UnitId>();

  // Задача боя — то же правило, что у полного боя (шаг 19b). Потолок раундов
  // остаётся сверх неё: он заменяет собой потолок ходов автобоя, и ничья по
  // нему читается тем же организованным отходом.
  const objective = brief.objective ?? DESTROY_ALL;
  const verdict = (rounds: number): ObjectiveVerdict =>
    judgeObjective(objective, progressOf(units, rounds));

  // ОТХОД СТОРОНЫ (шаг 43) — та же мораль, что и в полном бою. Карты здесь нет,
  // и дороги до края тоже: сторона, у которой мораль сломалась, держится ещё
  // `withdrawRounds` раундов (отстреливаясь, как и в отыгранном бою) и сходит с
  // поля целиком.
  //
  // Проверяются ОБЕ стороны — ровно как в автобое (`sim/bot.ts::chooseSideAction`).
  // Быстрый расчёт это и есть «отдать бой движку целиком»: там, где решает не
  // человек, отбирать у него решение не у кого, а звено, дерущееся до последней
  // машины в безнадёжном бою, обошлось бы роте дороже, чем отход.
  const leavesAt = new Map<Side, number>();

  // ЗАСАДА (шаг 73a) — то же правило, что в полном бою (`commands/execute.ts`),
  // только раундами. Карты нет, и обнаружить засаду до включения здесь некому:
  // спящий не стреляет и целью не бывает, пока его сторона не открыла огонь, и
  // включается сразу — к следующему раунду. Страховка та же: у стороны в строю
  // не осталось никого, кроме спящих, — они включаются.
  const fired = new Set<Side>();
  const wakeAmbush = (): void => {
    if (!units.some((u) => u.dormant)) return;
    units = units.map((u) => {
      if (!u.dormant || !isActive(u)) return u;
      const awakeAlly = units.some((o) => o.side === u.side && !o.dormant && isActive(o));
      return fired.has(u.side) || !awakeAlly ? { ...u, dormant: false, shutdown: false } : u;
    });
  };

  let round = 0;
  while (round < tuning.rounds && verdict(round) === null) {
    round++;
    wakeAmbush();

    for (const side of ['opfor', 'player'] as const) {
      if (leavesAt.has(side)) continue;
      if (!moraleReadingOf(units, side, round).broken) continue;
      leavesAt.set(side, round + tuning.withdrawRounds);
    }

    // Очередь сторон — то, чем здесь заменена инициатива: отстрелявшийся первым
    // успевает вывести машину до её ответного залпа, и это единственное, чем
    // порядок вообще важен.
    const first: Side = order.next() < 0.5 ? 'player' : 'opfor';
    const ready = units.filter((u) => isActive(u) && !u.dormant);
    const inPlay = engagedThisRound(ready);
    const queue = ready
      .filter((u) => inPlay.has(u.id))
      .sort((a, b) => (a.side === b.side ? (a.id < b.id ? -1 : 1) : a.side === first ? -1 : 1))
      .map((u) => u.id);

    for (const shooterId of queue) {
      let attacker = live(shooterId);
      if (!isActive(attacker) || attacker.shutdown) continue;

      // Цель: та же, что в прошлом раунде, пока жива и пока выпадает
      // сосредоточение. Иначе — любая живая машина другой стороны.
      const foes = units.filter((u) => u.side !== attacker.side && isActive(u) && !u.dormant);
      if (foes.length === 0) break;
      const kept = foes.find((u) => u.id === aimedAt.get(attacker.id));
      let target =
        kept !== undefined && engage.next() < tuning.focus ? kept : pickFoe(foes, engage.next());
      aimedAt.set(attacker.id, target.id);

      for (const mountIndex of usableMounts(attacker)) {
        if (!isActive(target)) break;
        const mount = attacker.mounts[mountIndex];
        if (mount === undefined) continue;
        const w = weapon(mount.weapon);

        // Не всякий ствол в бою достаёт: у части дальность короче расстояния до
        // цели или линия перекрыта. Карты нет — есть доля.
        if (engage.next() >= tuning.fireChance) continue;
        // И не всякий стреляет, когда машина уже раскалена: бот в полном бою
        // греется сознательно, но не бесконечно.
        // Потолок — от отвода самой машины (`rules/heat.ts`), как и порог
        // отключения в полном бою.
        if (attacker.heat + w.heat > heatLimits(attacker).shutdownAt + tuning.heatOverrun) continue;

        attacker = spendAmmo({ ...attacker, heat: attacker.heat + w.heat }, mountIndex);
        // Сторона открыла огонь — её засада включится к следующему раунду.
        fired.add(attacker.side);

        if (toHit.d2d6() < fastToHitTarget(attacker, tuning, fortuneOf(attacker.side))) continue;

        const zoneRolls: ZoneRoll[] = [];
        for (let i = 0; i < w.shots; i++) zoneRolls.push(rollZone(location));

        const salvo = resolveSalvo(rng, target, mount.weapon, zoneRolls);
        at(attacker.id).hits += 1;
        target = salvo.target;
        put(target);
        // Огневая точка (шаг 73c) — не добивание: как в полном бою (`sim/tally.ts`).
        if (!isActive(target) && target.frame !== 'emplacement') at(attacker.id).kills += 1;
      }

      put(attacker);
    }

    // Отходящая сторона сходит с поля ЦЕЛОЙ (шаг 43) — не выбывает: трофеем её
    // машины не станут, и разбор увидит их живыми у прежнего хозяина.
    for (const [side, at] of leavesAt) {
      if (round < at) continue;
      units = units.map((u) => (u.side === side && isActive(u) ? { ...u, withdrawn: true } : u));
    }

    // --- конец раунда: детонация, тепло, отключение, равновесие ---------------
    units = units.map((u) => {
      // Спящий обесточен и холоден: перезапуска и бросков на равновесие у него нет.
      if (!isActive(u) || u.dormant) return u;
      let next = u;

      // Тепловая детонация боезапаса — то же правило и тот же один бросок за
      // ход по одной пачке, что в конце боевого хода (`commands/execute.ts`).
      if (next.heat >= heatLimits(next).ammoRiskAt) {
        const packs: { zone: HitZone; index: number }[] = [];
        for (let z = 0; z < ZONE_COUNT; z++) {
          const zSlots = next.slots[z] ?? [];
          for (let sIdx = 0; sIdx < zSlots.length; sIdx++) {
            const slot = zSlots[sIdx];
            if (slot !== undefined && slot.kind === 'ammo' && !slot.destroyed && (slot.explosionDamage ?? 0) > 0) {
              packs.push({ zone: z as HitZone, index: sIdx });
            }
          }
        }
        if (packs.length > 0 && crits.next() < COMBAT.heat.ammoExplosionChance) {
          const pick = packs[Math.floor(crits.next() * packs.length)] as { zone: HitZone; index: number };
          const slot = next.slots[pick.zone]?.[pick.index];
          if (slot !== undefined) {
            next = triggerAmmoExplosion(skill, next, pick.zone, pick.index, slot).unit;
          }
        }
      }
      if (!isActive(next)) return next;

      // Перегрев засчитывается по СОСТОЯНИЮ на конце раунда — тем же замером,
      // каким его снимает автобой (`sim/tally.ts::sampleHeat`): это вход в
      // износ реактора послебоевого разбора.
      const limits = heatLimits(next);
      if (next.heat >= limits.shutdownAt) at(next.id).overheatTurns += 1;

      const reactorHeat =
        next.reactorHits *
        (chassis(next.chassis).reactorHeatPerHit ?? COMBAT.critical.reactor.heatPerHit);
      const heat = Math.max(
        0,
        Math.min(limits.max, next.heat - limits.dissipation + reactorHeat + tuning.moveHeat),
      );

      let shutdown = next.shutdown;
      let shutdownLastTurn = next.shutdownLastTurn;
      if (next.shutdown) {
        shutdown = false;
        shutdownLastTurn = true;
      } else if (shutdownLastTurn) {
        shutdownLastTurn = false;
      } else if (next.heat >= limits.shutdownAt) {
        shutdown = true;
        shutdownLastTurn = false;
      }

      // Бросок на удержание равновесия. В полном бою поводов два — бег по
      // пересечённой местности и полученные повреждения; ни того, ни другого
      // здесь нет, и ЧАСТОТА броска — коэффициент. Сам бросок настоящий:
      // целевое число считает то же `unitPilotingTarget` (перебитая нога,
      // криты гироскопа, перегрев), провал роняет машину с теми же
      // последствиями, что в бою, — урон падения в брошенную зону и бросок на
      // ранение. Без этого канала быстрый расчёт терял вдвое меньше своих
      // машин, чем полный: часть потерь в бою приходит не от залпа, а от
      // подломившейся ноги.
      // Огневой точке (шаг 73c) падать нечем.
      if (next.frame !== 'emplacement' && skill.next() < tuning.pilotingChecksPerRound) {
        if (skill.d2d6() >= unitPilotingTarget(next)) {
          at(next.id).pilotingPassed += 1;
        } else {
          const zone = rollZone(location).zone;
          next = applyDamage(next, zone, COMBAT.damage.fallDamagePerLevel).unit;
          const injury = rollInjury(skill, next.pilot, 'fall');
          next = { ...next, pilot: injury.pilot, prone: true };
          if (next.pilot.status !== 'active') next = { ...next, destroyed: true };
          if (!isActive(next)) return next;
        }
      }

      return {
        ...next,
        prone: false,
        heat,
        shutdown,
        shutdownLastTurn,
        damageThisTurn: 0,
        fellThisTurn: false,
        hasFired: false,
        mounts: next.mounts.map((m) => ({ ...m, firedThisTurn: false })),
      };
    });
  }

  const asTally: ReadonlyMap<UnitId, UnitCombatTally> = tallies;
  return {
    outcome: outcomeOf(units, asTally, { objective, roundsCompleted: round }),
    rounds: round,
  };
}

/** То же, но одним значением — так его зовут кампания и экран. */
export function fastResolve(brief: BattleBrief, tuning: FastResolveTuning = FAST): BattleOutcome {
  return fastResolveDetailed(brief, tuning).outcome;
}
