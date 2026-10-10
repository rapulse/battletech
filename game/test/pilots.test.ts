import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PILOTS } from '../src/core/data/tables.js';
import { Rng } from '../src/core/rng/index.js';
import {
  masteryTier,
  MAX_SKILL,
  MIN_SKILL,
  skillLevel,
  type Pilot,
} from '../src/core/model/index.js';
import {
  addInjuries,
  awardXp,
  botchOdds,
  composureBotch,
  gunneryBase,
  injuryOdds,
  levelCost,
  makePilot,
  markLost,
  OUT_AT,
  poiseChance,
  rollExecution,
  rollInjury,
  trainSkill,
} from '../src/core/rules/index.js';

function pilot(overrides: Record<string, number> = {}, rest: Partial<Pilot> = {}): Pilot {
  const p = makePilot(new Rng(99), { id: 'тест', tier: 5 });
  return { ...p, skills: { ...p.skills, ...overrides }, firstBattle: false, ...rest };
}

describe('таблицы навыков', () => {
  it('выше навык — ниже целевое число и реже срыв', () => {
    for (let l = 2; l <= MAX_SKILL; l++) {
      expect(gunneryBase(l)).toBeLessThanOrEqual(gunneryBase(l - 1));
      expect(composureBotch(l)).toBeLessThanOrEqual(composureBotch(l - 1));
    }
    expect(gunneryBase(1)).toBeGreaterThan(gunneryBase(MAX_SKILL));
  });

  it('даже легенда срывается — идеальных пилотов не бывает', () => {
    expect(composureBotch(MAX_SKILL)).toBeGreaterThan(0);
  });

  it('уровень вне диапазона зажимается, а не роняет расчёт', () => {
    expect(gunneryBase(0)).toBe(gunneryBase(MIN_SKILL));
    expect(gunneryBase(99)).toBe(gunneryBase(MAX_SKILL));
  });

  it('ступени мастерства покрывают весь диапазон', () => {
    const tiers = new Set<string>();
    for (let l = MIN_SKILL; l <= MAX_SKILL; l++) tiers.add(masteryTier(l));
    expect(tiers.size).toBe(5);
  });

  it('стоимость уровня растёт квадратично', () => {
    expect(levelCost(2) / levelCost(1)).toBeCloseTo(4, 5);
    expect(levelCost(9)).toBeGreaterThan(levelCost(1) * 50);
  });
});

describe('проверка исполнения', () => {
  it('обстановка добавляет к срыву, но итог ограничен сверху', () => {
    const calm = botchOdds(pilot({ composure: 10 }));
    const rough = botchOdds(pilot({ composure: 1 }, { injuries: 5, firstBattle: true }), {
      overheated: true,
      damageTakenThisTurn: 50,
      structureBreached: true,
      fellThisTurn: true,
    });
    expect(rough.chance).toBeGreaterThan(calm.chance);
    expect(rough.capped).toBe(true);
    expect(rough.chance).toBeLessThanOrEqual(0.6);
  });

  it('каждая причина срыва названа — иначе журнал не сможет её объяснить', () => {
    const odds = botchOdds(pilot({ composure: 4 }, { injuries: 2, firstBattle: true }), {
      overheated: true,
      fellThisTurn: true,
    });
    const keys = odds.factors.map((f) => f.key);
    expect(keys).toContain('botch.heat');
    expect(keys).toContain('botch.fell');
    expect(keys).toContain('botch.injuries');
    expect(keys).toContain('botch.firstBattle');
    for (const f of odds.factors) expect(f.amount).toBeGreaterThan(0);
  });

  it('частота срывов сходится к заявленной вероятности', () => {
    const rng = new Rng(555);
    const p = pilot({ composure: 5 });
    const expected = botchOdds(p).chance;
    let botched = 0;
    const n = 40000;
    for (let i = 0; i < n; i++) if (rollExecution(rng, p).botched) botched += 1;
    expect(botched / n).toBeCloseTo(expected, 2);
  });

  it('собранность включается только с восьмого уровня', () => {
    expect(poiseChance(pilot({ composure: 7 }))).toBe(0);
    expect(poiseChance(pilot({ composure: 8 }))).toBeGreaterThan(0);
    expect(poiseChance(pilot({ composure: 10 }))).toBeGreaterThan(
      poiseChance(pilot({ composure: 8 })),
    );
  });
});

