import { FACTIONS, GALAXY } from '../../core/campaign/galaxy/index.js';
import { PLAYER_ACTOR_ID } from '../../core/campaign/war/actors.js';
import palette from '../../../data/palette.json';
import type { BuildingKind } from '../../core/campaign/index.js';
import type { RealmArmy, RealmNeighbour, RealmWar, RealmWorld, SectorView } from '../state/campaign.svelte.js';
import { worldAlerts, type WorldAlert } from './worldAlerts.js';

/**
 * Модель карты державы (шаг 93): что лежит на карте и где, без слова о том, как это рисовать.
 *
 * Охват — свои миры и системы в прыжке от них: держава и соседи, с которыми она говорит и воюет.
 * Координаты — световые годы каталога (ось y вверх); в пиксели их переводит камера карты. Числа —
 * из тех же геттеров стора, что у карточек, поэтому карта и карточка не расходятся.
 */

export interface MapWorld {
  readonly i: number;
  readonly id: string;
  readonly name: string;
  readonly x: number;
  readonly y: number;
  readonly capital: boolean;
  readonly biome: string;
  /** Итог мира за декаду — доход минус содержание, как у строки списка. */
  readonly net: number;
  /** Центр сектора; `null` — вне секторов. */
  readonly sector: string | null;
  /** Цвет области сектора; `null` — вне секторов. */
  readonly sectorColor: string | null;
  /** Против мира стоит участок фронта (его могут отнять). */
  readonly threatened: boolean;
  readonly alerts: readonly WorldAlert[];
  readonly loyalty: number | null;
  readonly loyaltyDrift: number;
  /** Постройки мира: готовые и та, что строится (`null` — стройки нет). */
  readonly built: ReadonlySet<BuildingKind>;
  readonly building: BuildingKind | null;
  /** Машин роты в гарнизоне мира. */
  readonly garrison: number;
}

/** Постройки и гарнизон мира — из `buildingsView` и `garrisonView` стора. */
export interface WorldDetail {
  readonly built: ReadonlySet<BuildingKind>;
  readonly building: BuildingKind | null;
  readonly garrison: number;
}

/** Губернатор на центре сектора; `pilotId === null` — пост пуст. */
export interface MapGovernor {
  readonly center: number;
  readonly color: string;
  readonly pilotId: string | null;
  readonly callsign: string | null;
}

/**
 * Стрелка войны: `stance` — куда наступит стойка «наступать» (от ближайшего своего мира к цели), `chosen` —
 * цель выбрал игрок; `claim` — мир державы, который требует враг (от ближайшей его системы на карте).
 */
export interface MapArrow {
  readonly kind: 'stance' | 'claim';
  readonly chosen: boolean;
  readonly from: number;
  readonly to: number;
  readonly faction: string;
}

export interface MapForeign {
  readonly i: number;
  readonly id: string;
  readonly name: string;
  readonly x: number;
  readonly y: number;
  readonly owner: string;
  readonly color: string;
  readonly capital: boolean;
  /** Тип планеты и итог мира для державы, стань он её; `null` — сводку не передали (`RealmMapInput.glance`). */
  readonly glance: ForeignGlance | null;
}

/** Чужой мир глазами державы (после шага 93): тип планеты и итог за декаду, если его взять силой или купить. */
export interface ForeignGlance {
  readonly biome: string;
  readonly force: number;
  readonly bought: number;
}

/** Дуга «свой мир — мир соседа» через прыжок: фронт, если с соседом вражда. */
export interface MapFront {
  readonly own: number;
  readonly foe: number;
  readonly owner: string;
  /** `war` — объявленная война державы; `hostile` — вражда выше порога фронта без войны. */
  readonly state: 'war' | 'hostile';
}

export interface MapLane {
  readonly a: number;
  readonly b: number;
}

export interface MapSector {
  readonly center: string;
  readonly color: string;
  readonly worlds: readonly number[];
}

export interface MapFaction {
  readonly id: string;
  readonly color: string;
  /** Место для герба и имени: видимая система фракции дальше всех от середины державы — снаружи, а не поверх своих миров. */
  readonly x: number;
  readonly y: number;
  readonly standing: number;
  readonly atWar: boolean;
  /** Театр армии державы против фракции и его норма; `null` — театра нет. */
  readonly theater: { readonly mechs: number; readonly reference: number } | null;
}

