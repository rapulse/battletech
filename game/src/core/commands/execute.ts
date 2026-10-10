import { chassis, COMBAT, terrainInfo } from '../data/tables.js';
import { DIRECTION_COUNT, distance, equals, key as hexKey, neighbor, type Direction, type Hex } from '../hex/index.js';
import { moveCost, MoveMode, type MoveStep } from '../map/index.js';
import { HitZone, ZONE_COUNT } from '../model/HitZone.js';
import {
  isOperational,
  rearmMounts,
  structureBreached,
  zoneState,
  type MechUnit,
} from '../model/MechUnit.js';
import { ContactLevel, Phase, type BattleState, type Side, type UnitId } from '../model/index.js';
import {
  applyDamage,
  computeContacts,
  heatLimits,
  isOverheated,
  mpBudget,
  resolveAttack,
  rollEjection,
  type EjectionResult,
  rollExecution,
  rollInitiative,
  rollInjury,
  rollZone,
  unitPilotingTarget,
  needsRoutinePilotingCheck,
  triggerAmmoExplosion,
  atHomeEdge,
  exitReading,
  moraleReading,
  type CriticalResult,
} from '../rules/index.js';
import { ok, reject, RejectReason, type BattleEvent, type Command, type CommandResult } from './types.js';

/**
 * Единственная точка изменения состояния. Слой показа получает события и
 * проигрывает их, ничего не пересчитывая.
 */
export function execute(state: BattleState, command: Command): CommandResult {
  switch (command.kind) {
    case 'move':
      return executeMove(state, command);
    case 'turn':
      return executeTurn(state, command);
    case 'attack':
      return executeAttack(state, command);
    case 'eject':
      return executeEject(state, command);
    case 'withdrawSide':
      return executeWithdrawSide(state, command);
    case 'evacuate':
      return executeEvacuate(state, command);
    case 'endPhase':
      return executeEndPhase(state);
  }
}

/**
 * Пересчёт того, что каждая сторона знает о чужих машинах, и события об
 * изменениях.
 *
 * Считается дважды за ход, и это не оптимизация, а правило:
 *
 *   - **в начале хода** (`merge: false`) — картина строится заново, и знание
 *     может ослабнуть: машина ушла за холм — засветку или силуэт потеряли.
 *     Ниже силуэта оно при этом не падает никогда (решение пользователя
 *     2026-09-19, `detection.contactFloorAtSilhouette`): раз сторона однажды
 *     разглядела класс машины, «забыть» его настолько, чтобы на карте снова
 *     встало «?», она уже не может — это не то же самое знание, что могло не
 *     появиться вовсе. До этого дня расчёт был безусловно свежим и мог
 *     стереть контакт вплоть до `None`, хотя по замыслу опуститься должен был
 *     только до силуэта.
 *   - **на входе в фазу стрельбы** (`merge: true`) — знание только
 *     пополняется. Иначе вышедший из-за холма в фазе движения был бы неуязвим
 *     до следующего хода, а собственное движение перестало бы что-то решать.
 *     Внутри хода контакт не убывает: мигающий контакт читается как ошибка.
 *
 * Событие пишется только на СМЕНУ уровня, а не на его наличие: иначе журнал
 * каждый ход повторял бы одно и то же по каждой машине и перестал бы читаться.
 * Правило «каждый бросок объяснён» здесь превращается в «каждое изменение
 * знания объяснено» — и ловит ровно те ошибки, которые тесты не ловят.
 */
export function refreshContacts(state: BattleState, merge = false): BattleEvent[] {
  const events: BattleEvent[] = [];
  const sides = [...new Set(state.units.map((u) => u.side))].sort();
  const floorAtSilhouette = COMBAT.detection.contactFloorAtSilhouette;

  for (const side of sides) {
    const before = state.contacts(side);
    const fresh = computeContacts(state.map, state.units, side);

    const after = new Map(fresh);
    for (const [id, was] of before) {
      const floor = merge
        ? was
        : floorAtSilhouette
          ? (Math.min(was, ContactLevel.Silhouette) as ContactLevel)
          : ContactLevel.None;
      if ((after.get(id) ?? ContactLevel.None) < floor) after.set(id, floor);
    }
    state.setContacts(side, after);

    // Засада, которую сторона разглядела (шаг 73a), остаётся обнаруженной.
    for (const u of state.units) {
      if (u.side === side || !u.dormant || u.spotted) continue;
      if ((after.get(u.id) ?? ContactLevel.None) === ContactLevel.None) continue;
      state.replaceUnit({ ...u, spotted: true });
      events.push({ kind: 'ambushSpotted', side, unitId: u.id });
    }


    for (const u of state.units) {
      if (u.side === side) continue;
      // Выбывшая машина уходит из таблицы контактов целиком, и формально это
      // выглядит как «контакт потерян». Знание при этом не менялось: сторона не
      // перестала видеть противника, противника не стало. Журнал уже сказал об
      // этом строкой о выбытии, а замер «сколько раз теряли контакт» без этой
      // проверки считал бы гибель разведкой (шаг 8, часть E).
      if (u.destroyed || u.withdrawn) continue;
      const was = before.get(u.id) ?? ContactLevel.None;
      const now = after.get(u.id) ?? ContactLevel.None;
      if (was === now) continue;
      events.push({ kind: 'contactChanged', side, unitId: u.id, from: was, to: now });
    }

    // Память о последнем контакте (шаг 8, часть D): пока цель видна хотя бы
    // засветкой, сторона знает её точный гекс — «на этом гексе кто-то есть» уже
    // содержит координату. Запись обновляется, пока видно; пропавшая из вида
    // цель оставляет последнее известное место нетронутым.
    //
    // Проверка идёт по СЫРОМУ `fresh`, а не по полу `contactFloorAtSilhouette`:
    // пол держит уровень («мы знаем, что это лёгкая машина»), но не текущий
    // гекс. Взять здесь `after` значило бы каждый ход тайно подглядывать за
    // истинной позицией машины, о которой сторона на самом деле ничего не
    // знает уже который ход, — ровно то жульничество, которого эта запись
    // избегает по своему собственному замыслу.
    for (const u of state.units) {
      if (u.side === side) continue;
      if ((fresh.get(u.id) ?? ContactLevel.None) > ContactLevel.None) {
        state.recordLastKnownContact(side, u.id, u.hex, state.turn);
      }
    }
  }
  return events;
}