describe('ранения пилота', () => {
  it('пробитый кокпит опаснее выдержавшей брони в разы', () => {
    const p = pilot();
    const held = injuryOdds(p, 'headArmor').chance;
    const breached = injuryOdds(p, 'headStructure').chance;
    expect(breached).toBeGreaterThan(held * 2);
  });

  it('обычное попадание почти безопасно — иначе пилоты выбывали бы каждый бой', () => {
    const p = pilot();
    expect(injuryOdds(p, 'massiveDamage').chance).toBeLessThan(0.15);
    expect(injuryOdds(p, 'fall').chance).toBeLessThan(0.15);
    expect(injuryOdds(p, 'headStructure').chance).toBeGreaterThan(
      injuryOdds(p, 'massiveDamage').chance * 3,
    );
  });

  it('выносливость снижает вероятность ранения', () => {
    const weak = injuryOdds(pilot({ endurance: 1 }), 'headArmor').chance;
    const tough = injuryOdds(pilot({ endurance: 10 }), 'headArmor').chance;
    expect(tough).toBeLessThan(weak);
  });

  it('набранный порог ранений выводит пилота из боя', () => {
    let p = pilot();
    expect(p.status).toBe('active');
    p = addInjuries(p, OUT_AT - 1);
    expect(p.status).toBe('active');
    p = addInjuries(p, 1);
    expect(p.status).toBe('out');
    expect(p.injuries).toBe(OUT_AT);
  });

  it('травмы просаживают стрельбу и пилотирование, но не тактику', () => {
    const hurt = pilot({ gunnery: 6, piloting: 6, tactics: 6 }, { injuries: 4 });
    expect(skillLevel(hurt, 'gunnery')).toBe(4);
    expect(skillLevel(hurt, 'piloting')).toBe(4);
    expect(skillLevel(hurt, 'tactics')).toBe(6);
  });

  it('потерянный пилот больше не бросает на ранение', () => {
    const rng = new Rng(3);
    const lost = markLost(pilot());
    const res = rollInjury(rng, lost, 'headStructure');
    expect(res.injured).toBe(false);
    expect(res.pilot).toBe(lost);
  });

  it('частота ранений сходится к заявленной вероятности', () => {
    const rng = new Rng(808);
    const p = pilot({ endurance: 5 });
    const expected = injuryOdds(p, 'headArmor').chance;
    let hurt = 0;
    const n = 40000;
    for (let i = 0; i < n; i++) if (rollInjury(rng, p, 'headArmor').injured) hurt += 1;
    expect(hurt / n).toBeCloseTo(expected, 2);
  });
});

describe('создание и рост пилота', () => {
  it('один сид даёт одного и того же пилота', () => {
    const a = makePilot(new Rng(4242), { id: 'к', tier: 5 });
    const b = makePilot(new Rng(4242), { id: 'к', tier: 5 });
    expect(a).toEqual(b);
  });

  it('потолок таланта не ниже стартового уровня и в пределах правил', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const p = makePilot(new Rng(seed), { id: 'к', tier: 5 });
      for (const [id, level] of Object.entries(p.skills)) {
        const cap = p.caps[id] ?? 0;
        expect(cap).toBeGreaterThanOrEqual(level);
        expect(cap).toBeLessThanOrEqual(MAX_SKILL);
        expect(level).toBeGreaterThanOrEqual(MIN_SKILL);
      }
    }
  });

  it('опыт начисляется в тот навык, за который заработан', () => {
    const p = awardXp(pilot(), 'hit');
    expect(p.xp['gunnery']).toBeGreaterThan(0);
    expect(p.xp['piloting'] ?? 0).toBe(0);
  });

  it('уровень растёт только при хватающем опыте и ниже потолка', () => {
    const base = pilot({ gunnery: 3 });
    const poor = { ...base, xp: { ...base.xp, gunnery: 5 } };
    expect(trainSkill(poor, 'gunnery').skills['gunnery']).toBe(3);

    const rich = { ...base, xp: { ...base.xp, gunnery: levelCost(3) } };
    expect(trainSkill(rich, 'gunnery').skills['gunnery']).toBe(4);

    const capped = { ...rich, caps: { ...rich.caps, gunnery: 3 } };
    expect(trainSkill(capped, 'gunnery').skills['gunnery']).toBe(3);
  });

  it('опыт сам переходит в уровни — несколько подряд, но не выше потолка', () => {
    const base = pilot({ gunnery: 3 });
    // Опыта на два уровня с остатком: 3 → 4 → 5, остаток остаётся на счету.
    const stock = levelCost(3) + levelCost(4) + 1;
    const funded = { ...base, caps: { ...base.caps, gunnery: 8 }, xp: { ...base.xp, gunnery: stock - 1 } };
    const grown = awardXp(funded, 'hit');
    expect(grown.skills['gunnery']).toBe(5);
    expect(grown.xp['gunnery']).toBe(1);

    const capped = { ...funded, caps: { ...funded.caps, gunnery: 4 } };
    const held = awardXp(capped, 'hit');
    expect(held.skills['gunnery']).toBe(4);
    expect(held.xp['gunnery']).toBe(stock - levelCost(3));
  });
});

describe('источники опыта не бывают мёртвыми', () => {
  /**
   * Каждое событие опыта из `data/pilots.json` обязано где-то начисляться.
   *
   * Тест грубый — обход исходников на имя события, — но ловит ровно тот способ,
   * каким мёртвая строка и заводится: таблицу в данных дописали, а звать её не
   * стали. Так с шага 11 до 2026-09-10 прожили четыре события из семи:
   * Тактика, Хладнокровие, Техника и Выносливость не росли НИКОГДА, и по игре
   * это читалось как «настрелял полсотни машин, а навыки на месте».
   */
  const SRC = resolve(__dirname, '..', 'src');

  function collect(dir: string, out: string[]): void {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) collect(path, out);
      else if (entry.endsWith('.ts') || entry.endsWith('.svelte')) out.push(path);
    }
  }

  it('каждое событие из данных кто-то начисляет', () => {
    const files: string[] = [];
    collect(SRC, files);
    const code = files.map((f) => readFileSync(f, 'utf8')).join('\n');
    for (const event of Object.keys(PILOTS.progression.xp)) {
      expect(code.includes(`'${event}'`), `опыт за «${event}» описан в данных, но не начисляется`).toBe(true);
    }
  });
});
