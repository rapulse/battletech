<script lang="ts">
  import { ECONOMY, NAMES } from '../../core/data/index.js';
  import { GALAXY, START_SYSTEM_ID } from '../../core/campaign/galaxy/index.js';
  import { COMPANY_EMBLEM_COUNT } from '../../core/campaign/company/types.js';
  import { foundCompany } from '../../core/campaign/company/founding.js';
  import { recordChassisDef } from '../../core/campaign/mech/MechRecord.js';
  import { Rng } from '../../core/rng/index.js';
  import { weapon } from '../../core/data/tables.js';
  import { tr } from '../../core/log/index.js';
  import type { ChassisDef } from '../../core/data/schema.js';
  import type { CampaignMode } from '../../core/campaign/state.js';
  import { campaign } from '../state/campaign.svelte.js';
  import { cbills, currentLanguage, t } from '../i18n/index.js';
  import CompanyEmblem from '../components/CompanyEmblem.svelte';

  /**
   * Основание отряда.
   *
   * Стартовый состав НЕ собирается здесь: его собирает ядро
   * (`company/founding.ts::foundCompany`) — чистая функция от сида. Экран
   * только показывает, что из этого сида вышло, и даёт сид перебросить. До
   * шага 16a такой сборки в ядре не было вовсе, и третьей её копией стал бы
   * ровно этот компонент — то есть выдумывание стартового баланса в разметке.
   */

  let emblem = $state(0);
  /** Режим кампании (шаг 74). По умолчанию — стандарт. */
  let mode = $state<CampaignMode>('standard');
  const MODES: readonly CampaignMode[] = ['standard', 'sandbox'];
  /**
   * Сид СЛУЧАЕН ПРИ КАЖДОМ ОТКРЫТИИ (правка 2026-09-10).
   *
   * До этой правки здесь стояло фиксированное число, и каждая новая кампания
   * начиналась одной и той же ротой с одними и теми же тремя пилотами. Пока
   * пилоты были безымянными середняками, это не читалось; теперь стартовая
   * тройка тянется той же таблицей, что и найм, — и «может кому-то повезёт и
   * сразу выпадет клановый» работает, только если сид каждый раз новый.
   *
   * Случайность тут законна и ровно в одном месте: она не входит в состояние, а
   * только выбирает, с какого сида оно начнётся. Игрок видит число и может
   * вписать своё — тот же сид даёт ту же роту.
   */
  const initialSeed = randomSeed();
  let seed = $state(initialSeed);

  /**
   * Названия роты и позывные командира для кубика — пулы `names.json` на языке
   * интерфейса. Бросает сидированный `Rng` от начального сида, а не
   * `Math.random`: случайность экрана так и остаётся в одном месте — в сиде.
   * Новый сид имя не трогает: его игрок мог уже вписать сам.
   */
  const nameRng = new Rng(initialSeed);
  const english = currentLanguage() === 'en';
  const companyPool = english ? NAMES.companyNamesEn : NAMES.companyNames;
  const commanderPool = english ? NAMES.commanderNamesEn : NAMES.commanderNames;

  /** Другое имя из пула: текущее исключено, иначе кубик порой «не срабатывал» бы. */
  function rollFrom(pool: readonly string[], current: string): string {
    const rest = pool.filter((x) => x !== current);
    return nameRng.pick(rest.length > 0 ? rest : pool);
  }

  let name = $state(rollFrom(companyPool, ''));
  let commander = $state(rollFrom(commanderPool, ''));

  /** Предпросмотр стартовой роты: тот же вызов ядра, что сделает конструктор кампании. */
  const preview = $derived(foundCompany(seed >>> 0, { commander }));

  /**
   * Оружие, с которым машина придёт в роту, — строкой под названием. `def` собран
   * из уже урезанной сборки (`stripOutfit`), поэтому снятые установки сюда не
   * попадают. Одинаковые орудия — одной записью с числом, как на складе мехлаба.
   */
  function weaponsLine(def: ChassisDef): string {
    const counts = new Map<string, number>();
    for (const m of def.mounts) counts.set(m.weapon, (counts.get(m.weapon) ?? 0) + 1);
    if (counts.size === 0) return t('company.mechNoWeapons');
    const list = [...counts].map(([id, n]) => {
      const name = tr(weapon(id).key);
      return n > 1 ? `${name} × ${n}` : name;
    });
    return list.join(', ');
  }

  const startSystem = $derived(GALAXY.name(GALAXY.require(START_SYSTEM_ID)));

  /**
   * Игрок явно попросил другой сид — законное место для случайности: она не
   * попадает в состояние, а только выбирает, с какого сида оно начнётся.
   */
  function randomSeed(): number {
    return Math.floor(Math.random() * 90_000_000) + 10_000_000;
  }

  function reroll(): void {
    seed = randomSeed();
  }

  function start(): void {
    campaign.newCampaign({ name, commander, emblem, seed: seed >>> 0, mode });
  }
