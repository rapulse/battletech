<script lang="ts">
  import { getWikiSection, resolveWikiPath, type WikiSection } from '../../wiki/wikiData.js';
  import { t } from '../i18n/index.js';

  interface Props {
    readonly doc: string;
    readonly section?: string;
    readonly label?: string;
    readonly icon?: string;
    readonly align?: 'left' | 'right';
  }

  const { doc, section, label, icon = 'ℹ', align = 'left' }: Props = $props();

  let isOpen = $state(false);
  let popoverEl = $state<HTMLElement | null>(null);
  let triggerEl = $state<HTMLElement | null>(null);

  /**
   * ОКНО СПРАВКИ ПОВЕРХ ПАНЕЛЕЙ (плейтест 2026-09-15). Абсолютное окно резалось
   * панелью с `overflow: hidden` — в узком наряде мехлаба от него оставалась
   * половина. Фиксированное окно обрезке не подчиняется; место считается от
   * кнопки в момент открытия, окно не выходит за края экрана и открывается
   * вверх, если снизу не помещается. При прокрутке и смене размера окна оно
   * закрывается: иначе оторвалось бы от своей кнопки.
   */
  const POPOVER_WIDTH = 340;
  const POPOVER_HEIGHT = 380;
  const EDGE = 8;
  const GAP = 6;
  let pos = $state<{ top: number | null; bottom: number | null; left: number } | null>(null);

  function place(): void {
    if (!triggerEl) return;
    const r = triggerEl.getBoundingClientRect();
    const width = Math.min(POPOVER_WIDTH, window.innerWidth * 0.9);
    const wanted = align === 'right' ? r.right - width : r.left;
    const left = Math.max(EDGE, Math.min(wanted, window.innerWidth - width - EDGE));
    const roomBelow = window.innerHeight - r.bottom;
    pos =
      roomBelow >= POPOVER_HEIGHT || r.top < roomBelow
        ? { top: r.bottom + GAP, bottom: null, left }
        : { top: null, bottom: window.innerHeight - r.top + GAP, left };
  }

  $effect(() => {
    if (!isOpen) return;
    const onScroll = (e: Event): void => {
      // Прокрутка текста внутри самого окна его не закрывает.
      if (popoverEl && e.target instanceof Node && popoverEl.contains(e.target)) return;
      close();
    };
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', close);
    };
  });

  const info: WikiSection | null = $derived(getWikiSection(doc, section));

  function toggle(e: MouseEvent): void {
    e.stopPropagation();
    isOpen = !isOpen;
    if (isOpen) place();
  }

  function close(): void {
    isOpen = false;
  }

  function handleWindowClick(e: MouseEvent): void {
    if (isOpen && popoverEl && !popoverEl.contains(e.target as Node)) {
      close();
    }
  }

  function handleKeydown(e: KeyboardEvent): void {
    if (e.key === 'Escape' && isOpen) {
      close();
    }
  }

  function getWikiUrl(): string {
    const hash = section ? `#${section}` : '';
    return `./wiki.html?doc=${encodeURIComponent(doc)}${hash}`;
  }

  function handleBodyClick(e: MouseEvent): void {
    const a = (e.target as HTMLElement).closest('a');
    if (!a) return;
    const href = a.getAttribute('href');
    if (!href) return;

    e.preventDefault();
    close();

    let url = href;
    if (url.startsWith('#')) {
      url = `./wiki.html?doc=${encodeURIComponent(doc)}${url}`;
    } else if (!url.startsWith('http://') && !url.startsWith('https://') && !url.startsWith('./wiki.html')) {
      const [pathPart, hashPart] = href.split('#');
      const resolved = pathPart ? resolveWikiPath(doc, pathPart.endsWith('.md') ? pathPart : `${pathPart}.md`) : doc;
      const targetHash = hashPart ? `#${hashPart}` : '';
      url = `./wiki.html?doc=${encodeURIComponent(resolved)}${targetHash}`;
    }

    window.open(url, '_blank', 'noopener,noreferrer');
  }
</script>

<svelte:window onkeydown={handleKeydown} onclick={handleWindowClick} />

