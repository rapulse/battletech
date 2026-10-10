<script lang="ts" module>
  export type MapSelection = { readonly kind: 'world' | 'foreign' | 'sector'; readonly i: number } | null;
  /** Режим карты (шаг 93): смотреть, раскладывать миры по секторам, вести фронт. */
  export type MapMode = 'view' | 'sectors' | 'front';
  export const MAP_MODES: readonly MapMode[] = ['view', 'sectors', 'front'];
  /** Участок фронта для режима «Фронт»: шанс приказа, причина отказа, выбран ли игроком целью стойки. */
  export interface FrontMark {
    readonly odds: number;
    readonly why: string | null;
    readonly chosen: boolean;
  }
  export type MapLens = 'sector' | 'income' | 'loyalty' | 'threat' | 'build' | 'army';
  export const MAP_LENSES: readonly MapLens[] = ['sector', 'income', 'loyalty', 'threat', 'build', 'army'];
</script>

<script lang="ts">
  import { BUILDING_KINDS } from '../../core/campaign/index.js';
  import type { Pilot } from '../../core/model/index.js';
  import { GALAXY } from '../../core/campaign/galaxy/index.js';
  import palette from '../../../data/palette.json';
  import { t } from '../i18n/index.js';
  import { factionName } from '../campaign/relations.js';
  import FactionEmblem from '../components/FactionEmblem.svelte';
  import PilotPortrait from '../components/PilotPortrait.svelte';
  import PlanetDot from './PlanetDot.svelte';
  import { shortMoney } from './money.js';
  import { loyaltyDrift, loyaltyValue } from './loyaltyText.js';
  import type { MapFaction, MapForeign, MapWorld, RealmMapModel } from './realmMapModel.js';
  import { ALERT_SEVERE } from './worldAlerts.js';
  import RealmIcon from './RealmIcon.svelte';
  import { ALERT_ICON } from './realmIcons.js';

  /**
   * Карта державы (шаг 93): свои миры, секторы, соседи и фронт на одной схеме.
   *
   * SVG, а не Canvas, как у звёздной карты (`decisions.md` §20): объектов здесь сотни, а не тысячи, и
   * каждому нужны наведение, клик и подсказка — у элемента разметки они свои, без ручного поиска
   * попаданий. Геометрия — в пикселях окна: камера переводит световые годы каталога в экран, поэтому
   * значки и надписи одного размера на любом приближении, а подробность растёт с приближением.
   */
  let {
    model,
    selected,
    hovered,
    focus,
    lens,
    mode,
    activeSector,
    assignWhy,
    marks,
    pilots,
    sectorName,
    onselect,
    onhover,
    ondrop,
  }: {
    model: RealmMapModel;
    selected: MapSelection;
    /** Наведённая система — с карты или из списка слева. */
    hovered: number | null;
    /** Просьба показать систему: меняется — камера едет к ней. */
    focus: { readonly i: number; readonly seq: number } | null;
    lens: MapLens;
    mode: MapMode;
    /** Сектор, в который раскладывают миры в режиме «Секторы»; `null` — сектор ещё не выбран. */
    activeSector: string | null;
    /** Почему мир нельзя отнести к выбранному сектору; `null` — можно. Режим «Секторы». */
    assignWhy: (i: number) => string | null;
    /** Участки фронта по системе — режим «Фронт». */
    marks: ReadonlyMap<number, FrontMark>;
    /** Пилоты роты по id — для портретов губернаторов. */
    pilots: ReadonlyMap<string, Pilot>;
    /** Имя сектора по центру — для подсказки. */
    sectorName: (center: string) => string;
    onselect: (sel: MapSelection) => void;
    onhover: (i: number | null) => void;
    /** Мир перетащен на другой мир — в режиме «Секторы» это «в сектор того мира». */
    ondrop: (world: number, onto: number) => void;
  } = $props();

  const activeColor = $derived(model.sectors.find((x) => x.center === activeSector)?.color ?? null);
  /** Подсветка режима: можно сделать (кольцо), нельзя (гаснет), не при чём (как есть). */
  function sectorsMark(w: MapWorld): 'can' | 'cannot' | 'in' | null {
    if (mode !== 'sectors' || activeSector === null) return null;
    if (w.sector === activeSector) return 'in';
    return assignWhy(w.i) === null ? 'can' : 'cannot';
  }

  const R = palette.realm;
  const P = palette.ui;

  let width = $state(0);
  let height = $state(0);
  let zoom = $state(1);
  let panX = $state(0);
  let panY = $state(0);
  /** Масштаб «всё влезло» — от него меряются пределы приближения и подробность. */
  let fitZoom = $state(1);

  const PAD = 56;

  function fit(): void {
    if (width === 0 || height === 0) return;
    const b = model.bounds;
    const spanX = Math.max(b.maxX - b.minX, GALAXY.jumpRangeLy);
    const spanY = Math.max(b.maxY - b.minY, GALAXY.jumpRangeLy);
    fitZoom = Math.min((width - 2 * PAD) / spanX, (height - 2 * PAD) / spanY);
    zoom = fitZoom;
    panX = width / 2 - ((b.minX + b.maxX) / 2) * zoom;
    panY = height / 2 + ((b.minY + b.maxY) / 2) * zoom;
  }

  // Вписать при первом размере окна и когда охват меняется (взят или потерян мир).
  let fittedFor = '';
  $effect(() => {
    const key = `${width}x${height}:${model.bounds.minX},${model.bounds.maxX},${model.bounds.minY},${model.bounds.maxY}`;
    if (width === 0 || key === fittedFor) return;
    fittedFor = key;
    fit();
  });

  let lastFocus = 0;
  $effect(() => {
    if (focus === null || focus.seq === lastFocus) return;
    lastFocus = focus.seq;
    const x = GALAXY.x[focus.i] as number;
    const y = GALAXY.y[focus.i] as number;
    const fx = panX + x * zoom;
    const fy = panY - y * zoom;
    // Видна — камера стоит: прыжок к миру, который и так на экране, только сбивает.
    if (fx > PAD && fx < width - PAD && fy > PAD && fy < height - PAD) return;
    panX = width / 2 - x * zoom;
    panY = height / 2 + y * zoom;
  });

  const sx = (x: number): number => panX + x * zoom;
  const sy = (y: number): number => panY - y * zoom;
  const ax = (i: number): number => sx(GALAXY.x[i] as number);
  const ay = (i: number): number => sy(GALAXY.y[i] as number);

  /** Подробность: 1 — всё влезло, больше — ближе. */
  const detail = $derived(zoom / fitZoom);
  const near = $derived(detail >= 1.8);
  const showForeignNames = $derived(detail >= 1.6);
  /** Зазор подписи над диском: вплотную над ним стоят точки построек. */
  const lift = $derived(near ? 14 : 5);
  /** Радиус области сектора — полпрыжка: соседние миры сектора сливаются в одну область. */
  const areaR = $derived((GALAXY.jumpRangeLy / 2) * zoom);

  /** Половина диска чужого мира: чуть меньше своих (20 px) — свои читаются главными. */
  const FOE_HALF = 8;
  /** На сколько пикселей герб фракции стоит дальше её крайней системы. */
  const FACTION_OUT = 38;

  /**
   * Диск мира: столица крупнее, остальные — одного размера. Размер по итогу (шаг 93) читался как разные планеты:
   * одна и та же ледяная — то крупнее, то мельче (отладка 2026-10-09); доход несут подпись и линза «Доход».
   */
  function discSize(w: MapWorld): number {
    return w.capital ? 24 : 20;
  }

  // --- подпись под миром по линзе ---------------------------------------------
  function chip(w: MapWorld): { text: string; tone: 'ok' | 'bad' | 'warn' | 'dim' } | null {
    switch (lens) {
      case 'loyalty':
        if (w.loyalty === null) return null;
        return {
          text: t('realm.map.loyaltyChip', { value: loyaltyValue(w.loyalty), drift: loyaltyDrift(w.loyaltyDrift) }),
          tone: w.loyalty < 30 ? 'bad' : w.loyalty < 60 ? 'warn' : 'ok',
        };
      case 'build':
        return { text: t('realm.map.builtChip', { n: w.built.size, total: BUILDING_KINDS.length }), tone: w.building !== null ? 'warn' : 'dim' };
      case 'army':
        return w.garrison > 0 ? { text: t('realm.map.garrisonChip', { n: w.garrison }), tone: 'ok' } : null;
      case 'threat':
        return null;
      default:
        return { text: shortMoney(w.net), tone: w.net < 0 ? 'bad' : 'ok' };
    }
  }

  /** Ореол под диском по линзе; `null` — без ореола. */
  function halo(w: MapWorld): string | null {
    switch (lens) {
      case 'income':
        return w.net < 0 ? P.danger : w.net >= 2_000_000 ? P.ok : null;
      case 'loyalty':
        return w.loyalty === null ? null : w.loyalty < 30 ? P.danger : w.loyalty < 60 ? P.gold : null;
      case 'threat':
        return w.alerts.some((a) => ALERT_SEVERE[a]) ? P.danger : w.alerts.length > 0 ? P.gold : null;
      case 'build':
        return w.building !== null ? P.gold : null;
      default:
        return null;
    }
  }

  /** В линзе угроз спокойные миры гаснут — горящее видно сразу. */
  const dimmed = (w: MapWorld): boolean => lens === 'threat' && w.alerts.length === 0;

  function rank(w: MapWorld): number {
    if (selected?.kind === 'world' && selected.i === w.i) return 1e12;
    if (hovered === w.i) return 1e11;
    if (w.capital) return 1e10;
    return Math.abs(w.net) + (w.alerts.length > 0 ? 5e9 : 0);
  }

  // --- подписи без наложений ----------------------------------------------------
  /**
   * Где подписывать мир: под диском, над ним или нигде. Жадно, от важного к второстепенному:
   * выбранный, наведённый, столица, мир с тревогой, крупный итог. Подпись, которой некуда встать,
   * прячется — её покажут наведение и приближение. Ширина — по моноширинному шрифту 11 px.
   */
  const labels = $derived.by((): ReadonlyMap<number, 'below' | 'above'> => {
    const order = [...model.worlds].sort((a, b) => rank(b) - rank(a));
    // Диски миров с точками построек — препятствия: подпись не ложится на чужую планету.
    const boxes: { x0: number; y0: number; x1: number; y1: number }[] = model.worlds.map((w) => {
      const half = discSize(w) / 2 + 3;
      return { x0: ax(w.i) - half, y0: ay(w.i) - half - 8, x1: ax(w.i) + half, y1: ay(w.i) + half };
    });
    for (const f of model.foreign) {
      const half = (f.glance === null ? 4 : FOE_HALF) + 2;
      boxes.push({ x0: ax(f.i) - half, y0: ay(f.i) - half, x1: ax(f.i) + half, y1: ay(f.i) + half });
    }
    for (const g of model.governors) {
      boxes.push({ x0: ax(g.center) - 34, y0: ay(g.center) - 34, x1: ax(g.center) - 10, y1: ay(g.center) - 10 });
    }
    for (const f of model.factions) {
      const p = factionAt(f);
      const halfW = Math.max(12, factionName(f.id).length * 4.5);
      boxes.push({ x0: p.x - halfW, y0: p.y - 12, x1: p.x + halfW, y1: p.y + 26 });
    }
    const out = new Map<number, 'below' | 'above'>();
    const free = (b: { x0: number; y0: number; x1: number; y1: number }): boolean =>
      boxes.every((o) => b.x1 < o.x0 || b.x0 > o.x1 || b.y1 < o.y0 || b.y0 > o.y1);
    for (const w of order) {
      const x = ax(w.i);
      const y = ay(w.i);
      const half = discSize(w) / 2;
      const wPx = w.name.length * 6.7 + 4;
      const hPx = chip(w) === null ? 13 : 25;
      const gap = near ? 8 : 4;
      const below = { x0: x - wPx / 2, y0: y + half + gap, x1: x + wPx / 2, y1: y + half + gap + hPx };
      const above = { x0: x - wPx / 2, y0: y - half - lift - hPx, x1: x + wPx / 2, y1: y - half - lift };
      if (free(below)) {
        boxes.push(below);
        out.set(w.i, 'below');
      } else if (free(above)) {
        boxes.push(above);
        out.set(w.i, 'above');
      }
    }
    // Чужие миры — после своих: их подпись уступает место и прячется, если некуда; наведение покажет.
    if (showForeignNames || lens === 'income') {
      for (const f of model.foreign) {
        if (f.glance === null) continue;
        const x = ax(f.i);
        const y = ay(f.i);
        const wPx = f.name.length * 6.1 + 4;
        const below = { x0: x - wPx / 2, y0: y + FOE_HALF + 3, x1: x + wPx / 2, y1: y + FOE_HALF + 28 };
        const above = { x0: x - wPx / 2, y0: y - FOE_HALF - 28, x1: x + wPx / 2, y1: y - FOE_HALF - 3 };
        if (free(below)) {
          boxes.push(below);
          out.set(f.i, 'below');
        } else if (free(above)) {
          boxes.push(above);
          out.set(f.i, 'above');
        }
      }
    }
    return out;
  });

  /** Середина державы на экране: от неё гербы соседей относятся наружу. */
  const mid = $derived.by(() => {
    const n = Math.max(1, model.worlds.length);
    return { x: model.worlds.reduce((s, w) => s + ax(w.i), 0) / n, y: model.worlds.reduce((s, w) => s + ay(w.i), 0) / n };
  });

  /** Герб фракции — за её крайней системой, прочь от державы: не на планете и не на её подписи. */
  function factionAt(f: MapFaction): { x: number; y: number } {
    const x = sx(f.x);
    const y = sy(f.y);
    const d = Math.max(1, Math.hypot(x - mid.x, y - mid.y));
    return { x: x + ((x - mid.x) / d) * FACTION_OUT, y: y + ((y - mid.y) / d) * FACTION_OUT };
  }

  // --- панорама и приближение ---------------------------------------------------
  let dragFrom: { x: number; y: number; px: number; py: number } | null = null;
  let dragged = false;

  /** Перетаскиваемый мир в режиме «Секторы» и куда тянется линия. */
  let dragWorld = $state<{ i: number; x: number; y: number } | null>(null);

  function worldDown(e: PointerEvent, i: number): void {
    if (mode !== 'sectors' || e.button !== 0) return;
    e.stopPropagation();
    dragged = false;
    dragWorld = { i, x: localX(e), y: localY(e) };
  }

  function onDown(e: PointerEvent): void {
    if (e.button !== 0) return;
    dragFrom = { x: e.clientX, y: e.clientY, px: panX, py: panY };
    dragged = false;
  }
  function onMove(e: PointerEvent): void {
    if (tip !== null) tip = { ...tip, x: localX(e), y: localY(e) };
    if (dragWorld !== null) {
      dragWorld = { ...dragWorld, x: localX(e), y: localY(e) };
      return;
    }
    if (dragFrom === null) return;
    const dx = e.clientX - dragFrom.x;
    const dy = e.clientY - dragFrom.y;
    if (!dragged && Math.hypot(dx, dy) < 4) return;
    if (!dragged) (e.currentTarget as Element).setPointerCapture(e.pointerId);
    dragged = true;
    tip = null;
    panX = dragFrom.px + dx;
    panY = dragFrom.py + dy;
  }
  function onUp(): void {
    dragFrom = null;
    if (dragWorld !== null) {
      const from = dragWorld.i;
      dragWorld = null;
      // Отпустили над другим миром — «в его сектор»; над тем же — это был клик, его разберёт onclick.
      if (hovered !== null && hovered !== from) {
        dragged = true;
        ondrop(from, hovered);
      }
    }
  }
  function onWheel(e: WheelEvent): void {
    e.preventDefault();
    const mx = localX(e);
    const my = localY(e);
    const next = Math.min(fitZoom * 6, Math.max(fitZoom * 0.6, zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
    // Точка под курсором остаётся на месте — так приближают в любой стратегии.
    panX = mx - ((mx - panX) / zoom) * next;
    panY = my - ((my - panY) / zoom) * next;
    zoom = next;
  }
  function pick(sel: MapSelection): void {
    if (dragged) return;
    onselect(sel);
  }

  let wrap = $state<HTMLDivElement | null>(null);
  const localX = (e: MouseEvent): number => e.clientX - (wrap?.getBoundingClientRect().left ?? 0);
  const localY = (e: MouseEvent): number => e.clientY - (wrap?.getBoundingClientRect().top ?? 0);

  const isSel = (kind: 'world' | 'foreign', i: number): boolean => selected?.kind === kind && selected.i === i;

  // --- подсказка ----------------------------------------------------------------
  let tip = $state<{ x: number; y: number; kind: 'world' | 'foreign'; i: number } | null>(null);

  function enter(kind: 'world' | 'foreign', i: number, e: PointerEvent): void {
    onhover(i);
    if (dragFrom === null) tip = { x: localX(e), y: localY(e), kind, i };
  }
  function leave(): void {
    onhover(null);
    tip = null;
  }

  const tipWorld = $derived(tip?.kind === 'world' ? (model.worlds.find((w) => w.i === tip?.i) ?? null) : null);
  const tipForeign = $derived(tip?.kind === 'foreign' ? (model.foreign.find((f) => f.i === tip?.i) ?? null) : null);

  function standingOf(f: MapForeign): number {
    return model.factions.find((x) => x.id === f.owner)?.standing ?? 0;
  }

  /** Стрелка от края диска до края цели: концы не лезут на планеты. */
  function arrowLine(from: number, to: number): { x1: number; y1: number; x2: number; y2: number } {
    const x1 = ax(from);
    const y1 = ay(from);
    const x2 = ax(to);
    const y2 = ay(to);
    const d = Math.max(1, Math.hypot(x2 - x1, y2 - y1));
    const ux = (x2 - x1) / d;
    const uy = (y2 - y1) / d;
    return { x1: x1 + ux * 16, y1: y1 + uy * 16, x2: x2 - ux * 14, y2: y2 - uy * 14 };
  }
</script>

<div class="map-wrap" bind:this={wrap} bind:clientWidth={width} bind:clientHeight={height}>
  {#if width > 0}
    <!-- Клик мимо систем снимает выбор; с клавиатуры то же делает Esc в Штабе. -->
    <!-- svelte-ignore a11y_no_static_element_interactions, a11y_click_events_have_key_events -->
    <svg
      class="map"
      {width}
      {height}
      onpointerdown={onDown}
      onpointermove={onMove}
      onpointerup={onUp}
      onpointerleave={() => { onUp(); tip = null; }}
      onwheel={onWheel}
      onclick={() => pick(null)}
    >
      <defs>
        <!-- Контур области сектора: расширенная заливка минус сама заливка — кольцо её цвета. -->
        <filter id="sector-outline" x="-5%" y="-5%" width="110%" height="110%">
          <feMorphology in="SourceGraphic" operator="dilate" radius="1.4" result="wide" />
          <feComposite in="wide" in2="SourceGraphic" operator="out" />
        </filter>
        <marker id="head-stance" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" fill={R.own} />
        </marker>
        <marker id="head-claim" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" fill={R.war} />
        </marker>
      </defs>

      <!-- области секторов: заливка группой (круги сливаются) и контур её края -->
      {#each model.sectors as s (s.center)}
        <g class="sector-area" fill={s.color}>
          {#each s.worlds as i (i)}
            <circle cx={ax(i)} cy={ay(i)} r={areaR} />
          {/each}
        </g>
        <g class="sector-edge" fill={s.color} filter="url(#sector-outline)">
          {#each s.worlds as i (i)}
            <circle cx={ax(i)} cy={ay(i)} r={areaR} />
          {/each}
        </g>
      {/each}

      {#each model.lanes as l (`${l.a}:${l.b}`)}
        <line class="lane" x1={ax(l.a)} y1={ay(l.a)} x2={ax(l.b)} y2={ay(l.b)} stroke={R.lane} />
      {/each}

      {#each model.fronts as f (`${f.own}:${f.foe}`)}
        <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
        <line
          class="front-hit"
          x1={ax(f.own)}
          y1={ay(f.own)}
          x2={ax(f.foe)}
          y2={ay(f.foe)}
          onclick={(e) => { e.stopPropagation(); pick({ kind: 'foreign', i: f.foe }); }}
        />
        <line
          class="front"
          class:war={f.state === 'war'}
          class:loud={lens === 'threat'}
          x1={ax(f.own)}
          y1={ay(f.own)}
          x2={ax(f.foe)}
          y2={ay(f.foe)}
          stroke={f.state === 'war' ? R.war : R.hostile}
        />
      {/each}

      {#each model.arrows as a (`${a.kind}:${a.from}:${a.to}`)}
        {@const l = arrowLine(a.from, a.to)}
        <line
          class="arrow {a.kind}"
          class:chosen={a.chosen}
          x1={l.x1}
          y1={l.y1}
          x2={l.x2}
          y2={l.y2}
          stroke={a.kind === 'stance' ? R.own : R.war}
          marker-end="url(#head-{a.kind})"
        />
      {/each}

      {#each model.factions as f (f.id)}
        {@const p = factionAt(f)}
        <g class="faction" transform="translate({p.x}, {p.y})">
          <foreignObject x="-11" y="-11" width="22" height="22">
            <FactionEmblem factionId={f.id} size={22} />
          </foreignObject>
          <text class="faction-name" y="22" fill={f.atWar ? R.war : P.textDim}>{factionName(f.id)}</text>
          {#if lens === 'army' && f.theater !== null}
            <text class="faction-theater" y="34" fill={f.theater.mechs >= f.theater.reference ? P.ok : P.gold}>
              {t('realm.map.theaterChip', { mechs: f.theater.mechs, reference: f.theater.reference })}
            </text>
          {/if}
        </g>
      {/each}

      {#each model.goals as g (g)}
        <g class="goal" transform="translate({ax(g)}, {ay(g)})">
          <circle r="10" />
          <line x1="-14" y1="0" x2="-6" y2="0" /><line x1="6" y1="0" x2="14" y2="0" />
          <line x1="0" y1="-14" x2="0" y2="-6" /><line x1="0" y1="6" x2="0" y2="14" />
        </g>
      {/each}

      {#each model.foreign as f (f.i)}
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <g
          class="foreign"
          class:hover={hovered === f.i}
          class:dimmed={mode === 'front' && !marks.has(f.i)}
          data-system={f.id}
          role="button"
          tabindex="-1"
          transform="translate({ax(f.i)}, {ay(f.i)})"
          onclick={(e) => { e.stopPropagation(); pick({ kind: 'foreign', i: f.i }); }}
          onpointerenter={(e) => enter('foreign', f.i, e)}
          onpointerleave={leave}
        >
          <circle r={f.glance === null ? 9 : 11} class="hit" />
          {#if mode === 'front' && marks.has(f.i)}
            {@const m = marks.get(f.i) as FrontMark}
            <circle r={f.glance === null ? 11 : 13} class="target-ring" class:chosen={m.chosen} class:blocked={m.why !== null} />
            <text class="odds" class:blocked={m.why !== null} y={f.glance === null ? -14 : -16}>{Math.round(m.odds * 100)}%</text>
          {/if}
          {#if f.glance !== null}
            <!-- Чужой мир (после шага 93): серый шар — не наш, кольцо цвета владельца — чей. -->
            {#if f.capital}<circle r={FOE_HALF + 4.5} class="capital-ring" stroke={f.color} />{/if}
            <circle r={FOE_HALF + 2} class="foe-ring" stroke={f.color} />
            <foreignObject class="foe-planet" x={-FOE_HALF} y={-FOE_HALF} width={FOE_HALF * 2} height={FOE_HALF * 2}>
              <PlanetDot biome={f.glance.biome} size={FOE_HALF * 2} />
            </foreignObject>
          {:else}
            {#if f.capital}<circle r="6.5" class="capital-ring" stroke={f.color} />{/if}
            <circle r={isSel('foreign', f.i) ? 4.5 : 3.2} fill={f.color} />
          {/if}
          {#if isSel('foreign', f.i)}<circle r={f.glance === null ? 7 : FOE_HALF + 4.5} class="sel-ring" />{/if}
          {#if f.glance !== null}
            {@const fp = labels.get(f.i) ?? (isSel('foreign', f.i) || hovered === f.i ? 'below' : undefined)}
            {#if fp !== undefined}
              {@const top = fp === 'above' ? -FOE_HALF - 28 : FOE_HALF + 3}
              <text class="foreign-name below" y={top + 10}>{f.name}</text>
              <text class="chip foe" class:ok={f.glance.force >= 0} class:bad={f.glance.force < 0} y={top + 21}>{shortMoney(f.glance.force)}</text>
            {/if}
          {:else if showForeignNames || isSel('foreign', f.i) || hovered === f.i}
            <text class="foreign-name" x="7" y="3.5">{f.name}</text>
          {/if}
        </g>
      {/each}

      {#each model.worlds as w (w.i)}
        {@const size = discSize(w)}
        {@const half = size / 2}
        {@const c = chip(w)}
        {@const h = halo(w)}
        {@const place = labels.get(w.i)}
        {@const pips = near || lens === 'build' || isSel('world', w.i) || hovered === w.i}
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <g
          class="world"
          class:hover={hovered === w.i}
          class:selected={isSel('world', w.i)}
          class:dimmed={dimmed(w) || sectorsMark(w) === 'cannot'}
          data-system={w.id}
          role="button"
          tabindex="-1"
          transform="translate({ax(w.i)}, {ay(w.i)})"
          onclick={(e) => { e.stopPropagation(); pick({ kind: 'world', i: w.i }); }}
          onpointerdown={(e) => worldDown(e, w.i)}
          onpointerenter={(e) => enter('world', w.i, e)}
          onpointerleave={leave}
        >
          {#if h !== null}<circle r={half + 9} class="halo" fill={h} />{/if}
          {#if sectorsMark(w) === 'can' || sectorsMark(w) === 'in'}
            <circle r={half + 8} class="assign-ring" class:in={sectorsMark(w) === 'in'} stroke={activeColor ?? R.own} />
          {/if}
          {#if w.threatened}<circle r={half + 7} class="threat" stroke={R.war} />{/if}
          <circle r={half + 2.5} class="own-ring" class:sel={isSel('world', w.i)} />
          {#if w.capital}<circle r={half + 5} class="own-ring" class:sel={isSel('world', w.i)} />{/if}
          <foreignObject x={-half} y={-half} width={size} height={size}>
            <PlanetDot biome={w.biome} {size} />
          </foreignObject>

          <!-- постройки: семь точек над диском, вплотную или в линзе стройки -->
          {#if pips}
            {#each BUILDING_KINDS as kind, n (kind)}
              <rect
                class="pip"
                class:built={w.built.has(kind)}
                class:building={w.building === kind}
                x={(n - 3) * 6.5 - 2.5}
                y={-half - 10}
                width="5"
                height="5"
              />
            {/each}
          {/if}

          <!-- тревоги: значки справа сверху от диска, всегда -->
          {#each w.alerts as a, n (a)}
            <foreignObject class="alert" x={half + 2 + n * 13} y={-half - 6} width="12" height="12">
              <RealmIcon index={ALERT_ICON[a]} size={12} />
            </foreignObject>
          {/each}

          {#if near && w.loyalty !== null}
            <rect class="loy-bg" x={-11} y={half + 2} width="22" height="3" />
            <rect
              class="loy"
              class:low={w.loyalty < 30}
              class:mid={w.loyalty >= 30 && w.loyalty < 60}
              x={-11}
              y={half + 2}
              width={(22 * w.loyalty) / 100}
              height="3"
            />
          {/if}
          {#if near && w.garrison > 0}
            <text class="garrison" x={-half - 4} y={half + 1}>⛨{w.garrison}</text>
          {/if}

          {#if place !== undefined || isSel('world', w.i) || hovered === w.i}
            {@const top = place === 'above' ? -half - lift - (c === null ? 13 : 25) : half + (near ? 8 : 4)}
            <text class="world-name" y={top + 10}>{w.name}</text>
            {#if c !== null}
              <text class="chip {c.tone}" y={top + 22}>{c.text}</text>
            {/if}
          {/if}
        </g>
      {/each}

      <!-- губернаторы поверх миров: портрет на центре сектора, пустой пост — «?» -->
      {#each model.governors as g (g.center)}
        {@const pilot = g.pilotId === null ? undefined : pilots.get(g.pilotId)}
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <g
          class="governor"
          class:active={activeSector === GALAXY.id(g.center)}
          role="button"
          tabindex="-1"
          transform="translate({ax(g.center) - 22}, {ay(g.center) - 22})"
          onclick={(e) => { e.stopPropagation(); pick({ kind: 'sector', i: g.center }); }}
        >
          <circle r="11" class="gov-ring" stroke={g.color} class:vacant={pilot === undefined} />
          {#if pilot !== undefined}
            <foreignObject x="-10" y="-10" width="20" height="20">
              <div class="portrait"><PilotPortrait {pilot} width={20} bordered={false} /></div>
            </foreignObject>
          {:else}
            <text class="vacant-mark" y="4">?</text>
          {/if}
        </g>
      {/each}
      {#if dragWorld !== null}
        <line class="drag-line" x1={ax(dragWorld.i)} y1={ay(dragWorld.i)} x2={dragWorld.x} y2={dragWorld.y} stroke={activeColor ?? R.own} />
      {/if}
    </svg>

    {#if tip !== null && (tipWorld !== null || tipForeign !== null)}
      <div class="tip" style:left="{Math.min(tip.x + 16, width - 250)}px" style:top="{Math.min(tip.y + 16, height - 150)}px">
        {#if tipWorld !== null}
          <div class="tip-title">{tipWorld.name}{#if tipWorld.capital}<span class="gold"> ★</span>{/if}</div>
          <div class="dim">
            {tipWorld.sector === null ? t('realm.hq.outside') : t('realm.map.tipSector', { name: sectorName(tipWorld.sector) })}
          </div>
          <div class:ok={tipWorld.net >= 0} class:danger={tipWorld.net < 0}>{t('realm.hq.net')}: {shortMoney(tipWorld.net)}</div>
          {#if tipWorld.loyalty !== null}
            <div>{t('realm.map.loyaltyChip', { value: loyaltyValue(tipWorld.loyalty), drift: loyaltyDrift(tipWorld.loyaltyDrift) })}</div>
          {/if}
          <div>
            {t('realm.map.tipBuilt', { n: tipWorld.built.size, total: BUILDING_KINDS.length })}{#if tipWorld.building !== null} · {t('realm.map.tipBuilding', { name: t(`realm.world.building.${tipWorld.building}`) })}{/if}
          </div>
          {#if tipWorld.garrison > 0}<div>{t('realm.map.garrisonChip', { n: tipWorld.garrison })}</div>{/if}
          {#each tipWorld.alerts as a (a)}
            <div class="tip-alert" class:danger={ALERT_SEVERE[a]} class:gold={!ALERT_SEVERE[a]}><RealmIcon index={ALERT_ICON[a]} size={14} />{t(`realm.hq.alert.${a}`)}</div>
          {/each}
          {#if sectorsMark(tipWorld) === 'cannot'}<div class="dim">{assignWhy(tipWorld.i)}</div>{/if}
        {:else if tipForeign !== null}
          <div class="tip-title">{tipForeign.name}</div>
          <div style:color={tipForeign.color}>{factionName(tipForeign.owner)}</div>
          {#if tipForeign.glance !== null}
            {@const g = tipForeign.glance}
            <div class="dim">{t(`biome.${g.biome}`)}</div>
            <div>{t('realm.map.tipOutlook', { force: shortMoney(g.force), bought: shortMoney(g.bought) })}</div>
          {/if}
          <div class="dim">{t('realm.dip.standing', { value: Math.round(standingOf(tipForeign)) })}</div>
          {#if mode === 'front' && marks.has(tipForeign.i)}
            {@const m = marks.get(tipForeign.i) as FrontMark}
            <div class:gold={m.why === null}>{t('realm.map.oddsLine', { odds: Math.round(m.odds * 100) })}</div>
            {#if m.why !== null}<div class="dim">{m.why}</div>{/if}
          {/if}
        {/if}
      </div>
    {/if}

    <button class="fit-btn btn btn-sm" title={t('realm.map.fitHint')} onclick={fit}>⌖</button>
  {/if}
</div>

<style>
  .map-wrap {
    position: relative;
    width: 100%;
    height: 100%;
    min-height: 0;
    overflow: hidden;
    background:
      radial-gradient(circle at 50% 50%, rgba(57, 197, 187, 0.04), transparent 70%),
      #070a0f;
  }
  .map {
    display: block;
    cursor: grab;
    user-select: none;
  }
  .map:active {
    cursor: grabbing;
  }
  .sector-area {
    opacity: 0.1;
    pointer-events: none;
  }
  .sector-edge {
    opacity: 0.55;
    pointer-events: none;
  }
  .lane {
    stroke-width: 1;
    pointer-events: none;
  }
  .front-hit {
    stroke: transparent;
    stroke-width: 12;
    cursor: pointer;
  }
  .foreign.dimmed {
    opacity: 0.35;
  }
  .target-ring {
    fill: none;
    stroke: var(--color-gold);
    stroke-width: 1.5;
    stroke-dasharray: 3 2;
  }
  .target-ring.chosen {
    stroke-width: 3;
    stroke-dasharray: none;
  }
  .target-ring.blocked {
    stroke: var(--color-text-dim);
  }
  .odds {
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 700;
    text-anchor: middle;
    fill: var(--color-gold);
    paint-order: stroke;
    stroke: #070a0f;
    stroke-width: 3px;
  }
  .odds.blocked {
    fill: var(--color-text-dim);
  }
  .assign-ring {
    fill: none;
    stroke-width: 1.5;
    stroke-dasharray: 4 3;
  }
  .assign-ring.in {
    stroke-dasharray: none;
    stroke-width: 2;
  }
  .drag-line {
    stroke-width: 2;
    stroke-dasharray: 5 4;
    pointer-events: none;
  }
  .front {
    stroke-width: 2;
    opacity: 0.75;
    pointer-events: none;
  }
  .front.war {
    stroke-width: 2.5;
    stroke-dasharray: 6 4;
    animation: march 1.2s linear infinite;
  }
  .front.loud {
    stroke-width: 3.5;
    opacity: 1;
  }
  .arrow {
    stroke-width: 2.5;
    pointer-events: none;
  }
  .arrow.stance {
    stroke-dasharray: 8 5;
    animation: march 0.9s linear infinite;
  }
  /* Цель, выбранную игроком, видно сразу: сплошная и толще, бегущей остаётся только автоматическая. */
  .arrow.stance.chosen {
    stroke-dasharray: none;
    stroke-width: 3.5;
    animation: none;
  }
  @keyframes march {
    to {
      stroke-dashoffset: -13;
    }
  }
  .goal {
    pointer-events: none;
    fill: none;
    stroke: var(--color-gold);
    stroke-width: 1.5;
  }
  .faction {
    pointer-events: none;
  }
  .faction-name,
  .faction-theater {
    font-family: var(--font-display);
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.8px;
    text-transform: uppercase;
    text-anchor: middle;
  }
  .faction-theater {
    font-family: var(--font-mono);
    font-size: 10px;
    letter-spacing: 0;
    text-transform: none;
  }
  .foreign,
  .world {
    cursor: pointer;
  }
  .world.dimmed {
    opacity: 0.4;
  }
  .hit {
    fill: transparent;
  }
  .capital-ring {
    fill: none;
    stroke-width: 1.2;
  }
  .foreign-name {
    font-family: var(--font-mono);
    font-size: 10px;
    fill: var(--color-text-dim);
  }
  .foreign.hover .foreign-name {
    fill: var(--color-text);
  }
  .halo {
    opacity: 0.32;
  }
  /* Кольцо своего мира — только отделение от фона: серое; свой мир и так цветной, чужой — серый шар. */
  .own-ring {
    fill: none;
    stroke: var(--color-text-dim);
    stroke-width: 1.5;
    opacity: 0.7;
  }
  .foe-ring {
    fill: #070a0f;
    stroke-width: 1.5;
    opacity: 0.9;
  }
  /* Не до конца серый: по светлоте и следу цвета видно лёд, пустыню, лаву; а что мир не наш — видно сразу. */
  .foe-planet :global(.atlas) {
    filter: grayscale(0.65) brightness(0.85);
  }
  .foreign.hover .foe-planet :global(.atlas) {
    filter: grayscale(0.3) brightness(1);
  }
  .foreign-name.below {
    text-anchor: middle;
    paint-order: stroke;
    stroke: #070a0f;
    stroke-width: 3px;
  }
  .chip.foe {
    opacity: 0.75;
  }
  .world.hover .own-ring {
    opacity: 1;
    stroke-width: 2.2;
  }
  .threat {
    fill: none;
    stroke-width: 2;
    animation: pulse 1.6s ease-in-out infinite;
  }
  @keyframes pulse {
    0%,
    100% {
      opacity: 0.25;
    }
    50% {
      opacity: 0.95;
    }
  }
  /* Выбранный мир — кольцо зелёное: свой — его серое кольцо, чужой — второе снаружи кольца фракции. */
  .own-ring.sel {
    stroke: var(--color-ok);
    stroke-width: 2.5;
    opacity: 1;
  }
  .sel-ring {
    fill: none;
    stroke: var(--color-ok);
    stroke-width: 2;
  }
  /* Системы — кнопки (`role="button"`): рамка фокуса браузера после клика дублировала выбор. */
  .world:focus,
  .foreign:focus,
  .governor:focus {
    outline: none;
  }
  .pip {
    fill: #0d1117;
    stroke: var(--color-text-dim);
    stroke-width: 0.8;
    opacity: 0.7;
  }
  .pip.built {
    fill: var(--color-ok);
    stroke: var(--color-ok);
    opacity: 1;
  }
  .pip.building {
    fill: var(--color-gold);
    stroke: var(--color-gold);
    opacity: 1;
    animation: pulse 1.2s ease-in-out infinite;
  }
  .alert {
    overflow: visible;
    pointer-events: none;
  }
  .tip-alert {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .loy-bg {
    fill: #0d1117;
    stroke: var(--color-border);
    stroke-width: 0.5;
  }
  .loy {
    fill: var(--color-ok);
  }
  .loy.mid {
    fill: var(--color-gold);
  }
  .loy.low {
    fill: var(--color-danger);
  }
  .garrison {
    font-family: var(--font-mono);
    font-size: 9.5px;
    text-anchor: end;
    fill: var(--color-accent);
    paint-order: stroke;
    stroke: #070a0f;
    stroke-width: 2.5px;
  }
  .world-name {
    font-family: var(--font-mono);
    font-size: 11px;
    font-weight: 700;
    text-anchor: middle;
    fill: var(--color-text);
    paint-order: stroke;
    stroke: #070a0f;
    stroke-width: 3px;
  }
  .chip {
    font-family: var(--font-mono);
    font-size: 10px;
    text-anchor: middle;
    paint-order: stroke;
    stroke: #070a0f;
    stroke-width: 3px;
  }
  .chip.ok {
    fill: var(--color-ok);
  }
  .chip.bad {
    fill: var(--color-danger);
  }
  .chip.warn {
    fill: var(--color-gold);
  }
  .chip.dim {
    fill: var(--color-text-dim);
  }
  .governor {
    cursor: pointer;
  }
  .governor.active .gov-ring {
    stroke-width: 3.5;
  }
  .gov-ring {
    fill: #0d1117;
    stroke-width: 2;
  }
  .gov-ring.vacant {
    stroke: var(--color-danger);
    stroke-dasharray: 3 2;
  }
  .portrait {
    width: 20px;
    height: 20px;
    border-radius: 50%;
    overflow: hidden;
    line-height: 0;
  }
  .vacant-mark {
    font-size: 12px;
    font-weight: 700;
    text-anchor: middle;
    fill: var(--color-danger);
  }
  .tip {
    position: absolute;
    z-index: 2;
    width: 240px;
    padding: 6px 8px;
    background: rgba(13, 17, 23, 0.95);
    border: 1px solid var(--color-border-active);
    font-size: 11px;
    line-height: 1.45;
    pointer-events: none;
  }
  .tip-title {
    font-weight: 700;
    font-size: 12px;
  }
  .fit-btn {
    position: absolute;
    right: 10px;
    bottom: 10px;
  }
  @media (prefers-reduced-motion: reduce) {
    .front.war,
    .arrow.stance,
    .threat,
    .pip.building {
      animation: none;
    }
    .threat {
      opacity: 0.8;
    }
  }
</style>
