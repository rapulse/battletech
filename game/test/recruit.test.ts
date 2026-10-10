import { describe, expect, it } from 'vitest';
import { NAMES, PILOTS } from '../src/core/data/tables.js';
import { CLAN_IDS, HOUSE_IDS, isClan } from '../src/core/rules/names.js';
import { Rng } from '../src/core/rng/index.js';
import { CampaignRejectReason, CampaignState, execute, foundingInit, rollRecruit } from '../src/core/campaign/index.js';
import { hashCampaignState } from '../src/core/campaign/hash.js';
import { makeSaveFile, parseSaveFile, restore, snapshot } from '../src/core/campaign/index.js';

/**
 * Найм переработан 2026-09-10: попытка вместо покупки.
 *
 * Проверяется то, что глазами не поймать: полосы выучки не пересекаются,
 * клановцы редки, а лицо, пол и имя пилота собраны согласованно. Последнее —
 * не косметика: имя подбирается ПОД ПОЛ нарисованного лица, и разъедься эти
 * трое, в роте появится Керенский с портретом женщины из Дома Ляо.
 */

const FACES = PILOTS.faces as unknown as Record<string, { male: number[]; female: number[] }>;

function facesOf(affiliation: string): { male: number[]; female: number[] } {
  const set = FACES[isClan(affiliation) ? affiliation : 'sphere'];
  if (set === undefined) throw new Error(`нет лиц для ${affiliation}`);
  return set;
}

describe('кандидат в найме', () => {
  it('полосы Сферы и кланов не пересекаются: выше сферного потолка приходят только клановцы', () => {
    const rng = new Rng(4242);
    for (let i = 0; i < 3000; i++) {
      const p = rollRecruit(rng, `к-${i}`);
      const levels = Object.values(p.skills);
      if (isClan(p.affiliation)) {
        expect(Math.min(...levels), `${p.name}: клановец ниже своей полосы`).toBeGreaterThanOrEqual(
          PILOTS.recruits.clan.minTier,
        );
      } else {
        expect(Math.max(...levels), `${p.name}: сферный выше своей полосы`).toBeLessThanOrEqual(
          PILOTS.recruits.sphere.maxTier,
        );
      }
    }
  });

  it('потолок таланта держится в границах своей полосы: клановцу всегда есть куда расти', () => {
    const rng = new Rng(555);
    for (let i = 0; i < 2000; i++) {
      const p = rollRecruit(rng, `к-${i}`);
      const band = isClan(p.affiliation) ? PILOTS.recruits.clan : PILOTS.recruits.sphere;
      for (const [skill, cap] of Object.entries(p.caps)) {
        const level = p.skills[skill] ?? 0;
        expect(cap, `${p.name}: потолок ${skill} ниже уровня`).toBeGreaterThanOrEqual(level);
        // Потолок ниже полосы бывает ровно в одном случае — его подпёр уровень,
        // а он в полосе по построению. Поэтому проверяется нижняя граница
        // полосы, а не «cap >= capMin» вслепую.
        expect(cap, `${p.name}: потолок ${skill} ниже полосы`).toBeGreaterThanOrEqual(
          Math.min(band.capMin, level),
        );
        expect(cap, `${p.name}: потолок ${skill} выше полосы`).toBeLessThanOrEqual(band.capMax);
      }
    }
  });

  it('клановцу остаётся расти, а не приходить упёршимся в себя', () => {
    const rng = new Rng(606);
    let room = 0;
    let n = 0;
    for (let i = 0; i < 6000; i++) {
      const p = rollRecruit(rng, `к-${i}`);
      if (!isClan(p.affiliation)) continue;
      n++;
      const skills = Object.keys(p.skills);
      room +=
        skills.reduce((sum, k) => sum + ((p.caps[k] ?? 0) - (p.skills[k] ?? 0)), 0) / skills.length;
    }
    // До правки 2026-09-10 запас был около 0.26 ступени: потолок 4-10 почти
    // всегда подпирался уровнем 8-10, и клановец приходил законченным.
    expect(room / n).toBeGreaterThan(0.6);
  });

  it('клановцы редки, и их доля держится у заявленной', () => {
    const rng = new Rng(77);
    const N = 4000;
    let clan = 0;
    for (let i = 0; i < N; i++) if (isClan(rollRecruit(rng, `к-${i}`).affiliation)) clan++;
    const share = clan / N;
    // Полоса допуска широкая намеренно: проверяется порядок величины, а не
    // точность генератора — тест не должен падать от смены сида.
    expect(share).toBeGreaterThan(PILOTS.recruits.clanChance * 0.6);
    expect(share).toBeLessThan(PILOTS.recruits.clanChance * 1.6);
  });

  it('лицо, пол и имя собраны согласованно', () => {
    const rng = new Rng(9);
    for (let i = 0; i < 500; i++) {
      const p = rollRecruit(rng, `к-${i}`);
      const set = facesOf(p.affiliation);
      expect(set[p.gender], `${p.name}: лицо не из своего набора`).toContain(p.face);

      const first = p.name.split(' ')[0] ?? '';
      const pool = isClan(p.affiliation)
        ? NAMES.clan.given[p.gender]
        : NAMES.sphere[p.affiliation as keyof typeof NAMES.sphere][p.gender];
      expect(pool, `${p.name}: имя не из пула своего пола`).toContain(first);

      if (isClan(p.affiliation)) {
        // КЛАНОВЦА ЗОВУТ ОДНИМ ИМЕНЕМ. Фамилий у кланов нет, а родовое имя —
        // редкость, и его носитель не пойдёт в наёмники Сферы (правка лора
        // 2026-09-10). Проверяется буквально: в имени нет пробела.
        expect(p.name, `${p.name}: у клановца не должно быть второго имени`).toBe(first);
      } else {
        expect(p.name.split(' ').length, `${p.name}: наёмник Сферы без фамилии`).toBeGreaterThan(1);
      }
    }
  });

  it('принадлежность всегда из реестра: дом либо один из четырёх нарисованных кланов', () => {
    const rng = new Rng(31);
    const known = new Set([...HOUSE_IDS, ...CLAN_IDS]);
    for (let i = 0; i < 300; i++) {
      expect(known).toContain(rollRecruit(rng, `к-${i}`).affiliation);
    }
  });

  it('имя не повторяет портрет: одно лицо приходит с разными именами', () => {
    const rng = new Rng(5);
    const byFace = new Map<string, Set<string>>();
    for (let i = 0; i < 400; i++) {
      const p = rollRecruit(rng, `к-${i}`);
      const key = `${p.affiliation}/${p.face}`;
      const names = byFace.get(key) ?? new Set<string>();
      names.add(p.name);
      byFace.set(key, names);
    }
    const repeated = [...byFace.values()].filter((names) => names.size > 1);
    expect(repeated.length, 'ни одно лицо не встретилось с разными именами').toBeGreaterThan(5);
  });
});

