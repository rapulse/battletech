<script lang="ts">
  import type { WikiTreeNode } from '../../wiki/wikiData.js';
  import WikiTree from './WikiTree.svelte';
  import { hasKey, t } from '../i18n/index.js';

  interface Props {
    readonly nodes: readonly WikiTreeNode[];
    readonly activeDocId: string;
    readonly onSelect: (docId: string) => void;
  }

  const { nodes, activeDocId, onSelect }: Props = $props();

  // Состояние развёрнутых папок
  let openFolders = $state<Record<string, boolean>>({
    overview: true,
    design: true,
    'design/combat': true,
    'design/campaign': true,
    'design/mechs': true,
    'design/pilots': true,
  });

  function toggleFolder(path: string, e: MouseEvent): void {
    e.stopPropagation();
    openFolders[path] = !(openFolders[path] ?? false);
  }

  function formatTitle(node: WikiTreeNode): string {
    if (node.isDir) {
      // Папка без подписи в словаре показывается своим именем на диске.
      const key = `wiki.folder.${node.path}`;
      return hasKey(key) ? t(key) : node.name;
    }
    return node.title ?? node.name;
  }
</script>

<ul class="tree-list">
  {#each nodes as node (node.path)}
    {#if node.isDir}
      {@const isOpen = openFolders[node.path] ?? false}
      <li class="tree-dir">
        <button
          type="button"
          class="dir-button"
          onclick={(e) => toggleFolder(node.path, e)}
        >
          <span class="dir-icon">{isOpen ? '▾' : '▸'}</span>
          <span class="dir-label">{formatTitle(node)}</span>
          <span class="dir-meta dim">/{node.name}</span>
        </button>
        {#if isOpen && node.children}
          <div class="dir-children">
            <WikiTree
              nodes={node.children}
              {activeDocId}
              {onSelect}
            />
          </div>
        {/if}
      </li>
    {:else}
      {@const isActive = activeDocId === node.path}
      <li class="tree-file">
        <button
          type="button"
          class="file-button"
          class:active={isActive}
          onclick={() => onSelect(node.path)}
        >
          <span class="file-bullet" class:active={isActive}>•</span>
          <span class="file-title">{node.title ?? node.name}</span>
          {#if node.name === 'README.md' || node.name === 'glossary.md'}
            <span class="badge badge-dim pin">core</span>
          {/if}
        </button>
      </li>
    {/if}
  {/each}
</ul>

<style>
  .tree-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .tree-dir {
    display: flex;
    flex-direction: column;
  }

  .dir-button {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 5px 8px;
    background: transparent;
    border: none;
    border-radius: 2px;
    color: var(--color-text);
    font-family: var(--font-mono);
    font-size: 11.5px;
    font-weight: 600;
    text-align: left;
    cursor: pointer;
    transition: background 0.12s ease;
  }

  .dir-button:hover {
    background: rgba(255, 255, 255, 0.04);
  }

  .dir-icon {
    font-size: 10px;
    width: 10px;
    color: var(--color-accent);
    text-align: center;
  }

  .dir-label {
    flex: 1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .dir-meta {
    font-size: 9.5px;
    opacity: 0.6;
    font-weight: 400;
  }

  .dir-children {
    padding-left: 12px;
    margin-left: 5px;
    border-left: 1px solid rgba(255, 255, 255, 0.08);
    display: flex;
    flex-direction: column;
    gap: 2px;
    margin-top: 2px;
    margin-bottom: 4px;
  }

  .tree-file {
    display: flex;
  }

  .file-button {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 8px;
    background: transparent;
    border: 1px solid transparent;
    border-radius: 2px;
    color: #8b949e;
    font-family: var(--font-mono);
    font-size: 11px;
    text-align: left;
    cursor: pointer;
    transition: all 0.12s ease;
    white-space: nowrap;
    overflow: hidden;
  }

  .file-button:hover {
    color: var(--color-text);
    background: rgba(255, 255, 255, 0.03);
  }

  .file-button.active {
    color: #ffffff;
    background: rgba(57, 197, 187, 0.12);
    border-color: rgba(57, 197, 187, 0.4);
    font-weight: 600;
  }

  .file-bullet {
    color: #484f58;
    font-size: 12px;
  }

  .file-bullet.active {
    color: var(--color-accent);
  }

  .file-title {
    flex: 1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .pin {
    font-size: 8.5px;
    padding: 0 4px;
  }
</style>