/**
 * Сторона выходит из боя (шаг 43).
 *
 * Команда, а не побочный эффект правила: состояние меняется только командами
 * (game_core.md §2), и без этого реплей по журналу не воспроизвёл бы бой, в
 * котором противник ушёл. Морали здесь нет — её читает тот, кто команду отдаёт
 * (`sim/bot.ts::chooseSideAction`); исполнение только записывает решение.
 *
 * Бросков нет ни одного, поэтому отказ ничего не тратит из ГПСЧ по построению.
 */
function executeWithdrawSide(
  state: BattleState,
  command: Extract<Command, { kind: 'withdrawSide' }>,
): CommandResult {
  if (state.isWithdrawing(command.side)) return reject(RejectReason.AlreadyWithdrawing);
  const standing = state.active.filter((u) => u.side === command.side);
  if (standing.length === 0) return reject(RejectReason.NoSuchSide);

  state.startWithdrawal(command.side);
  const reading = moraleReading(state, command.side);
  return ok([
    {
      kind: 'sideWithdrawing',
      side: command.side,
      units: standing.length,
      pressure: reading.pressure,
      resolve: reading.resolve,
    },
  ]);
}

/**
 * Кто из отходящих дошёл до своего края и снимается с поля ЦЕЛЫМ (шаг 43).
 *
 * Проверяется ОДИН раз за ход, в конце фазы движения, а не после каждого хода
 * машины. Так покрываются оба случая разом — и «дошла», и «уже стояла у своего
 * края, когда объявили отход», — и ушедшая машина не успевает выстрелить в том
 * же ходу: её на поле уже нет.
 *
 * Обездвиженная не уходит и уйти не может: она не дойдёт до края, останется на
 * поле и станет трофеем. Это и есть цена промедления игрока с другой стороны —
 * успел обездвижить, трофей твой.
 */
function leaveField(state: BattleState): BattleEvent[] {
  const events: BattleEvent[] = [];
  for (const side of state.withdrawing()) {
    for (const u of state.units) {
      if (u.side !== side || u.destroyed || u.withdrawn) continue;
      if (!atHomeEdge(state, u)) continue;
      state.replaceUnit({ ...u, withdrawn: true });
      events.push({ kind: 'unitWithdrew', unitId: u.id, side });
    }
  }
  return events;
}

/**
 * Немедленный выход стороны (шаг 65): кто в зоне выхода — уходит целым, остальные
 * теряются. Порядок обхода — по id юнитов, как везде. Бросков нет.
 */
function executeEvacuate(
  state: BattleState,
  command: Extract<Command, { kind: 'evacuate' }>,
): CommandResult {
  const { inZone, stranded } = exitReading(state, command.side);
  if (inZone.length + stranded.length === 0) return reject(RejectReason.NoSuchSide);

  const events: BattleEvent[] = [];
  for (const u of state.units) {
    if (inZone.includes(u)) {
      state.replaceUnit({ ...u, withdrawn: true });
      events.push({ kind: 'unitWithdrew', unitId: u.id, side: u.side });
    } else if (stranded.includes(u)) {
      state.replaceUnit({ ...u, destroyed: true });
      events.push({ kind: 'unitAbandoned', unitId: u.id, side: u.side });
    }
  }
  return ok(events);
}

