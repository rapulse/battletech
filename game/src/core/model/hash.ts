import { key as hexKey } from '../hex/index.js';
import type { BattleState } from './BattleState.js';
import { isDefaultObjective, type BattleObjective } from './Objective.js';

/**
 * Хэш состояния боя для golden-replay (game_core.md §12).
 *
 * Тест хранит сид, журнал команд и этот хэш. Если правило поменялось незаметно —
 * хэш разойдётся, и тест покажет это сразу, а не через месяц через «бои стали
 * какими-то другими».
 *
 * Строка строится в явном, отсортированном порядке: полагаться на порядок обхода
 * объектов нельзя (game_core.md §4.7).
 */
function cyrb32(text: string): number {
  let h = 0x9e3779b9;
  for (let i = 0; i < text.length; i++) {
    h = Math.imul(h ^ text.charCodeAt(i), 0x85ebca6b);
    h ^= h >>> 13;
  }
  h = Math.imul(h ^ (h >>> 16), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/** Задача боя одной строкой. Числа входят: срок обороны — часть состояния, а не украшение. */
function describeObjective(objective: BattleObjective): string {
  switch (objective.kind) {
    case 'destroy':
      return 'destroy';
    case 'hold':
      return `hold:${objective.rounds}`;
    case 'destroyTargets':
      return 'destroyTargets';
    case 'protectTargets':
      return `protectTargets:${objective.rounds}`;
    case 'cripple':
      return objective.quota === undefined ? `cripple:${objective.share}` : `cripple:${objective.share}:${objective.quota}`;
  }
}

/** Каноническая строка состояния. Читаема глазами — при расхождении видно, что именно уехало. */
export function serializeBattleState(state: BattleState): string {
  const parts: string[] = [`turn=${state.turn}`, `phase=${state.phase}`];

  // Задача боя (шаг 19b) входит в хэш, только когда она НЕ умолчание. Бой без
  // задачи — тот же бой, что был до шага, и его эталонный хэш обязан остаться
  // прежним: иначе правка, ничего в правилах не изменившая, потребовала бы
  // переписать golden-значение, а вместе с ним и всё доверие к нему.
  if (!isDefaultObjective(state.objective)) {
    parts.push(`task=${describeObjective(state.objective)}`);
  }

  // Отход стороны (шаг 43) входит в хэш, только когда он есть. Бой, в котором
  // никто не уходил, — тот же бой, что был до шага, и его закреплённый хэш
  // обязан остаться прежним: та же дисциплина, что у задачи боя выше.
  const withdrawing = state.withdrawing();
  if (withdrawing.length > 0) parts.push(`withdrawing=${withdrawing.join(',')}`);

  const rng = state.rng.getState();
  for (const name of Object.keys(rng).sort()) {
    parts.push(`rng.${name}=${rng[name as keyof typeof rng]}`);
  }

  for (const u of state.units) {
    const zones = u.zones.map((z) => `${z.armor}/${z.structure}${z.destroyed ? 'x' : ''}`).join(',');
    // Ушедшая с поля машина отмечается только когда ушла — по той же причине.
    const gone = u.withdrawn ? ' gone=1' : '';
    const asleep = (u.dormant ? ' asleep=1' : '') + (u.spotted ? ' spotted=1' : '');
    const ally = u.ally ? ' ally=1' : '';
    const post = (u.frame === 'emplacement' ? ' frame=emplacement' : '') + (u.objectiveTarget ? ' target=1' : '');
    const mounts = u.mounts.map((m) => `${m.weapon}:${m.ammo ?? '-'}${m.destroyed ? 'x' : ''}`).join(',');
    const skills = Object.keys(u.pilot.skills)
      .sort()
      .map((k) => `${k}${u.pilot.skills[k]}`)
      .join('');
    parts.push(
      [
        u.id,
        u.side,
        u.chassis,
        `hex=${hexKey(u.hex)}`,
        `f=${u.facing}`,
        `mp=${u.mpLeft}`,
        `mode=${u.moveMode ?? '-'}`,
        `moved=${u.hexesMoved}`,
        `sub=${u.submerged}`,
        `prone=${u.prone ? 1 : 0}`,
        `heat=${u.heat}`,
        `dmg=${u.damageThisTurn}`,
        `fired=${u.hasFired ? 1 : 0}`,
        `dead=${u.destroyed ? 1 : 0}`,
        `z[${zones}]`,
        `w[${mounts}]`,
        `pilot=${u.pilot.id}:${u.pilot.status}:${u.pilot.injuries}:${skills}`,
      ].join(' ') + gone + asleep + ally + post,
    );
  }

  // Знание сторон — часть состояния, и оно обязано попасть в хэш: иначе реплей
  // перестанет ловить расхождения ровно в том, что добавил шаг 7. Порядок
  // явный: стороны по алфавиту, внутри — юниты по id.
  for (const side of [...new Set(state.units.map((u) => u.side))].sort()) {
    const seen = state.units
      .filter((u) => u.side !== side)
      .map((u) => `${u.id}:${state.contact(side, u.id)}`)
      .join(',');
    parts.push(`contacts.${side}=[${seen}]`);

    // Память о последнем контакте — состояние боя (шаг 8, часть D), не поле
    // бота: обязана попасть в хэш, иначе реплей перестанет ловить расхождения
    // ровно в том, что она добавляет. Сортировка по id — детерминизм обхода.
    const memory = [...state.lastKnownContacts(side).entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([id, m]) => `${id}:${hexKey(m.hex)}@${m.turn}`)
      .join(',');
    parts.push(`lastKnown.${side}=[${memory}]`);
  }

  return parts.join('\n');
}

export function hashBattleState(state: BattleState): string {
  return cyrb32(serializeBattleState(state)).toString(16).padStart(8, '0');
}
