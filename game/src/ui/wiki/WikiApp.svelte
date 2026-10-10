<script lang="ts">
  import { onMount } from 'svelte';
  import {
    getAllWikiDocs,
    getWikiDoc,
    getWikiTree,
    searchWiki,
    type WikiDoc,
    type WikiSearchResult,
  } from '../../wiki/wikiData.js';
  import WikiTree from './WikiTree.svelte';
  import WikiDocViewer from './WikiDocViewer.svelte';
  import { t } from '../i18n/index.js';

  const allDocs = getAllWikiDocs();
  const tree = getWikiTree();

  let activeDocId = $state<string>('README.md');
  let targetHash = $state<string>('');
  let searchQuery = $state<string>('');
  let crt = $state<boolean>(false);

  const activeDoc: WikiDoc | undefined = $derived(
    getWikiDoc(activeDocId) ?? getWikiDoc('README.md')
  );

  const searchResults: WikiSearchResult[] = $derived(
    searchWiki(searchQuery)
  );

  // Инициализация из URL
  onMount(() => {
    parseUrlState();
    window.addEventListener('hashchange', parseUrlState);
    window.addEventListener('popstate', parseUrlState);
    return () => {
      window.removeEventListener('hashchange', parseUrlState);
      window.removeEventListener('popstate', parseUrlState);
    };
  });

  function parseUrlState(): void {
    const urlParams = new URLSearchParams(window.location.search);
    const docParam = urlParams.get('doc');
    const sectionParam = urlParams.get('section');
    const rawHash = window.location.hash.replace(/^#/, '');

    // Если в hash попал docId (например ?doc=glossary.md#design/ai.md или #design/ai.md#anchor)
    if (rawHash) {
      const [docPart, anchorPart] = rawHash.split('#');
      if (docPart && (docPart.endsWith('.md') || getWikiDoc(docPart) !== undefined)) {
        activeDocId = docPart;
        targetHash = anchorPart ? `#${anchorPart}` : '';
        return;
      }
    }

    // 1. Проверяем query params: ?doc=...&section=... (или с hash #anchor)
    if (docParam) {
      activeDocId = docParam;
      targetHash = sectionParam ? `#${sectionParam}` : (rawHash ? `#${rawHash}` : '');
      return;
    }

    // 2. Проверяем чистый hash: #design/combat/rules.md#якорь
    if (rawHash) {
      const [docPart, anchorPart] = rawHash.split('#');
      if (docPart) {
        activeDocId = docPart;
        targetHash = anchorPart ? `#${anchorPart}` : '';
        return;
      }
    }

    // По умолчанию
    activeDocId = 'README.md';
    targetHash = '';
  }

  function navigateTo(docId: string, hash?: string): void {
    activeDocId = docId;
    targetHash = hash ? (hash.startsWith('#') ? hash : `#${hash}`) : '';
    searchQuery = ''; // Сбрасываем поиск при переходе

    const cleanHash = targetHash ? targetHash : '';
    const newUrl = `./wiki.html?doc=${encodeURIComponent(docId)}${cleanHash}`;
    window.history.pushState(null, '', newUrl);
  }

  function handleSelectResult(result: WikiSearchResult): void {
    navigateTo(result.doc.id);
  }
</script>

<div class="wiki-root" class:crt>
  <!-- Верхняя панель терминала -->
  <header class="wiki-header">
    <div class="brand">
      <span class="brand-icon">❖</span>
      <span class="brand-title">{t('wiki.brand')}</span>
      <span class="badge badge-dim">3053</span>
    </div>

    <!-- Строка поиска -->
    <div class="search-box">
      <span class="search-icon">🔍</span>
      <input
        type="search"
        class="search-input"
        placeholder={t('wiki.searchPlaceholder')}
        bind:value={searchQuery}
      />
      {#if searchQuery}
        <button
          type="button"
          class="clear-btn"
          onclick={() => (searchQuery = '')}
          title={t('wiki.clear')}
        >
          ×
        </button>
      {/if}
    </div>

    <div class="header-tools">
      <button
        type="button"
        class="btn btn-sm"
        class:btn-primary={crt}
        onclick={() => (crt = !crt)}
        title={t('wiki.crt')}
      >
        CRT
      </button>

      <a href="./" class="btn btn-sm game-link" title={t('wiki.backToGameTitle')}>
        <span>{t('wiki.backToGame')}</span>
        <span class="arr">↵</span>
      </a>
    </div>
  </header>

  <!-- Основная рабочая область -->
  <div class="wiki-body">
    <!-- Левый сайдбар: навигатор по файлам или результаты поиска -->
    <aside class="sidebar">
      <div class="sidebar-header">
        <span class="sidebar-title">
          {searchQuery ? t('wiki.searchResults') : t('wiki.archive')}
        </span>
        <span class="badge badge-dim">
          {searchQuery ? searchResults.length : allDocs.length}
        </span>
      </div>

      <div class="sidebar-content">
        {#if searchQuery}
          {#if searchResults.length === 0}
            <div class="empty-search dim">
              {t('wiki.nothingFound', { query: searchQuery })}
            </div>
          {:else}
            <ul class="search-results">
              {#each searchResults as res}
                <li>
                  <button
                    type="button"
                    class="search-item"
                    class:active={activeDocId === res.doc.id}
                    onclick={() => handleSelectResult(res)}
                  >
                    <span class="res-title">{res.doc.title}</span>
                    <span class="res-cat dim">{res.doc.id}</span>
                    <span class="res-snippet dim">{res.snippet}</span>
                  </button>
                </li>
              {/each}
            </ul>
          {/if}
        {:else}
          <WikiTree
            nodes={tree}
            {activeDocId}
            onSelect={(id) => navigateTo(id)}
          />
        {/if}
      </div>
    </aside>

    <!-- Просмотр выбранного документа -->
    <section class="content-area">
      {#if activeDoc}
        <WikiDocViewer
          doc={activeDoc}
          {targetHash}
          onNavigate={(id, hash) => navigateTo(id, hash)}
        />
      {:else}
        <div class="not-found">
          <h2>{t('wiki.notFound')}</h2>
          <p class="dim">{t('wiki.notRegistered', { id: activeDocId })}</p>
          <button
            type="button"
            class="btn btn-primary"
            onclick={() => navigateTo('README.md')}
          >
            {t('wiki.toIndex')}
          </button>
        </div>
      {/if}
    </section>
  </div>
</div>

<style>
  .wiki-root {
    display: flex;
    flex-direction: column;
    width: 100vw;
    height: 100vh;
    overflow: hidden;
    background: var(--color-bg);
    color: var(--color-text);
    font-family: var(--font-mono);
  }

  /* Шапка */
  .wiki-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 8px 16px;
    background: #161b22;
    border-bottom: 1px solid var(--color-border);
    flex-shrink: 0;
  }

  .brand {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .brand-icon {
    color: var(--color-accent);
    font-size: 16px;
  }

  .brand-title {
    font-family: var(--font-display);
    font-size: 15px;
    font-weight: 700;
    letter-spacing: 1px;
    color: #ffffff;
  }

  /* Поиск */
  .search-box {
    position: relative;
    display: flex;
    align-items: center;
    width: 380px;
    max-width: 40vw;
  }

  .search-icon {
    position: absolute;
    left: 10px;
    font-size: 12px;
    opacity: 0.6;
    pointer-events: none;
  }

  .search-input {
    width: 100%;
    padding: 6px 28px 6px 30px;
    background: #0d1117;
    border: 1px solid var(--color-border);
    border-radius: 3px;
    color: #ffffff;
    font-family: var(--font-mono);
    font-size: 11.5px;
    transition: border-color 0.15s;
  }

  .search-input:focus {
    outline: none;
    border-color: var(--color-accent);
    box-shadow: 0 0 6px var(--glow-cyan);
  }

  .clear-btn {
    position: absolute;
    right: 8px;
    background: none;
    border: none;
    color: var(--color-text-dim);
    font-size: 16px;
    cursor: pointer;
    line-height: 1;
  }

  .clear-btn:hover {
    color: #ffffff;
  }

  /* Инструменты шапки */
  .header-tools {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .game-link {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    text-decoration: none;
    background: rgba(57, 197, 187, 0.1);
    border-color: var(--color-accent);
    color: var(--color-accent);
  }

  .game-link:hover {
    background: rgba(57, 197, 187, 0.2);
    color: #ffffff;
  }

  .arr {
    font-size: 13px;
    line-height: 1;
  }

  /* Тело */
  .wiki-body {
    display: flex;
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }

  /* Сайдбар */
  .sidebar {
    width: 290px;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    background: #11151c;
    border-right: 1px solid var(--color-border);
  }

  .sidebar-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 14px;
    background: #161b22;
    border-bottom: 1px solid var(--color-border);
  }

  .sidebar-title {
    font-family: var(--font-display);
    font-size: 11.5px;
    font-weight: 700;
    letter-spacing: 0.8px;
    color: var(--color-text-dim);
  }

  .sidebar-content {
    flex: 1;
    overflow-y: auto;
    padding: 8px;
  }

  /* Результаты поиска */
  .search-results {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .search-item {
    display: flex;
    flex-direction: column;
    gap: 2px;
    width: 100%;
    padding: 8px 10px;
    background: transparent;
    border: 1px solid transparent;
    border-radius: 2px;
    color: inherit;
    font-family: var(--font-mono);
    text-align: left;
    cursor: pointer;
    transition: all 0.12s ease;
  }

  .search-item:hover {
    background: rgba(255, 255, 255, 0.04);
    border-color: rgba(255, 255, 255, 0.1);
  }

  .search-item.active {
    background: rgba(57, 197, 187, 0.12);
    border-color: var(--color-accent);
  }

  .res-title {
    font-size: 12px;
    font-weight: 600;
    color: #ffffff;
  }

  .res-cat {
    font-size: 9.5px;
  }

  .res-snippet {
    font-size: 10.5px;
    line-height: 1.35;
    margin-top: 3px;
  }

  .empty-search {
    padding: 24px 12px;
    text-align: center;
    font-size: 11.5px;
  }

  /* Контентная область */
  .content-area {
    flex: 1;
    min-width: 0;
    height: 100%;
    display: flex;
    overflow: hidden;
  }

  .not-found {
    padding: 48px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 16px;
    width: 100%;
    text-align: center;
  }
</style>
