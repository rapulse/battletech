import { describe, expect, it } from 'vitest';
import { lanceGroups, takeLance, type LanceCandidate } from '../src/ui/state/lanceGroups.js';

/** Звенья парка (шаг 60): порядок массива задаёт группу, кнопка звена выбирает годных. */
const ids = (n: number): string[] => Array.from({ length: n }, (_, i) => `m${i + 1}`);
const fit = (id: string): LanceCandidate => ({ id, skip: null });

describe('lanceGroups', () => {
  it('десять машин при звене 4 режутся 4+4+2, счётчик у каждого звена', () => {
    const g = lanceGroups(ids(10), 4);
    expect(g.map((x) => x.count)).toEqual([4, 4, 2]);
    expect(g.map((x) => x.number)).toEqual([1, 2, 3]);
    expect(g.every((x) => x.size === 4)).toBe(true);
    expect(g[2]?.mechs).toEqual(['m9', 'm10']);
  });

  it('пустой парк — нет групп', () => {
    expect(lanceGroups([], 4)).toEqual([]);
  });

  it('звено 1 — группа на каждую машину; нулевой размер не зацикливает', () => {
    expect(lanceGroups(ids(3), 1).map((x) => x.count)).toEqual([1, 1, 1]);
    expect(lanceGroups(ids(3), 0)).toHaveLength(3);
  });

  it('перестановка через границу меняет состав звеньев', () => {
    const order = ids(6);
    const [moved] = order.splice(4, 1); // m5 из второго звена
    order.splice(0, 0, moved as string);
    const g = lanceGroups(order, 4);
    expect(g[0]?.mechs).toEqual(['m5', 'm1', 'm2', 'm3']);
    expect(g[1]?.mechs).toEqual(['m4', 'm6']);
  });
});

describe('takeLance', () => {
  it('берёт годных, пропущенных считает по причинам', () => {
    const group: LanceCandidate[] = [fit('a'), { id: 'b', skip: 'inWork' }, { id: 'c', skip: 'noPilot' }, fit('d')];
    const r = takeLance(group, [], 4);
    expect(r.lance).toEqual(['a', 'd']);
    expect(r.action).toBe('added');
    expect(r.skipped).toEqual({ inWork: 1, noPilot: 1 });
    expect(r.overflow).toBe(0);
  });

  it('не трогает выбранных из других звеньев: смешанный вывод остаётся возможным', () => {
    const r = takeLance([fit('c'), fit('d')], ['a', 'x'], 4);
    expect(r.lance).toEqual(['a', 'x', 'c', 'd']);
  });

  it('упирается в потолок судна и говорит, сколько не влезло', () => {
    const r = takeLance([fit('a'), fit('b'), fit('c'), fit('d')], ['x', 'y'], 4);
    expect(r.lance).toEqual(['x', 'y', 'a', 'b']);
    expect(r.overflow).toBe(2);
  });

  it('уже выбранных не дублирует и не считает лишними', () => {
    const r = takeLance([fit('a'), fit('b')], ['a'], 2);
    expect(r.lance).toEqual(['a', 'b']);
    expect(r.overflow).toBe(0);
  });

  it('когда все годные звена уже выбраны, снимает именно их', () => {
    const group: LanceCandidate[] = [fit('a'), { id: 'b', skip: 'wreck' }, fit('c')];
    const r = takeLance(group, ['a', 'c', 'x'], 4);
    expect(r.lance).toEqual(['x']);
    expect(r.action).toBe('removed');
    expect(r.skipped).toEqual({ wreck: 1 });
  });

  it('звено без единой годной машины ничего не выбирает', () => {
    const r = takeLance([{ id: 'a', skip: 'inWork' }], ['x'], 4);
    expect(r.lance).toEqual(['x']);
    expect(r.action).toBe('added');
    expect(r.skipped).toEqual({ inWork: 1 });
  });
});