function executeEndPhase(state: BattleState): CommandResult {
  const events: BattleEvent[] = [{ kind: 'phaseEnded', turn: state.turn }];

  // Инициатива бросается здесь, а не в вызывающем коде. Порядок хода — часть
  // состояния боя, а состояние меняется только командами (game_core.md §2).
  // Бросок снаружи означал бы, что реплей по журналу команд не воспроизводит бой.
  if (state.phase === Phase.Initiative) {
    // Контакты пересчитываются один раз за ход, до инициативы: сторона входит
    // в ход с готовой картиной и принимает решения по ней. Пересчёт по запросу
    // дал бы контакт, мигающий внутри фазы, — это читается как ошибка, а не
    // как правило (шаг 7).
    events.push(...refreshContacts(state));

    const init = rollInitiative(state.rng.stream('initiative'), state);
    state.order = init.order;
    events.push({ kind: 'initiative', phase: 'movement', rolls: init.rolls, order: init.order });
    state.phase = Phase.Movement;
    return ok(events);
  }

  if (state.phase !== Phase.Heat) {
    // Отходящие снимаются с поля на выходе из фазы движения — до стрельбы:
    // машина, уже покинувшая карту, стрелять не может (шаг 43).
    if (state.phase === Phase.Movement) events.push(...leaveField(state));
    state.phase = (state.phase + 1) as Phase;
    // Вход в фазу стрельбы: то, что открылось за фазу движения, уже видно.
    // Только пополнение — потерять контакт внутри хода нельзя.
    if (state.phase === Phase.Attack) {
      events.push(...refreshContacts(state, true));
      // Второй бросок инициативы — перед стрельбой (решение пользователя
      // 2026-09-15). С одним броском на ход очерёдность залпа была известна
      // ещё на движении: ходишь вторым — значит, и стреляешь вторым, и машины
      // можно заранее увести за укрытие; ходишь первым — смело выходить на
      // открытое. Урон применяется сразу, поэтому первый залп — настоящее
      // преимущество, и знать его заранее значило играть манёвр наверняка.
      // Бросает то же правило, после ухода отходящих: ушедший пилот своей
      // Тактикой уже не помогает.
      const init = rollInitiative(state.rng.stream('initiative'), state);
      state.order = init.order;
      events.push({ kind: 'initiative', phase: 'attack', rolls: init.rolls, order: init.order });
    }
    return ok(events);
  }

  const skill = state.rng.stream('skill');
  const critsRng = state.rng.stream('crits');
  const stranded = strandedAmbush(state);

  for (const u of state.units) {
    // Ушедшая с поля не греется, не остывает и не встаёт: её здесь нет (шаг 43).
    if (u.destroyed || u.withdrawn) continue;

    let next = u;

    // 1. Тепловая детонация боекомплекта при экстремальном нагреве (ammoRiskAt).
    //
    // Один бросок за ход по одной случайной пачке, а не по каждой. Бросок на
    // каждую превращает порог в приговор: при шести пачках хотя бы одна рванёт
    // с вероятностью около двух третей за ход, и раскалённая машина исчезает
    // раньше, чем игрок успевает что-то решить. Порог обязан оставаться риском,
    // за который берутся сознательно, а не отложенным уничтожением.
    if (next.heat >= heatLimits(next).ammoRiskAt) {
      const live: { zone: HitZone; index: number }[] = [];
      for (let z = 0; z < ZONE_COUNT; z++) {
        const zSlots = next.slots[z] ?? [];
        for (let sIdx = 0; sIdx < zSlots.length; sIdx++) {
          const slot = zSlots[sIdx]!;
          if (slot.kind === 'ammo' && !slot.destroyed && (slot.explosionDamage ?? 0) > 0) {
            live.push({ zone: z as HitZone, index: sIdx });
          }
        }
      }
      if (live.length > 0 && critsRng.next() < COMBAT.heat.ammoExplosionChance) {
        const pick = live[Math.floor(critsRng.next() * live.length)]!;
        const slot = next.slots[pick.zone]![pick.index]!;
        const res = triggerAmmoExplosion(skill, next, pick.zone, pick.index, slot);
        next = res.unit;
        events.push(
          ...ammoExplosionEvents(next.id, pick.zone, pick.index, slot.id, res),
          ...ammoExplosionAftermath(next, res, 'ammoExplosion'),
        );
      }
    }

    if (next.destroyed) {
      state.replaceUnit(next);
      continue;
    }

    // 2. Рассеивание тепла охладителями с учётом тепла от повреждённого реактора
    // и от собственного движения (бег/прыжок). `moveMode`/`hexesMoved` берутся
    // ДО сброса ниже — это ещё тепло текущего хода, не следующего.
    //
    // `heat.runHeat`/`heat.jumpHeatPerHex` лежали в `combat.json` с шага 2 и не
    // читались ни одной строкой правил: бег и прыжок физически не грели. Найдено
    // тем же способом, каким шаг 8 просит искать мёртвые числа — grep'ом по
    // ключам данных, а не по названию механики (шаг 8, предусловие части C).
    const moveHeat =
      next.moveMode === MoveMode.Run
        ? COMBAT.heat.runHeat
        : next.moveMode === MoveMode.Jump
          ? COMBAT.heat.jumpHeatPerHex * next.hexesMoved
          : 0;
    // Тепло за крит реактора берётся у МАШИНЫ, а не из общей константы: класс
    // исполнения реактора его меняет (шаг 11, `data/quality.json`). Отсутствие
    // поля у шасси означает общее значение, поэтому весь каталог считается как
    // раньше и закреплённый хэш боя не двигается.
    const reactorHeat =
      next.reactorHits *
      (chassis(next.chassis).reactorHeatPerHit ?? COMBAT.critical.reactor.heatPerHit);
    const terrainHeat = terrainInfo(state.map.getTerrain(next.hex)).heatPerTurn;
    // Все пороги — от предела машины (отвод + запас корпуса, `rules/heat.ts`): край
    // шкалы, отключение, пилот и потолок. Остывает машина только на отвод — запас
    // возвращается через ход. Считаются после детонации: она могла выбить радиаторы.
    const limits = heatLimits(next);
    const heat = Math.max(
      0,
      Math.min(limits.max, next.heat - limits.dissipation + reactorHeat + terrainHeat + moveHeat),
    );

    let shutdown = next.shutdown;
    let shutdownLastTurn = next.shutdownLastTurn;

    // 3. Аварийное отключение (тепло выше предела: отвод + запас корпуса) и автоматический перезапуск
    if (next.dormant && !stranded.has(next.id)) {
      // Засада ждёт (шаг 73a): отключение держится, перезапуска нет.
    } else if (next.shutdown) {
      if (next.dormant) {
        // У стороны не осталось никого, кроме спящих, — засада включается
        // тем же перезапуском, что после перегрева.
        next = { ...next, dormant: false };
        events.push({ kind: 'ambushWoke', unitId: next.id, instant: false });
      }
      // Робот провёл ход обесточенным — автоматический перезапуск
      shutdown = false;
      shutdownLastTurn = true;
      events.push({ kind: 'restarted', unitId: next.id });
    } else if (shutdownLastTurn) {
      // Только что перезапустился — защита от петли повторного отключения
      shutdownLastTurn = false;
    } else if (next.heat >= limits.shutdownAt) {
      // Тепло перешло через предел: полный залп ровно в предел реактор держит,
      // единица сверх — отключение (решения пользователя 2026-09-14 и 09-15).
      shutdown = true;
      shutdownLastTurn = false;
      events.push({ kind: 'shutdown', unitId: next.id, heat: next.heat, limit: limits.limit });
    }

    // 4. Подъём после падения. Автоматический, без броска: падение — потеря
    //    темпа, а не приговор. Упавший в этом ходу встаёт не сейчас, а в конце
    //    следующего — тот самый «ход на подъём», и та же осторожность, что и с
    //    перезапуском реактора.
    let prone = next.prone;
    if (prone && !next.fellThisTurn && canStandUp(next)) {
      prone = false;
      events.push({ kind: 'stoodUp', unitId: next.id });
    }

    next = rearmMounts({
      ...next,
      heat,
      shutdown,
      shutdownLastTurn,
      prone,
      moveMode: null,
      hexesMoved: 0,
      mpLeft: 0,
      hasFired: false,
      damageThisTurn: 0,
      fellThisTurn: false,
    });

    // 5. Опасность для пилота от раскалённой кабины (предел + heat.pilotRisk)
    if (!next.destroyed && next.pilot.status === 'active' && heat >= limits.pilotRiskAt) {
      const result = rollInjury(skill, next.pilot, 'heat');
      next = { ...next, pilot: result.pilot };
      if (result.injured) {
        events.push({
          kind: 'pilotInjured',
          unitId: next.id,
          pilotId: next.pilot.id,
          cause: 'heat',
          chance: result.odds.chance,
          injuries: next.pilot.injuries,
          status: next.pilot.status,
        });
        if (next.pilot.status !== 'active') {
          next = { ...next, destroyed: true };
          events.push({ kind: 'unitDestroyed', unitId: next.id, reason: 'pilotOut' });
        }
      }
    }

    state.replaceUnit(next);
  }

  state.phase = Phase.Initiative;
  state.turn += 1;
  events.push({ kind: 'turnStarted', turn: state.turn });
  return ok(events);
}

