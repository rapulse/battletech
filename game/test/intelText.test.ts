import { describe, expect, it } from 'vitest';
import { intelSurpriseText } from '../src/ui/state/intelText.js';

/** Строка «разведка ошиблась» (шаг 61): обе стороны ошибки названы, числа те же, что дало ядро. */
describe('расхождение сводки словами', () => {
  it('в бою: недооценила, когда на поле больше обещанного', () => {
    const text = intelSurpriseText({ declared: 2, actual: 3 }, 'battle');
    expect(text).toContain('недооценила');
    expect(text).toContain('3 машины');
    expect(text).toContain('вместо 2');
  });

  it('в бою: переоценила, когда на поле меньше обещанного', () => {
    const text = intelSurpriseText({ declared: 5, actual: 4 }, 'battle');
    expect(text).toContain('переоценила');
    expect(text).toContain('4 машины');
    expect(text).toContain('вместо 5');
  });

  it('склонение слова «машина» по числу', () => {
    expect(intelSurpriseText({ declared: 3, actual: 1 }, 'battle')).toContain('1 машина');
    expect(intelSurpriseText({ declared: 3, actual: 5 }, 'battle')).toContain('5 машин');
  });

  it('в разборе говорит, что условие контракта не менялось', () => {
    expect(intelSurpriseText({ declared: 2, actual: 3 }, 'debrief')).toContain('Условие контракта от этого не менялось');
  });
});
