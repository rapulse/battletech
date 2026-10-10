import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/**
 * Архитектура держится конфигом, а не дисциплиной (game_core.md §10).
 *   1. Math.random запрещён везде — вся случайность идёт через сидированный Rng.
 *   2. core/ не знает о слое показа — ни импортов, ни глобалей DOM.
 *   3. боевое ядро не знает о кампании — зависимость только в одну сторону.
 */

/** Что закрыто от всего ядра целиком: показ, файловая система, симулятор. */
const HIDDEN_FROM_CORE = [
  'svelte', 'svelte/*',
  '@tauri-apps/*',
  '**/render/**', '**/ui/**', '**/platform/**', '**/sim/**',
  'node:*', 'fs', 'path', 'os', 'child_process',
];

const HIDDEN_FROM_CORE_MESSAGE =
  'core/ не должен знать ни о слое показа, ни о файловой системе. ' +
  'Зависимости идут только внутрь core/, данные приходят импортом JSON.';

/**
 * Боевое ядро Части 1. Кампания (`core/campaign/`) имеет право импортировать
 * его — обратное направление запрещено: иначе правила боя начнут зависеть от
 * денег и календаря, автобой перестанет собираться, а замер боя — мериться
 * отдельно от замера экономики.
 */
const BATTLE_CORE = [
  'src/core/hex/**/*.ts',
  'src/core/map/**/*.ts',
  'src/core/model/**/*.ts',
  'src/core/rules/**/*.ts',
  'src/core/commands/**/*.ts',
  'src/core/data/**/*.ts',
  'src/core/log/**/*.ts',
  'src/core/rng/**/*.ts',
];

export default tseslint.config(
  // `_tmp/` — рабочий каталог прогонов и черновиков, он в .gitignore и не код
  // проекта. Без него линтер ругается на одноразовые пробники, и `pnpm check`
  // перестаёт что-либо значить: ошибку в настоящем файле не видно за ними.
  { ignores: ['dist/**', 'node_modules/**', 'src-tauri/**', '_tmp/**'] },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  // --- Правило 1: единственный источник случайности ---
  {
    files: ['**/*.ts'],
    rules: {
      'no-restricted-properties': [
        'error',
        {
          object: 'Math',
          property: 'random',
          message:
            'Math.random запрещён. Все броски — через сидированный Rng (core/rng), ' +
            'иначе ломаются реплей, воспроизводимость багов и авто-расчёт боя.',
        },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },

  // --- Служебные скрипты разработки: среда Node, не браузер ---
  {
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      globals: { process: 'readonly', console: 'readonly', URL: 'readonly', Buffer: 'readonly' },
    },
  },

  // --- Правило 2: ядро не знает о слое показа ---
  {
    files: ['src/core/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [{ group: HIDDEN_FROM_CORE, message: HIDDEN_FROM_CORE_MESSAGE }],
        },
      ],
      'no-restricted-globals': [
        'error',
        ...[
          'window', 'document', 'navigator', 'localStorage', 'sessionStorage',
          'requestAnimationFrame', 'fetch', 'alert',
        ].map((name) => ({
          name,
          message: 'core/ не должен знать о браузере — ядро обязано работать в чистом Node.',
        })),
        // @types/node включён ради sim/cli.ts. Без этой строки ядро могло бы
        // незаметно уехать в файловую систему и перестать собираться для браузера.
        ...['process', '__dirname', '__filename', 'require'].map((name) => ({
          name,
          message: 'core/ не должен знать о Node — ядро обязано собираться и для браузера.',
        })),
      ],
    },
  },

  // --- Правило 3: боевое ядро не знает о кампании ---
  // Блок идёт ПОСЛЕ правила 2 и повторяет его список: в плоском конфиге
  // одноимённое правило не дополняется, а замещается целиком.
  {
    files: BATTLE_CORE,
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: HIDDEN_FROM_CORE, message: HIDDEN_FROM_CORE_MESSAGE },
            {
              group: ['**/campaign/**', '../campaign/*', './campaign/*'],
              message:
                'Боевое ядро не должно знать о кампании. Зависимость только в одну ' +
                'сторону: core/campaign/ импортирует правила боя, но не наоборот.',
            },
          ],
        },
      ],
    },
  },
);
