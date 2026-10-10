import { describe, expect, it } from 'vitest';
import { skillGuide } from '../src/ui/campaign/skillGuide.js';

/**
 * Подсказка казарм обязана называть уровень, на котором навык РЕАЛЬНО станет
 * лучше, а не просто следующий: таблицы ступенчатые (`data/pilots.json`).
 */
describe('подсказка навыков в казармах', () => {
  it('перескакивает уровни, которые ничего не меняют', () => {
    // Стрельба 5, 6 и 7 дают одну базу 4; следующая польза — на 8.
    const g = skillGuide('gunnery', 5, 5, 10);
    expect(g.now).toContain('4+');
    expect(g.next).toContain('8');
    expect(g.next).toContain('3+');
  });

  it('говорит, что польза лежит выше потолка таланта', () => {
    const g = skillGuide('gunnery', 5, 5, 7);
    expect(g.next).toContain('8');
    expect(g.next).toContain('7');
  });

  it('считает иммунитет к проверкам на рельефе пользой Пилотирования', () => {
    // Цель на 2 и 3 одна и та же, но с 3 штатных проверок нет.
    const g = skillGuide('piloting', 2, 2, 10);
    expect(g.next).toContain('3');
  });

  it('учитывает травмы: учится база, действует база минус травмы', () => {
    // Стрельба 5 с травмами до 4: сейчас база 5, уровень 6 даст действующий 5 — базу 4.
    const g = skillGuide('gunnery', 4, 5, 10);
    expect(g.now).toContain('5+');
    expect(g.next).toContain('6');
    expect(g.next).toContain('4+');
  });

  it('на вершине таблицы честно говорит, что улучшать нечего', () => {
    expect(skillGuide('gunnery', 10, 10, 10).next).not.toBe('');
  });

  it('помечает навык, который правилами пока не читается', () => {
    const g = skillGuide('tech', 5, 5, 10);
    expect(g.idle).toBe(true);
  });
});
