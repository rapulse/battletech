import { describe, expect, it } from 'vitest';
import { makePlatform } from '../src/core/rules/construction.js';
import { STANDARD_QUALITY } from '../src/core/model/QualityClass.js';

describe('Расчёт узлов и классов исполнения (NodeInspector)', () => {
  it('корректно рассчитывает дельты реактора R1..R5 для 55-тонника', () => {
    const tonnage = 55;
    const techBase = 'is';
    const installed = makePlatform(techBase, tonnage, 3, 2, STANDARD_QUALITY);

    expect(installed.reactorTier).toBe(3);
    expect(installed.walkMP).toBe(6); // medium R3 walk MP (шаг 49: сетка [4..8])
    expect(installed.runMP).toBe(9); // floor(6 * 1.5)
    expect(installed.baseHeatDiss).toBe(10); // IS standard

    // Переключение на R4
    const previewR4 = makePlatform(techBase, tonnage, 4, 2, STANDARD_QUALITY);
    expect(previewR4.walkMP).toBe(7);
    expect(previewR4.runMP).toBe(10);
    expect(previewR4.walkMP - installed.walkMP).toBe(1);
    expect(previewR4.runMP - installed.runMP).toBe(1);
    expect(previewR4.reactorMass).toBeGreaterThan(installed.reactorMass);

    // Переключение на R2
    const previewR2 = makePlatform(techBase, tonnage, 2, 2, STANDARD_QUALITY);
    expect(previewR2.walkMP).toBe(5);
    expect(previewR2.runMP).toBe(7);
    expect(previewR2.walkMP - installed.walkMP).toBe(-1);
    expect(previewR2.reactorMass).toBeLessThan(installed.reactorMass);
  });

  it('корректно рассчитывает влияние классов качества В, С, А, М на реактор', () => {
    const tonnage = 55;
    const techBase = 'is';
    const tier = 3;

    const standard = makePlatform(techBase, tonnage, tier, 1, { reactor: 'standard', frame: 'standard' });
    const recovered = makePlatform(techBase, tonnage, tier, 1, { reactor: 'recovered', frame: 'standard' });
    const military = makePlatform(techBase, tonnage, tier, 1, { reactor: 'military', frame: 'standard' });
    const master = makePlatform(techBase, tonnage, tier, 1, { reactor: 'master', frame: 'standard' });

    // Масса: recovered x1.20, military x0.85, master x0.70
    expect(recovered.reactorMass).toBeGreaterThan(standard.reactorMass);
    expect(military.reactorMass).toBeLessThan(standard.reactorMass);
    expect(master.reactorMass).toBeLessThan(military.reactorMass);

    // Отвод тепла: standard 10, recovered 9 (-1), military 11 (+1), master 12 (+2).
    // Сдвиги вдвое меньше шага 46: шаг 51 вернул тепло оружия к канону, и класс
    // реактора обязан стоить в стволах столько же, сколько стоил.
    expect(standard.baseHeatDiss).toBe(10);
    expect(recovered.baseHeatDiss).toBe(9);
    expect(military.baseHeatDiss).toBe(11);
    expect(master.baseHeatDiss).toBe(12);

    // Крит реактора в канонической тепловой шкале (шаг 51): standard 2,
    // recovered 3, military 2, master 1.
    expect(standard.reactorCritHeat).toBe(2);
    expect(recovered.reactorCritHeat).toBe(3);
    expect(military.reactorCritHeat).toBe(2);
    expect(master.reactorCritHeat).toBe(1);
  });

  it('корректно рассчитывает дельты силового каркаса F1..F3 и классов качества', () => {
    const tonnage = 55;
    const techBase = 'is';

    const f1 = makePlatform(techBase, tonnage, 3, 1, STANDARD_QUALITY);
    const f2 = makePlatform(techBase, tonnage, 3, 2, STANDARD_QUALITY);
    const f3 = makePlatform(techBase, tonnage, 3, 3, STANDARD_QUALITY);

    // Масса каркаса: F1 12%, F2 8%, F3 5%
    expect(f1.frameMass).toBe(Math.round(55 * 0.12 * 4) / 4);
    expect(f2.frameMass).toBe(Math.round(55 * 0.08 * 4) / 4);
    expect(f3.frameMass).toBe(Math.round(55 * 0.05 * 4) / 4);
    expect(f3.frameMass).toBeLessThan(f2.frameMass);
    expect(f2.frameMass).toBeLessThan(f1.frameMass);

    // Штрафы слотов: F1 0, F2 -5, F3 -14
    expect(f1.frameSlotPenalty).toBe(0);
    expect(f2.frameSlotPenalty).toBe(5);
    expect(f3.frameSlotPenalty).toBe(14);
    expect(f1.freeSlotsTotal).toBeGreaterThan(f2.freeSlotsTotal);
    expect(f2.freeSlotsTotal).toBeGreaterThan(f3.freeSlotsTotal);

    // Влияние качества каркаса
    const masterFrame = makePlatform(techBase, tonnage, 3, 2, { reactor: 'standard', frame: 'master' });
    const recoveredFrame = makePlatform(techBase, tonnage, 3, 2, { reactor: 'standard', frame: 'recovered' });

    // Мастерский каркас: структура x1.15, слоты +2 в торсе
    expect(masterFrame.totalStructure).toBeGreaterThan(f2.totalStructure);
    expect(masterFrame.maxArmorPts).toBe(masterFrame.totalStructure * 2);
    expect(masterFrame.freeSlotsTotal - f2.freeSlotsTotal).toBe(2);

    // Восстановленный каркас: структура x0.90, слоты -2 в торсе
    expect(recoveredFrame.totalStructure).toBeLessThan(f2.totalStructure);
    expect(recoveredFrame.freeSlotsTotal - f2.freeSlotsTotal).toBe(-2);
  });

  it('для негуманоидов (локомоция N) допустимы только F2 и F3, F1 бросает RangeError', () => {
    const tonnage = 20; // e.g. Locust
    const techBase = 'is';
    expect(() => makePlatform(techBase, tonnage, 5, 1, undefined, 'N')).toThrow(RangeError);
    expect(() => makePlatform(techBase, tonnage, 5, 2, undefined, 'N')).not.toThrow();
    expect(() => makePlatform(techBase, tonnage, 5, 3, undefined, 'N')).not.toThrow();
  });
});
