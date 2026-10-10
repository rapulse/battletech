<script lang="ts">
  import { battle } from '../state/battle.svelte.js';
  import { CHASSIS_CATALOG, chassis, EQUIPMENT } from '../../core/data/index.js';
  import {
    cleanChassisCode,
    ContactLevel,
    Phase,
    skillLevel,
    WEIGHT_CLASS_KEYS,
    type MechUnit,
  } from '../../core/model/index.js';
  import { MoveMode } from '../../core/map/index.js';
  import { MOVE_MODES, mpBudget, offeredMoveModes, ecmRange, probeRange } from '../../core/rules/index.js';
  import { tr } from '../../core/log/index.js';
  import type { ZoneId } from '../../core/model/HitZone.js';
  import { t, tn, equipmentHint } from '../i18n/index.js';
  import MechSilhouette from './MechSilhouette.svelte';
  import Paperdoll from './Paperdoll.svelte';

  let unit = $derived(battle.selected);
  /** Своя машина, которой командует игрок; звено нанимателя (шаг 73b) — нет. */
  let own = $derived(unit !== undefined && battle.commands(unit));
  let chassisCode = $derived(unit === undefined ? '' : cleanChassisCode(unit.chassis));
  let mechTitle = $derived(
    chassisCode !== '' ? (CHASSIS_CATALOG.get(chassisCode)?.canonName || chassisCode) : '',
  );
  let zones = $derived(battle.zonesOf(unit));
  let weapons = $derived(battle.weaponsOf(unit));
  let known = $derived(unit === undefined ? ContactLevel.None : battle.contactOf(unit));

  /**
   * ЭПП и активный зонд — видны, как оружие и класс исполнения, только у
   * опознанной машины (`ecmRange`/`probeRange` читают целую сборку, а её не
   * положено знать по силуэту). Id самой установки ищется отдельно от
   * дальности — он нужен только для точного текста подсказки (у Сферы и
   * Кланов разный радиус зонда, и подсказка должна называть именно тот).
   */
  function supportEquipmentId(u: MechUnit, field: 'ecmRange' | 'probeRange'): string | null {
    for (const zoneSlots of u.slots) {
      for (const slot of zoneSlots) {
        if (slot.kind !== 'equipment' || slot.destroyed || slot.id === undefined) continue;
        if ((EQUIPMENT.get(slot.id)?.[field] ?? 0) > 0) return slot.id;
      }
    }
    return null;
  }
  let ecmR = $derived(unit === undefined || known < ContactLevel.Identified ? 0 : ecmRange(unit));
  let probeR = $derived(unit === undefined || known < ContactLevel.Identified ? 0 : probeRange(unit));
  let ecmId = $derived(unit === undefined || ecmR <= 0 ? null : supportEquipmentId(unit, 'ecmRange'));
  let probeId = $derived(unit === undefined || probeR <= 0 ? null : supportEquipmentId(unit, 'probeRange'));

  /*
    Класс исполнения и навыки пилота (решение пользователя 2026-09-15). Видны только
    опознанной цели — как оружие и броня. Класс лежит в описании шасси боя
    (`assemblyToChassisDef`); нет поля — серийная машина. Реактор и каркас могут
    быть разного класса: тогда оба коротко, полные названия в подсказке.
  */
  let quality = $derived(unit === undefined ? undefined : chassis(unit.chassis).quality);
  let qualityText = $derived(
    quality === undefined
      ? t('quality.standard')
      : quality.reactor === quality.frame
        ? t(`quality.${quality.reactor}`)
        : `${t(`quality.${quality.reactor}Short`)}/${t(`quality.${quality.frame}Short`)}`,
  );
  let qualityTitle = $derived(
    t('battle.card.qualityTitle', {
      reactor: t(`quality.${quality?.reactor ?? 'standard'}`),
      frame: t(`quality.${quality?.frame ?? 'standard'}`),
    }),
  );
  // Навыки — с поправкой на ранения (`skillLevel`): то, чем пилот стреляет сейчас.
  const COCKPIT_SKILLS = ['gunnery', 'piloting', 'tactics', 'composure'] as const;
  let pilotTitle = $derived(
    unit === undefined
      ? ''
      : COCKPIT_SKILLS.map((id) =>
          t('battle.card.skillItem', { name: tr(`skill.${id}`), level: skillLevel(unit!.pilot, id) }),
        ).join(t('battle.card.skillSeparator')),
  );

  let armorNow = $derived(zones.reduce((s, z) => s + z.armor + z.structure, 0));
  let armorMax = $derived(zones.reduce((s, z) => s + z.maxArmor + z.maxStructure, 0));

  /*
    Целость по зонам (решение пользователя 2026-09-15). Общая полоса молчала о
    главном: где броня уже снята и бьют по структуре. Каждая зона — своя полоса
    на свой максимум: жёлтая часть — структура, зелёная — броня поверх неё.
    Порядок и подписи — те же, что в мехлабе (`ZonePicker.svelte`), чтобы
    взгляд не искал ЛР заново на другом экране.
  */
  const ZONE_GROUPS: readonly (readonly ZoneId[])[] = [
    ['head'],
    ['torso'],
    ['leftArm', 'rightArm'],
    ['leftLeg', 'rightLeg'],
  ];

  let zoneGroups = $derived(
    ZONE_GROUPS.map((group) =>
      group.flatMap((id) => {
        const z = zones.find((line) => line.id === id);
        if (z === undefined) return [];
        const max = Math.max(1, z.maxArmor + z.maxStructure);
        return [{
          ...z,
          short: t(`zone.${id}Short`),
          structurePct: (z.structure / max) * 100,
          armorPct: (z.armor / max) * 100,
        }];
      }),
    ),
  );
  // Край шкалы — предел машины (отвод + запас корпуса), та же цифра, что в
  // мехлабе. Мигание — выбранный выстрел (или уже набранное тепло) отключит
  // реактор в фазе тепла.
  let heatInfo = $derived(unit === undefined ? null : battle.heatLimitsOf(unit));
  let heatEdge = $derived(heatInfo === null ? 1 : heatInfo.limit);
  let heatShare = $derived(unit === undefined ? 0 : unit.heat / heatEdge);
  let heatAlarm = $derived(battle.heatAlarm);

  let hasJump = $derived(unit !== undefined && mpBudget(unit, MoveMode.Jump) > 0);
  const runOffered = MOVE_MODES.includes(MoveMode.Run);

  /*
    Полоса режимов собирается из ПРАВИЛ (`offeredMoveModes`), а не перечисляется
    здесь: выключенный в данных бег обязан пропасть у игрока ровно так же, как
    он пропал у бота, — иначе кнопка предлагала бы ход, которого нет. Один
    режим — не выбор: полоса тогда не рисуется вовсе.
  */
  const MODE_LABELS: Readonly<Record<MoveMode, string>> = {
    [MoveMode.Walk]: `🚶 ${t('battle.mode.walk')}`,
    [MoveMode.Run]: `🏃 ${t('battle.mode.run')}`,
    [MoveMode.Jump]: `🚀 ${t('battle.mode.jump')}`,
  };

  /*
    Кнопки поворота скрыты, но не удалены (решение пользователя 2026-09-15):
    поворот и так висит на клавишах Q/E и стрелках (`TacticalCanvas.svelte`,
    слушатель на всём окне), а новичку о них говорит подсказка фазы движения
    (`PhaseHint.svelte`). Вернуть кнопки — поставить здесь `true`.
  */
  const SHOW_TURN_BUTTONS = false;

  let availableModes = $derived(
    unit === undefined
      ? []
      : offeredMoveModes(unit).map((mode) => ({ mode, label: MODE_LABELS[mode] })),
  );

  function statusText(): string {
    if (unit === undefined) return '—';
    if (unit.destroyed) return t('battle.unit.state.destroyed');
    if (unit.shutdown) return t('battle.unit.state.shutdown');
    if (unit.prone) return t('battle.unit.state.prone');
    if (unit.moveMode !== null && unit.hasFired) return t('battle.unit.state.done');
    if (unit.moveMode !== null) return t('battle.unit.state.moved');
    return t('battle.unit.state.ready');
  }
