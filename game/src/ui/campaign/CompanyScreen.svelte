<script lang="ts">
  import { dateOf } from '../../core/campaign/clock.js';
  import { fleetTonnage } from '../../core/campaign/company/types.js';
  import { ACHIEVEMENTS, ECONOMY } from '../../core/data/index.js';
  import { campaign } from '../state/campaign.svelte.js';
  import { cbills, days as daysText, formatDate, t } from '../i18n/index.js';
  import AchievementBadge from '../components/AchievementBadge.svelte';
  import CompanyEmblem from '../components/CompanyEmblem.svelte';
  import { achievementHint, achievementName } from './achievements.js';

  /**
   * Рота: кто мы, чем платим и как унести кампанию с собой.
   *
   * Экспорт и импорт стоят ЗДЕСЬ, а не в настройках, и это следствие поставки
   * сайтом (решение 2026-09-02): кампания живёт в IndexedDB браузера и
   * пропадает вместе с очисткой данных сайта. Файл — не «резервная копия на
   * всякий случай», а единственный способ унести кампанию на другую машину.
   *
   * Герб и позывной командира здесь только показываются: сменить их командой
   * нельзя, потому что такой команды в ядре нет. Заводить её ради косметики
   * значило бы поднять версию правил второй раз за шаг.
   */

  let name = $state(campaign.companyName);

  const upkeep = $derived({
    ship: campaign.dropshipDef.shipRent,
    pilots: campaign.pilots.length * ECONOMY.payroll.pilotSalary,
    fleet: Math.round(fleetTonnage(campaign.state.company) * ECONOMY.payroll.mechUpkeepPerTon),
  });

  /** Когда очередь суток спишет содержание в следующий раз. */
  const nextPayroll = $derived.by(() => {
    for (const e of campaign.state.queue) {
      if (e.task.kind === 'payroll') return Math.max(0, e.day - campaign.day);
    }
    return 0;
  });

  /** Открытые достижения: id → день открытия (шаг 69). */
  const opened = $derived(new Map(campaign.achievements.unlocked.map((e) => [e.id, e.day])));

  const renameCmd = $derived({ kind: 'setCompanyName', name } as const);

  /** Кредиты песочницы (шаг 74): команды без параметров, отказ объясняет ядро. */
  const takeLoanCmd = { kind: 'takeSandboxLoan' } as const;
  const repayLoanCmd = { kind: 'repaySandboxLoan' } as const;
  const sandbox = $derived(campaign.state.mode === 'sandbox');

  let fileInput = $state<HTMLInputElement | null>(null);

  async function pick(event: Event): Promise<void> {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (file === undefined) return;
    if (await campaign.importFile(file)) name = campaign.companyName;
  }
</script>

