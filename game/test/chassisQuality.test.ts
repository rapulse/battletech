import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng/index.js';
import { chassis, registerDynamicChassis } from '../src/core/data/index.js';
import { assemblyToChassisDef, generateAssembly } from '../src/core/rules/construction.js';

/**
 * Класс исполнения в описании боевого шасси (2026-09-15): карточка цели в бою
 * показывает его, а в бою, кроме описания шасси, про класс не знает ничто. Код
 * шасси класс не восстанавливает: суффикс `~Q` берёт первую букву класса, а у
 * армейского и мастерского она одна.
 */
describe('класс исполнения доходит до боя', () => {
  it('армейский реактор и мастерский каркас записаны в шасси, и схема их принимает', () => {
    const assembly = generateAssembly(
      { chassisCode: 'IS-H55-R3F2', quality: { reactor: 'military', frame: 'master' } },
      new Rng(3),
    );
    const def = assemblyToChassisDef(assembly);
    expect(def.quality).toEqual({ reactor: 'military', frame: 'master' });

    registerDynamicChassis({ ...def, id: `${def.id}~quality-test` });
    expect(chassis(`${def.id}~quality-test`).quality).toEqual({ reactor: 'military', frame: 'master' });
  });

  it('серийная машина поля не несёт — как и все шасси каталога', () => {
    const def = assemblyToChassisDef(generateAssembly({ chassisCode: 'IS-H55-R3F2' }, new Rng(3)));
    expect(def.quality).toBeUndefined();
  });
});
