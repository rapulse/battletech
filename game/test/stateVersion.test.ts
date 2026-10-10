import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * Геттер состояния обязан подписываться на версию.
 *
 * Состояние кампании и боя — обычные объекты ядра, а не руны: команды меняют их
 * НА МЕСТЕ, и Svelte об этом не знает. Единственный сигнал «что-то изменилось» —
 * счётчик `version`, который поднимает `run()`. Геттер, читающий состояние и не
 * трогающий `version`, посчитается один раз и застынет: `$derived` по нему
 * больше не пересчитается.
 *
 * Найдено на живом примере (2026-09-16): `get state()` версию не читал, и
 * `$derived(campaign.state.systemId)` на звёздной карте после прилёта
 * продолжал считать местом стоянки прежнюю систему — панель писала «Пути
 * прыжками сюда нет» вместо кнопки разведки, пока экран не пересобирали
 * переходом на соседнюю вкладку.
 *
 * Тест грубый — разбор исходника, — но ловит ровно тот способ, каким осечка и
 * заводится: кто-то пишет ещё один геттер и забывает строку.
 */

const STATE = resolve(__dirname, '..', 'src', 'ui', 'state');

/**
 * Сырые поля с состоянием ядра. `this.state` сюда НЕ входит намеренно: это сам
 * подписанный геттер, и чтение через него уже реактивно — именно поэтому он
 * обязан читать версию, и именно это ловится здесь.
 */
const CORE_STATE = /\bthis\.(campaign|battle)\b/;

function gettersWithoutVersion(file: string): string[] {
  const source = readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const guilty: string[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isGetAccessorDeclaration(node) && node.body !== undefined) {
      const body = node.body.getText(sf);
      if (CORE_STATE.test(body) && !/void this\.version;/.test(body)) {
        guilty.push(node.name.getText(sf));
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return guilty;
}

describe('подписка на версию состояния', () => {
  for (const file of ['campaign.svelte.ts', 'battle.svelte.ts']) {
    it(`каждый геттер ${file}, читающий состояние, подписан на версию`, () => {
      const guilty = gettersWithoutVersion(join(STATE, file));
      expect(guilty, `без «void this.version;»: ${guilty.join(', ')}`).toEqual([]);
    });
  }
});
