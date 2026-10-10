import { marked, type Tokens } from 'marked';

/**
 * Описание секции внутри markdown-документа.
 * Используется как для навигации по статье (TOC),
 * так и для тултипов-справок в интерфейсе (Часть 2).
 */
export interface WikiSection {
  readonly id: string;
  readonly title: string;
  readonly level: number;
  readonly html: string;
  readonly text: string;
}

/**
 * Распарсенный документ вики.
 */
export interface WikiDoc {
  readonly id: string;          // e.g. "design/combat/rules.md"
  readonly title: string;       // e.g. "Правила боя"
  readonly category: string;    // e.g. "design/combat"
  readonly filename: string;    // e.g. "rules.md"
  readonly raw: string;         // Исходный текст markdown
  readonly html: string;        // Отрендеренный HTML с подсветкой и якорями
  readonly sections: readonly WikiSection[];
}

/**
 * Узел дерева каталогов для сайдбара навигации.
 */
export interface WikiTreeNode {
  readonly name: string;
  readonly path: string;
  readonly isDir: boolean;
  readonly title?: string | undefined;
  readonly children?: readonly WikiTreeNode[] | undefined;
}

/**
 * Результат полнотекстового поиска.
 */
export interface WikiSearchResult {
  readonly doc: WikiDoc;
  readonly matchField: 'title' | 'content';
  readonly snippet: string;
}

/**
 * Генерация якоря (slug) из текста заголовка.
 */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/[\s_]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Очистка markdown разметки для краткого текста тултипа.
 */
