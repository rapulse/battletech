import { writeFileSync } from 'node:fs';
import { ALLOWLIST_PATH, lineCount, scanHardcodedText } from '../test/i18nScan.js';

/**
 * Пересчитать файл исключений теста `i18n-hardcoded` (шаг 52).
 *
 * Запускать после переезда файла на словарь, чтобы число в исключении
 * уменьшилось. Тест всё равно сверяет каждое число с разбором: поднять его
 * этим скриптом незаметно не выйдет — рост видно в диффе файла исключений.
 *
 * `pnpm i18n:allowlist` — записать; `-- --print` — только показать находки.
 */

const found = scanHardcodedText();

if (process.argv.includes('--print')) {
  for (const [file, list] of found) {
    for (const f of list) console.log(`${file}:${f.line}  ${f.text.slice(0, 100)}`);
  }
} else {
  const allow: Record<string, number> = {};
  for (const [file, list] of found) allow[file] = lineCount(list);
  writeFileSync(ALLOWLIST_PATH, `${JSON.stringify(allow, null, 2)}\n`);
  const total = Object.values(allow).reduce((a, b) => a + b, 0);
  console.log(`${found.size} файлов, ${total} строк → ${ALLOWLIST_PATH}`);
}
