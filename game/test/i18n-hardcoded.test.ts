import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ALLOWLIST_PATH, GAME, lineCount, scanHardcodedText } from './i18nScan.js';

/**
 * Русский текст мимо словарей (шаг 52).
 *
 * Схема локализации (`game_core.md` §7) ничем не охранялась: строка, вписанная
 * прямо в код, не ловилась ни тестом полноты словаря, ни линтером. Этот тест
 * разбирает исходники `ui`, `core`, `render`, `platform` и сверяет число строк
 * с кириллицей в литералах и разметке с файлом исключений
 * `test/i18n-allowlist.json`.
 *
 * Число в исключении работает как храповик: больше — новый текст мимо словаря,
 * тест падает; меньше — файл переехал, и число обязано уменьшиться вместе с ним
 * (`pnpm i18n:allowlist`), иначе освободившееся место тихо займёт новая строка.
 */

const allow = JSON.parse(readFileSync(ALLOWLIST_PATH, 'utf8')) as Record<string, number>;

describe('тексты игрока через словари', () => {
  const found = scanHardcodedText();

  it('в коде нет новых русских строк мимо словарей', () => {
    const over: string[] = [];
    for (const [file, list] of found) {
      const allowed = allow[file] ?? 0;
      const count = lineCount(list);
      if (count <= allowed) continue;
      const sample = list
        .slice(0, 5)
        .map((f) => `    ${file}:${f.line}  ${f.text.slice(0, 80)}`)
        .join('\n');
      over.push(`${file}: ${count} строк, разрешено ${allowed}\n${sample}`);
    }
    expect(over, 'текст игрока — через t() и словарь, см. game_core.md §7').toEqual([]);
  });

  it('файл исключений не отстаёт от переезда', () => {
    const stale: string[] = [];
    for (const [file, allowed] of Object.entries(allow)) {
      if (!existsSync(join(GAME, file))) {
        stale.push(`${file}: файла нет — убрать из исключений`);
        continue;
      }
      const count = lineCount(found.get(file) ?? []);
      if (count < allowed) stale.push(`${file}: ${count} строк, в исключениях ${allowed} — уменьшить`);
    }
    expect(stale, 'пересчитать: pnpm i18n:allowlist').toEqual([]);
  });
});