export interface RealmMapModel {
  readonly worlds: readonly MapWorld[];
  readonly foreign: readonly MapForeign[];
  readonly lanes: readonly MapLane[];
  readonly fronts: readonly MapFront[];
  readonly sectors: readonly MapSector[];
  readonly factions: readonly MapFaction[];
  readonly governors: readonly MapGovernor[];
  readonly arrows: readonly MapArrow[];
  /** Миры целей войн державы — прицелом на карте. */
  readonly goals: readonly number[];
  /** Охват в световых годах: min/max по x и y всех систем карты. */
  readonly bounds: { readonly minX: number; readonly maxX: number; readonly minY: number; readonly maxY: number };
}

export interface RealmMapInput {
  readonly worlds: readonly RealmWorld[];
  readonly sectors: readonly SectorView[];
  readonly neighbours: readonly RealmNeighbour[];
  readonly wars: readonly RealmWar[];
  /** Владелец каждой системы по индексу каталога (`CampaignUi.owners`). */
  readonly owners: readonly string[];
  /** Постройки и гарнизон по id мира; нет записи — пусто. */
  readonly details?: ReadonlyMap<string, WorldDetail>;
  readonly theaters?: RealmArmy['theaters'];
  /** Сводка чужого мира по id (`CampaignUi.systemGlance`); нет — сосед рисуется точкой. */
  readonly glance?: (id: string) => ForeignGlance;
}

const NO_DETAIL: WorldDetail = { built: new Set(), building: null, garrison: 0 };

const SECTOR_COLORS: readonly string[] = palette.realm.sectors;

export function sectorColor(index: number): string {
  return SECTOR_COLORS[index % SECTOR_COLORS.length] as string;
}

