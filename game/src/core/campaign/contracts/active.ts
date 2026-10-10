import type { Pilot } from '../../model/Pilot.js';
import type { BattleBrief, BattleParticipant } from '../bridge/toBattle.js';
import type { MechRecord } from '../mech/MechRecord.js';
import type { CampaignState } from '../state.js';
import type { Contract } from './board.js';
import { buildAllies, buildOpfor } from './opfor.js';
import { emplacementsFor, fortressObjective } from './emplacements.js';
import { missionField } from './intel.js';
import { CONTRACTS, type MissionType } from './schema.js';
import type { BattleObjective } from '../../model/Objective.js';
import { crippleQuota } from '../../rules/objective.js';

/**
 * Взятый контракт (шаг 16).
 *
 * Лежит в `CampaignState` целиком, а не ссылкой на биржу: биржа выводится и на
 * следующей декаде предложит другое, а взятый контракт обязан пережить смену
 * декады, перелёт и загрузку сохранения ровно тем же, чем был подписан.
 */
export interface ActiveContract {
  readonly contract: Contract;
  readonly takenDay: number;
  /** День, после которого контракт считается проваленным по сроку (задача `contractExpired`). */
  readonly deadlineDay: number;
  /** Уплачено нанимателем вперёд. Хранится отдельно: при разрыве аванс возвращается. */
  readonly advancePaid: number;
  /** Звено, выведенное на бой. `null` — рота ещё не выходила. */
  readonly sortie: Sortie | null;
}

/**
 * Вылет: кто вышел и по какому сиду собран противник.
 *
 * Сид лежит в состоянии, а не бросается заново при разборе, и это не мелочь:
 * `ResolveContract` пересобирает брифинг того же боя, чтобы отдать его
 * послебоевому разбору. Соберись противник по другому сиду — разбор не нашёл
 * бы в итогах боя ни одной вражеской машины.
 */
export interface Sortie {
  readonly recordIds: readonly string[];
  readonly battleSeed: number;
  readonly mapSeed: number;
}

/**
 * Задача боя этого типа миссии (шаг 19b).
 *
 * Единственный переводчик между «контракт» и «бой»: дальше по коду ядро боя
 * знает только «продержись столько-то ходов», а тип миссии не знает про бой
 * вовсе.
 */
export function missionObjective(mission: MissionType): BattleObjective {
  return CONTRACTS.missions[mission].objective;
}

/** Машины звена в порядке вылета. Бросает, если запись успела уйти из ростера. */
export function sortieRecords(state: CampaignState, sortie: Sortie): MechRecord[] {
  return sortie.recordIds.map((id) => {
    const record = state.company.mechs.find((m) => m.id === id);
    if (record === undefined) throw new RangeError(`Машина вылета ${id} не найдена в роте`);
    return record;
  });
}

function pilotOf(state: CampaignState, record: MechRecord): Pilot {
  if (record.pilotId === null) throw new RangeError(`Машина ${record.id} вышла на контракт без пилота`);
  const pilot = state.company.pilots.find((p) => p.id === record.pilotId);
  if (pilot === undefined) throw new RangeError(`Пилота ${record.pilotId} нет в роте`);
  return pilot;
}

/**
 * Брифинг боя по взятому контракту.
 *
 * Чистая функция от состояния: одно и то же состояние даёт один и тот же бой.
 * Вызывается дважды за контракт — на выходе в бой (`Deploy` → `makeBattleFromBrief`)
 * и при разборе (`ResolveContract` → `debrief`), и оба раза обязана дать
 * побайтово тот же состав. Ровно поэтому сид вылета лежит в состоянии.
 *
 * Биом карты — биом планеты (брифинг шага 16, п. 3), а РАЗМЕР — от числа машин
 * на поле (решение пользователя 2026-09-08, `contracts.json → map`). До этой
 * правки размеры не передавались вовсе, и бой всегда собирался умолчанием
 * 15×15 — «дуэльным» полем: противник первым же ходом пересекал три четверти
 * карты, и вместо расстановки выходила свалка в углу.
 *
 * Размер считается от ОБЕИХ сторон, а не от одного звена: поле тесно ровно
 * настолько, сколько машин на нём стоит.
 */
