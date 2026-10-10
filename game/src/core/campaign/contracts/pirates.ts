import { GALAXY } from '../galaxy/catalog.js';
import { ownerOf, withDelta, type GalaxyDeltas } from '../galaxy/delta.js';
import type { MarketClass } from '../galaxy/profile.js';
import { WAR } from '../war/schema.js';
import { isPlayerActor, tensionOf, type WarState } from '../war/index.js';
import type { ReputationState } from '../reputation/state.js';
import { enemiesOf, factionKind } from './relations.js';
import { CONTRACTS } from './schema.js';

/**
 * ФРОНТ И ТЫЛ (шаг 37).
 *
 * **Зачем это понадобилось.** До этого шага пираты стояли в пуле противников
 * биржи БЕЗУСЛОВНО: `neighbourFactions` открывалась строкой
 * `found.set(PIRATE_FACTION, 0)`, и снять её оттуда было нечем. Пиратский подряд
 * на границе Дэвиона с Ляо, где стоят регулярные полки, аэрокосмические патрули
 * и линии снабжения, был ровно так же вероятен, как в глухом захолустье.
 *
 * Замер показал, чем это оборачивается: **`vs_pirates_share` = 0.816** — восемь
 * контрактов из десяти рота берёт против пиратов. То есть у новичка не «нет
 * стартовой ниши»: пиратской работы СЛИШКОМ МНОГО, и она размазана по всей
 * карте ровным слоем. Ниши не видно не потому, что её нет, а потому, что она
 * везде и потому ничего не значит — лететь за ней некуда, выбирать нечего, и
 * тыл ничем не отличается от фронта.
 *
 * **Что заводит этот модуль.** Две чистые функции: насколько система близка к
 * фронту и насколько она пиратская. Из них биржа выводит вес пиратов среди
 * противников, а шаг 37a будет выводить цели набегов. Формула одна на всех: две
 * формулы одной величины разошлись бы молча.
 *
 * **Ни одного нового обхода карты.** Близость чужих флагов вокруг системы биржа
 * считала и раньше — обходом в ширину на `enemyRangeJumps` прыжка
 * (`neighbourFactions`, переехала сюда из `board.ts`). Тот же обход отвечает и
 * на вопрос про фронт: близость ВРАЖДЕБНОГО владельца и есть фронтовой индекс.
 * Второго определения фронта не заводится — по тому же правилу, по которому от
 * него отказался `war/development.ts` («определение фронта здесь ровно то же,
 * что у войны»).
 */

const P = CONTRACTS.pirates;

/** Вольница — не государство: своей стороны фронта у неё нет, она есть везде, где есть что грабить. */
export const PIRATE_FACTION = 'pirates';

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Кто вообще воюет ПО СОСЕДСТВУ — и насколько близко.
 *
 * Без этого ограничения биржа отвечает «кто с кем враждует во всей Сфере», и
 * наёмник на Аутриче получает работу против Стальной Гадюки, чья ближайшая
 * система в шестистах световых годах. Вражда — свойство пары фракций,
 * география — свойство места, и контракт стоит на обоих: «противник — фракция
 * по другую сторону фронта» (`wiki/design/campaign/reputation.md`).
 *
 * Обход в ширину по прыжкам, а не по всей карте: соседи каталога уже посчитаны
 * и закэшированы (`GalaxyCatalog.neighbors`), и глубины в пару прыжков хватает,
 * чтобы поймать соседнее государство и не поймать другой край Сферы.
 *
 * **С шага 21b возвращается не список, а БЛИЗОСТЬ**: 1.0 у врага за соседней
 * звездой, `proximityFalloff` у врага в двух прыжках. Из неё выводится
 * напряжённость участка, а из напряжённости — и опасность работы, и её цена
 * (решение 7). Ноль означает «фронта здесь нет»: работа против такого
 * противника бывает, но рождает её не война.
 *
 * Пираты в карте всегда и с нулевой близостью, если своих миров рядом не
 * держат: пиратская вольница не государство с границей, у неё нет «своей
 * стороны фронта» — она есть везде, где есть что грабить, и потому фронтом не
 * бывает никогда. **Сколько её здесь — отвечает `pirateRisk`, а не близость.**
 */