function stripMarkdown(text: string): string {
  return text
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^[#>*\s-]+/gm, '')
    .trim();
}

/**
 * Разрешение относительного пути к документу относительно текущего.
 * Например: doc="design/campaign/contracts.md", target="../combat/rules.md" -> "design/combat/rules.md"
 */
export function resolveWikiPath(currentDocId: string, targetPath: string): string {
  // Убираем якорь
  const [cleanTarget] = targetPath.split('#');
  if (!cleanTarget) return currentDocId;

  // Если абсолютный путь от корня вики
  if (cleanTarget.startsWith('/')) {
    return cleanTarget.replace(/^\/+/, '');
  }

  const parts = currentDocId.split('/');
  parts.pop(); // Убираем имя текущего файла, остаётся каталог

  for (const segment of cleanTarget.split('/')) {
    if (segment === '.' || segment === '') continue;
    if (segment === '..') {
      parts.pop();
    } else {
      parts.push(segment);
    }
  }

  return parts.join('/');
}

/**
 * Настройка кастомного рендерера marked для ссылок, заголовков и предупреждений.
 */
function createCustomRenderer(currentDocId: string) {
  const renderer = new marked.Renderer();

  // Заголовки с автоматическими ID якорей
  renderer.heading = function ({ tokens, depth }) {
    const text = this.parser.parseInline(tokens);
    const rawText = tokens.map((t) => ('text' in t ? (t as { text: string }).text : '')).join(' ');
    const id = slugify(rawText || text);
    return `<h${depth} id="${id}" class="wiki-heading wiki-h${depth}"><a href="#${id}" class="wiki-anchor-link">#</a> ${text}</h${depth}>\n`;
  };

  // Перехват внутренних ссылок на другие .md файлы
  renderer.link = function ({ href, title, tokens }) {
    const text = this.parser.parseInline(tokens);
    const titleAttr = title ? ` title="${title}"` : '';

    if (!href) {
      return `<a href="#"${titleAttr}>${text}</a>`;
    }

    // Внешние ссылки
    if (/^(https?:)?\/\//i.test(href)) {
      return `<a href="${href}"${titleAttr} target="_blank" rel="noopener noreferrer" class="wiki-ext-link">${text}<span class="ext-icon">↗</span></a>`;
    }

    // Внутридокументный якорь (#раздел)
    if (href.startsWith('#')) {
      return `<a href="${href}"${titleAttr} class="wiki-anchor-nav">${text}</a>`;
    }

    // Относительная ссылка на .md файл
    const [pathPart, hashPart] = href.split('#');
    if (pathPart && (pathPart.endsWith('.md') || !pathPart.includes('.'))) {
      const resolved = resolveWikiPath(currentDocId, pathPart.endsWith('.md') ? pathPart : `${pathPart}.md`);
      const targetHash = hashPart ? `#${hashPart}` : '';
      return `<a href="./wiki.html?doc=${encodeURIComponent(resolved)}${targetHash}" data-wiki-doc="${resolved}" data-wiki-hash="${hashPart ?? ''}" class="wiki-internal-link"${titleAttr}>${text}</a>`;
    }

    return `<a href="${href}"${titleAttr}>${text}</a>`;
  };

  // Таблицы с обёрткой для горизонтальной прокрутки
  renderer.table = function (headerAndBody) {
    const html = marked.Renderer.prototype.table.call(this, headerAndBody);
    return `<div class="wiki-table-wrap">${html}</div>`;
  };

  return renderer;
}

/**
 * Преобразование цитат с GitHub Alerts (> [!NOTE], > [!TIP], > [!WARNING], > [!IMPORTANT])
 */
function processAlerts(html: string): string {
  return html.replace(
    /<blockquote>\s*<p>\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*([\s\S]*?)<\/p>\s*<\/blockquote>/gi,
    (_, type: string, content: string) => {
      const kind = type.toLowerCase();
      const labels: Record<string, string> = {
        note: 'Примечание',
        tip: 'Совет',
        important: 'Важно',
        warning: 'Внимание',
        caution: 'Осторожно',
      };
      const label = labels[kind] ?? type;
      return `<div class="wiki-alert wiki-alert-${kind}"><div class="wiki-alert-header"><span class="wiki-alert-badge">${label}</span></div><div class="wiki-alert-body"><p>${content}</p></div></div>`;
    }
  );
}

/**
 * Загрузка всех markdown-файлов через glob Vite.
 *
 * `wiki/archive/` не берём: это пройденный путь для разработчика и агента,
 * не для игрока во внутриигровой вики (решение пользователя 2026-09-17).
 *
 * `wiki/plans/` не берём по той же причине (2026-09-21): это планы незапущенных
 * шагов — что сделать, какими ступенями и каким замером проверить. Папка
 * завелась ПОСЛЕ того решения, и до этой правки планы молча ехали в сборку и в
 * поиск по справке. Полнота исключения проверяется `test/wiki.test.ts`.
 */
const rawMarkdownFiles = import.meta.glob(
  ['../../../wiki/**/*.md', '!../../../wiki/archive/**', '!../../../wiki/plans/**'],
  {
    query: '?raw',
    eager: true,
    import: 'default',
  }
) as Record<string, string>;

/**
 * Нормализация ключа glob в относительный путь от корня wiki/.
 * Пример: "../../../wiki/design/combat/rules.md" -> "design/combat/rules.md"
 */
function normalizeDocId(globKey: string): string {
  const match = globKey.match(/(?:^|\/)wiki\/(.+)$/);
  const matched = match?.[1];
  return matched ?? globKey.replace(/^(\.\.\/)+wiki\//, '');
}

/**
 * Извлечение секций документа для оглавления и тултипов.
 * Поддерживает как стандартные заголовки (#, ##, ###),
 * так и словарные таблицы (| Термин | Значение |).
 */
function parseDocSections(raw: string, currentDocId: string = ''): WikiSection[] {
  const tokens = marked.lexer(raw);
  const sections: WikiSection[] = [];
  const renderer = createCustomRenderer(currentDocId);

  let currentHeading: Tokens.Heading | null = null;
  let currentTokens: Tokens.Generic[] = [];

  function flush(): void {
    if (!currentHeading) return;
    const title = currentHeading.text.trim();
    const id = slugify(title);
    const html = marked.parser(currentTokens as unknown as Tokens.Generic[], { renderer });
    const rawSnippet = currentTokens
      .map((t) => ('text' in t && typeof t.text === 'string' ? t.text : ''))
      .join(' ');
    const text = stripMarkdown(rawSnippet).slice(0, 350);

    sections.push({
      id,
      title,
      level: currentHeading.depth,
      html: processAlerts(html),
      text,
    });
  }

  for (const token of tokens) {
    if (token.type === 'heading') {
      flush();
      currentHeading = token as Tokens.Heading;
      currentTokens = [];
    } else if (token.type === 'table') {
      // Если таблица словаря (Термин / Значение)
      const tableToken = token as Tokens.Table;
      const headerText = tableToken.header.map((h: Tokens.TableCell) => h.text.toLowerCase()).join(' ');
      if (headerText.includes('термин') || headerText.includes('понятие') || headerText.includes('параметр')) {
        for (const row of tableToken.rows) {
          const firstCell = row[0];
          const secondCell = row[1];
          if (firstCell && secondCell) {
            const termRaw = firstCell.text.trim();
            const defRaw = secondCell.text.trim();
            const termId = slugify(termRaw);
            const defHtml = marked.parseInline(defRaw, { renderer }) as string;
            sections.push({
              id: termId,
              title: termRaw,
              level: 4,
              html: `<p><strong>${termRaw}</strong>: ${defHtml}</p>`,
              text: `${termRaw} — ${stripMarkdown(defRaw)}`,
            });
          }
        }
      }
      if (currentHeading) {
        currentTokens.push(token);
      }
    } else if (currentHeading) {
      currentTokens.push(token);
    }
  }
  flush();

  return sections;
}

/**
 * Парсинг одного markdown файла в WikiDoc.
 */
function parseWikiDoc(id: string, raw: string): WikiDoc {
  // Название: первый H1 заголовок или имя файла
  const h1Match = raw.match(/^#\s+(.+)$/m);
  const filename = id.split('/').pop() ?? id;
  const firstMatch = h1Match?.[1];
  const title = firstMatch ? firstMatch.trim() : filename.replace(/\.md$/, '');

  const parts = id.split('/');
  parts.pop();
  const category = parts.join('/');

  const renderer = createCustomRenderer(id);
  const renderedHtml = marked.parse(raw, { renderer }) as string;
  const html = processAlerts(renderedHtml);
  const sections = parseDocSections(raw, id);

  return {
    id,
    title,
    category,
    filename,
    raw,
    html,
    sections,
  };
}

/**
 * Главный реестр распарсенных документов вики.
 */
const docsMap = new Map<string, WikiDoc>();

for (const [globPath, rawContent] of Object.entries(rawMarkdownFiles)) {
  const docId = normalizeDocId(globPath);
  docsMap.set(docId, parseWikiDoc(docId, rawContent));
}

/**
 * Получить все документы вики.
 */
export function getAllWikiDocs(): readonly WikiDoc[] {
  return Array.from(docsMap.values());
}

/**
 * Получить документ по ID (например: "overview/roadmap.md" или "roadmap.md").
 */
export function getWikiDoc(id: string): WikiDoc | undefined {
  if (docsMap.has(id)) return docsMap.get(id);

  // Допускаем поиск без расширения .md
  const withMd = id.endsWith('.md') ? id : `${id}.md`;
  if (docsMap.has(withMd)) return docsMap.get(withMd);

  // Допускаем поиск по имени файла
  for (const [docId, doc] of docsMap.entries()) {
    if (docId.endsWith(`/${withMd}`) || docId === withMd) {
      return doc;
    }
  }

  return undefined;
}

/**
 * Построение дерева каталогов для навигатора.
 */
export function getWikiTree(): readonly WikiTreeNode[] {
  interface MutableNode {
    name: string;
    path: string;
    isDir: boolean;
    title?: string | undefined;
    children?: Map<string, MutableNode> | undefined;
  }

  const rootDirs = new Map<string, MutableNode>();
  const rootFiles: WikiTreeNode[] = [];

  for (const doc of docsMap.values()) {
    const parts = doc.id.split('/');
    const firstPart = parts[0];
    if (parts.length === 1 && firstPart) {
      rootFiles.push({
        name: firstPart,
        path: doc.id,
        isDir: false,
        title: doc.title,
      });
      continue;
    }

    let currentMap = rootDirs;
    let accumulatedPath = '';

    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      if (!part) continue;
      accumulatedPath = accumulatedPath ? `${accumulatedPath}/${part}` : part;

      let existing = currentMap.get(part);
      if (!existing) {
        existing = {
          name: part,
          path: accumulatedPath,
          isDir: true,
          children: new Map(),
        };
        currentMap.set(part, existing);
      }

      if (!existing.children) {
        existing.children = new Map();
      }
      currentMap = existing.children;
    }

    const fileName = parts[parts.length - 1];
    if (fileName) {
      currentMap.set(fileName, {
        name: fileName,
        path: doc.id,
        isDir: false,
        title: doc.title,
      });
    }
  }

  function convertMap(map: Map<string, MutableNode>): WikiTreeNode[] {
    const list: WikiTreeNode[] = [];
    for (const node of map.values()) {
      if (node.isDir && node.children) {
        list.push({
          name: node.name,
          path: node.path,
          isDir: true,
          children: convertMap(node.children),
        });
      } else {
        list.push({
          name: node.name,
          path: node.path,
          isDir: false,
          title: node.title,
        });
      }
    }

    // Сортировка: папки сверху, файлы снизу; логический приоритет
    return list.sort((a, b) => {
      if (a.isDir && !b.isDir) return -1;
      if (!a.isDir && b.isDir) return 1;
      return a.name.localeCompare(b.name, 'ru');
    });
  }

  const dirNodes = convertMap(rootDirs);
  rootFiles.sort((a, b) => {
    // README и glossary первыми в корне
    if (a.name === 'README.md') return -1;
    if (b.name === 'README.md') return 1;
    if (a.name === 'glossary.md') return -1;
    if (b.name === 'glossary.md') return 1;
    return a.name.localeCompare(b.name, 'ru');
  });

  return [...dirNodes, ...rootFiles];
}

/**
 * Поиск по вики (заголовки и текст).
 */
export function searchWiki(query: string): WikiSearchResult[] {
  const clean = query.trim().toLowerCase();
  if (!clean) return [];

  const titleResults: WikiSearchResult[] = [];
  const contentResults: WikiSearchResult[] = [];

  for (const doc of docsMap.values()) {
    const titleMatch = doc.title.toLowerCase().includes(clean);
    if (titleMatch) {
      titleResults.push({
        doc,
        matchField: 'title',
        snippet: doc.title,
      });
      continue;
    }

    const contentIdx = doc.raw.toLowerCase().indexOf(clean);
    if (contentIdx !== -1) {
      const start = Math.max(0, contentIdx - 40);
      const end = Math.min(doc.raw.length, contentIdx + clean.length + 60);
      const snippet = '...' + doc.raw.slice(start, end).replace(/\n/g, ' ') + '...';
      contentResults.push({
        doc,
        matchField: 'content',
        snippet,
      });
    }
  }

  return [...titleResults, ...contentResults].slice(0, 25);
}

/**
 * ============================================================================
 * ЧАСТЬ 2: Справка для Tooltip в интерфейсе игры.
 * Извлекает конкретный абзац или раздел статьи вики для контекстной подсказки.
 * ============================================================================
 *
 * Пример вызова:
 *   getWikiSection('glossary.md', 'orderpart')
 *   getWikiSection('design/combat/rules.md', 'фаза-инициативы')
 *   getWikiSection('rules.md', 'нагрев')
 */
export function getWikiSection(docQuery: string, sectionQuery?: string): WikiSection | null {
  const doc = getWikiDoc(docQuery);
  if (!doc) return null;

  // Если секция не указана, возвращаем первую содержательную секцию статьи
  if (!sectionQuery) {
    return doc.sections[0] ?? {
      id: 'intro',
      title: doc.title,
      level: 1,
      html: doc.html,
      text: stripMarkdown(doc.raw).slice(0, 300),
    };
  }

  const querySlug = slugify(sectionQuery);
  const queryLower = sectionQuery.toLowerCase().trim();

  // 1. Точное совпадение по slug
  const bySlug = doc.sections.find((s) => s.id === querySlug || s.id === sectionQuery);
  if (bySlug) return bySlug;

  // 2. Совпадение по названию заголовка
  const byTitle = doc.sections.find((s) => s.title.toLowerCase() === queryLower);
  if (byTitle) return byTitle;

  // 3. Частичное совпадение по заголовку
  const byPartial = doc.sections.find((s) => s.title.toLowerCase().includes(queryLower));
  if (byPartial) return byPartial;

  // 4. Поиск в тексте секций
  const byText = doc.sections.find((s) => s.text.toLowerCase().includes(queryLower));
  if (byText) return byText;

  return null;
}
