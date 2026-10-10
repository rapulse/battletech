<script lang="ts">
  import { GALAXY } from '../../core/campaign/galaxy/index.js';
  import type { BuildingKind } from '../../core/campaign/index.js';
  import { campaign } from '../state/campaign.svelte.js';
  import { t } from '../i18n/index.js';
  import RealmMap, { MAP_LENSES, MAP_MODES, type FrontMark, type MapLens, type MapMode, type MapSelection } from './RealmMap.svelte';
  import RealmSidePanel from './RealmSidePanel.svelte';
  import RealmWorldTree from './RealmWorldTree.svelte';
  import { buildRealmMap, type WorldDetail } from './realmMapModel.js';
  import { realmTodo } from './realmTodo.js';

  /**
   * Штаб державы (шаг 93): миры по секторам слева, карта державы и соседей в центре, выбранное и держава
   * справа. Выбор и наведение — одни на три колонки.
   */
  const worlds = $derived(campaign.realmWorlds);
  const sectorsView = $derived(campaign.realmSectors);
  const sectors = $derived(sectorsView.sectors);
  const army = $derived(campaign.realmArmy);
  const wars = $derived(campaign.realmWars);
  const neighbours = $derived(campaign.realmNeighbours);

  /** Постройки и гарнизон каждого мира — те же представления, что у карточки мира. */
  const details = $derived.by((): ReadonlyMap<string, WorldDetail> => {
    const out = new Map<string, WorldDetail>();
    for (const w of worlds) {
      const b = campaign.buildingsView(w.id);
      out.set(w.id, {
        built: new Set<BuildingKind>(b.rows.filter((r) => r.built).map((r) => r.kind)),
        building: b.construction?.kind ?? null,
        garrison: campaign.garrisonView(w.id).count,
      });
    }
    return out;
  });

  const model = $derived(
    buildRealmMap({
      worlds,
      sectors,
      neighbours,
      wars,
      owners: campaign.owners,
      details,
      theaters: army.theaters,
      glance: (id) => campaign.systemGlance(id),
    }),
  );

  const pilots = $derived(new Map(campaign.pilots.map((p) => [p.id, p])));
  const sectorName = (center: string): string => GALAXY.name(GALAXY.require(center));

  /**
   * Миров, где ничего не строится, хотя начать стройку можно сейчас: причину отказа спрашивает у ядра
   * та же команда, что у кнопки «Строить», — с деньгами и всеми условиями.
   */
  const idleWorlds = $derived(
    worlds.filter((w) => {
      const b = campaign.buildingsView(w.id);
      if (b.construction !== null) return false;
      return b.rows.some((r) => !r.built && campaign.why({ kind: 'startBuilding', systemId: w.id, building: r.kind }) === null);
    }).length,
  );

  const todo = $derived(
    realmTodo({
      day: campaign.day,
      worlds,
      sectors,
      sectorLimit: sectorsView.limit,
      wars,
      neighbours,
      idleWorlds,
    }),
  );

  /** Выбор — общий с другими вкладками державы (`campaign.realmPick`): «На карте державы» открывает Штаб на нём. */
  function fromPick(): MapSelection {
    const pick = campaign.realmPick;
    if (pick === null || GALAXY.index(pick.id) < 0) return null;
    return { kind: pick.kind, i: GALAXY.require(pick.id) };
  }
  const initial = fromPick();
  let selection = $state<MapSelection>(initial);
  $effect(() => {
    campaign.realmPick = selection === null ? null : { kind: selection.kind, id: GALAXY.id(selection.i) };
  });
  let hovered = $state<number | null>(null);
  /** Пришли из другой вкладки с выбранным — карта сразу едет к нему. */
  let focus = $state<{ i: number; seq: number } | null>(initial === null ? null : { i: initial.i, seq: 1 });
  let lens = $state<MapLens>('sector');
  let mode = $state<MapMode>('view');

  /** Выбрать мир, соседа или сектор и подвезти к нему карту — из списка, из «Требует решения». */
  function show(kind: 'world' | 'foreign' | 'sector', i: number): void {
    selection = { kind, i };
    focus = { i, seq: (focus?.seq ?? 0) + 1 };
  }

  const sectorOfWorld = (i: number): string | null => worlds.find((w) => w.id === GALAXY.id(i))?.sector ?? null;

  /**
   * Сектор, в который раскладывают миры в режиме «Секторы»: выбранный сектор или сектор выбранного мира.
   * Без него клик по миру сперва выбирает его сектор.
   */
  const activeSector = $derived.by((): string | null => {
    if (mode !== 'sectors' || selection === null) return null;
    if (selection.kind === 'sector') return GALAXY.id(selection.i);
    if (selection.kind === 'world') return sectorOfWorld(selection.i);
    return null;
  });

  function assignWhy(i: number): string | null {
    if (activeSector === null) return null;
    return campaign.why({ kind: 'assignWorldSector', systemId: GALAXY.id(i), center: activeSector });
  }

  /** Участки фронта под приказ по всем войнам: шанс, причина отказа, цель ли стойки. */
  const marks = $derived.by((): ReadonlyMap<number, FrontMark> => {
    const out = new Map<number, FrontMark>();
    for (const f of campaign.realmOffensives.fronts) {
      const focusId = wars.find((w) => w.factionId === f.factionId)?.stanceFocusId ?? null;
      for (const x of f.targets) out.set(GALAXY.require(x.id), { odds: x.odds, why: x.why, chosen: x.id === focusId });
    }
    return out;
  });

  /**
   * Клик по карте — по режиму. «Обзор» — выбор. «Секторы»: центр или мир без выбранного сектора — выбрать его
   * сектор; иначе мир переходит в выбранный сектор, а мир, отнесённый туда вручную, — обратно к геометрии.
   * «Фронт»: участок врага — цель стойки (повторный клик снимает) и выбор.
   */
  function onMapSelect(sel: MapSelection): void {
    if (sel === null || mode === 'view') {
      selection = sel;
      return;
    }
    if (mode === 'sectors' && sel.kind === 'world') {
      const id = GALAXY.id(sel.i);
      const isCenter = sectors.some((x) => x.center === id);
      if (activeSector === null || isCenter) {
        selection = isCenter ? { kind: 'sector', i: sel.i } : sel;
        return;
      }
      const manual = campaign.state.realm.assigned?.[id] === activeSector;
      if (manual) campaign.run({ kind: 'assignWorldSector', systemId: id, center: null });
      else if (sectorOfWorld(sel.i) !== activeSector) campaign.run({ kind: 'assignWorldSector', systemId: id, center: activeSector });
      return;
    }
    const owner = sel.kind === 'foreign' ? (campaign.owners[sel.i] ?? GALAXY.ownerId(sel.i)) : null;
    // Враг с первого дня без записи войны: цели стойки у него нет — только выбор, приказ — в правой колонке.
    if (mode === 'front' && owner !== null && marks.has(sel.i) && wars.some((w) => w.factionId === owner)) {
      const id = GALAXY.id(sel.i);
      const chosen = marks.get(sel.i)?.chosen === true;
      campaign.run({ kind: 'setStanceTarget', factionId: owner, systemId: chosen ? null : id });
    }
    selection = sel;
  }

  /** Мир перетащен на другой мир: в сектор того мира (режим «Секторы»). */
  function onDrop(world: number, onto: number): void {
    const center = sectorOfWorld(onto) ?? (sectors.some((x) => x.center === GALAXY.id(onto)) ? GALAXY.id(onto) : null);
    if (center === null) return;
    campaign.run({ kind: 'assignWorldSector', systemId: GALAXY.id(world), center });
  }

  function dropFromList(worldId: string, center: string): void {
    campaign.run({ kind: 'assignWorldSector', systemId: worldId, center });
  }