/**
 * Выстрел: одна установка за фазу. Игрок выбирает, чем стрелять — ровно та
 * механика, с которой начинали за столом. Залп из всего оружия сразу
 * (альфа-страйк) заложен как расширение и упирается только в снятие этой проверки.
 */
function executeAttack(
  state: BattleState,
  command: Extract<Command, { kind: 'attack' }>,
): CommandResult {
  if (state.phase !== Phase.Attack) return reject(RejectReason.WrongPhase);

  const unit = state.getUnit(command.unitId);
  if (unit === undefined) return reject(RejectReason.NoSuchUnit);
  if (unit.destroyed) return reject(RejectReason.UnitDestroyed);
  if (!isOperational(unit)) return reject(RejectReason.PilotUnfit);
  // Лёжа никто не стреляет (шаг 6, часть E): повод падения не важен — гироскоп,
  // тепло, неудачный бросок при движении. Пока не встал, оружие недоступно.
  if (unit.prone) return reject(RejectReason.Prone);

  const target = state.getUnit(command.targetId);
  if (target === undefined) return reject(RejectReason.NoSuchTarget);
  if (target.id === unit.id || target.side === unit.side) return reject(RejectReason.SameSide);
  if (target.destroyed) return reject(RejectReason.TargetDestroyed);

  const mount = unit.mounts[command.mountIndex];
  if (mount === undefined) return reject(RejectReason.NoSuchWeapon);
  if (mount.firedThisTurn) return reject(RejectReason.AlreadyFired);
  if (mount.destroyed || zoneState(unit, mount.zone).destroyed) {
    return reject(RejectReason.WeaponUnavailable);
  }
  if (mount.ammo !== null && mount.ammo <= 0) return reject(RejectReason.WeaponUnavailable);

  // Что сторона стрелка знает о цели. Уровень берётся из состояния, а не
  // считается здесь заново: пересчёт на каждый выстрел давал бы контакт,
  // меняющийся внутри фазы стрельбы (шаг 7).
  const contact = state.contact(unit.side, target.id);

  const res = resolveAttack(state.rng, {
    map: state.map,
    attacker: unit,
    target,
    mountIndex: command.mountIndex,
    contact,
    units: state.units,
  });

  if (res.impossible) {
    if (contact === ContactLevel.None) return reject(RejectReason.NoContact);
    return reject(res.breakdown.band === 'out' ? RejectReason.OutOfRange : RejectReason.NoLineOfSight);
  }

  state.replaceUnit(res.attacker);
  state.replaceUnit(res.target);
  // Засада (шаг 73a): попадание по обнаруженной засаде её включает, а огонь её
  // стороны включает всех своих спящих. События о включении идут после выстрела.
  const woke = wakeOnShot(state, unit.side, res.hit ? res.target.id : null);

  // Ракетная пачка (шаг 66b): этапы выстрела на верхнем уровне события —
  // бросок, намерение, Собранность, срыв — описывают ПЕРВУЮ (ведущую) ракету
  // пачки. Это ровно то, что до шага 66b значил один бросок на весь залп:
  // у ведущей ракеты те же шансы, что были у залпа, поэтому опыт пилота
  // (`sim/tally.ts::collect`: попадание и «держался под риском») и счётчики
  // замера остаются в прежнем масштабе. Сводка «хоть одна из N» (шаг 66b,
  // первая редакция) начисляла ракетчику попадание почти за каждый залп и
  // почти никогда — «держался»: при шансе срыва 0.2 и десяти ракетах 0.8¹⁰ ≈
  // 11 % против прежних 80 % (шаг 66c). Остальные ракеты пачки — только урон:
  // `hit` ниже остаётся «долетела хоть одна», по нему гаснет луч и
  // засчитывается добивание, а сколько долетело — `clusterLanded`.
  const lead = res.clusterShots?.[0] ?? null;
  const intentHit = res.clusterShots !== null ? (lead?.intentHit ?? false) : res.intentHit;
  const poise = res.clusterShots !== null ? (lead?.poise ?? null) : res.poise;
  const execution = res.clusterShots !== null ? (lead?.execution ?? null) : res.execution;

  const events: BattleEvent[] = [
    {
      kind: 'shot',
      unitId: unit.id,
      targetId: target.id,
      weapon: res.weapon,
      toHitTarget: res.breakdown.target,
      factors: res.breakdown.factors,
      toHitBase: res.breakdown.base,
      toHitSituationalCut: res.breakdown.situationalCut,
      toHitOverflow: res.breakdown.overflow,
      range: res.breakdown.distance,
      roll: res.roll,
      zoneTable: res.zoneTable,
      intentHit,
      poiseSaved: poise?.saved ?? false,
      botched: execution?.botched ?? false,
      botchChance: execution?.odds.chance ?? 0,
      botchReasons: execution?.odds.factors.map((f) => f.key) ?? [],
      composure: execution?.odds.composure ?? 0,
      hit: res.hit,
      // Ракетная пачка (шаг 66b): ключи ставятся, только если ствол
      // кластерный — иначе поле есть, но пустое, а это не то же самое, что
      // «поля нет» (exactOptionalPropertyTypes).
      ...(res.clusterShots !== null
        ? { clusterLanded: res.shots.length, clusterTotal: res.clusterShots.length }
        : {}),
    },
  ];

  for (const shot of res.shots) {
    const o = shot.outcome;
    events.push({
      kind: 'damaged',
      unitId: target.id,
      zone: o.zone,
      transferredFrom: o.transferredFrom,
      amount: o.amount,
      armorAfter: o.armorAfter,
      structureAfter: o.structureAfter,
      armorHeld: o.armorHeld,
      zoneDestroyed: o.zoneDestroyed,
    });
    for (const w of o.weaponsLost) {
      events.push({ kind: 'weaponLost', unitId: target.id, weapon: w, zone: o.zone });
    }
    if (o.fell) events.push({ kind: 'fell', unitId: target.id });

    if (shot.critical) {
      const c = shot.critical;
      if (c.effect === 'ammoExplosion') {
        // Ранение и уход после детонации разбираются общим блоком ниже вместе
        // с остальными поводами — здесь только сам взрыв.
        events.push(...ammoExplosionEvents(target.id, c.zone, c.slotIndex, c.itemId, c));
      } else {
        events.push({
          kind: 'critical',
          unitId: target.id,
          zone: c.zone,
          slotIndex: c.slotIndex,
          slotKind: c.slotKind,
          itemId: c.itemId,
          effect: c.effect,
          weaponLost: c.weaponLost,
        });
      }
    }
  }

  // Равновесие от попадания: криты гироскопа и приводов ноги, урон через порог
  // класса (шаг 30, 2026-09-15). События идут ДО ранений: сперва машину повалило,
  // потом пилот получил при падении — журнал обязан читаться в том порядке, в
  // каком это происходило.
  for (const f of res.hitFalls) {
    events.push({
      kind: 'pilotingCheck',
      unitId: target.id,
      hex: res.target.hex,
      target: f.target,
      roll: f.roll,
      passed: f.passed,
      reason: f.reason,
    });
    if (!f.passed) events.push({ kind: 'fell', unitId: target.id });
  }

  for (const inj of res.injuries) {
    if (!inj.result.injured) continue;
    events.push({
      kind: 'pilotInjured',
      unitId: target.id,
      pilotId: inj.result.pilot.id,
      cause: inj.cause,
      chance: inj.result.odds.chance,
      injuries: inj.result.pilot.injuries,
      status: inj.result.pilot.status,
    });
  }

  if (res.cockpitBreach) {
    const b = res.cockpitBreach;
    events.push({
      kind: 'cockpitBreach',
      unitId: target.id,
      pilotId: res.target.pilot.id,
      roll: b.roll,
      lostFrom: b.lostFrom,
      pilotLost: b.lost,
    });
  }

  if (res.ejection) {
    events.push(...ejectionEvents(target.id, res.target.pilot.id, res.ejection));
  }

  if (res.pilotLost) {
    // Потеря уже объявлена внутри ejectionEvents — здесь только случаи без ухода.
    if (res.ejection === null) {
      const reason = res.cockpitBreach?.lost === true ? 'cockpitBreach' : 'cockpit';
      events.push({ kind: 'pilotLost', unitId: target.id, pilotId: res.target.pilot.id, reason });
    }
  } else if (res.target.pilot.status === 'out') {
    events.push({ kind: 'pilotLost', unitId: target.id, pilotId: res.target.pilot.id, reason: 'injuries' });
  }

  if (res.targetDestroyed && !target.destroyed) {
    const headGone = zoneState(res.target, HitZone.Head).destroyed;
    const torsoGone = zoneState(res.target, HitZone.Torso).destroyed;
    const legGone =
      zoneState(res.target, HitZone.LeftLeg).destroyed || zoneState(res.target, HitZone.RightLeg).destroyed;
    const reactorGone = res.target.reactorHits >= COMBAT.critical.reactor.maxHits;
    const gyroGone = res.target.gyroHits >= COMBAT.critical.gyro.maxHits;
    const ammoExploded = res.criticalHits.some((c) => c.effect === 'ammoExplosion');
    const reason = reactorGone
      ? 'reactor'
      : ammoExploded
        ? 'ammoExplosion'
        : headGone
          ? 'cockpit'
          : torsoGone
            ? 'torso'
            : legGone
              ? 'leg'
              : gyroGone
                ? 'gyro'
                : 'pilotOut';
    events.push({
      kind: 'unitDestroyed',
      unitId: target.id,
      reason,
    });
  }

  events.push(...woke);
  return ok(events);
}

