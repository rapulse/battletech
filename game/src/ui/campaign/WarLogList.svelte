<script lang="ts">
  import type { WarLine } from '../state/campaign.svelte.js';
  import { formatDate, t } from '../i18n/index.js';
  import { dateOf } from './relations.js';
  import { warLineText } from './warLineText.js';
  import { PLAYER_ACTOR_ID } from '../../core/campaign/index.js';

  /**
   * Строки сводки войны (шаг 21b, часть D; вынесено шагом 78).
   *
   * Одна лента на два экрана: вкладка «Война» показывает её целиком с фильтром, экран державы —
   * последние строки с меткой «держава». Второго журнала нет: строки те же, отбор — снаружи.
   */
  /**
   * `compact` — узкая колонка (Штаб, «Армия и фронты»): название, под ним дата, под ним текст — сетка в четыре колонки
   * там сжимала текст до слова в строку (отладка 2026-10-09).
   */
  let { lines, compact = false }: { lines: readonly WarLine[]; compact?: boolean } = $props();

  /** Строки соперников (шаг 22): у них «нападающий» — это наниматель, а `who` — имя отряда. */
  const RIVAL_KINDS = ['rivalHere', 'rivalGone', 'rivalBack', 'commission', 'regimentMoved'];
  /** Строки замысла (шаг 23) и дипломатии (шаг 83): у них нет ни разорения, ни потерь — только стороны. */
  const PLAN_KINDS = ['planDeclared', 'planDone', 'planSpent'];
  const DIPLOMACY_KINDS = ['pact', 'coalition', 'warDeclared'];

  /** Правая колонка строки: потери, разорение или «—», когда чисел у строки нет. */
  function sideText(line: WarLine): string | null {
    if (line.kind === 'commission') return t('war.commissionLoss', { lost: line.lost ?? 0 });
    if (line.kind === 'clash') {
      return t('war.clashLoss', { attacker: line.clash?.attackerLost ?? 0, defender: line.clash?.defenderLost ?? 0 });
    }
    const noNumbers =
      line.kind === 'effort' ||
      line.kind === 'policy' ||
      line.kind === 'realmLoss' ||
      line.kind === 'warEnded' ||
      line.kind === 'event' ||
      line.kind === 'revolt' ||
      line.kind === 'seceded' ||
      RIVAL_KINDS.includes(line.kind) ||
      PLAN_KINDS.includes(line.kind) ||
      DIPLOMACY_KINDS.includes(line.kind);
    return noNumbers ? null : t('war.ruinedTo', { percent: Math.round(line.ruined * 100) });
  }
</script>

{#each lines as line, i (`${line.day}-${line.systemId}-${i}`)}
  <!--
    Строка сводки — дата, ЯРЛЫК события и стрелка «от кого к кому».
    Стрелка, а не глагол, и это не про краткость: фракции в словаре
    стоят в разном роде и числе («Соколы», «Курита», «Гадюки»), и любой
    глагол согласовался бы верно ровно с одной из них. Первый вариант
    экрана писал «Гадюки занял Wetzburg» — видно на первом же скриншоте.
  -->
  {@const side = sideText(line)}
  <div
    class="entry"
    class:compact
    class:raid={line.kind === 'raid' ||
      line.kind === 'seceded' ||
      (line.kind === 'warDeclared' && line.defender === PLAYER_ACTOR_ID) ||
      (line.kind === 'revolt' && line.detail !== 'won') ||
      (line.kind === 'clash' && line.clash?.lostWorld === true)}
    class:effort={line.kind === 'effort'}
    class:rival={RIVAL_KINDS.includes(line.kind)}
    class:plan={PLAN_KINDS.includes(line.kind) || DIPLOMACY_KINDS.includes(line.kind) || line.kind === 'policy'}
    class:era={line.kind === 'event'}
    class:here={line.kind === 'rivalHere'}
    class:loss={line.kind === 'realmLoss'}
  >
    {#if compact}
      <span class="tag kind">{t(`war.kind.${line.kind}`)}</span>
      <span class="dim small">{formatDate(dateOf(line.day))}</span>
      <span class="what">{warLineText(line)}</span>
      {#if side !== null}<span class="dim small">{side}</span>{/if}
    {:else}
      <span class="dim small">{formatDate(dateOf(line.day))}</span>
      <span class="dim tiny tag">{t(`war.kind.${line.kind}`)}</span>
      <span class="what">{warLineText(line)}</span>
      <span class="dim small right">{side ?? '—'}</span>
    {/if}
  </div>
{/each}

<style>
  .entry.plan {
    background: rgba(120, 170, 255, 0.05);
  }
  .entry {
    display: grid;
    grid-template-columns: 96px 86px minmax(0, 1fr) 120px;
    gap: 8px;
    align-items: center;
    padding: 6px 10px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.04);
  }
  .tag {
    text-transform: uppercase;
    letter-spacing: 1px;
  }
  .entry.compact {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 2px;
    padding: 6px 2px;
  }
  .entry.compact .kind {
    font-family: var(--font-display);
    font-size: 11px;
    font-weight: 700;
    color: var(--color-text-dim);
  }
  .entry.compact .what {
    font-size: 11.5px;
    line-height: 1.35;
  }
  .entry.era .what {
    color: var(--color-gold);
  }
  .entry.raid .what,
  .entry.loss .what {
    color: var(--color-warn, #f85149);
  }
  .entry.effort .what {
    color: var(--color-accent);
  }
  .entry.rival .what {
    opacity: 0.75;
  }
  .entry.here .what {
    color: var(--color-warn, #f85149);
    opacity: 1;
  }
  .right {
    text-align: right;
  }
  .small {
    font-size: 11px;
  }
  .tiny {
    font-size: 10px;
  }
</style>
