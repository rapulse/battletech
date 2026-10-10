import { describe, expect, it } from 'vitest';
import type { WarehouseEntry } from '../src/core/campaign/company/types.js';
import { stackKey, stackOrder, stackWarehouse } from '../src/ui/campaign/warehouseStacks.js';

const item = (id: string, itemId: string): WarehouseEntry => ({ sort: 'item', id, itemId, kind: 'heatsink' });
const node = (id: string, over: Partial<Extract<WarehouseEntry, { sort: 'node' }>> = {}): WarehouseEntry => ({
  sort: 'node',
  id,
  node: 'reactor',
  quality: 'standard',
  wear: 0,
  sourceTonnage: 55,
  tier: 2,
  ...over,
});

describe('склад стопками', () => {
  it('одинаковые установки сливаются в одну стопку с числом, порядок — по первому появлению', () => {
    const stacks = stackWarehouse([
      item('a', 'is_shs'),
      item('b', 'is_ml'),
      item('c', 'is_shs'),
      item('d', 'is_shs'),
    ]);
    expect(stacks.map((s) => [s.head.id, s.count])).toEqual([
      ['a', 3],
      ['b', 1],
    ]);
    expect(stacks[0]!.entries.map((e) => e.id)).toEqual(['a', 'c', 'd']);
  });

  it('когда одна запись уходит со склада, число в стопке уменьшается, а следующая становится верхней', () => {
    const all = [item('a', 'is_shs'), item('b', 'is_shs'), item('c', 'is_shs')];
    const after = stackWarehouse(all.filter((e) => e.id !== 'a'));
    expect(after).toHaveLength(1);
    expect(after[0]!.count).toBe(2);
    expect(after[0]!.head.id).toBe('b');
  });

  it('узлы сливаются только при полном совпадении вида, класса, тоннажа, тира и износа', () => {
    const same = stackWarehouse([node('a'), node('b')]);
    expect(same).toHaveLength(1);
    expect(same[0]!.count).toBe(2);

    for (const other of [
      node('c', { node: 'frame' }),
      node('c', { quality: 'military' }),
      node('c', { sourceTonnage: 60 }),
      node('c', { tier: 3 }),
      node('c', { wear: 12 }),
    ]) {
      expect(stackKey(other)).not.toBe(stackKey(node('a')));
      expect(stackWarehouse([node('a'), other])).toHaveLength(2);
    }
  });

  it('признак split разводит одинаковые записи по разным стопкам', () => {
    const stacks = stackWarehouse([item('a', 'is_shs'), item('b', 'is_shs'), item('c', 'is_shs')], (e) =>
      e.id === 'a' ? 'work' : '',
    );
    expect(stacks.map((s) => [s.head.id, s.count])).toEqual([
      ['a', 1],
      ['b', 2],
    ]);
  });

  it('порядок стопок не зависит от того, какие записи потрачены: поставленная стопка остаётся на месте', () => {
    // Регрессия 2026-09-20: стопка стояла «по первой записи», при установке уходили
    // первые записи, и она проваливалась вниз списка.
    const name = (id: string): string => id;
    const shelf: WarehouseEntry[] = [
      item('b1', 'is_shs'),
      item('b2', 'is_shs'),
      item('a1', 'is_ml'),
      item('c1', 'is_dhs'),
      item('b3', 'is_shs'),
    ];
    const order = stackOrder(name);
    const keys = (list: readonly WarehouseEntry[], o?: typeof order): string[] =>
      stackWarehouse(list, undefined, o).map((s) => s.key);
    const spent = shelf.filter((e) => e.id !== 'b1' && e.id !== 'b2');

    // Без порядка стопка «ездит»: первая запись ушла, верхней стала b3 — в конце списка.
    expect(keys(spent)).not.toEqual(keys(shelf));

    const before = keys(shelf, order);
    const after = keys(spent, order);
    expect(after).toEqual(before);
  });

  it('порядок: установки по алфавиту, узлы после установок, сильный класс раньше слабого', () => {
    const order = stackOrder((id) => id);
    const stacks = stackWarehouse(
      [node('n1', { quality: 'recovered' }), item('i2', 'is_shs'), node('n2', { quality: 'master' }), item('i1', 'is_dhs')],
      undefined,
      order,
    );
    expect(stacks.map((s) => s.head.id)).toEqual(['i1', 'i2', 'n2', 'n1']);
  });
});