/**
 * Засада включается выстрелом (шаг 73a, правила пользователя 2026-09-24).
 *
 * Огонь стороны `side` включает всех её спящих. Необнаруженная засада
 * включается сразу — реактор под нагрузкой, и она стреляет в этой же фазе:
 * в этом её смысл. Обнаруженная включается перезапуском: отключение снимется в
 * фазе тепла, и первую фазу огня она пропускает. Попадание по обнаруженной
 * засаде (`hitId`) включает её так же — перезапуском.
 */
function wakeOnShot(state: BattleState, side: Side, hitId: UnitId | null): BattleEvent[] {
  const events: BattleEvent[] = [];
  for (const u of state.units) {
    if (!u.dormant || u.destroyed || u.withdrawn) continue;
    if (u.side !== side && u.id !== hitId) continue;
    const instant = u.side === side && !u.spotted;
    state.replaceUnit(instant ? { ...u, dormant: false, shutdown: false } : { ...u, dormant: false });
    events.push({ kind: 'ambushWoke', unitId: u.id, instant });
  }
  return events;
}

/**
 * Страховка от тупика: у стороны в строю не осталось никого, кроме спящих, —
 * они включаются в фазе тепла этого хода. Иначе на задаче «вывести всех» бой
 * висел бы без видимых целей.
 */
