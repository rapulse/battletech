import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Целость документации (шаг 16a).
 *
 * Единственная АВТОМАТИЧЕСКАЯ часть синхронизации кода и вики. Остальные две —
 * обязательный статус-маркер у раздела и чек-лист закрытия шага — соблюдаются
 * людьми; этот тест ловит ровно тот класс расхождений, который люди пропускают
 * молча: ссылку на переименованный раздел и упоминание файла, которого больше
 * нет.
 *
 * Так и нашлась битая ссылка `#5-класс-исполнения-черновик-ждёт-экономики--m9`:
 * заголовок переименовали в «[стабильно, реализовано шагом 11]», а ссылку на
 * него — нет, и она никуда не вела неизвестно сколько времени.
 *
 * Что тест НЕ проверяет и не должен: правду написанного. Что вики не врёт про
 * механику, проверяет только чтение глазами при закрытии шага.
 */

const ROOT = resolve(__dirname, '..', '..');

/** Куда смотрим. Архивы и заморозки не трогаем — они намеренно устарели. */
const SCANNED = [
  'wiki',
  'game_core.md',
  'CLAUDE.md',
  // План действующего шага в корне (если есть). Он ссылается на вики и на
  // таблицы данных так же густо, как пайплайн, и точно так же протухает: файл,
  // переименованный в `wiki/`, обязан ломать тест, а не тихо оставлять план с
  // ссылкой в пустоту. Планы закрытых шагов уезжают в `wiki/archive/` и
  // попадают в обход этого списка — каталог `wiki` сканируется целиком.
  'шаг28-план.md',
];

const SKIPPED_DIRS = new Set(['archive', 'node_modules', '_tmp']);

function collectMarkdown(path: string, out: string[]): void {
  // Пути из `SCANNED` могут ОТСУТСТВОВАТЬ, и это не поломка: план действующего
  // шага живёт в корне, только пока шаг идёт, — закрытый уезжает в
  // `wiki/archive/`, а отложенный может быть просто переименован. Сам список
  // это и оговаривает («если есть»), а падал тест на этом до 2026-09-07:
  // `шаг28-план.md` переименовали, и вся проверка документации перестала
  // запускаться вовсе — то есть отсутствие одного файла глушило охрану всех
  // остальных.
  if (!existsSync(path)) return;
  const stat = statSync(path);
  if (stat.isFile()) {
    if (path.endsWith('.md')) out.push(path);
    return;
  }
  for (const entry of readdirSync(path)) {
    if (entry.startsWith('.') || SKIPPED_DIRS.has(entry)) continue;
    collectMarkdown(join(path, entry), out);
  }
}

const FILES: string[] = [];
for (const target of SCANNED) collectMarkdown(resolve(ROOT, target), FILES);

/**
 * Якорь GitHub из заголовка: в нижний регистр, пробелы в дефисы, пунктуация
 * выброшена. Кириллица остаётся как есть — так же, как её оставляет GitHub.
 */
function anchorOf(heading: string): string {
  return heading
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    // Каждый пробел — свой дефис, БЕЗ склейки подряд идущих: так делает GitHub,
    // и «Обнаружение — три уровня» даёт `обнаружение--три-уровня`, а не один
    // дефис. Склейка тихо признала бы верной ссылку, которая никуда не ведёт.
    .replace(/\s/g, '-');
}

function anchorsOf(text: string): Set<string> {
  const out = new Set<string>();
  for (const line of text.split('\n')) {
    const m = /^#{1,6}\s+(.*)$/.exec(line);
    if (m !== null) out.add(anchorOf(m[1] as string));
  }
  return out;
}

interface Link {
  readonly from: string;
  readonly target: string;
  readonly anchor: string;
}

function linksOf(file: string, text: string): Link[] {
  const out: Link[] = [];
  // Только относительные ссылки на файлы: внешние URL и почта не наше дело.
  const re = /\[[^\]]*\]\(([^)\s]+)\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const href = m[1] as string;
    if (/^[a-z]+:/i.test(href) || href.startsWith('#')) continue;
    const [target = '', anchor = ''] = href.split('#');
    out.push({ from: file, target: decodeURIComponent(target), anchor: decodeURIComponent(anchor) });
  }
  return out;
}

const CONTENT = new Map(FILES.map((f) => [f, readFileSync(f, 'utf8')]));
const ANCHORS = new Map(FILES.map((f) => [f, anchorsOf(CONTENT.get(f) as string)]));

function exists(path: string): boolean {
  try {
    statSync(path);
    return true;
  } catch {
    return false;
  }
}

describe('целость документации', () => {
  it('нашла файлы, а не пустоту', () => {
    expect(FILES.length).toBeGreaterThan(10);
  });

  it('каждая ссылка ведёт в существующий файл', () => {
    const broken: string[] = [];
    for (const file of FILES) {
      for (const link of linksOf(file, CONTENT.get(file) as string)) {
        const resolved = resolve(dirname(file), link.target);
        if (!exists(resolved)) broken.push(`${relative(ROOT, file)} → ${link.target}`);
      }
    }
    expect(broken).toEqual([]);
  });

  it('каждый якорь ведёт в существующий заголовок', () => {
    const broken: string[] = [];
    for (const file of FILES) {
      for (const link of linksOf(file, CONTENT.get(file) as string)) {
        if (link.anchor === '') continue;
        const resolved = resolve(dirname(file), link.target);
        if (!resolved.endsWith('.md') || !exists(resolved)) continue;
        const anchors =
          ANCHORS.get(resolved) ?? anchorsOf(readFileSync(resolved, 'utf8'));
        if (!anchors.has(link.anchor)) {
          broken.push(`${relative(ROOT, file)} → ${link.target}#${link.anchor}`);
        }
      }
    }
    expect(broken).toEqual([]);
  });

  it('каждая упомянутая таблица данных существует', () => {
    const re = /(?:game\/)?data\/[A-Za-z0-9_/-]+\.json/g;
    const missing = new Set<string>();
    for (const file of FILES) {
      const text = CONTENT.get(file) as string;
      for (const hit of text.match(re) ?? []) {
        const path = hit.startsWith('game/') ? hit : `game/${hit}`;
        if (!exists(resolve(ROOT, path))) missing.add(`${relative(ROOT, file)} → ${hit}`);
      }
    }
    expect([...missing]).toEqual([]);
  });

  it('у каждого раздела design/ есть статус-маркер', () => {
    // Статус в заголовке — то, из чего состояние вики читается одной командой
    // `grep`, а не перечитыванием двух десятков файлов. Проверяется верхний
    // заголовок файла: он отвечает за документ целиком.
    const noStatus: string[] = [];
    for (const file of FILES) {
      if (!file.includes(`${'design'}/`)) continue;
      const first = (CONTENT.get(file) as string)
        .split('\n')
        .find((l) => l.startsWith('# '));
      if (first === undefined || !/[[`]/.test(first)) noStatus.push(relative(ROOT, file));
    }
    expect(noStatus).toEqual([]);
  });
});