<span class="wiki-help-wrapper">
  <button
    bind:this={triggerEl}
    type="button"
    class="wiki-help-trigger"
    class:active={isOpen}
    onclick={toggle}
    title={info?.title ? t('wiki.helpTitle', { title: info.title }) : (label ?? t('wiki.openHelp'))}
    aria-label={t('wiki.help')}
  >
    <span class="icon">{icon}</span>
    {#if label}
      <span class="label">{label}</span>
    {/if}
  </button>

  {#if isOpen && info}
    <div
      bind:this={popoverEl}
      class="wiki-popover"
      style:top={pos?.top != null ? `${pos.top}px` : null}
      style:bottom={pos?.bottom != null ? `${pos.bottom}px` : null}
      style:left={pos ? `${pos.left}px` : null}
      role="tooltip"
    >
      <div class="popover-header">
        <span class="popover-badge">{t('wiki.helpBadge')}</span>
        <span class="popover-title">{info.title}</span>
        <button class="popover-close" onclick={close} title={t('wiki.close')}>×</button>
      </div>

      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="popover-body" onclick={handleBodyClick}>
        {#if info.html}
          {@html info.html}
        {:else}
          <p>{info.text}</p>
        {/if}
      </div>

      <div class="popover-footer">
        <a
          href={getWikiUrl()}
          target="_blank"
          rel="noopener noreferrer"
          class="wiki-link"
          onclick={close}
        >
          <span>{t('wiki.openArticle')}</span>
          <span class="arrow">↗</span>
        </a>
      </div>
    </div>
  {/if}
</span>

<style>
  .wiki-help-wrapper {
    position: relative;
    display: inline-flex;
    align-items: center;
    vertical-align: middle;
  }

  .wiki-help-trigger {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 1px 5px;
    background: rgba(57, 197, 187, 0.08);
    border: 1px solid rgba(57, 197, 187, 0.4);
    border-radius: 2px;
    color: var(--color-accent);
    font-family: var(--font-mono);
    font-size: 11px;
    line-height: 1.2;
    cursor: pointer;
    transition: all 0.15s ease;
    user-select: none;
    text-transform: none;
    letter-spacing: normal;
  }

  .wiki-help-trigger:hover,
  .wiki-help-trigger.active {
    background: rgba(57, 197, 187, 0.2);
    border-color: var(--color-accent);
    box-shadow: 0 0 6px var(--glow-cyan);
  }

  .icon {
    font-weight: 700;
    font-size: 10px;
  }

  .label {
    font-size: 10.5px;
    color: var(--color-text);
  }

  .wiki-popover {
    position: fixed;
    z-index: 1000;
    width: 340px;
    max-width: 90vw;
    background: #11151c;
    border: 1px solid var(--color-accent);
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.75), 0 0 10px rgba(57, 197, 187, 0.25);
    border-radius: 3px;
    font-family: var(--font-mono);
    text-align: left;
    animation: pop-in 0.15s ease-out;
    text-transform: none;
    letter-spacing: normal;
    font-weight: normal;
  }

  @keyframes pop-in {
    from {
      opacity: 0;
      transform: translateY(-4px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .popover-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 6px 10px;
    background: #161c24;
    border-bottom: 1px solid var(--color-border);
  }

  .popover-badge {
    font-size: 9px;
    color: var(--color-accent);
    letter-spacing: 0.5px;
    font-weight: 700;
  }

  .popover-title {
    flex: 1;
    font-size: 11.5px;
    font-weight: 600;
    color: var(--color-text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    text-transform: none;
    letter-spacing: normal;
  }

  .popover-close {
    background: none;
    border: none;
    color: var(--color-text-dim);
    font-size: 15px;
    cursor: pointer;
    padding: 0 2px;
    line-height: 1;
  }

  .popover-close:hover {
    color: var(--color-danger);
  }

  .popover-body {
    padding: 10px;
    max-height: 280px;
    overflow-y: auto;
    font-size: 11px;
    line-height: 1.45;
    color: #c9d1d9;
    text-transform: none;
    letter-spacing: normal;
  }

  .popover-body :global(p) {
    margin: 0 0 6px;
  }

  .popover-body :global(p:last-child) {
    margin-bottom: 0;
  }

  .popover-body :global(strong) {
    color: var(--color-gold);
  }

  .popover-body :global(a) {
    color: var(--color-accent);
    text-decoration: underline;
    text-underline-offset: 2px;
    transition: color 0.15s ease;
    cursor: pointer;
  }

  .popover-body :global(a:hover) {
    color: #58a6ff;
    text-decoration: underline;
  }

  .popover-footer {
    padding: 6px 10px;
    background: #0d1117;
    border-top: 1px solid var(--color-border);
    display: flex;
    justify-content: flex-end;
  }

  .wiki-link {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    color: var(--color-accent);
    text-decoration: none;
    font-size: 10.5px;
    transition: color 0.15s ease;
    text-transform: none;
    letter-spacing: normal;
  }

  .wiki-link:hover {
    color: #58a6ff;
    text-decoration: underline;
  }

  .arrow {
    font-size: 12px;
  }
</style>
