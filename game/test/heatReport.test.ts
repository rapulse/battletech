import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng/index.js';
import { EQUIPMENT } from '../src/core/data/index.js';
import { generateAssembly, validateAssembly } from '../src/core/rules/construction.js';

/**
 * Строка тепла мехлаба (2026-09-15) показывает отвод по частям: реактор и
 * охладители. Экран вычитает одно из другого, поэтому отчёт валидатора обязан
 * держать части согласованными с целым.
 */
describe('отчёт валидатора: отвод по частям', () => {
  it('реактор + навешенные охладители = весь отвод, на обеих техбазах и всех классах реактора', () => {
    const rng = new Rng(51);
    for (let i = 0; i < 40; i++) {
      const assembly = generateAssembly(
        {
          techBase: i % 2 === 0 ? 'is' : 'clan',
          tonnage: [35, 55, 75, 95][i % 4]!,
          quality: { reactor: (['recovered', 'standard', 'military', 'master'] as const)[i % 4]!, frame: 'standard' },
        },
        rng,
      );
      const report = validateAssembly(assembly);
      const sinks = assembly.items.reduce(
        (sum, it) => sum + (EQUIPMENT.get(it.id)?.category === 'heatsink' ? (EQUIPMENT.get(it.id)?.heatDissipation ?? 1) : 0),
        0,
      );
      expect(report.heatReactor).toBeGreaterThan(0);
      expect(report.heatReactor + sinks).toBe(report.heatDissipation);
      expect(report.heatLimit).toBe(report.heatDissipation + report.heatReserve);
    }
  });
});
