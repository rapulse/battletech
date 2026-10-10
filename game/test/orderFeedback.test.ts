import { describe, expect, it } from 'vitest';
import { MemoryStorage } from '../src/platform/MemoryStorage.js';
import { CampaignUi } from '../src/ui/state/campaign.svelte.js';
import { recordNodeSpec } from '../src/core/campaign/index.js';

/**
 * Оплаченный заказ узлов должен быть виден игроку: строка в журнале, серая
 * кнопка вместо живой и срок прибытия. Раньше деньги списывались молча, и
 * заказ выглядел несработавшим (2026-09-18).
 */
describe('заказ связки узлов: обратная связь', () => {
  it('после оплаты: запись в журнале, «в пути» вместо заказа, доставка тоже в журнале', () => {
    const ui = new CampaignUi(new MemoryStorage());
    ui.newCampaign({ seed: 7, name: 'Hounds', commander: 'Wolf', emblem: 0 });
    ui.state.company = { ...ui.state.company, cbills: 50_000_000 };

    const mech = ui.mechs[0]!;
    const reactor = recordNodeSpec(mech, 'reactor');
    const want = {
      reactor: { tier: reactor.tier === 5 ? 4 : reactor.tier + 1, cls: 'standard' as const },
      frame: { tier: recordNodeSpec(mech, 'frame').tier, cls: 'military' as const },
    };

    const before = ui.orderQuote(mech, want);
    expect(before.deliverable, 'на стартовом мире заказ доступен').toBe(true);
    expect(before.toOrder.length).toBeGreaterThan(0);
    expect(before.inTransit).toEqual([]);

    expect(ui.run({ kind: 'orderPart', items: before.toOrder })).toBe(true);

    // Одна строка на заказ, сколько бы позиций в нём ни было.
    const ordered = ui.logs.filter((l) => l.text.startsWith('Заказано'));
    expect(ordered).toHaveLength(1);

    const after = ui.orderQuote(mech, want);
    expect(after.toOrder).toEqual([]);
    expect(after.inTransit).toHaveLength(before.toOrder.length);

    ui.run({ kind: 'advance', days: before.days });
    expect(ui.logs.some((l) => l.text.startsWith('Заказ доставлен'))).toBe(true);
    const done = ui.orderQuote(mech, want);
    expect(done.inTransit).toEqual([]);
    expect(done.ready).toHaveLength(before.toOrder.length);
  });
});