</script>

{#if worlds.length === 0}
  <section class="panel panel-body empty">
    <p class="dim">{t('realm.empty')}</p>
  </section>
{:else}
  <div class="hq">
    <RealmWorldTree
      {worlds}
      {sectors}
      selected={selection?.kind === 'world' ? selection.i : null}
      {hovered}
      onselect={(i) => show('world', i)}
      onsector={(center) => show('sector', GALAXY.require(center))}
      ondropworld={dropFromList}
      onhover={(i) => (hovered = i)}
    />
    <div class="map-col panel">
      <div class="lens-bar">
        <div class="modes">
          {#each MAP_MODES as m (m)}
            <button class="mode-btn" class:active={mode === m} data-mode={m} title={t(`realm.map.modeHint.${m}`)} onclick={() => (mode = m)}>
              {t(`realm.map.mode.${m}`)}
            </button>
          {/each}
        </div>
        <span class="lens-title">{t('realm.map.lensTitle')}</span>
        {#each MAP_LENSES as l (l)}
          <button class="lens-btn" class:active={lens === l} data-lens={l} title={t(`realm.map.lensHint.${l}`)} onclick={() => (lens = l)}>
            {t(`realm.map.lens.${l}`)}
          </button>
        {/each}
      </div>
      <div class="map-box">
        <RealmMap
          {model}
          selected={selection}
          {hovered}
          {focus}
          {lens}
          {mode}
          {activeSector}
          {assignWhy}
          {marks}
          {pilots}
          {sectorName}
          onselect={onMapSelect}
          onhover={(i) => (hovered = i)}
          ondrop={onDrop}
        />
        {#if mode !== 'view'}
          <div class="mode-banner">
            {mode === 'sectors' && activeSector !== null
              ? t('realm.map.bannerSectorActive', { name: sectorName(activeSector) })
              : t(`realm.map.banner.${mode}`)}
            <button class="link-btn" onclick={() => (mode = 'view')}>{t('realm.map.exitMode')}</button>
          </div>
        {/if}
      </div>
    </div>
    <RealmSidePanel
      {selection}
      {todo}
      onclear={() => (selection = null)}
      onshow={show}
      onlens={(l) => (lens = l)}
    />
  </div>
{/if}

<svelte:window
  onkeydown={(e) => {
    if (e.key !== 'Escape') return;
    // Esc снимает сначала выбор, потом режим: как «назад» в стратегиях.
    if (selection !== null) selection = null;
    else if (mode !== 'view') mode = 'view';
  }}
/>

<style>
  .hq {
    display: grid;
    grid-template-columns: minmax(220px, 280px) 1fr minmax(260px, 340px);
    gap: 10px;
    height: 100%;
    padding: 10px;
    min-height: 0;
    overflow: hidden;
  }
  .map-col {
    display: flex;
    flex-direction: column;
    min-height: 0;
    overflow: hidden;
    padding: 0;
  }
  .map-box {
    position: relative;
    flex: 1;
    min-height: 0;
  }
  .modes {
    display: flex;
    margin-right: 12px;
  }
  .mode-btn {
    padding: 3px 10px;
    background: var(--color-panel-sub);
    border: 1px solid var(--color-border);
    color: var(--color-text-dim);
    font-family: var(--font-display);
    font-size: 11.5px;
    font-weight: 700;
    letter-spacing: 0.8px;
    text-transform: uppercase;
    cursor: pointer;
  }
  .mode-btn + .mode-btn {
    margin-left: -1px;
  }
  .mode-btn.active {
    position: relative;
    color: var(--color-accent);
    border-color: var(--color-accent);
    background: rgba(57, 197, 187, 0.12);
  }
  .mode-banner {
    position: absolute;
    left: 50%;
    bottom: 12px;
    transform: translateX(-50%);
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 5px 12px;
    background: rgba(13, 17, 23, 0.92);
    border: 1px solid var(--color-accent);
    font-size: 11.5px;
    white-space: nowrap;
  }
  .link-btn {
    background: none;
    border: none;
    padding: 0;
    color: var(--color-accent);
    font-size: 11px;
    cursor: pointer;
  }
  .lens-bar {
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 5px 8px;
    border-bottom: 1px solid var(--color-border);
    flex-wrap: wrap;
  }
  .lens-title {
    margin-right: 6px;
    font-family: var(--font-display);
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 1px;
    text-transform: uppercase;
    color: var(--color-text-dim);
  }
  .lens-btn {
    padding: 3px 9px;
    background: transparent;
    border: 1px solid var(--color-border);
    color: var(--color-text-dim);
    font-size: 11px;
    cursor: pointer;
  }
  .lens-btn:hover {
    color: var(--color-text);
  }
  .lens-btn.active {
    color: var(--color-gold);
    border-color: var(--color-gold);
    background: rgba(227, 179, 65, 0.1);
  }
  .empty {
    margin: 10px;
  }
</style>