function strandedAmbush(state: BattleState): Set<UnitId> {
  const out = new Set<UnitId>();
  for (const u of state.units) {
    if (!u.dormant || u.destroyed || u.withdrawn) continue;
    const awakeAlly = state.units.some(
      (o) => o.side === u.side && !o.dormant && !o.destroyed && !o.withdrawn,
    );
    if (!awakeAlly) out.add(u.id);
  }
  return out;
}

/**
 * Может ли робот подняться.
 *
 * И потеря ноги, и второй крит гироскопа сразу выводят машину из боя
 * (`applyDamage` / `resolveCriticalSlot`, шаг 6, части A и E) — `unit.destroyed`
 * отсекает оба случая здесь одной проверкой, подниматься уже некому.
 */
function canStandUp(unit: MechUnit): boolean {
  return !unit.destroyed && !unit.shutdown && unit.pilot.status === 'active';
}

/**
 * События одной детонации боекомплекта. Общие для обоих поводов — крит и
 * перегрев, — чтобы журнал не расходился между ними.
 */
function ammoExplosionEvents(
  unitId: UnitId,
  zone: HitZone,
  slotIndex: number,
  ammoId: string | undefined,
  res: CriticalResult,
): BattleEvent[] {
  return [
    {
      kind: 'critical',
      unitId,
      zone,
      slotIndex,
      slotKind: 'ammo',
      itemId: ammoId,
      effect: 'ammoExplosion',
    },
    {
      kind: 'ammoExplosion',
      unitId,
      zone,
      ammoId: ammoId ?? '',
      damage: res.damageDealt ?? 0,
      contained: res.contained ?? false,
      transferred: (res.explosionOutcome?.transferredFrom ?? null) !== null,
    },
  ];
}

/**
 * Последствия детонации для пилота: уход, ранение или потеря сознания.
 *
 * Отдельной ветки гибели быть не должно — уничтоженная детонацией машина
 * отпускает пилота ровно так же, как разрушенный торс.
 */
function ammoExplosionAftermath(
  unit: MechUnit,
  res: CriticalResult,
  reason: 'ammoExplosion',
): BattleEvent[] {
  const events: BattleEvent[] = [];
  if (res.ejection) {
    events.push(...ejectionEvents(unit.id, unit.pilot.id, res.ejection));
    events.push({ kind: 'unitDestroyed', unitId: unit.id, reason });
    return events;
  }
  if (res.injury?.injured) {
    events.push({
      kind: 'pilotInjured',
      unitId: unit.id,
      pilotId: unit.pilot.id,
      cause: 'ammoExplosion',
      chance: res.injury.odds.chance,
      injuries: unit.pilot.injuries,
      status: unit.pilot.status,
    });
    // Ранение могло довести пилота до потери сознания — тогда машина встала, и
    // это обязано быть объявлено, а не выведено читателем из тишины.
    if (unit.pilot.status === 'out') {
      events.push({ kind: 'pilotLost', unitId: unit.id, pilotId: unit.pilot.id, reason: 'injuries' });
      events.push({ kind: 'unitDestroyed', unitId: unit.id, reason: 'pilotOut' });
    }
  }
  return events;
}

/**
 * Общие события катапультирования: сам уход, ранение при приземлении и, если
 * уйти не удалось, потеря пилота. Одна функция на оба повода — принудительный
 * (из разрешения атаки) и добровольный, — чтобы журнал не расходился между ними.
 */
function ejectionEvents(
  unitId: UnitId,
  pilotId: string,
  ejection: EjectionResult,
): BattleEvent[] {
  const events: BattleEvent[] = [
    {
      kind: 'pilotEjected',
      unitId,
      pilotId,
      trigger: ejection.odds.trigger,
      chance: ejection.odds.chance,
      roll: ejection.roll,
      success: ejection.success,
      landingInjured: ejection.injury?.injured ?? false,
    },
  ];

  if (ejection.injury?.injured === true) {
    events.push({
      kind: 'pilotInjured',
      unitId,
      pilotId,
      cause: ejection.injury.odds.cause,
      chance: ejection.injury.odds.chance,
      injuries: ejection.pilot.injuries,
      status: ejection.pilot.status,
    });
  }

  if (!ejection.success) {
    // Повод потери — не всегда кокпит: добровольный уход тоже может сорваться.
    events.push({
      kind: 'pilotLost',
      unitId,
      pilotId,
      reason: ejection.odds.trigger === 'head' ? 'cockpit' : 'ejectionFailed',
    });
  }

  return events;
}

function executeEject(
  state: BattleState,
  command: Extract<Command, { kind: 'eject' }>,
): CommandResult {
  if (state.phase !== Phase.Movement) return reject(RejectReason.WrongPhase);

  const unit = state.getUnit(command.unitId);
  if (unit === undefined) return reject(RejectReason.NoSuchUnit);
  if (unit.destroyed) return reject(RejectReason.UnitDestroyed);
  // Ушедшая с поля машина уже увезла пилота домой (шаг 43).
  if (unit.withdrawn) return reject(RejectReason.UnitDestroyed);
  if (unit.pilot.status !== 'active') return reject(RejectReason.AlreadyEjected);

  const ejection = rollEjection(state.rng.stream('skill'), unit, 'voluntary');
  state.replaceUnit(ejection.unit);

  const events = ejectionEvents(unit.id, unit.pilot.id, ejection);
  events.push({ kind: 'unitDestroyed', unitId: unit.id, reason: 'ejected' });

  return ok(events);
}

/**
 * Разворот на месте. Меняет только фасинг и ничего больше: ни MP, ни признак
 * «уже ходил» не трогаются, потому что поворот в правилах бесплатен.
 *
 * Не даёт развернуться лежащему и выбывшему — по тем же основаниям, что и ход.
 */