export function neighbourFactions(
  deltas: GalaxyDeltas,
  from: number,
  jumps: number,
): ReadonlyMap<string, number> {
  const seen = new Set<number>([from]);
  const found = new Map<string, number>([[PIRATE_FACTION, 0]]);
  let frontier: number[] = [from];

  for (let depth = 1; depth <= jumps; depth++) {
    const proximity = depth === 1 ? 1 : Math.pow(WAR.front.proximityFalloff, depth - 1);
    const next: number[] = [];
    for (const i of frontier) {
      for (const j of GALAXY.neighbors(i)) {
        if (seen.has(j)) continue;
        seen.add(j);
        next.push(j);
        const owner = ownerOf(deltas, j);
        // Ближайшее вхождение выигрывает: обход идёт по возрастанию глубины,
        // поэтому найденному раньше близость можно было бы только уменьшить.
        if ((found.get(owner) ?? 0) < proximity) found.set(owner, proximity);
      }
    }
    frontier = next;
  }
  return found;
}

/** Один враждебный сосед и его вклад во фронтовой индекс. */
export interface HostileNeighbour {
  readonly id: string;
  /** Близость: 1.0 за соседней звездой, `proximityFalloff` в двух прыжках. */
  readonly proximity: number;
  /** Напряжённость участка против него — 0, если война между этими двумя не идёт. */
  readonly tension: number;
}

/**
 * ФРОНТОВОЙ ИНДЕКС системы, 0..1.
 *
 * 1.0 — чужой враждебный флаг за соседней звездой, и здесь стоят регулярные
 * части. 0 — глубокий тыл: ближайший враг дальше `enemyRangeJumps` прыжков.
 *
 * **Пираты в расчёт не идут вовсе, и это не мелочь.** Вольница фронтом не
 * бывает по построению; если бы она сюда попадала, каждая система оказывалась
 * бы «фронтовой» сама по себе, и тыла на карте не осталось бы ни одного.
 *
 * **Напряжённость поднимает индекс, но не создаёт его.** Тихая граница — это
 * всё равно граница: гарнизоны и полки на ней стоят, даже когда войны нет, и
 * пиратам там делать нечего. Активная война добавляет к этому ещё войск, и
 * потому горячий участок в двух прыжках вытесняет пиратов сильнее, чем спокойный.
 */
export function frontierIndex(hostiles: readonly HostileNeighbour[]): number {
  let best = 0;
  for (const h of hostiles) {
    if (h.id === PIRATE_FACTION) continue;
    const value = clamp(h.proximity * (1 + P.tensionBoost * h.tension), 0, 1);
    if (value > best) best = value;
  }
  return best;
}

/**
 * Фронтовой индекс системы по её номеру — для тех, у кого под рукой нет уже
 * посчитанного соседства (карта, такт набегов).
 *
 * Биржа этой функцией НЕ пользуется: у неё соседи и напряжённости уже посчитаны
 * своим циклом, и считать их второй раз значило бы удвоить обход на каждое
 * предложение. Значение при этом одно и то же — на то оно и выведено одной
 * формулой `frontierIndex`.
 */
export function frontierIndexAt(
  deltas: GalaxyDeltas,
  rep: ReputationState | undefined,
  war: WarState | undefined,
  i: number,
): number {
  const owner = ownerOf(deltas, i);
  const nearby = neighbourFactions(deltas, i, CONTRACTS.board.enemyRangeJumps);
  const hostiles: HostileNeighbour[] = [];
  for (const e of enemiesOf(owner, CONTRACTS.board.minEnmity)) {
    const proximity = nearby.get(e.id);
    if (proximity === undefined || proximity <= 0) continue;
    hostiles.push({
      id: e.id,
      proximity,
      tension: war === undefined || rep === undefined ? 0 : tensionOf(war, rep, owner, e.id, proximity),
    });
  }
  return frontierIndex(hostiles);
}

/** Что нужно знать о самом мире, чтобы оценить его пиратский риск. */
export interface PirateWorldFacts {
  readonly marketClass: MarketClass;
  /** Сила гарнизона, 0–5 (`SystemProfile.garrison`). */
  readonly garrison: number;
  /** Разорение мира, 0..1. */
  readonly ruined: number;
  readonly owner: string;
  readonly blackMarket: boolean;
  /** Насколько мир уже вычищен от вольницы, 0..1 (шаг 37a). */
  readonly cleared: number;
}