export function buildRealmMap(input: RealmMapInput): RealmMapModel {
  const sectorIndex = new Map(input.sectors.map((s, n) => [s.center, n]));
  const worlds: MapWorld[] = input.worlds.map((w) => {
    const i = GALAXY.require(w.id);
    const n = w.sector === null ? undefined : sectorIndex.get(w.sector);
    return {
      i,
      id: w.id,
      name: w.name,
      x: GALAXY.x[i] as number,
      y: GALAXY.y[i] as number,
      capital: w.capital,
      biome: w.biome,
      net: w.income - w.upkeep,
      sector: w.sector,
      sectorColor: n === undefined ? null : sectorColor(n),
      threatened: w.threats.length > 0,
      alerts: worldAlerts(w),
      loyalty: w.loyalty,
      loyaltyDrift: w.loyaltyDrift,
      ...(input.details?.get(w.id) ?? NO_DETAIL),
    };
  });
  const ownSet = new Set(worlds.map((w) => w.i));

  const ownerOf = (i: number): string => input.owners[i] ?? GALAXY.ownerId(i);
  const foreignIdx = new Set<number>();
  for (const w of worlds) for (const j of GALAXY.neighbors(w.i)) if (!ownSet.has(j)) foreignIdx.add(j);
  const capitals = new Set(input.neighbours.flatMap((n) => n.systems.filter((s) => s.capital).map((s) => s.id)));
  const foreign: MapForeign[] = [...foreignIdx]
    .sort((a, b) => a - b)
    .map((i) => {
      const owner = ownerOf(i);
      return {
        i,
        id: GALAXY.id(i),
        name: GALAXY.name(i),
        x: GALAXY.x[i] as number,
        y: GALAXY.y[i] as number,
        owner,
        color: FACTIONS.get(owner)?.color ?? palette.ui.textDim,
        capital: capitals.has(GALAXY.id(i)),
        glance: input.glance?.(GALAXY.id(i)) ?? null,
      };
    });

  const atWar = new Set(input.wars.map((w) => w.factionId));
  const hostile = new Set(input.neighbours.filter((n) => n.atWar).map((n) => n.factionId));
  const fronts: MapFront[] = [];
  for (const w of worlds) {
    for (const j of GALAXY.neighbors(w.i)) {
      if (ownSet.has(j)) continue;
      const owner = ownerOf(j);
      if (owner === PLAYER_ACTOR_ID) continue;
      if (atWar.has(owner)) fronts.push({ own: w.i, foe: j, owner, state: 'war' });
      else if (hostile.has(owner)) fronts.push({ own: w.i, foe: j, owner, state: 'hostile' });
    }
  }
  const frontKey = new Set(fronts.map((f) => `${f.own}:${f.foe}`));

  const shown = [...ownSet, ...foreignIdx];
  const shownSet = new Set(shown);
  const lanes: MapLane[] = [];
  for (const a of shown) {
    for (const b of GALAXY.neighbors(a)) {
      if (b <= a || !shownSet.has(b)) continue;
      if (frontKey.has(`${a}:${b}`) || frontKey.has(`${b}:${a}`)) continue;
      // Дорожки между двумя чужими системами — фон, который карту только засоряет.
      if (!ownSet.has(a) && !ownSet.has(b)) continue;
      lanes.push({ a, b });
    }
  }

  const sectors: MapSector[] = input.sectors.map((s, n) => ({
    center: s.center,
    color: sectorColor(n),
    worlds: worlds.filter((w) => w.sector === s.center).map((w) => w.i),
  }));

  const cx = worlds.reduce((s, w) => s + w.x, 0) / Math.max(1, worlds.length);
  const cy = worlds.reduce((s, w) => s + w.y, 0) / Math.max(1, worlds.length);
  const byFaction = new Map<string, MapForeign[]>();
  for (const f of foreign) {
    const list = byFaction.get(f.owner);
    if (list === undefined) byFaction.set(f.owner, [f]);
    else list.push(f);
  }
  const standing = new Map(input.neighbours.map((n) => [n.factionId, n]));
  const factions: MapFaction[] = [...byFaction.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([id, list]) => ({
      id,
      color: list[0]?.color ?? palette.ui.textDim,
      ...farthest(list),
      standing: standing.get(id)?.standing ?? 0,
      atWar: atWar.has(id) || hostile.has(id),
      theater: ((): MapFaction['theater'] => {
        const th = input.theaters?.find((x) => x.against === id);
        return th === undefined ? null : { mechs: th.mechs, reference: th.reference };
      })(),
    }));

  const governors: MapGovernor[] = input.sectors.map((s, n) => ({
    center: GALAXY.require(s.center),
    color: sectorColor(n),
    pilotId: s.governor?.id ?? null,
    callsign: s.governor?.callsign ?? null,
  }));

  const dist = (a: number, b: number): number =>
    Math.hypot((GALAXY.x[a] as number) - (GALAXY.x[b] as number), (GALAXY.y[a] as number) - (GALAXY.y[b] as number));
  const nearest = (to: number, from: readonly number[]): number | undefined => {
    let best: number | undefined;
    let bestD = Infinity;
    for (const i of from) {
      const d = dist(i, to);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  };
  const ownList = worlds.map((w) => w.i);
  const arrows: MapArrow[] = [];
  const goals: number[] = [];
  for (const war of input.wars) {
    const target = war.stanceFocusId ?? war.stanceTargetId;
    if (target !== null) {
      const to = GALAXY.require(target);
      const from = nearest(to, ownList);
      if (from !== undefined) arrows.push({ kind: 'stance', chosen: war.stanceFocusId !== null, from, to, faction: war.factionId });
    }
    const theirs = foreign.filter((f) => f.owner === war.factionId).map((f) => f.i);
    for (const id of war.foeGoalIds) {
      const to = GALAXY.require(id);
      const from = nearest(to, theirs);
      if (from !== undefined) arrows.push({ kind: 'claim', chosen: false, from, to, faction: war.factionId });
    }
    for (const id of war.goalIds) goals.push(GALAXY.require(id));
  }

  function farthest(list: readonly MapForeign[]): { x: number; y: number } {
    let best = list[0] as MapForeign;
    let bestD = -1;
    for (const f of list) {
      const d = Math.hypot(f.x - cx, f.y - cy);
      if (d > bestD) {
        bestD = d;
        best = f;
      }
    }
    return { x: best.x, y: best.y };
  }

  const xs = shown.map((i) => GALAXY.x[i] as number);
  const ys = shown.map((i) => GALAXY.y[i] as number);
  const bounds =
    shown.length === 0
      ? { minX: 0, maxX: 0, minY: 0, maxY: 0 }
      : { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };

  return { worlds, foreign, lanes, fronts, sectors, factions, governors, arrows, goals, bounds };
}