</script>

<div class="setup">
  <div class="panel sheet">
    <div class="panel-header">
      <span>{t('company.title')}</span>
      <span class="badge badge-dim">{startSystem}</span>
    </div>

    <div class="panel-body body">
      <div class="two">
        <div class="field">
          <label for="company-name">{t('company.name')}</label>
          <div class="name-row">
            <input id="company-name" type="text" bind:value={name} maxlength="40" />
            <button
              type="button"
              class="dice-btn"
              onclick={() => (name = rollFrom(companyPool, name))}
              title={t('company.randomName')}
              aria-label={t('company.randomName')}
            >
              🎲
            </button>
          </div>
        </div>
        <div class="field">
          <label for="company-commander">{t('company.commander')}</label>
          <div class="name-row">
            <input id="company-commander" type="text" bind:value={commander} maxlength="24" />
            <button
              type="button"
              class="dice-btn"
              onclick={() => (commander = rollFrom(commanderPool, commander))}
              title={t('company.randomCommander')}
              aria-label={t('company.randomCommander')}
            >
              🎲
            </button>
          </div>
        </div>
      </div>

      <div class="field">
        <label for="company-seed">{t('company.seed')}</label>
        <div class="seed-row">
          <input id="company-seed" type="number" bind:value={seed} min="1" />
          <button class="btn btn-sm" onclick={reroll}>{t('company.randomSeed')}</button>
        </div>
        <span class="dim small">{t('company.seedHint')}</span>
      </div>

      <div class="field">
        <span class="label-like">{t('company.emblem')}</span>
        <div class="emblems">
          {#each Array.from({ length: COMPANY_EMBLEM_COUNT }, (_, i) => i) as i (i)}
            <button class="emb" class:active={emblem === i} onclick={() => (emblem = i)}>
              <CompanyEmblem index={i} size={44} />
            </button>
          {/each}
        </div>
      </div>

      <!-- РЕЖИМ ИГРЫ (шаг 74). Выбирается один раз: сменить его командой
           нельзя, иначе песочница стала бы кнопкой «деньги» посреди стандарта. -->
      <div class="field">
        <span class="label-like">{t('company.mode')}</span>
        <div class="seed-row">
          {#each MODES as m (m)}
            <button class="btn btn-sm" class:btn-primary={mode === m} onclick={() => (mode = m)}>
              {m === 'standard' ? t('company.modeStandard') : t('company.modeSandbox')}
            </button>
          {/each}
        </div>
        <span class="dim small">
          {mode === 'standard'
            ? t('company.modeStandardHint')
            : t('company.modeSandboxHint', { sum: cbills(ECONOMY.sandbox.loanStep) })}
        </span>
      </div>

      <section class="pack">
        <div class="sec-title">{t('company.startPack')}</div>
        <p class="dim small">
          {t('company.startPackDesc', {
            cbills: cbills(ECONOMY.company.startingCbills),
            system: startSystem,
          })}
        </p>
        <div class="roster">
          {#each preview.mechs as m, i (m.id)}
            {@const def = recordChassisDef(m)}
            <div class="kv">
              <!-- Имя целиком, а не позывной: стартовая тройка теперь тянется
                   той же таблицей, что и найм, и КТО достался — это первое,
                   что игрок про свою роту узнаёт. -->
              <span class="kv-k">{preview.pilots[i]?.name ?? ''}</span>
              <span class="kv-v">
                <span class="strong">{m.name}</span>
                <span class="dim small">({m.assembly.chassisCode} · {def.tons} {t('common.tons')})</span>
              </span>
              <!-- Вне .kv-v: та обрезает строку многоточием, а список оружия
                   должен читаться целиком и переноситься. -->
              <span class="weapons small">{weaponsLine(def)}</span>
            </div>
          {/each}
        </div>
        <p class="gold small">{t('company.startPackWarn')}</p>
      </section>

      <div class="actions">
        {#if campaign.started}
          <button class="btn" onclick={() => (campaign.screen = 'hangar')}>{t('common.cancel')}</button>
          <span class="danger small">{t('company.danger')}</span>
        {:else}
          <button class="btn" onclick={() => campaign.toMenu()}>{t('common.back')}</button>
        {/if}
        <button class="btn btn-gold start" onclick={start}>{t('company.start')}</button>
      </div>
    </div>
  </div>
</div>

<style>
  .setup {
    display: flex;
    justify-content: center;
    height: 100%;
    padding: 14px;
    overflow-y: auto;
  }
  .sheet {
    width: 660px;
    max-width: 100%;
    height: fit-content;
  }
  .body {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .two {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
  }
  .label-like {
    font-family: var(--font-display);
    font-size: 11.5px;
    font-weight: 700;
    letter-spacing: 1px;
    text-transform: uppercase;
    color: var(--color-text-dim);
  }
  .name-row {
    display: flex;
    gap: 6px;
    align-items: center;
  }
  .name-row input {
    flex: 1;
    min-width: 0;
  }
  .dice-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    padding: 0;
    font-size: 16px;
    line-height: 1;
    background: var(--color-panel-sub);
    border: 1px solid var(--color-border);
    cursor: pointer;
    border-radius: 2px;
    transition: all 0.15s ease;
    flex-shrink: 0;
  }
  .dice-btn:hover {
    border-color: var(--color-accent);
    background: rgba(57, 197, 187, 0.14);
    box-shadow: 0 0 8px var(--glow-cyan);
    color: #fff;
  }
  .dice-btn:active {
    transform: translateY(1px);
  }
  .seed-row {
    display: flex;
    gap: 8px;
  }
  .seed-row input {
    flex: 1;
  }
  .emblems {
    display: grid;
    grid-template-columns: repeat(8, 1fr);
    gap: 6px;
  }
  .emb {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 4px;
    background: var(--color-panel-sub);
    border: 1px solid var(--color-border);
    border-radius: 2px;
    cursor: pointer;
  }
  .emb:hover {
    border-color: var(--color-border-active);
  }
  .emb.active {
    border-color: var(--color-accent);
    background: rgba(57, 197, 187, 0.14);
    box-shadow: 0 0 10px var(--glow-cyan);
  }
  .pack {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 11px 13px;
    background: var(--color-panel-sub);
    border: 1px solid var(--color-border);
    border-radius: 2px;
  }
  .roster {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
    gap: 6px;
  }
  .weapons {
    color: var(--color-text-dim);
    line-height: 1.35;
    overflow-wrap: anywhere;
  }
  .actions {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .start {
    margin-left: auto;
    padding: 11px 20px;
  }
  .small {
    font-size: 10.5px;
  }
  p {
    margin: 0;
    line-height: 1.5;
  }
</style>