/**
 * ПИРАТСКИЙ РИСК системы, 0..1 — «сколько здесь пиратской вольницы».
 *
 * Множители по порядку и почему каждый из них тут:
 *
 * 1. **Удалённость от фронта.** Главный множитель и причина всего шага. Пираты
 *    не бьют укреплённые фронтовые миры: там их находят регулярные части.
 *    Степень `frontierPower` больше единицы — спад не линейный: у самой границы
 *    вольницы нет вовсе, а на третьем прыжке вглубь она уже почти полная.
 * 2. **Слабость гарнизона.** Держать по полку мехов в каждой тыловой системе
 *    Дому разорительно, и там, где гарнизон это лёгкая пехота и ополчение,
 *    набег окупается. При гарнизоне от `garrisonFull` он не окупается вовсе.
 * 3. **Есть что грабить.** Столица кормит вольницу хуже всех — не бедностью, а
 *    тем, что это место, где сидит регулярная армия. Разброс по классам рынка
 *    намеренно узкий: канонический Трелл I — захолустье, и захолустья грабят.
 * 4. **Чёрный рынок рядом** — сбыт добычи, и вольница тянется к нему.
 * 5. **Периферия** — там нет ни Домов, ни их полков.
 * 6. **Разорение** — выжженный мир грабить незачем, его уже ограбили.
 * 7. **Вычищенность** (шаг 37a) — след чужой работы: здесь уже поработал
 *    наёмный отряд, и вольница сюда пока не вернулась.
 */
export function pirateRisk(frontier: number, w: PirateWorldFacts): number {
  const kind = factionKind(w.owner);
  const rim = kind === 'periphery' || kind === 'pirates' || kind === 'independent';
  const raw =
    Math.pow(clamp(1 - frontier, 0, 1), P.frontierPower) *
    clamp(1 - w.garrison / P.garrisonFull, 0, 1) *
    P.byMarketClass[w.marketClass] *
    (1 + (w.blackMarket ? P.blackMarketBonus : 0) + (rim ? P.rimBonus : 0)) *
    clamp(1 - P.ruinWeight * clamp(w.ruined, 0, 1), 0, 1) *
    clamp(1 - w.cleared, 0, 1);
  return clamp(raw, 0, 1);
}

/**
 * Кто платит за зачистку логова — непиратские соседи мира вольницы в пределах
 * досягаемости биржи, с близостью (шаг 72f). Держава роты нанимателем не бывает.
 * Пусто — мир не вольницы или платить некому.
 */
export function denPayers(
  deltas: GalaxyDeltas,
  i: number,
): readonly { readonly id: string; readonly proximity: number }[] {
  if (CONTRACTS.pirates.bountyOffers <= 0 || ownerOf(deltas, i) !== PIRATE_FACTION) return [];
  const nearby = neighbourFactions(deltas, i, CONTRACTS.board.enemyRangeJumps);
  return [...nearby.entries()]
    .filter(([id, proximity]) => proximity > 0 && id !== PIRATE_FACTION && !isPlayerActor(id))
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([id, proximity]) => ({ id, proximity }));
}

/**
 * С какой вероятностью выживает каждое предложение награды за логово (шаг 72f):
 * (1 − вычищенность) на мире вольницы, у которого есть кому платить, иначе 0.
 * Одна на биржу и слой пиратской угрозы звёздной карты — карта обязана обещать
 * ровно ту работу, что даёт биржа.
 */
export function denBounty(deltas: GalaxyDeltas, i: number): number {
  if (denPayers(deltas, i).length === 0) return 0;
  return clamp(1 - clearedOf(deltas, GALAXY.id(i)), 0, 1);
}

// --- ВЫЧИЩЕННОСТЬ МИРА (шаг 37a) ---------------------------------------------

/**
 * Насколько мир вычищен от вольницы, 0..1.
 *
 * **Шкала, а не флажок, и это требование замысла, а не вкусовщина.** «Чем
 * больше успешных контрактов — тем чище мир» означает, что каждый выигранный
 * подряд двигает активность вниз, а не что N-й щёлкает переключателем. Порог
 * отвечает игроку только на третьем контракте, шкала — на первом, и это и есть
 * «чувство хорошо сделанной работы» из замысла.
 *
 * Свойство МИРА, а не роты: вычистить мир мог кто угодно — рота, соперник,
 * гарнизон, — и след виден всем одинаково. Потому оно и ложится в разрежённую
 * дельту рядом с разорением, не ломая чистоту биржи. (Тем же и отличается от
 * «сколько декад рота сидит на планете» — свойства РОТЫ, об которое споткнулся
 * пункт 3 `questions.md`.)
 */
export function clearedOf(deltas: GalaxyDeltas, id: string): number {
  return deltas[id]?.cleared ?? 0;
}