/**
 * Сторона поля боя под такие силы. Таблица лежит в данных, а не здесь: это
 * ручка калибровки, и крутить её надо, не трогая код.
 */
export function mapSizeFor(units: number): number {
  const steps = CONTRACTS.map.steps;
  for (const step of steps) if (units <= step.maxUnits) return step.size;
  return steps[steps.length - 1]!.size;
}

/**
 * Задача боя по контракту: то же, что `missionObjective`, но долевая задача получает число
 * машин, посчитанное от ОБЪЯВЛЕННОГО состава (`contract.opforUnits`). Игрок читает его на
 * карточке контракта и в бою; на поле может выйти больше или меньше — условие не сдвигается.
 */
export function contractObjective(contract: Contract): BattleObjective {
  // Укреплённая работа (шаг 73d) — своя задача: разрушить или удержать объекты.
  if (contract.fortified !== undefined) {
    const fort = fortressObjective(contract.mission);
    if (fort !== null) return fort;
  }
  const task = missionObjective(contract.mission);
  if (task.kind !== 'cripple') return task;
  return { ...task, quota: crippleQuota(task.share, contract.opforUnits) };
}

/**
 * Укрепление брифинга (шаг 73d): объекты-цели и бункеры на стороне
 * обороняющегося — на своей земле нанимателя это рота, на чужой — противник.
 */
export function fortressField(contract: Contract): Pick<BattleBrief, 'structures'> {
  const f = contract.fortified;
  if (f === undefined) return {};
  const side = missionField(contract.mission) === 'own' ? 'player' : 'opfor';
  return {
    structures: [
      ...f.targets.map((structure, i) => ({ id: `F-${i + 1}`, structure, weapons: [], side }) as const),
      ...f.bunkers.map((weapons, i) => ({ id: `B-${i + 1}`, structure: 'bunker', weapons, side }) as const),
    ],
  };
}

/** Огневые точки брифинга (шаг 73c): поле пишется, только когда они есть. */
export function emplacementsField(contract: Contract, seed: number): Pick<BattleBrief, 'emplacements'> {
  const list = emplacementsFor(contract, seed);
  return list.length > 0 ? { emplacements: list } : {};
}

export function contractBrief(state: CampaignState): BattleBrief {
  const active = state.contract;
  if (active === null) throw new RangeError('Брифинг боя запрошен без взятого контракта');
  if (active.sortie === null) throw new RangeError('Брифинг боя запрошен до выхода звена на контракт');

  const records = sortieRecords(state, active.sortie);
  const company: BattleParticipant[] = records.map((record) => ({ record, pilot: pilotOf(state, record) }));
  return briefFor(active.contract, company, active.sortie.battleSeed, active.sortie.mapSeed);
}

/**
 * Брифинг боя по контракту для этого звена и сидов. Его же берёт бой гарнизона с восстанием (шаг 86b):
 * противник тот же, что у работы «подавить восстание».
 */
export function briefFor(
  contract: Contract,
  company: readonly BattleParticipant[],
  battleSeed: number,
  mapSeed: number,
): BattleBrief {
  const records = company.map((p) => p.record);
  const enemy = buildOpfor(contract, records, battleSeed);
  const allies = buildAllies(contract, battleSeed);
  const size = mapSizeFor(company.length + allies.length + enemy.length);

  return {
    mapSeed,
    battleSeed,
    map: { biome: contract.biome, width: size, height: size },
    company,
    enemy,
    ...(allies.length > 0 ? { allies } : {}),
    ...emplacementsField(contract, battleSeed),
    ...fortressField(contract),
    // Задача боя — свойство ТИПА МИССИИ (шаг 19b), а не отдельное поле
    // контракта: она одинакова у всех рейдов и не может разойтись с типом,
    // потому что берётся по нему из данных. Доля же превращается в ЧИСЛО по
    // объявленному составу: разведка могла ошибиться, а условие контракта от этого
    // не меняется (шаг 61).
    objective: contractObjective(contract),
  };
}
