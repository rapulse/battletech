import type { GalaxyDeltas } from '../galaxy/delta.js';
import { domainWorlds } from '../war/domain.js';
import { WAR } from '../war/schema.js';

/**
 * ТИТУЛЫ ДЕРЖАВЫ (шаг 89, проект державы §4 H; решения пользователя 2026-10-02).
 *
 * Ступени снял шаг 72c: до «державы» мир роты жгли только набегами, а рота уже наступала — асимметрия. Титул
 * возвращается без запретов: он ничего не закрывает, а лишь называет размер державы и даёт малую прибавку. Титул
 * выводится из числа миров сейчас и в сохранение не пишется — потерял миры, потерял и титул, как главы кампании
 * (шаг 70). Числа — `war.json → realm.titles`.
 */

export type RealmTitle = (typeof WAR.realm.titles)[number];

/** Прибавки титула: к дрейфу лояльности и к очкам стройки каждого мира, к пределу секторов, к потолку армии. */
export interface TitleBonus {
  readonly loyalty: number;
  readonly points: number;
  readonly sectors: number;
  /** Доля прибавки к потолку армии державы (шаг 90). */
  readonly army: number;
}

/** Высший титул по числу миров, или `null` — миров нет. */
export function titleOf(worlds: number): RealmTitle | null {
  let out: RealmTitle | null = null;
  for (const t of WAR.realm.titles) if (worlds >= t.worlds) out = t;
  return out;
}

export function realmTitle(deltas: GalaxyDeltas): RealmTitle | null {
  return titleOf(domainWorlds(deltas).length);
}

/** Следующий титул и сколько миров до него; `null` — вершина или державы нет. */
export function nextTitle(worlds: number): RealmTitle | null {
  return WAR.realm.titles.find((t) => t.worlds > worlds) ?? null;
}

/** Прибавки всех достигнутых титулов — они копятся. */
export function titleBonusOf(worlds: number): TitleBonus {
  let loyalty = 0;
  let points = 0;
  let sectors = 0;
  let army = 0;
  for (const t of WAR.realm.titles) {
    if (worlds < t.worlds) break;
    loyalty += t.loyalty ?? 0;
    points += t.points ?? 0;
    sectors += t.sectors ?? 0;
    army += t.army ?? 0;
  }
  return { loyalty, points, sectors, army };
}
