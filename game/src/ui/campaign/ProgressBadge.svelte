<script lang="ts">
  import { campaign } from '../state/campaign.svelte.js';
  import { t } from '../i18n/index.js';
  import { chapterDesc, chapterName, milestoneHint, milestoneName } from './progress.js';

  /**
   * Глава кампании в шапке и окно «куда двигаться» (шаг 70).
   *
   * Ничего не считает: главы, вехи и текущая глава — `campaignProgress` ядра
   * через стор. Это примерный план пути, а не счётчик, поэтому процента нет:
   * глава и сколько её вех выполнено.
   */

  const progress = $derived(campaign.progress);
  const current = $derived(progress.chapters[progress.current]);
  const total = $derived(progress.chapters.length);
  const doneHere = $derived(current?.milestones.filter((m) => m.done).length ?? 0);

  let open = $state(false);

  function status(i: number): 'done' | 'current' | 'ahead' | 'beyond' {
    const c = progress.chapters[i];
    if (c?.beyondVersion) return 'beyond';
    if (i === progress.current) return 'current';
    return c?.done ? 'done' : 'ahead';
  }
</script>

<svelte:window onkeydown={(e) => { if (e.key === 'Escape' && open) open = false; }} />

{#if current !== undefined}
  <button
    class="btn btn-sm progress-btn"
    data-testid="campaign-progress"
    onclick={() => (open = true)}
    title={t('progress.badgeHint')}
  >
    {t('progress.badge', { n: progress.current + 1, total, name: chapterName(current.id) })}
    {#if !current.beyondVersion}
      <span class="dim">· {doneHere}/{current.milestones.length}</span>
    {/if}
  </button>
{/if}

{#if open}
  <div
    class="modal-backdrop"
    role="presentation"
    onclick={(e) => {
      if (e.target === e.currentTarget) open = false;
    }}
  >
    <div class="modal progress-modal" role="dialog" aria-modal="true" tabindex="-1">
      <div class="panel-header progress-header">
        <span class="progress-title">{t('progress.title')}</span>
        <button class="btn btn-sm" onclick={() => (open = false)} title={t('header.logClose')}>✕</button>
      </div>

      <div class="progress-body">
        <p class="intro">{t('progress.intro')}</p>

        <ol class="chapters">
          {#each progress.chapters as chapter, i (chapter.id)}
            {@const st = status(i)}
            <li class="chapter {st}">
              <div class="chapter-head">
                <span class="mark">
                  {#if st === 'done'}✓{:else if st === 'current'}▶{:else if st === 'beyond'}🔒{:else}·{/if}
                </span>
                <span class="chapter-name">{i + 1}. {chapterName(chapter.id)}</span>
                <span class="chapter-status dim">{t(`progress.status.${st}`)}</span>
              </div>
              <p class="chapter-desc dim">{chapterDesc(chapter.id)}</p>
              <ul class="milestones">
                {#each chapter.milestones as m (m.id)}
                  <li class:done={m.done}>
                    <span class="m-mark">{m.done ? '✓' : m.beyondVersion ? '—' : '○'}</span>
                    <span class="m-name">{milestoneName(m.id)}</span>
                    {#if st === 'current' && !m.done}
                      <span class="m-hint dim">— {milestoneHint(m.id)}</span>
                    {/if}
                  </li>
                {/each}
              </ul>
              {#if st === 'beyond'}
                <p class="beyond-note gold">{t('progress.beyondVersion')}</p>
              {/if}
            </li>
          {/each}
        </ol>
      </div>
    </div>
  </div>
{/if}

<style>
  .progress-btn {
    white-space: nowrap;
  }

  .progress-modal {
    width: min(640px, 100%);
  }

  .progress-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }

  .progress-title {
    font-family: var(--font-display);
    font-size: 18px;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: var(--color-accent);
  }

  .progress-body {
    overflow-y: auto;
    padding: 12px 16px 16px;
  }

  .intro {
    margin: 0 0 12px;
  }

  .chapters {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .chapter {
    border: 1px solid var(--color-border);
    border-left-width: 3px;
    padding: 8px 10px;
    background: var(--color-panel-sub);
  }

  .chapter.done {
    border-left-color: var(--color-ok);
  }

  .chapter.current {
    border-color: var(--color-accent);
    border-left-color: var(--color-accent);
    box-shadow: 0 0 8px var(--glow-cyan);
  }

  .chapter.ahead,
  .chapter.beyond {
    opacity: 0.7;
  }

  .chapter-head {
    display: flex;
    align-items: baseline;
    gap: 8px;
  }

  .mark {
    width: 1.2em;
    text-align: center;
  }

  .chapter.done .mark {
    color: var(--color-ok);
  }

  .chapter.current .mark {
    color: var(--color-accent);
  }

  .chapter-name {
    font-weight: 600;
  }

  .chapter-status {
    margin-left: auto;
    font-size: 12px;
  }

  .chapter-desc {
    margin: 4px 0 6px;
    font-size: 13px;
  }

  .milestones {
    list-style: none;
    margin: 0;
    padding: 0 0 0 1.6em;
    font-size: 13px;
  }

  .milestones li.done .m-mark {
    color: var(--color-ok);
  }

  .m-mark {
    display: inline-block;
    width: 1.2em;
  }

  .beyond-note {
    margin: 6px 0 0;
    font-size: 13px;
  }
</style>
