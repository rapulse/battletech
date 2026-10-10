<script lang="ts">
  import { onMount } from 'svelte';
  import type { WikiDoc, WikiSection } from '../../wiki/wikiData.js';
  import { t } from '../i18n/index.js';

  interface Props {
    readonly doc: WikiDoc;
    readonly targetHash?: string;
    readonly onNavigate: (docId: string, hash?: string) => void;
  }

  const { doc, targetHash, onNavigate }: Props = $props();

  let containerEl = $state<HTMLElement | null>(null);
  let copied = $state(false);

  // Фильтруем секции для оглавления (только H2 и H3)
  const tocSections = $derived(
    doc.sections.filter((s) => s.level >= 2 && s.level <= 3)
  );

  onMount(() => {
    const el = containerEl;
    if (!el) return;
    el.addEventListener('click', handleContainerClick);
    return () => {
      el.removeEventListener('click', handleContainerClick);
    };
  });

  // Скролл к якорю при смене targetHash или документа
  $effect(() => {
    if (!containerEl) return;
    if (targetHash) {
      setTimeout(() => {
        const cleanHash = targetHash.replace(/^#/, '');
        const target = containerEl?.querySelector(`#${CSS.escape(cleanHash)}`);
        if (target) {
          target.scrollIntoView({ behavior: 'smooth', block: 'start' });
          target.classList.add('wiki-target-highlight');
          setTimeout(() => target.classList.remove('wiki-target-highlight'), 1800);
        }
      }, 50);
    } else {
      containerEl.scrollTo({ top: 0, behavior: 'instant' });
    }
  });

  function handleContainerClick(e: MouseEvent): void {
    const target = (e.target as HTMLElement).closest('a');
    if (!target) return;

    // Внутренняя ссылка на документ вики
    const wikiDoc = target.getAttribute('data-wiki-doc');
    const wikiHash = target.getAttribute('data-wiki-hash') ?? undefined;
    if (wikiDoc) {
      e.preventDefault();
      onNavigate(wikiDoc, wikiHash);
      return;
    }

    const href = target.getAttribute('href');
    if (href) {
      const matchDoc = href.match(/[?&]doc=([^&#]+)/);
      if (matchDoc?.[1]) {
        e.preventDefault();
        const hashMatch = href.match(/#([^&]+)/);
        onNavigate(decodeURIComponent(matchDoc[1]), hashMatch?.[1]);
        return;
      }
    }
    if (href && href.startsWith('#')) {
      e.preventDefault();
      const cleanHash = href.replace(/^#/, '');
      const targetEl = containerEl?.querySelector(`#${CSS.escape(cleanHash)}`);
      if (targetEl) {
        targetEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
        targetEl.classList.add('wiki-target-highlight');
        setTimeout(() => targetEl.classList.remove('wiki-target-highlight'), 1800);
      }
    }
  }

  function scrollToSection(s: WikiSection): void {
    const targetEl = containerEl?.querySelector(`#${CSS.escape(s.id)}`);
    if (targetEl) {
      targetEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
      targetEl.classList.add('wiki-target-highlight');
      setTimeout(() => targetEl.classList.remove('wiki-target-highlight'), 1800);
    }
  }

  async function copyRawMarkdown(): Promise<void> {
    try {
      await navigator.clipboard.writeText(doc.raw);
      copied = true;
      setTimeout(() => (copied = false), 2000);
    } catch {
      // Игнорируем ошибку буфера обмена
    }
  }
</script>

<div class="viewer-layout">
  <!-- Основная колонка статьи -->
  <main
    bind:this={containerEl}
    class="doc-content-scroll"
  >
    <div class="doc-inner">
      <!-- Навигационная цепочка (хлебные крошки) -->
      <nav class="breadcrumbs">
        <span class="crumb dim">WIKI</span>
        <span class="crumb-sep dim">/</span>
        {#if doc.category}
          {#each doc.category.split('/') as segment}
            <span class="crumb dim">{segment}</span>
            <span class="crumb-sep dim">/</span>
          {/each}
        {/if}
        <span class="crumb current">{doc.filename}</span>

        <div class="actions">
          <button
            type="button"
            class="btn btn-sm action-btn"
            onclick={copyRawMarkdown}
            title={t('wiki.copySource')}
          >
            {copied ? t('wiki.copied') : t('wiki.sourceMd')}
          </button>
        </div>
      </nav>

      <!-- Отрендеренный контент -->
      <article class="markdown-body">
        {@html doc.html}
      </article>

      <footer class="doc-footer">
        <span class="dim">{t('wiki.docId', { id: doc.id })}</span>
        <button
          type="button"
          class="btn btn-sm"
          onclick={() => containerEl?.scrollTo({ top: 0, behavior: 'smooth' })}
        >
          {t('wiki.toTop')}
        </button>
      </footer>
    </div>
  </main>

  <!-- Правая колонка: оглавление документа (TOC) -->
  {#if tocSections.length > 1}
    <aside class="toc-sidebar">
      <div class="toc-header">
        <span class="toc-title">{t('wiki.toc')}</span>
        <span class="badge badge-dim">{tocSections.length}</span>
      </div>
      <ul class="toc-list">
        {#each tocSections as s}
          <li class="toc-item level-{s.level}">
            <button
              type="button"
              class="toc-link"
              onclick={() => scrollToSection(s)}
            >
              {s.title}
            </button>
          </li>
        {/each}
      </ul>
    </aside>
  {/if}
</div>

<style>
  .viewer-layout {
    display: flex;
    flex: 1;
    height: 100%;
    overflow: hidden;
    position: relative;
  }

  .doc-content-scroll {
    flex: 1;
    height: 100%;
    overflow-y: auto;
    padding: 24px 32px;
    background: #0d1117;
  }

  .doc-inner {
    max-width: 860px;
    margin: 0 auto;
    padding-bottom: 60px;
  }

  /* Хлебные крошки */
  .breadcrumbs {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 20px;
    padding-bottom: 10px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    font-family: var(--font-mono);
    font-size: 11px;
  }

  .crumb.current {
    color: var(--color-accent);
    font-weight: 600;
  }

  .crumb-sep {
    opacity: 0.4;
  }

  .actions {
    margin-left: auto;
  }

  .action-btn {
    font-size: 10.5px;
    padding: 2px 8px;
  }

  /* Стилизация Markdown */
  .markdown-body {
    font-family: var(--font-mono);
    font-size: 13.5px;
    line-height: 1.65;
    color: #c9d1d9;
    user-select: text;
  }

  .markdown-body :global(h1) {
    font-family: var(--font-display);
    font-size: 26px;
    font-weight: 800;
    letter-spacing: 0.8px;
    color: #ffffff;
    margin: 0 0 16px;
    padding-bottom: 8px;
    border-bottom: 1px solid var(--color-border);
  }

  .markdown-body :global(h2) {
    font-family: var(--font-display);
    font-size: 20px;
    font-weight: 700;
    color: var(--color-accent);
    margin: 32px 0 12px;
    padding-bottom: 6px;
    border-bottom: 1px solid rgba(57, 197, 187, 0.2);
    position: relative;
  }

  .markdown-body :global(h3) {
    font-family: var(--font-display);
    font-size: 16px;
    font-weight: 700;
    color: var(--color-gold);
    margin: 24px 0 8px;
  }

  .markdown-body :global(h4) {
    font-size: 13.5px;
    font-weight: 700;
    color: #ffffff;
    margin: 16px 0 6px;
  }

  .markdown-body :global(p) {
    margin: 0 0 14px;
  }

  .markdown-body :global(ul),
  .markdown-body :global(ol) {
    margin: 0 0 14px;
    padding-left: 24px;
  }

  .markdown-body :global(li) {
    margin-bottom: 6px;
  }

  .markdown-body :global(hr) {
    border: none;
    border-top: 1px solid var(--color-border);
    margin: 28px 0;
  }

  /* Ссылки */
  .markdown-body :global(a) {
    color: var(--color-accent);
    text-decoration: underline;
    text-underline-offset: 3px;
    transition: color 0.15s ease;
  }

  .markdown-body :global(a:hover) {
    color: #58a6ff;
  }

  .markdown-body :global(.wiki-anchor-link) {
    color: #484f58;
    text-decoration: none;
    font-size: 14px;
    margin-right: 4px;
    opacity: 0.4;
    transition: opacity 0.15s;
  }

  .markdown-body :global(.wiki-heading:hover .wiki-anchor-link) {
    opacity: 1;
    color: var(--color-accent);
  }

  .markdown-body :global(.ext-icon) {
    font-size: 11px;
    margin-left: 3px;
    display: inline-block;
  }

  /* Код */
  .markdown-body :global(code) {
    font-family: var(--font-mono);
    font-size: 12px;
    background: #161b22;
    padding: 2px 6px;
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 3px;
    color: #ff7b72;
  }

  .markdown-body :global(pre) {
    background: #161b22;
    border: 1px solid var(--color-border);
    border-radius: 4px;
    padding: 14px;
    overflow-x: auto;
    margin: 0 0 16px;
  }

  .markdown-body :global(pre code) {
    background: transparent;
    border: none;
    padding: 0;
    color: #e6edf3;
    font-size: 12px;
  }

  /* Таблицы */
  .markdown-body :global(.wiki-table-wrap) {
    overflow-x: auto;
    margin: 16px 0 20px;
    border: 1px solid var(--color-border);
    border-radius: 3px;
  }

  .markdown-body :global(table) {
    width: 100%;
    border-collapse: collapse;
    font-size: 12px;
    text-align: left;
  }

  .markdown-body :global(th) {
    background: #161b22;
    color: #ffffff;
    font-weight: 700;
    padding: 8px 12px;
    border-bottom: 2px solid var(--color-border);
    white-space: nowrap;
  }

  .markdown-body :global(td) {
    padding: 8px 12px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  }

  .markdown-body :global(tr:hover td) {
    background: rgba(255, 255, 255, 0.025);
  }

  /* Блоки предупреждений (Alerts) */
  .markdown-body :global(.wiki-alert) {
    margin: 16px 0;
    padding: 12px 14px;
    border-left: 4px solid var(--color-accent);
    background: rgba(57, 197, 187, 0.06);
    border-radius: 0 3px 3px 0;
  }

  .markdown-body :global(.wiki-alert-note) {
    border-left-color: #58a6ff;
    background: rgba(88, 166, 255, 0.07);
  }

  .markdown-body :global(.wiki-alert-tip) {
    border-left-color: #3fb950;
    background: rgba(63, 185, 80, 0.07);
  }

  .markdown-body :global(.wiki-alert-important) {
    border-left-color: #a371f7;
    background: rgba(163, 113, 247, 0.07);
  }

  .markdown-body :global(.wiki-alert-warning) {
    border-left-color: var(--color-gold);
    background: rgba(227, 179, 65, 0.07);
  }

  .markdown-body :global(.wiki-alert-caution) {
    border-left-color: var(--color-danger);
    background: rgba(248, 81, 73, 0.07);
  }

  .markdown-body :global(.wiki-alert-header) {
    margin-bottom: 6px;
  }

  .markdown-body :global(.wiki-alert-badge) {
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.8px;
  }

  .markdown-body :global(.wiki-alert-body p) {
    margin: 0;
  }

  /* Подсветка целевого элемента при переходе по якорю */
  .markdown-body :global(.wiki-target-highlight) {
    animation: target-pulse 1.8s ease-out;
  }

  @keyframes target-pulse {
    0% {
      background: rgba(57, 197, 187, 0.3);
    }
    100% {
      background: transparent;
    }
  }

  /* Подвал статьи */
  .doc-footer {
    margin-top: 40px;
    padding-top: 16px;
    border-top: 1px solid var(--color-border);
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 11px;
  }

  /* Сайдбар оглавления (TOC) */
  .toc-sidebar {
    width: 220px;
    flex-shrink: 0;
    height: 100%;
    overflow-y: auto;
    padding: 24px 16px;
    background: #0a0d12;
    border-left: 1px solid var(--color-border);
  }

  .toc-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 12px;
    padding-bottom: 6px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  }

  .toc-title {
    font-family: var(--font-display);
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.8px;
    color: var(--color-text-dim);
  }

  .toc-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .toc-item.level-3 {
    padding-left: 10px;
  }

  .toc-link {
    background: none;
    border: none;
    padding: 3px 6px;
    color: #8b949e;
    font-family: var(--font-mono);
    font-size: 11px;
    line-height: 1.35;
    text-align: left;
    cursor: pointer;
    border-radius: 2px;
    width: 100%;
    transition: all 0.12s ease;
  }

  .toc-link:hover {
    color: var(--color-accent);
    background: rgba(255, 255, 255, 0.03);
  }

  @media (max-width: 1000px) {
    .toc-sidebar {
      display: none;
    }
  }
</style>