</script>

{#if unit === undefined}
  <div class="panel-section empty">{t('battle.unit.none')}</div>
{:else}
  <div class="panel-section">
    <div class="head-top">
      <h4 class="section-title">
        {own ? t('battle.unit.titleOwn') : unit.ally ? t('battle.unit.titleAlly') : t('battle.unit.titleEnemy')}
      </h4>
      {#if !own}
        <button class="btn-return" onclick={() => battle.selectFirstOwn()}>
          {t('battle.unit.backToOwn')}
        </button>
      {/if}
    </div>

    <div class="unit-head">
      {#if known >= ContactLevel.Identified}
        <div class="unit-thumb" class:enemy={unit.side !== 'player'}>
          <MechSilhouette {chassisCode} name={mechTitle} paint={battle.paintOf(unit)} width={38} zoomable />
        </div>
      {:else}
        <div
          class="avatar"
          class:enemy={unit.side !== 'player'}
          class:silhouette={known === ContactLevel.Silhouette}
          class:blip={known === ContactLevel.Blip}
        >
          {known === ContactLevel.Blip ? '?' : '◐'}
        </div>
      {/if}
      <div>
        <h3 class="unit-name">
          {known === ContactLevel.Blip ? t('battle.unit.sensorContact') : mechTitle}
        </h3>
        <div class="unit-class">
          {#if known >= ContactLevel.Identified}
            {chassisCode} &bull; <span title={qualityTitle}>{qualityText}</span><br />
            {t('battle.unit.pilot', { callsign: unit.pilot.callsign })} &bull;
            <span title={pilotTitle}>
              {t('battle.card.skillsShort', {
                gunnery: skillLevel(unit.pilot, 'gunnery'),
                piloting: skillLevel(unit.pilot, 'piloting'),
              })}
            </span>
            {#if ecmR > 0}
              <span class="support-badge" title={ecmId !== null ? equipmentHint(ecmId) : ''}>
                {t('battle.unit.ecm')}
              </span>
            {/if}
            {#if probeR > 0}
              <span class="support-badge" title={probeId !== null ? equipmentHint(probeId) : ''}>
                {t('battle.unit.bap')}
              </span>
            {/if}
          {:else if known === ContactLevel.Silhouette}
            {t('battle.unit.weightClass', { name: tr(WEIGHT_CLASS_KEYS[unit.weightClass]).toUpperCase() })}
          {:else}
            {t('battle.unit.radarSignature')}
          {/if}
        </div>
      </div>
    </div>

    {#if known >= ContactLevel.Identified}
      <div class="meters">
        <div class="meter-group">
          <div class="meter-labels"><span>{t('battle.unit.integrity')}</span> <span>{armorNow} / {armorMax}</span></div>
          <div class="zone-bars">
            {#each zoneGroups as group, gi (gi)}
              {#if gi > 0}<span class="zone-sep" aria-hidden="true">·</span>{/if}
              {#each group as z (z.id)}
                <div
                  class="zone-cell"
                  class:destroyed={z.destroyed}
                  title={t(z.destroyed ? 'battle.unit.zoneTitleDestroyed' : 'battle.unit.zoneTitle', {
                    zone: z.label,
                    armor: z.armor,
                    maxArmor: z.maxArmor,
                    structure: z.structure,
                    maxStructure: z.maxStructure,
                  })}
                >
                  <span class="zone-short">{z.short}</span>
                  <div class="meter-bar zone-bar">
                    <div class="meter-fill structure" style:width="{z.structurePct}%"></div>
                    <div class="meter-fill armor" style:width="{z.armorPct}%"></div>
                  </div>
                </div>
              {/each}
            {/each}
          </div>
        </div>
        <div class="meter-group">
          <div class="meter-labels">
            <span>{t('battle.unit.heat')}</span>
            <span
              class:alarm-text={heatAlarm}
              title={heatInfo === null
                ? ''
                : t('battle.unit.heatTitle', {
                    limit: heatInfo.limit,
                    dissipation: heatInfo.dissipation,
                    reserve: heatInfo.reserve,
                  })}
            >{unit.heat} / {heatEdge}</span>
          </div>
          <div class="meter-bar" class:alarm={heatAlarm}>
            <div class="meter-fill heat" style:width="{Math.min(100, heatShare * 100)}%"></div>
          </div>
        </div>
      </div>

      <div class="stats-grid">
        <div class="u-stat"><span class="lbl">{t('battle.unit.statLabel', { name: t('battle.mode.walk') })}</span> <span class="val">{t('battle.unit.mp', { n: mpBudget(unit, MoveMode.Walk) })}</span></div>
        {#if runOffered}
          <div class="u-stat"><span class="lbl">{t('battle.unit.statLabel', { name: t('battle.mode.run') })}</span> <span class="val">{t('battle.unit.mp', { n: mpBudget(unit, MoveMode.Run) })}</span></div>
        {/if}
        {#if hasJump}
          <div class="u-stat"><span class="lbl">{t('battle.unit.statLabel', { name: t('battle.mode.jump') })}</span> <span class="val">{t('battle.unit.mp', { n: mpBudget(unit, MoveMode.Jump) })}</span></div>
        {/if}
        <div class="u-stat"><span class="lbl">{t('battle.unit.status')}</span> <span class="val ready">{statusText()}</span></div>
      </div>
    {:else if known === ContactLevel.Silhouette}
      <p class="unknown-note silhouette-note">
        ◐ <b>{t('battle.unit.silhouetteTitle')}</b>: {t('battle.unit.silhouetteBody')}<br>
        {t('battle.unit.silhouetteAdvice')}
      </p>
    {:else}
      <p class="unknown-note blip-note">
        ❓ <b>{t('battle.unit.blipTitle')}</b>: {t('battle.unit.blipBody')}
      </p>
    {/if}

    {#if own}
      <div class="weapons">
        <div class="weapons-title">{t('battle.unit.weaponsOwn')}</div>
        {#each weapons as w (w.index)}
          <button
            class="weapon"
            class:active={w.index === battle.mountIndex}
            class:dead={!w.ready}
            onclick={() => battle.setMount(w.index)}
            onmouseenter={() => (battle.hoveredWeapon = w.range)}
            onmouseleave={() => (battle.hoveredWeapon = null)}
          >
            <span class="w-name">{w.name}</span>
            <span class="w-meta">
              {t('battle.unit.weaponDamage', { n: w.damage })} &bull; {w.range.shortR}/{w.range.medR}/{w.range.maxR}H &bull; {w.heat} 🔥
              {#if w.ammo !== null}&bull; {tn('count.volleys', w.ammo)}{/if}
            </span>
          </button>
        {/each}
      </div>

      {#if availableModes.length > 1}
        <div class="actions">
          {#each availableModes as m (m.mode)}
            <button
              class="act"
              class:active={battle.moveMode === m.mode}
              disabled={battle.phase !== Phase.Movement}
              onclick={() => battle.setMoveMode(m.mode)}
            >{m.label}</button>
          {/each}
        </div>
      {/if}

      {#if SHOW_TURN_BUTTONS}
      <div class="actions">
        <button
          class="act turn"
          disabled={battle.phase !== Phase.Movement}
          title={t('battle.unit.turnLeftTitle')}
          onclick={() => battle.rotateBy(-1)}
        >{t('battle.unit.turnLeft')}</button>
        <button
          class="act turn"
          disabled={battle.phase !== Phase.Movement}
          title={t('battle.unit.turnRightTitle')}
          onclick={() => battle.rotateBy(1)}
        >{t('battle.unit.turnRight')}</button>
      </div>
      {/if}
    {:else if known >= ContactLevel.Identified}
      <div class="weapons">
        <div class="weapons-title">{t('battle.unit.weaponsEnemy', { n: weapons.length })}</div>
        {#each weapons as w (w.index)}
          <div
            class="weapon enemy-weapon"
            class:dead={!w.ready}
            role="button"
            tabindex="-1"
            onmouseenter={() => (battle.hoveredWeapon = w.range)}
            onmouseleave={() => (battle.hoveredWeapon = null)}
          >
            <span class="w-name">{w.name}</span>
            <span class="w-meta">
              {t('battle.unit.weaponDamage', { n: w.damage })} &bull; {w.range.shortR}/{w.range.medR}/{w.range.maxR}H &bull; {w.heat} 🔥
              {#if w.ammo !== null}&bull; {tn('count.volleys', w.ammo)}{/if}
            </span>
          </div>
        {/each}
      </div>
    {/if}

    <Paperdoll {zones} hidden={known < ContactLevel.Identified} />
  </div>
{/if}

<style>
  .panel-section {
    padding: 12px; background: #161b22;
    border: 1px solid #30363d; border-radius: 6px;
  }
  .panel-section.empty {
    color: #8b949e; font-family: monospace; font-size: 11px; line-height: 1.5;
  }
  .head-top {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 8px;
  }
  .btn-return {
    background: rgba(57, 197, 187, 0.12);
    border: 1px solid rgba(57, 197, 187, 0.4);
    color: #39c5bb;
    font-size: 9.5px;
    font-family: monospace;
    font-weight: bold;
    padding: 3px 8px;
    border-radius: 4px;
    cursor: pointer;
    transition: all 0.15s;
  }
  .btn-return:hover {
    background: rgba(57, 197, 187, 0.25);
    border-color: #39c5bb;
  }
  .section-title {
    margin: 0; font-size: 11px; color: #8b949e;
    letter-spacing: 0.5px; font-family: monospace;
  }
  .unit-head { display: flex; gap: 10px; align-items: center; margin-bottom: 10px; }
  .unit-thumb {
    flex-shrink: 0;
    line-height: 0;
  }
  .unit-thumb.enemy :global(.atlas.bordered) {
    border-color: #f85149;
  }
  .avatar {
    width: 38px; height: 38px; border-radius: 6px;
    background: rgba(56, 139, 253, 0.18); border: 1px solid #388bfd;
    color: #79c0ff; display: flex; align-items: center; justify-content: center;
    font-family: monospace; font-weight: bold; font-size: 12px; flex-shrink: 0;
  }
  .avatar.enemy {
    background: rgba(248, 81, 73, 0.18); border-color: #f85149; color: #ff7b72;
  }
  .avatar.silhouette {
    background: #21262d; border-color: #6e7681; color: #8b949e;
  }
  .avatar.blip {
    background: rgba(227, 179, 65, 0.15); border-color: #e3b341; color: #ffd54f;
  }
  .unit-name { margin: 0; font-size: 12.5px; color: #e6edf3; font-family: monospace; }
  .unit-class { font-size: 9.5px; color: #8b949e; font-family: monospace; }
  /* Тот же бирюзово-фиолетовый, что у бирки установки в ангаре (`#bc8cff`) —
     один цвет на обе панели, чтобы РЭБ и зонд читались одинаково везде.
     Строкой после «ПИЛ N», а не отдельной строкой карточки (решение
     пользователя 2026-09-18): вторая строка сдвигала список машин, а тут
     занята только та ширина, что осталась после текста. */
  .support-badge {
    display: inline-block;
    margin-left: 5px;
    padding: 0 5px;
    border: 1px solid #bc8cff;
    border-radius: 2px;
    background: rgba(188, 140, 255, 0.1);
    color: #bc8cff;
    font-size: 9px;
    font-weight: 700;
    font-family: monospace;
    letter-spacing: 0.3px;
    line-height: 1.5;
    vertical-align: middle;
    cursor: default;
  }
  .meters { display: flex; flex-direction: column; gap: 8px; margin-bottom: 10px; }
  .meter-labels {
    display: flex; justify-content: space-between;
    font-size: 9.5px; color: #8b949e; font-family: monospace; margin-bottom: 3px;
  }
  .meter-bar { height: 7px; background: #0d1117; border-radius: 4px; overflow: hidden; border: 1px solid #21262d; }
  .meter-fill { height: 100%; transition: width 0.25s; }
  .meter-fill.armor { background: linear-gradient(90deg, #2ea043, #3fb950); }
  .meter-fill.structure { background: #e3b341; }
  .zone-bars { display: flex; align-items: flex-end; gap: 4px; }
  .zone-sep { color: #484f58; font-size: 11px; line-height: 7px; }
  .zone-cell { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
  .zone-short {
    font-family: monospace; font-size: 9px; color: #8b949e; text-align: center; letter-spacing: 0.5px;
  }
  .zone-bar { display: flex; }
  .zone-cell.destroyed .zone-short { color: #f85149; }
  .zone-cell.destroyed .zone-bar { border: 1px dashed #f85149; }
  .meter-fill.heat { background: linear-gradient(90deg, #e3b341, #f85149); }
  .meter-bar.alarm { border-color: #f85149; animation: heat-alarm 0.7s ease-in-out infinite; }
  .alarm-text { color: #ff7b72; }
  @keyframes heat-alarm {
    50% { border-color: #ff9100; box-shadow: 0 0 8px rgba(248, 81, 73, 0.9); opacity: 0.55; }
  }
  .stats-grid {
    display: grid; grid-template-columns: 1fr 1fr; gap: 4px 10px; margin-bottom: 10px;
  }
  .u-stat { display: flex; justify-content: space-between; font-family: monospace; font-size: 10px; }
  .u-stat .lbl { color: #8b949e; }
  .u-stat .val { color: #e6edf3; font-weight: bold; }
  .u-stat .val.ready { color: #3fb950; }
  .unknown-note {
    margin: 0 0 10px; font-family: monospace; font-size: 10px;
    color: #e3b341; line-height: 1.5; padding: 8px;
    background: rgba(22, 27, 34, 0.7); border: 1px solid #30363d; border-radius: 4px;
  }
  .unknown-note.silhouette-note {
    border-color: rgba(110, 118, 129, 0.4);
    background: rgba(110, 118, 129, 0.08);
    color: #c9d1d9;
  }
  .unknown-note.blip-note {
    border-color: rgba(227, 179, 65, 0.4);
    background: rgba(227, 179, 65, 0.08);
    color: #ffd54f;
  }
  .weapons { display: flex; flex-direction: column; gap: 4px; margin-bottom: 10px; }
  .weapons-title { font-size: 9.5px; color: #8b949e; font-family: monospace; margin-bottom: 2px; }
  .weapon {
    display: flex; flex-direction: column; align-items: flex-start; gap: 1px;
    background: #0d1117; border: 1px solid #30363d; border-radius: 4px;
    padding: 5px 8px; cursor: pointer; text-align: left; transition: all 0.12s;
  }
  .weapon.enemy-weapon {
    cursor: default;
    background: rgba(13, 17, 23, 0.6);
  }
  .weapon.enemy-weapon:hover {
    border-color: #30363d;
  }
  .weapon:hover { border-color: #39c5bb; }
  .weapon.active { border-color: #e3b341; background: rgba(227, 179, 65, 0.1); }
  .weapon.dead { opacity: 0.35; }
  .w-name { font-family: monospace; font-size: 11px; color: #e6edf3; font-weight: bold; }
  .w-meta { font-family: monospace; font-size: 9px; color: #8b949e; }
  .actions { display: flex; gap: 5px; margin-bottom: 6px; }
  .act {
    flex: 1; padding: 6px 4px; font-size: 10px; font-family: monospace; font-weight: bold;
    background: #0d1117; border: 1px solid #30363d; color: #c9d1d9;
    border-radius: 4px; cursor: pointer; transition: all 0.12s;
  }
  .act:hover:not(:disabled) { border-color: #39c5bb; color: #39c5bb; }
  .act.active { border-color: #39c5bb; color: #39c5bb; background: rgba(57, 197, 187, 0.12); }
  .act.turn { background: rgba(56, 139, 253, 0.12); border-color: rgba(56, 139, 253, 0.4); }
  .act:disabled { opacity: 0.35; cursor: default; }
</style>