function executeTurn(
  state: BattleState,
  command: Extract<Command, { kind: 'turn' }>,
): CommandResult {
  if (state.phase !== Phase.Movement) return reject(RejectReason.WrongPhase);

  const unit = state.getUnit(command.unitId);
  if (unit === undefined) return reject(RejectReason.NoSuchUnit);
  if (unit.destroyed) return reject(RejectReason.UnitDestroyed);
  if (!isOperational(unit)) return reject(RejectReason.PilotUnfit);
  if (unit.prone) return reject(RejectReason.Prone);

  const facing = command.facing;
  if (!Number.isInteger(facing) || facing < 0 || facing > 5) {
    return reject(RejectReason.NoSuchTarget);
  }
  if (facing === unit.facing) return { ok: true, events: [] };

  const from = unit.facing;
  state.replaceUnit({ ...unit, facing });
  return {
    ok: true,
    events: [{ kind: 'turned', unitId: unit.id, from, to: facing }],
  };
}

function executeMove(
  state: BattleState,
  command: Extract<Command, { kind: 'move' }>,
): CommandResult {
  if (state.phase !== Phase.Movement) return reject(RejectReason.WrongPhase);

  const unit = state.getUnit(command.unitId);
  if (unit === undefined) return reject(RejectReason.NoSuchUnit);
  if (unit.destroyed) return reject(RejectReason.UnitDestroyed);
  if (!isOperational(unit)) return reject(RejectReason.PilotUnfit);
  if (unit.prone) return reject(RejectReason.Prone);
  if (unit.moveMode !== null) return reject(RejectReason.AlreadyMoved);

  const path = command.path;
  if (path.length === 0) return reject(RejectReason.EmptyPath);
  if (!equals(path[0]!, unit.hex)) return reject(RejectReason.PathNotFromUnit);

  const budget = mpBudget(unit, command.mode);
  const occupied = state.occupiedExcept(unit.id);

  // --- Проверка маршрута целиком ДО единого броска -------------------------
  // Порядок обязателен: отклонённая команда не имеет права сдвинуть ГПСЧ, иначе
  // повтор боя по журналу команд разойдётся с оригиналом.
  interface Walk {
    readonly to: Parameters<typeof neighbor>[0];
    readonly dir: Direction;
    readonly step: MoveStep;
    readonly spent: number;
  }
  const walk: Walk[] = [];
  let spent = 0;

  for (let i = 1; i < path.length; i++) {
    const from = path[i - 1]!;
    const to = path[i]!;

    const dir = directionBetween(from, to);
    if (dir === null) return reject(RejectReason.NotAdjacent);
    if (occupied.has(hexKey(to))) return reject(RejectReason.Occupied);

    const result = moveCost(state.map, from, to, dir, command.mode);
    if (!result.ok) return reject(RejectReason.Impassable);

    spent += result.step.mp;
    if (spent > budget) return reject(RejectReason.NotEnoughMp);

    walk.push({ to, dir, step: result.step, spent });
  }

  const events: BattleEvent[] = [];
  const skill = state.rng.stream('skill');
  const piloting = state.rng.stream('piloting');

  // --- Этап «исполнение»: пилот может не пройти маршрут целиком -------------
  // Маршрут остаётся заданным маршрутом: робот может не дойти, но не свернёт
  // куда-то ещё (wiki/design/pilots/skills.md, ограничение 3).
  let limit = walk.length;
  let extraCheck = false;

  if (walk.length > 0) {
    const execution = rollExecution(skill, unit.pilot, {
      overheated: isOverheated(unit),
      damageTakenThisTurn: unit.damageThisTurn,
      structureBreached: structureBreached(unit),
      fellThisTurn: unit.fellThisTurn,
    });

    if (execution.botched) {
      // Длинный маршрут не дойден на 1–2 гекса; на коротком отбирать нечего,
      // поэтому вместо этого добавляется лишний бросок пилотирования.
      const short = walk.length >= 2 ? 1 + skill.int(0, 1) : 0;
      if (short > 0) limit = Math.max(1, walk.length - short);
      else extraCheck = true;

      events.push({
        kind: 'moveBotched',
        unitId: unit.id,
        botchChance: execution.odds.chance,
        composure: execution.odds.composure,
        botchReasons: execution.odds.factors.map((f) => f.key),
        hexesShort: walk.length - limit,
      });
    }
  }

  // --- Проход по маршруту с бросками на равновесие --------------------------
  let next: MechUnit = unit;
  let travelled = 0;
  let mpUsed = 0;
  let fellAt = false;

  // Сколько бросков может дать ОДНО перемещение (шаг 30). Маршрут — это один
  // манёвр: три гекса брода оцениваются целиком, а не тремя независимыми
  // бросками подряд. До этого шага бросок назначался на каждый гекс, и на
  // переправе из трёх гексов новобранец падал в 93 % случаев — не потому, что
  // правило строгое, а потому, что его применяли трижды.
  //
  // Иммунитет по навыку считается ОДИН раз, до прохода: он свойство пилота и
  // состояния машины, а не гекса, и меняться посреди маршрута ему не от чего.
  const routineImmune = !needsRoutinePilotingCheck(next);
  let checksMade = 0;

  for (let i = 0; i < limit; i++) {
    const leg = walk[i]!;
    travelled = i + 1;
    mpUsed = leg.spent;

    // Срыв исполнения иммунитету не подчиняется: это не рельеф, а уже
    // случившаяся ошибка пилота, и отменять её мастерством было бы странно.
    const forced = extraCheck && i === limit - 1;
    const needsCheck = forced || (leg.step.pilotingCheck && !routineImmune);
    if (!needsCheck) continue;
    if (checksMade >= COMBAT.piloting.checksPerMove) continue;
    checksMade += 1;

    const target = unitPilotingTarget(next);
    const roll = piloting.d2d6();
    const passed = roll >= target;

    events.push({
      kind: 'pilotingCheck',
      unitId: unit.id,
      hex: leg.to,
      target,
      roll,
      passed,
      reason: leg.step.pilotingReason ?? 'piloting.botch',
    });

    if (!passed) {
      fellAt = true;
      break;
    }
  }

  const last = travelled === 0 ? null : walk[travelled - 1]!;
  const destination = last === null ? unit.hex : last.to;
  const submerged = last === null ? unit.submerged : last.step.submerged;
  // Фасинг берётся от ПОСЛЕДНЕГО пройденного шага, а не от конца заданного
  // маршрута: недошедший робот смотрит туда, куда шёл, а не туда, куда собирался.
  const facing: Direction = last === null ? unit.facing : last.dir;

  next = {
    ...next,
    hex: destination,
    facing,
    mpLeft: budget - mpUsed,
    moveMode: command.mode,
    hexesMoved: travelled,
    submerged,
  };

  events.push({
    kind: 'moved',
    unitId: unit.id,
    path: path.slice(0, travelled + 1),
    facing,
    mode: command.mode,
    mpSpent: mpUsed,
    submerged,
    pilotingChecks: events.filter((e) => e.kind === 'pilotingCheck').length,
  });

  // --- Падение --------------------------------------------------------------
  if (fellAt) {
    next = { ...next, prone: true, fellThisTurn: true, mpLeft: 0 };
    events.push({ kind: 'fell', unitId: unit.id });

    const zone = rollZone(state.rng.stream('hitLocation')).zone;
    const outcome = applyDamage(next, zone, COMBAT.damage.fallDamagePerLevel);
    next = outcome.unit;
    events.push({
      kind: 'damaged',
      unitId: unit.id,
      zone: outcome.zone,
      transferredFrom: outcome.transferredFrom,
      amount: outcome.amount,
      armorAfter: outcome.armorAfter,
      structureAfter: outcome.structureAfter,
      armorHeld: outcome.armorHeld,
      zoneDestroyed: outcome.zoneDestroyed,
    });

    const injury = rollInjury(skill, next.pilot, 'fall');
    next = { ...next, pilot: injury.pilot };
    if (injury.injured) {
      events.push({
        kind: 'pilotInjured',
        unitId: unit.id,
        pilotId: next.pilot.id,
        cause: 'fall',
        chance: injury.odds.chance,
        injuries: next.pilot.injuries,
        status: next.pilot.status,
      });
    }
    if (next.pilot.status !== 'active') {
      next = { ...next, destroyed: true };
      events.push({ kind: 'pilotLost', unitId: unit.id, pilotId: next.pilot.id, reason: 'injuries' });
      events.push({ kind: 'unitDestroyed', unitId: unit.id, reason: 'pilotOut' });
    } else if (next.destroyed) {
      // Падение при движении разрушило зону насмерть (торс, голова или, после
      // шага 6, нога) — та же автоматика катапультирования, что и при выстреле:
      // отдельной ветки гибели не существует (decisions.md, 2026-08-25).
      //
      // Повод берётся по разрушенной зоне, а не всегда «торс»: разбитая при
      // падении голова — это разбитая катапульта, и уходить из неё так же
      // трудно, как из головы, разбитой выстрелом.
      const headGone = zoneState(next, HitZone.Head).destroyed;
      const torsoGone = zoneState(next, HitZone.Torso).destroyed;
      const legGone =
        zoneState(next, HitZone.LeftLeg).destroyed || zoneState(next, HitZone.RightLeg).destroyed;

      const fallEjection = rollEjection(skill, next, headGone ? 'head' : 'torso');
      next = fallEjection.unit;
      events.push(...ejectionEvents(unit.id, next.pilot.id, fallEjection));

      const reason = headGone ? 'cockpit' : torsoGone ? 'torso' : legGone ? 'leg' : 'torso';
      events.push({ kind: 'unitDestroyed', unitId: unit.id, reason });
    }
  }

  state.replaceUnit(next);
  events.push(...spotAlongPath(state, unit.side, path.slice(0, travelled + 1)));
  return ok(events);
}

