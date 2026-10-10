import { afterEach, describe, expect, it } from 'vitest';
import { allKeys, days, formatDate, hasKey, setLanguages, t, tn } from '../src/ui/i18n/index.js';
import { tr } from '../src/core/log/index.js';
import uiEn from '../src/ui/i18n/en.json';
import uiRu from '../src/ui/i18n/ru.json';
import coreEn from '../src/core/log/en.json';
import coreRu from '../src/core/log/ru.json';

/**
 * Английский интерфейс (шаг 64).
 *
 * Схема перевода работает с шага 52, но английский долго был заготовкой: игрок, переключивший язык,
 * видел ключи. Три проверки на то, чего глазами не поймать в полутора тысячах строк:
 *
 *  — **полнота**: каждый ключ русского словаря есть в английском;
 *  — **плейсхолдеры**: наборы `{…}` в паре строк совпадают, иначе в готовой фразе появится дыра
 *    или лишнее слово `{count}`;
 *  — **формы числа**: у русского `one/few/many/other`, у английского две (`one/other`), и это не
 *    «четыре одинаковых текста», а правило языка — `tn` выбирает форму по `Intl.PluralRules('en')`.
 *
 * Плюс охрана от недоперевода: кириллицы в английском словаре быть не должно.
 */

type Tree = { readonly [key: string]: string | Tree };

function flatten(tree: Tree, prefix = ''): Map<string, string> {
  const out = new Map<string, string>();
  for (const [name, value] of Object.entries(tree)) {
    const key = prefix === '' ? name : `${prefix}.${name}`;
    if (typeof value === 'string') out.set(key, value);
    else for (const [k, v] of flatten(value, key)) out.set(k, v);
  }
  return out;
}

const placeholders = (s: string): string[] => [...new Set([...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1] as string))].sort();

const UI_RU = flatten(uiRu as Tree);
const UI_EN = flatten(uiEn as Tree);
const CORE_RU = new Map(Object.entries(coreRu as Record<string, string>));
const CORE_EN = new Map(Object.entries(coreEn as Record<string, string>));

describe('английский интерфейс: полнота', () => {
  it('в английском словаре интерфейса есть каждый ключ русского', () => {
    // Формы `few`/`many` — русские: у английского две категории (`one`, `other`), остальные `tn` не спросит.
    const missing = [...UI_RU.keys()].filter((k) => !UI_EN.has(k) && !/\.(few|many)$/.test(k));
    expect(missing).toEqual([]);
  });

  it('в английском словаре ядра есть каждый ключ русского', () => {
    const missing = [...CORE_RU.keys()].filter((k) => !CORE_EN.has(k));
    expect(missing).toEqual([]);
  });
});

describe('английский интерфейс: плейсхолдеры', () => {
  it('наборы {…} в паре строк интерфейса совпадают', () => {
    const bad: string[] = [];
    for (const [key, en] of UI_EN) {
      const ru = UI_RU.get(key);
      if (ru === undefined) continue;
      if (placeholders(en).join() !== placeholders(ru).join()) bad.push(`${key}: ${placeholders(ru)} ≠ ${placeholders(en)}`);
    }
    expect(bad).toEqual([]);
  });

  it('наборы {…} в паре строк ядра совпадают', () => {
    const bad: string[] = [];
    for (const [key, en] of CORE_EN) {
      const ru = CORE_RU.get(key);
      if (ru === undefined) continue;
      if (placeholders(en).join() !== placeholders(ru).join()) bad.push(`${key}: ${placeholders(ru)} ≠ ${placeholders(en)}`);
    }
    expect(bad).toEqual([]);
  });
});

describe('английский интерфейс: формы числа', () => {
  it('у каждого набора форм есть `one` и `other`, и число {n} стоит в обеих', () => {
    const groups = new Set([...UI_RU.keys()].filter((k) => /\.(one|few|many|other)$/.test(k)).map((k) => k.replace(/\.\w+$/, '')));
    expect(groups.size).toBeGreaterThan(0);
    const bad: string[] = [];
    for (const g of groups) {
      for (const form of ['one', 'other']) {
        const text = UI_EN.get(`${g}.${form}`);
        if (text === undefined) bad.push(`нет ${g}.${form}`);
        else if (!text.includes('{n}')) bad.push(`${g}.${form} без {n}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('английские формы различаются: «1 day» и «2 days» — не один и тот же текст', () => {
    const groups = new Set([...UI_EN.keys()].filter((k) => k.endsWith('.one')).map((k) => k.replace(/\.one$/, '')));
    for (const g of groups) expect(UI_EN.get(`${g}.one`), g).not.toBe(UI_EN.get(`${g}.other`));
  });
});

describe('английский интерфейс: недоперевод', () => {
  it('в английских словарях нет кириллицы', () => {
    const bad = [...UI_EN, ...CORE_EN].filter(([, v]) => /[А-Яа-яЁё]/.test(v)).map(([k]) => k);
    expect(bad).toEqual([]);
  });

  it('английские словари не заводят ключей, которых нет в русских', () => {
    expect([...UI_EN.keys()].filter((k) => !UI_RU.has(k))).toEqual([]);
    expect([...CORE_EN.keys()].filter((k) => !CORE_RU.has(k))).toEqual([]);
  });
});

describe('английский интерфейс: поведение', () => {
  afterEach(() => setLanguages('ru', 'ru'));

  it('в английском режиме ни один ключ интерфейса не возвращается ключом', () => {
    setLanguages('en', 'en');
    const shown = allKeys().filter((k) => t(k) === k);
    expect(shown).toEqual([]);
  });

  it('в английском режиме ни один ключ ядра не возвращается ключом', () => {
    setLanguages('en', 'en');
    expect([...CORE_RU.keys()].filter((k) => tr(k) === k)).toEqual([]);
  });

  it('склонение по-английски: одна форма для единицы, другая для остального', () => {
    setLanguages('en', 'en');
    expect(days(1)).toBe('1 day');
    expect(days(2)).toBe('2 days');
    expect(days(5)).toBe('5 days');
    expect(days(21)).toBe('21 days');
    expect(days(0)).toBe('0 days');
    expect(tn('count.mechs', 1)).toBe('1 mech');
    expect(tn('count.mechs', 3)).toBe('3 mechs');
    expect(tn('count.jumps', 4)).toBe('4 jumps');
  });

  it('дата и суммы читаются по-английски', () => {
    setLanguages('en', 'en');
    expect(formatDate({ year: 3053, month: 5, day: 12 })).toBe('12 May 3053');
    expect(hasKey('date.months.12')).toBe(true);
  });

  it('язык терминов и язык интерфейса остаются независимыми', () => {
    setLanguages('en', 'ru');
    expect(t('hangar.title')).toBe('Hangar');
    expect(tr('weapon.is_ml')).toBe('средний лазер');
    expect(tr('zone.head')).toBe('cockpit');
  });
});
