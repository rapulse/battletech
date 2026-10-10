import { FACTIONS, FACTION_LIST } from '../galaxy/catalog.js';
import type { FactionKind } from '../galaxy/schema.js';
import { actorKind } from '../war/actors.js';
import { RELATIONS } from './schema.js';

/**
 * Статичная вражда фракций (шаг 16).
 *
 * Отвечает ровно на один вопрос: **кто с кем воюет**. Не «как наниматель
 * относится к отряду» — это репутация, три оси, шаг 20; и не «где сейчас
 * фронт» — это тикер войны, шаг 21. Оба перекроют эту таблицу, а не заменят
 * её: генератору контрактов всё равно понадобится знать, что Курита и Дэвион
 * враждуют, даже когда фронт между ними стоит.
 *
 * Величина СИММЕТРИЧНА (`enmity(a, b) === enmity(b, a)`) и лежит в 0..1.
 * Асимметрия появится вместе с репутацией: «Дэвион не любит Куриту» — свойство
 * пары, «Курита не любит именно вас» — свойство отряда.
 */

/**
 * Ключ пары, не зависящий от порядка: пара — это множество, а не список.
 *
 * Экспортируется с шага 20: тем же ключом размечена матрица отношений фракций
 * в состоянии (`reputation/state.ts`). Два способа назвать одну и ту же пару
 * разошлись бы молча — и половина матрицы читалась бы мимо записанного.
 */
export function factionPairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

const PAIR_ENMITY: ReadonlyMap<string, number> = new Map(
  RELATIONS.pairs.map((p) => [factionPairKey(p.a, p.b), p.enmity]),
);

const KIND_ENMITY: ReadonlyMap<string, number> = new Map(
  RELATIONS.kinds.map((p) => [factionPairKey(p.a, p.b), p.enmity]),
);

// Опечатка в имени фракции внутри `pairs` не должна тихо превращаться в
// «вражды нет»: разбор схемы проверяет форму файла, а ссылку в реестр акторов
// проверять больше некому. Тот же приём, что у владельца системы в `catalog.ts`.
for (const p of RELATIONS.pairs) {
  for (const id of [p.a, p.b]) {
    if (!FACTIONS.has(id)) {
      throw new Error(
        `Ошибка в данных отношений (data/galaxy/relations.json):\nнеизвестная фракция «${id}» в паре ${p.a}–${p.b}`,
      );
    }
  }
  if (p.a === p.b) {
    throw new Error(
      `Ошибка в данных отношений (data/galaxy/relations.json):\nпара «${p.a}» с самой собой — фракция не воюет сама с собой`,
    );
  }
}

/**
 * Насколько глубока вражда двух фракций.
 *
 * Порядок разрешения: явная пара → вид × вид → умолчание. Фракция сама с собой
 * не враждует никогда — это не запись в таблице, а тождество.
 */
export function enmity(a: string, b: string): number {
  if (a === b) return 0;

  const explicit = PAIR_ENMITY.get(factionPairKey(a, b));
  if (explicit !== undefined) return explicit;

  // Через `actorKind`, а не напрямую через каталог: держава игрока — такой же
  // владелец мира, как Волчьи Драгуны, и вражда вокруг её планеты обязана
  // считаться теми же данными, а не отдельным правилом (шаг 25, часть C).
  const kindA = actorKind(a);
  const kindB = actorKind(b);
  if (kindA === undefined || kindB === undefined) return RELATIONS.default;

  return KIND_ENMITY.get(factionPairKey(kindA, kindB)) ?? RELATIONS.default;
}

export function factionKind(id: string): FactionKind | undefined {
  return actorKind(id);
}

/** С кем у фракции вражда не ниже порога. Отсортировано по id — порядок обхода не выдумывается. */
export function enemiesOf(id: string, minEnmity: number): readonly { id: string; enmity: number }[] {
  return FACTION_LIST.filter((f) => f.id !== id)
    .map((f) => ({ id: f.id, enmity: enmity(id, f.id) }))
    .filter((e) => e.enmity >= minEnmity)
    .sort((x, y) => (x.id < y.id ? -1 : 1));
}