<div class="company">
  <section class="panel sheet">
    <div class="panel-header">
      <span>{t('companyTab.title')}</span>
      <span class="badge badge-dim">{t('header.day', { day: campaign.day })}</span>
    </div>

    <div class="panel-body body">
      <div class="ident">
        <CompanyEmblem index={campaign.emblem} size={72} bordered />
        <div class="ident-text">
          <div class="field">
            <label for="company-rename">{t('company.name')}</label>
            <div class="rename">
              <input id="company-rename" type="text" bind:value={name} maxlength="40" />
              <button
                class="btn btn-sm"
                disabled={campaign.why(renameCmd) !== null || name === campaign.companyName}
                onclick={() => campaign.run(renameCmd)}
              >
                {t('companyTab.rename')}
              </button>
            </div>
          </div>
          <span class="dim small">
            {t('header.commander', { callsign: campaign.commander })} · {t('header.ship')}
          </span>
        </div>
      </div>

      <div class="grid">
        <div class="kv">
          <span class="kv-k">{t('header.cbills')}</span>
          <span class="kv-v gold">{cbills(campaign.cbills)}</span>
        </div>
        <div class="kv">
          <span class="kv-k">{t('companyTab.mechs')}</span>
          <span class="kv-v">{campaign.mechs.length}</span>
        </div>
        <div class="kv">
          <span class="kv-k">{t('companyTab.pilots')}</span>
          <span class="kv-v">{campaign.pilots.length}</span>
        </div>
        <div class="kv">
          <span class="kv-k">{t('companyTab.tonnage')}</span>
          <span class="kv-v">{fleetTonnage(campaign.state.company)} {t('common.tons')}</span>
        </div>
        <div class="kv">
          <span class="kv-k">{t('rating.strength')}</span>
          <span class="kv-v cyan">{campaign.rating.total}</span>
        </div>
        <div class="kv">
          <span class="kv-k">{t('companyTab.warehouse')}</span>
          <span class="kv-v">{campaign.warehouse.length}</span>
        </div>
        <!-- СИД КАМПАНИИ (просьба пользователя 2026-09-10). Из него выведено
             всё, что бросалось: стартовая тройка пилотов, парк, галактика. Один
             и тот же сид даёт ту же роту, поэтому удачное начало можно назвать
             вслух и повторить. -->
        <div class="kv">
          <span class="kv-k">{t('companyTab.mode')}</span>
          <span class="kv-v">{sandbox ? t('company.modeSandbox') : t('company.modeStandard')}</span>
        </div>
        <div class="kv">
          <span class="kv-k">{t('companyTab.seed')}</span>
          <span class="kv-v mono" title={t('companyTab.seedHint')}>{campaign.state.seed}</span>
        </div>
      </div>

      <!-- ДОСТИЖЕНИЯ (шаг 69). Лежат в сохранении роты, а не в браузере:
           уезжают вместе с файлом кампании. Порядок — порядок данных. -->
      <div class="block">
        <div class="sec-title ach-head">
          <span>{t('companyTab.achievements')}</span>
          <span class="dim">
            {t('companyTab.achievementsCount', { got: opened.size, total: ACHIEVEMENTS.achievements.length })}
          </span>
        </div>
        <p class="dim small">{t('companyTab.achievementsHint')}</p>
        <div class="ach-grid">
          {#each ACHIEVEMENTS.achievements as def (def.id)}
            {@const day = opened.get(def.id)}
            {@const concealed = day === undefined && def.hidden}
            <div class="ach" class:ach-got={day !== undefined}>
              <AchievementBadge
                {def}
                unlocked={day !== undefined}
                size={56}
                title={concealed ? '' : achievementHint(def)}
              />
              <span class="ach-name">{concealed ? t('companyTab.achievementHidden') : achievementName(def.id)}</span>
              <span class="ach-sub dim">
                {#if day !== undefined}
                  {t('companyTab.achievementOpened', { date: formatDate(dateOf(day)) })}
                {:else if !concealed}
                  {achievementHint(def)}
                {/if}
              </span>
            </div>
          {/each}
        </div>
      </div>

      <div class="block">
        <div class="sec-title">{t('companyTab.upkeep')}</div>
        <!-- Разбор содержания по статьям: сумму считает ядро (`payrollAmount`),
             здесь показано, из чего она складывается по `economy.json`. -->
        <div class="row-kv"><span>{t('companyTab.ship')}</span><span>{cbills(upkeep.ship)}</span></div>
        <div class="row-kv"><span>{t('companyTab.salaries')}</span><span>{cbills(upkeep.pilots)}</span></div>
        <div class="row-kv"><span>{t('companyTab.fleetUpkeep')}</span><span>{cbills(upkeep.fleet)}</span></div>
        <div class="row-kv total">
          <span>{t('companyTab.total')}</span>
          <span class="gold">{cbills(campaign.upkeep)}</span>
        </div>
        <div class="row-kv">
          <span>{t('companyTab.nextPayroll')}</span>
          <span class:danger={campaign.cbills < campaign.upkeep}>{daysText(nextPayroll)}</span>
        </div>
        {#if campaign.bankrupt}
          <p class="danger small">{t('header.bankrupt')}</p>
        {/if}
      </div>

      {#if sandbox}
        {@const step = cbills(ECONOMY.sandbox.loanStep)}
        {@const takeWhy = campaign.why(takeLoanCmd)}
        {@const repayWhy = campaign.why(repayLoanCmd)}
        <div class="block">
          <div class="sec-title">{t('companyTab.sandboxLoans')}</div>
          <p class="dim small">{t('companyTab.sandboxHint', { sum: step })}</p>
          <div class="row-kv">
            <span>{t('companyTab.sandboxDebt')}</span>
            <span class="gold">{cbills(campaign.state.company.sandboxDebt ?? 0)}</span>
          </div>
          <div class="save-row">
            <button
              class="btn btn-sm"
              disabled={takeWhy !== null}
              title={takeWhy ?? ''}
              onclick={() => campaign.run(takeLoanCmd)}
            >
              {t('companyTab.sandboxTake', { sum: step })}
            </button>
            <button
              class="btn btn-sm"
              disabled={repayWhy !== null}
              title={repayWhy ?? ''}
              onclick={() => campaign.run(repayLoanCmd)}
            >
              {t('companyTab.sandboxRepay', { sum: step })}
            </button>
          </div>
        </div>
      {/if}

      <div class="block">
        <div class="sec-title">{t('companyTab.save')}</div>
        <p class="dim small">{t('save.exportHint')}</p>
        <div class="save-row">
          <button class="btn btn-primary" onclick={() => campaign.exportFile()}>{t('save.export')}</button>
          <button class="btn" onclick={() => fileInput?.click()}>{t('save.import')}</button>
          <button class="btn btn-sm" onclick={() => void campaign.save()} disabled={campaign.saving}>
            {t('header.save')}
          </button>
        </div>
        {#if campaign.notice !== null}<p class="danger small">{campaign.notice}</p>{/if}
        {#if campaign.storageFailed}<p class="gold small">{t('app.menu.storageFailed')}</p>{/if}
        <input
          bind:this={fileInput}
          class="hidden-input"
          type="file"
          accept="application/json,.json"
          onchange={(e) => void pick(e)}
        />
      </div>

      <div class="block danger-block">
        <div class="sec-title">{t('companyTab.restart')}</div>
        <p class="dim small">{t('company.danger')}</p>
        <button class="btn btn-danger btn-sm" onclick={() => (campaign.screen = 'setup')}>
          {t('app.menu.newCampaign')}
        </button>
      </div>
    </div>
  </section>
</div>

<style>
  .mono {
    font-family: monospace;
    letter-spacing: 0.04em;
  }
  .company {
    display: flex;
    justify-content: center;
    height: 100%;
    padding: 12px;
    overflow-y: auto;
  }
  .sheet {
    width: 720px;
    max-width: 100%;
    height: fit-content;
  }
  .body {
    display: flex;
    flex-direction: column;
    gap: 13px;
  }
  .ident {
    display: flex;
    gap: 16px;
    align-items: center;
  }
  .ident-text {
    display: flex;
    flex-direction: column;
    gap: 6px;
    flex: 1;
    min-width: 0;
  }
  .rename {
    display: flex;
    gap: 7px;
  }
  .rename input {
    flex: 1;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    gap: 6px;
  }
  .block {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 10px 12px;
    background: var(--color-panel-sub);
    border: 1px solid var(--color-border);
    border-radius: 2px;
  }
  .ach-head {
    display: flex;
    justify-content: space-between;
  }
  .ach-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
    gap: 10px 8px;
  }
  .ach {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    text-align: center;
  }
  .ach-name {
    font-size: 11px;
    line-height: 1.3;
    color: var(--color-text-dim);
  }
  .ach-got .ach-name {
    color: var(--color-gold);
  }
  .ach-sub {
    font-size: 9.5px;
    line-height: 1.35;
  }
  .danger-block {
    border-color: rgba(248, 81, 73, 0.4);
  }
  .total {
    border-top: 1px solid var(--color-border);
    padding-top: 5px;
    font-size: 13px;
  }
  .save-row {
    display: flex;
    flex-wrap: wrap;
    gap: 7px;
  }
  .hidden-input {
    display: none;
  }
  .small {
    font-size: 10.5px;
  }
  p {
    margin: 0;
    line-height: 1.5;
  }
</style>
