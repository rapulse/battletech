import { tr } from './dictionary.js';

/**
 * Фраза словаря ядра, собранная из кусков (шаг 52).
 *
 * Журнал боя выделяет на экране отдельные слова — «попадание», «N урона»,
 * «КРИТ». До шага 52 экран находил их регулярным выражением по русскому тексту,
 * и на другом языке подсветка пропала бы молча. Теперь фраза остаётся одной
 * строкой словаря с подстановками, а выделяемое приходит подстановкой с «тоном»:
 * экран красит кусок по тону, текстовый отчёт и терминал просто склеивают куски.
 */

export type LogTone = 'hit' | 'miss' | 'danger' | 'warn' | 'crit' | 'dmg';

export interface LogPart {
  readonly text: string;
  readonly tone?: LogTone;
}

/** Подстановка: число, строка, выделенный кусок или уже собранная фраза. */
export type PhraseParam = string | number | LogPart | readonly LogPart[];

export function toned(text: string, tone: LogTone): LogPart {
  return { text, tone };
}

export function phrase(key: string, params: Readonly<Record<string, PhraseParam>> = {}): LogPart[] {
  const template = tr(key);
  const parts: LogPart[] = [];

  const push = (part: LogPart): void => {
    if (part.text === '') return;
    const last = parts[parts.length - 1];
    // Соседние невыделенные куски склеиваются: экрану незачем дробить строку.
    if (part.tone === undefined && last !== undefined && last.tone === undefined) {
      parts[parts.length - 1] = { text: last.text + part.text };
    } else {
      parts.push(part);
    }
  };

  let at = 0;
  for (const m of template.matchAll(/\{(\w+)\}/g)) {
    const index = m.index ?? 0;
    push({ text: template.slice(at, index) });
    const value = params[m[1] as string];
    if (value === undefined) push({ text: m[0] });
    else if (typeof value === 'string' || typeof value === 'number') push({ text: String(value) });
    else if (Array.isArray(value)) (value as readonly LogPart[]).forEach(push);
    else push(value as LogPart);
    at = index + m[0].length;
  }
  push({ text: template.slice(at) });
  return parts;
}

export function partsText(parts: readonly LogPart[]): string {
  return parts.map((p) => p.text).join('');
}

/** Фраза сразу текстом — для отчёта, терминала и подстановок внутри других фраз. */
export function phraseText(key: string, params: Readonly<Record<string, PhraseParam>> = {}): string {
  return partsText(phrase(key, params));
}
