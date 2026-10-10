import { GALAXY } from '../galaxy/catalog.js';
import { ownerOf, type GalaxyDeltas } from '../galaxy/delta.js';
import { actorKind, isPlayerActor } from './actors.js';
import { totalArmy, type WarState } from './economy.js';
import { WAR } from './schema.js';

/**
 * УГРОЗА (шаг 83; образец — Stellaris).
 *
 * До шага мир не замечал снежного кома: Лиао съедал Дэвиона 134 → 212 миров, держава роты росла
 * 1 → 18, и ни одна соседняя держава на это не отвечала (`notes.md` §10zg пп. 9, 11). «Агрессивное
 * расширение» по сети отношений было проверено и снято (§10zf п. 1): жертвы роты — враги её
 * сюзерена, и по сети «враг моего врага» отношение к роте росло. Угроза считается не по сети, а по
 * карте: кто растёт, куда он смотрит и чем.
 *
 * Угроза для `i` от `j` — произведение трёх вещей:
 * 1. **рост `j`** — его захваты у всех, по тающей памяти (`WarState.conquests`);
 * 2. **куда `j` смотрит** — доля его приграничных миров, касающихся `i`;
 * 3. **чем** — соотношение сил на этой границе: армия `j` × та же доля против армии `i` × доли
 *    границы `i`, обращённой к `j`, в пределах `powerMin`..`powerMax`.
 *
 * Так растущий сосед пугает всех соседей, каждого в своей пропорции, а не только того, у кого берёт,
 * и слабый растущий пугает меньше сильного. Правило одно для Домов и для державы роты.
 *
 * Здесь только мера. Что угроза делает с отношениями и договорами — `diplomacy.ts::worldDiplomacy`,
 * объявление войны державе — `playerWar.ts::playerWarTick`.
 */

const D = WAR.diplomacy;

/**
 * Приграничные миры: у кого из владельцев сколько миров касаются каждого соседа и сколько у него
 * приграничных миров всего (касающихся хоть одного чужого). Мир с тремя соседями-владельцами
 * считается у каждого из них и один раз в итоге.
 */
export interface Borders {
  readonly touching: ReadonlyMap<string, ReadonlyMap<string, number>>;
  readonly total: ReadonlyMap<string, number>;
}

/** Один проход по каталогу — та же цена, что у списка участков фронта. */
export function bordersOf(deltas: GalaxyDeltas): Borders {
  const own: string[] = [];
  for (let i = 0; i < GALAXY.count; i++) own.push(ownerOf(deltas, i));
  const touching = new Map<string, Map<string, number>>();
  const total = new Map<string, number>();
  for (let i = 0; i < GALAXY.count; i++) {
    const o = own[i] as string;
    let seen: Set<string> | null = null;
    for (const j of GALAXY.neighbors(i)) {
      const n = own[j] as string;
      if (n === o) continue;
      if (seen === null) seen = new Set<string>();
      seen.add(n);
    }
    if (seen === null) continue;
    total.set(o, (total.get(o) ?? 0) + 1);
    let row = touching.get(o);
    if (row === undefined) touching.set(o, (row = new Map<string, number>()));
    for (const n of seen) row.set(n, (row.get(n) ?? 0) + 1);
  }
  return { touching, total };
}

/** Какая доля приграничных миров `from` касается `to`. */
export function borderShare(b: Borders, from: string, to: string): number {
  const all = b.total.get(from) ?? 0;
  return all > 0 ? (b.touching.get(from)?.get(to) ?? 0) / all : 0;
}

/** Рост каждого актора — сумма его захватов у всех по памяти захватов. */
export function growthOf(war: WarState): ReadonlyMap<string, number> {
  const out = new Map<string, number>();
  for (const key of Object.keys(war.conquests).sort()) {
    const by = key.slice(0, key.indexOf('>'));
    out.set(by, (out.get(by) ?? 0) + (war.conquests[key] as number));
  }
  return out;
}

/**
 * Сила `from` на границе с `to`: вся армия × доля границы `from`, обращённой к `to`. Та же мера — в
 * соотношении сил угрозы и в условии «сильнее на общей границе» объявления войны державе.
 */
export function borderForce(war: WarState, b: Borders, from: string, to: string): number {
  return totalArmy(war, from) * borderShare(b, from, to);
}

/** Угроза для `i` от `j`. Ноль — `j` не растёт или не граничит с `i`. */
export function threatOf(
  war: WarState,
  b: Borders,
  growth: ReadonlyMap<string, number>,
  i: string,
  j: string,
): number {
  const g = growth.get(j) ?? 0;
  const facing = borderShare(b, j, i);
  if (g <= 0 || facing <= 0) return 0;
  const theirs = borderForce(war, b, j, i);
  const ours = borderForce(war, b, i, j);
  const power = ours <= 0 ? D.powerMax : Math.min(D.powerMax, Math.max(D.powerMin, theirs / ours));
  return g * facing * power;
}

/**
 * Ведёт ли актор политику, на которую действуют угроза, коалиции, второй фронт и торговля ИИ. У
 * вольницы и независимых миров политики нет (у пиратов нет и мира — `playerWar.ts::peaceTerms`), а
 * держава роты ведёт свою дипломатию командами игрока.
 */
export function politicalActor(id: string): boolean {
  if (isPlayerActor(id)) return false;
  const kind = actorKind(id);
  return kind !== undefined && kind !== 'pirates' && kind !== 'independent';
}
