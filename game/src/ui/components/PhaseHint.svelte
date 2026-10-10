<script lang="ts">
  import { battle } from '../state/battle.svelte.js';
  import { Phase } from '../../core/model/index.js';
  import { MoveMode } from '../../core/map/index.js';
  import { offeredMoveModes } from '../../core/rules/index.js';
  import { t, tParts, type TPart } from '../i18n/index.js';

  /*
    Подсказка новичку по текущей фазе. Живёт отдельно от карточки машины, под
    легендой: карточка — про машину, подсказка — про порядок хода. Слова о
    выборе режима появляются, только если выбор есть (`offeredMoveModes`).
  */
  const MODE_WORDS: Readonly<Record<MoveMode, string>> = {
    [MoveMode.Walk]: 'battle.hint.modeWord.walk',
    [MoveMode.Run]: 'battle.hint.modeWord.run',
    [MoveMode.Jump]: 'battle.hint.modeWord.jump',
  };

  let unit = $derived(battle.selected);
  let modes = $derived(unit === undefined ? [] : offeredMoveModes(unit));

  // Кнопка внутри фразы выделяется жирным; сама фраза — одна строка словаря (`tParts`).
  // Список режимов — тоже подстановка, но обычным текстом: жирным идут только кнопки и клавиши.
  let moveParts = $derived<TPart[]>(
    modes.length > 1
      ? tParts('battle.hint.moveChoose', {
          modes: modes.map((m) => t(MODE_WORDS[m])).join('/'),
          btn: t('battle.initiative.toFire'),
        })
      : tParts('battle.hint.moveClick', { btn: t('battle.initiative.toFire') }),
  );
</script>

{#snippet phrase(parts: TPart[])}
  {#each parts as p, i (i)}{#if p.param && p.name !== 'modes'}<b>{p.text}</b>{:else}{p.text}{/if}{/each}
{/snippet}

{#if unit !== undefined && battle.commands(unit)}
  {#if battle.phase === Phase.Movement}
    {#if unit.moveMode === null}
      <div class="phase-hint move">
        🚶 <b>{t('battle.hint.moveTitle')}</b>:
        {@render phrase(moveParts)}
        <br>{@render phrase(tParts('battle.hint.turnKeys', { q: '[Q]', e: '[E]' }))}
      </div>
    {:else}
      <div class="phase-hint moved">
        {@render phrase(tParts('battle.hint.moved', { btn: t('battle.initiative.toFire') }))}
      </div>
    {/if}
  {:else if battle.phase === Phase.Attack}
    <div class="phase-hint attack">
      🎯 <b>{t('battle.hint.attackTitle')}</b>:
      {@render phrase(tParts('battle.hint.attackBody', { btn: t('battle.initiative.nextTurn') }))}
    </div>
  {:else if battle.phase === Phase.Heat}
    <div class="phase-hint heat">
      🔥 <b>{t('battle.hint.heatTitle')}</b>:
      {@render phrase(tParts('battle.hint.heatBody', { btn: t('battle.hint.nextTurnFull') }))}
    </div>
  {/if}
{/if}

<style>
  .phase-hint {
    font-family: monospace; font-size: 10px; line-height: 1.4;
    padding: 6px 8px; border-radius: 4px; flex-shrink: 0;
  }
  .phase-hint.attack {
    background: rgba(248, 81, 73, 0.12);
    border: 1px solid rgba(248, 81, 73, 0.35);
    color: #ff7b72;
  }
  .phase-hint.moved {
    background: rgba(57, 197, 187, 0.1);
    border: 1px solid rgba(57, 197, 187, 0.3);
    color: #8b949e;
  }
  .phase-hint b { color: #e6edf3; }
</style>
