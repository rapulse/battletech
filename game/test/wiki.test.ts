import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  getAllWikiDocs,
  getWikiDoc,
  getWikiSection,
  getWikiTree,
  resolveWikiPath,
  searchWiki,
  slugify,
} from '../src/wiki/wikiData.js';

describe('База знаний и вики (wikiData)', () => {
  it('загружает все документы из каталога wiki/, кроме архива и планов', () => {
    const docs = getAllWikiDocs();
    expect(docs.length).toBeGreaterThanOrEqual(20);
    expect(docs.some((d) => d.id.startsWith('archive/'))).toBe(false);

    // `wiki/plans/` — планы незапущенных шагов, читает их разработчик, а не
    // игрок. Папка завелась позже исключения для архива, и до 2026-09-21 планы
    // молча ехали в сборку и в поиск по справке.
    expect(docs.some((d) => d.id.startsWith('plans/'))).toBe(false);
    expect(getWikiDoc('plans/README.md')).toBeUndefined();

    const readme = getWikiDoc('README.md');
    expect(readme).toBeDefined();
    expect(readme?.title.toLowerCase()).toContain('battletech');

    const rules = getWikiDoc('design/combat/rules.md');
    expect(rules).toBeDefined();
    expect(rules?.sections.length).toBeGreaterThan(0);
  });

  it('строит иерархическое дерево каталогов', () => {
    const tree = getWikiTree();
    expect(tree.length).toBeGreaterThan(0);

    // Папки должны быть первыми
    const dirNodes = tree.filter((n) => n.isDir);
    expect(dirNodes.length).toBeGreaterThan(0);
    expect(dirNodes.some((d) => d.name === 'overview')).toBe(true);
    expect(dirNodes.some((d) => d.name === 'design')).toBe(true);
    expect(dirNodes.some((d) => d.name === 'archive')).toBe(false);
    expect(dirNodes.some((d) => d.name === 'plans')).toBe(false);

    // README в корне
    expect(tree.some((n) => n.name === 'README.md')).toBe(true);
  });

  it('корректно разрешает относительные пути в ссылках', () => {
    expect(resolveWikiPath('design/campaign/contracts.md', '../combat/rules.md')).toBe('design/combat/rules.md');
    expect(resolveWikiPath('overview/roadmap.md', '../glossary.md')).toBe('glossary.md');
    expect(resolveWikiPath('README.md', 'glossary.md')).toBe('glossary.md');
  });

  it('выполняет поиск по заголовкам и тексту статей', () => {
    const results = searchWiki('пилот');
    expect(results.length).toBeGreaterThan(0);
    expect(results.some((r) => r.doc.id.includes('pilot'))).toBe(true);
  });

  it('формирует корректные slug для якорей', () => {
    expect(slugify('Класс качества')).toBe('класс-качества');
    expect(slugify('1. Шкала фаз раунда')).toBe('1-шкала-фаз-раунда');
    expect(slugify('OrderPart')).toBe('orderpart');
  });

  it('ЧАСТЬ 2 (Подготовка): извлекает конкретный абзац или раздел для тултипа', () => {
    // Проверяем извлечение термина из глоссария
    const orderPartSection = getWikiSection('glossary.md', 'orderpart');
    expect(orderPartSection).not.toBeNull();
    expect(orderPartSection?.title.toLowerCase()).toContain('orderpart');
    expect(orderPartSection?.text.length).toBeGreaterThan(10);

    const nodesSection = getWikiSection('glossary.md', 'узлы и каркас');
    expect(nodesSection).not.toBeNull();
    expect(nodesSection?.title.toLowerCase()).toContain('узлы и каркас');
    expect(nodesSection?.html).toContain('Реактор');
    expect(nodesSection?.html).toContain('Силовой каркас');

    // Справка «Наряда цеха» в мехлабе (2026-09-15): одна кнопка в заголовке, одна
    // строка глоссария — коротко по каждому пункту, подробнее про тепло.
    const planSection = getWikiSection('glossary.md', 'наряд цеха');
    expect(planSection).not.toBeNull();
    expect(planSection?.title.toLowerCase()).toContain('наряд цеха');
    for (const part of ['Масса', 'Тепло', 'Броня', 'Работа', 'залп']) {
      expect(planSection?.html, part).toContain(part);
    }

    const contractsSection = getWikiSection('glossary.md', 'контракты и биржа');
    expect(contractsSection).not.toBeNull();
    expect(contractsSection?.title.toLowerCase()).toContain('контракты и биржа');
    for (const part of ['Гарнизон', 'Разведка', 'Рейд', 'Оборона', 'Штурм', 'Достоверность']) {
      expect(contractsSection?.html, part).toContain(part);
    }
    expect(contractsSection?.html).toContain('./wiki.html?doc=design%2Fcampaign%2Fcontracts.md');
    expect(contractsSection?.html).toContain('data-wiki-doc="design/campaign/contracts.md"');

    // Проверяем извлечение по разделу правил
    const combatSection = getWikiSection('design/combat/rules.md', 'очки движения');
    expect(combatSection).not.toBeNull();
    expect(combatSection?.html).toContain('walkMP');

    // Проверяем запасной вариант (первый абзац документа)
    const defaultSection = getWikiSection('overview/roadmap.md');
    expect(defaultSection).not.toBeNull();
  });

  it('формирует корректные ссылки на страницы вики для .md файлов', () => {
    const doc = getWikiDoc('glossary.md');
    expect(doc).toBeDefined();
    expect(doc?.html).toContain('./wiki.html?doc=design%2Fcampaign%2Fcontracts.md');
    expect(doc?.html).toContain('data-wiki-doc="design/campaign/contracts.md"');
  });

  // Кнопка «?» с разделом, которого нет в статье, не открывается вовсе: `getWikiSection`
  // отдаёт null, и подсказка молчит. Найдено 2026-10-09 на экране державы.
  it('каждая кнопка WikiHelp в интерфейсе находит свою статью и раздел', () => {
    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        const path = join(dir, entry);
        if (statSync(path).isDirectory()) walk(path);
        else if (path.endsWith('.svelte')) files.push(path);
      }
    };
    walk(join(__dirname, '../src/ui'));

    const broken: string[] = [];
    let seen = 0;
    for (const file of files) {
      for (const [tag] of readFileSync(file, 'utf8').matchAll(/<WikiHelp\b[^>]*>/g)) {
        const doc = /\bdoc="([^"]+)"/.exec(tag)?.[1];
        if (doc === undefined) continue;
        const section = /\bsection="([^"]+)"/.exec(tag)?.[1];
        seen++;
        if (getWikiSection(doc, section) === null) broken.push(`${file}: ${doc} → ${section ?? '(статья)'}`);
      }
    }
    expect(seen).toBeGreaterThan(10);
    expect(broken).toEqual([]);
  });
});