describe('стартовая тройка', () => {
  it('тянется той же таблицей, что найм: имена настоящие, а не «Пилот-1»', () => {
    for (const seed of [1, 2, 3, 11, 77]) {
      const pilots = foundingInit(seed).pilots ?? [];
      expect(pilots).toHaveLength(3);
      for (const p of pilots) {
        expect(p.name).not.toMatch(/^Пилот-/);
        expect(facesOf(p.affiliation)[p.gender]).toContain(p.face);
      }
    }
  });

  it('один и тот же сид даёт ту же тройку, разные сиды — разную', () => {
    const names = (seed: number): string => (foundingInit(seed).pilots ?? []).map((p) => p.name).join('|');
    const a = names(12345);
    const b = names(12345);
    const c = names(54321);
    expect(b).toBe(a);
    expect(c).not.toBe(a);
  });

  it('соперникам достаётся прежний путь: заданный потолок выучки означает сборку по числам', () => {
    // Полоса найма сюда не применяется — иначе у соперников появились бы
    // клановые пилоты, которых `rivals.json` не заказывал.
    const pilots = foundingInit(7, { pilotTierMin: 5, pilotTierMax: 5, idPrefix: 'R' }).pilots ?? [];
    for (const p of pilots) {
      expect(isClan(p.affiliation)).toBe(false);
      // Разброс `makePilot` даёт ±1 к заказанной ступени плюс сдвиг
      // происхождения — потолка полосы найма здесь нет вовсе.
      expect(Math.max(...Object.values(p.skills))).toBeLessThanOrEqual(7);
    }
  });
});

describe('найм в состоянии кампании', () => {
  const rich = (): CampaignState => {
    const state = new CampaignState(3, { company: { ...foundingInit(3), cbills: 500_000 } });
    return state;
  };

  it('кандидат переживает сохранение вместе с уплаченным поиском', () => {
    const state = rich();
    expect(execute(state, { kind: 'searchRecruit', id: 'н-1' }).ok).toBe(true);
    const before = hashCampaignState(state);

    const back = restore(parseSaveFile(JSON.parse(JSON.stringify(makeSaveFile(snapshot(state))))));
    expect(hashCampaignState(back)).toBe(before);
    expect(back.recruit?.name).toBe(state.recruit?.name);
    expect(back.hireReadyDay).toBe(state.hireReadyDay);

    // И решение по нему принимается после загрузки — тем же кандидатом.
    expect(execute(back, { kind: 'hireRecruit' }).ok).toBe(true);
    expect(back.company.pilots.at(-1)?.name).toBe(state.recruit?.name);
  });

  it('перезагрузка не даёт переиграть бросок: тот же кандидат, а не новый', () => {
    const state = rich();
    execute(state, { kind: 'searchRecruit', id: 'н-1' });
    const first = state.recruit?.name;

    const back = restore(parseSaveFile(JSON.parse(JSON.stringify(makeSaveFile(snapshot(state))))));
    expect(back.recruit?.name).toBe(first);
    expect(execute(back, { kind: 'searchRecruit', id: 'н-2' })).toEqual({
      ok: false,
      reason: CampaignRejectReason.RecruitPending,
    });
  });
});