/**
 * Засада, мимо которой прошли (шаг 73a, решение пользователя 2026-09-24).
 *
 * Обнаружение идёт по ВСЕЙ траектории хода, а не по конечной клетке: машина,
 * проскочившая в двух гексах от засады, её заметила, даже если встала дальше.
 * Контакт поднимается сразу и только с найденной засадой — внутри хода знание
 * может лишь пополняться (`sawShot`), и пересчитывать ради этого всю картину
 * стороны незачем: остальное обновит ближайший пересчёт.
 */
function spotAlongPath(state: BattleState, side: Side, path: readonly Hex[]): BattleEvent[] {
  const range = COMBAT.ambush.spotRange;
  const found: UnitId[] = [];
  for (const u of state.units) {
    if (u.side === side || !u.dormant || u.spotted || u.destroyed || u.withdrawn) continue;
    if (!path.some((h) => distance(h, u.hex) <= range)) continue;
    state.replaceUnit({ ...u, spotted: true });
    found.push(u.id);
  }
  if (found.length === 0) return [];

  const events: BattleEvent[] = [];
  const fresh = computeContacts(state.map, state.units, side);
  const table = new Map(state.contacts(side));
  for (const id of found) {
    events.push({ kind: 'ambushSpotted', side, unitId: id });
    const was = table.get(id) ?? ContactLevel.None;
    const now = fresh.get(id) ?? ContactLevel.None;
    if (now <= was) continue;
    table.set(id, now);
    events.push({ kind: 'contactChanged', side, unitId: id, from: was, to: now });
  }
  state.setContacts(side, table);
  return events;
}

/** Направление из a в b, либо null, если клетки не соседние. */
function directionBetween(a: Parameters<typeof neighbor>[0], b: typeof a): Direction | null {
  for (let d = 0; d < DIRECTION_COUNT; d++) {
    if (equals(neighbor(a, d as Direction), b)) return d as Direction;
  }
  return null;
}

/**
 * Все допустимые команды для юнита.
 *
 * Один источник на три потребителя: подсветка в интерфейсе, перебор в ИИ (M5) и
 * авто-расчёт боя (M10). Без него ИИ завёл бы вторую копию правил валидации, и
 * две копии разошлись бы (game_core.md §4.5).
 */
export { enumerateLegalCommands } from './enumerate.js';
export { MoveMode };