/**
 * Выигранный подряд против вольницы — мир стал чище, и соседи тоже.
 *
 * **Волновой эффект** — вторая половина замысла: «сектор становится чище».
 * Соседи за один прыжок получают долю того же приращения, поэтому вычистить
 * кластер из двух-трёх миров значит успокоить целый угол карты, а не три точки
 * на нём.
 */
export function withPirateClearing(deltas: GalaxyDeltas, i: number): GalaxyDeltas {
  const bump = (map: GalaxyDeltas, at: number, amount: number): GalaxyDeltas => {
    if (amount <= 0) return map;
    const id = GALAXY.id(at);
    const now = Math.round(clamp(clearedOf(map, id) + amount, 0, 1) * 1000) / 1000;
    return withDelta(map, id, { cleared: now <= 0 ? undefined : now });
  };

  let out = bump(deltas, i, P.clearPerWin);
  for (const j of GALAXY.neighbors(i)) out = bump(out, j, P.clearPerWin * P.clearNeighbourShare);
  return out;
}

/**
 * Вычищенное ЗАРАСТАЕТ обратно — сама причина, по которой шкала не становится
 * односторонним счётчиком.
 *
 * Без этого за длинную кампанию карта вычистилась бы насухо и работа кончилась
 * бы совсем: вольница не воспроизводится, а рота работает годами. Заживает тем
 * же приёмом, что разорение (`war/front.ts::healRuin`), и по той же причине
 * запись снимается целиком, дойдя до нуля, — иначе разрежённая карта потекла бы
 * через первый же вычищенный сектор.
 */
export function regrowPirates(deltas: GalaxyDeltas): GalaxyDeltas {
  if (P.regrowPerTick <= 0) return deltas;
  let out = deltas;
  for (const id of Object.keys(deltas).sort()) {
    const was = deltas[id]?.cleared;
    if (was === undefined || was <= 0) continue;
    const now = Math.round(Math.max(0, was - P.regrowPerTick) * 1000) / 1000;
    if (now === was) continue;
    out = withDelta(out, id, { cleared: now <= 0 ? undefined : now });
  }
  return out;
}

/**
 * ФРОНТОВОЙ ИНДЕКС ОПТОМ — для тех, кому он нужен сразу для всей карты.
 *
 * Поштучный `frontierIndexAt` делает обход в ширину вокруг КАЖДОЙ системы: для
 * биржи это правильно (ей нужна одна система, и соседство у неё уже посчитано),
 * а для двух тысяч систем — две тысячи обходов на такт, то есть ровно тот
 * процент времени мира, который шаг 37 обязан не потратить.
 *
 * Здесь наоборот: ОДИН обход в ширину из всего множества фронтовых систем сразу.
 * Множество это уже посчитано тем, кто зовёт (`war/development.ts` строит его
 * из `frontSectors` для собственных нужд), поэтому лишней работы нет вовсе.
 *
 * **Значение то же самое, и это проверяется тестом.** Система на фронте — та, у
 * которой враждебный флаг за соседней звездой, то есть глубина 0 и близость 1.0;
 * её сосед видит того же врага в двух прыжках — глубина 1 и близость
 * `proximityFalloff`; дальше биржа не смотрит вовсе, и там ноль. Напряжённости
 * здесь нет: она свойство ПАРЫ фракций, а не места, и оптом её не сложить —
 * поэтому оптовый индекс это геометрия без войны, то есть нижняя граница
 * поштучного.
 */
export function frontierField(atFront: ReadonlySet<number>): Float32Array {
  const out = new Float32Array(GALAXY.count);
  const depth = new Int8Array(GALAXY.count).fill(-1);
  let frontier: number[] = [];
  for (const i of atFront) {
    depth[i] = 0;
    out[i] = 1;
    frontier.push(i);
  }
  // Глубже одного прыжка идти незачем: биржа смотрит на `enemyRangeJumps`
  // прыжка, и всё, что дальше, для неё одинаковый ноль.
  for (let d = 1; d <= CONTRACTS.board.enemyRangeJumps - 1; d++) {
    const value = Math.pow(WAR.front.proximityFalloff, d);
    const next: number[] = [];
    for (const i of frontier) {
      for (const j of GALAXY.neighbors(i)) {
        if ((depth[j] as number) >= 0) continue;
        depth[j] = d;
        out[j] = value;
        next.push(j);
      }
    }
    frontier = next;
  }
  return out;
}
