import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  CampaignRejectReason,
  CampaignState,
  FACTIONS,
  FACTION_LIST,
  GALAXY,
  GALAXY_RULES,
  START_SYSTEM_ID,
  execute,
  factionsFileSchema,
  findRoute,
  garrisonBand,
  hashCampaignState,
  isAdjacent,
  isSurveyed,
  jumpDistance,
  makeCompany,
  makeRecord,
  makeSaveFile,
  parseSaveFile,
  restore,
  snapshot,
  systemKnowledge,
  systemProfile,
  systemsFileSchema,
  withDelta,
  type CampaignCommand,
  type CampaignEvent,
  type Company,
} from '../src/core/campaign/index.js';
import { BIOME_LIST } from '../src/core/data/index.js';
import { generateAssembly } from '../src/core/rules/index.js';
import { Rng } from '../src/core/rng/index.js';

/**
 * Шаг 14 — галактика: каталог, ленивый профиль, навигация.
 *
 * Проверяется ровно то, на чём стоит решение 4 §2 `часть2-pipeline.md`:
 * каталог грузится и проходит схему, профиль детерминирован и НЕ попадает в
 * сохранение, из любой системы достижима любая другая, дельта переживает
 * круговой прогон, а перелёт не останавливает очередь суток.
 */

function run(state: CampaignState, command: CampaignCommand): readonly CampaignEvent[] {
  const result = execute(state, command);
  if (!result.ok) throw new Error(`Команда ${command.kind} отклонена: ${result.reason}`);
  return result.events;
}

function rich(seed: number, cbills = 50_000_000, company: Partial<Company> = {}): CampaignState {
  const state = new CampaignState(seed);
  state.company = { ...makeCompany(), cbills, ...company };
  return state;
}

/** Система в одном прыжке от заданной — берётся первая по индексу, чтобы тест был воспроизводим. */
function neighborOf(id: string): string {
  const n = GALAXY.neighbors(GALAXY.require(id));
  expect(n.length).toBeGreaterThan(0);
  return GALAXY.id(n[0] as number);
}

describe('каталог галактики', () => {
  it('загружен, проходит схему и не имеет повторов', () => {
    expect(GALAXY.count).toBe(2000);
    expect(new Set(GALAXY.ids).size).toBe(GALAXY.count);
    expect(new Set(GALAXY.names).size).toBe(GALAXY.count);
    expect(GALAXY.jumpRangeLy).toBe(GALAXY_RULES.jump.rangeLy);
  });

  it('владелец каждой системы есть в реестре акторов, а столица каждой фракции — в каталоге', () => {
    for (let i = 0; i < GALAXY.count; i++) {
      expect(FACTIONS.has(GALAXY.ownerId(i))).toBe(true);
    }
    for (const f of FACTION_LIST) {
      if (f.capital !== undefined) expect(GALAXY.has(f.capital)).toBe(true);
    }
  });

  it('стартовая система существует и это якорный мир', () => {
    expect(GALAXY.has(START_SYSTEM_ID)).toBe(true);
    expect(GALAXY.hasFlag(GALAXY.require(START_SYSTEM_ID), 'anchor')).toBe(true);
  });

  it('системы не сидят друг на друге: минимум четыре световых года', () => {
    // Проверка по сетке соседей, а не полным перебором пар: два миллиона
    // сравнений ради того, что заведомо лежит в пределах одного прыжка.
    let min = Number.POSITIVE_INFINITY;
    for (let i = 0; i < GALAXY.count; i++) {
      for (const j of GALAXY.neighbors(i)) {
        const d = GALAXY.distance(i, j);
        if (d < min) min = d;
      }
    }
    expect(min).toBeGreaterThanOrEqual(4);
  });

  it('схемы галактики отсекают опечатку, а не пропускают её молча', () => {
    const faction = { id: 'x', kind: 'house', name: 'Икс', short: 'Икс', color: '#112233' };
    expect(factionsFileSchema.safeParse({ factions: [faction] }).success).toBe(true);
    // Незнакомый вид актора — опечатка в данных, а не расширение формата.
    expect(factionsFileSchema.safeParse({ factions: [{ ...faction, kind: 'аристократия' }] }).success).toBe(false);
    // Лишний ключ: опечатка в имени поля иначе теряется молча.
    expect(factionsFileSchema.safeParse({ factions: [{ ...faction, colour: '#fff' }] }).success).toBe(false);
    // Поле `doctrine` снято шагом 71 (роли решает биом): забытое в данных, оно
    // ловится как лишний ключ, а не молча игнорируется.
    expect(factionsFileSchema.safeParse({ factions: [{ ...faction, doctrine: 'combined' }] }).success).toBe(false);
    // Каталог без колонки координат не грузится вовсе.
    expect(
      systemsFileSchema.safeParse({
        generatorSeed: 1,
        jumpRangeLy: 30,
        starClasses: ['G'],
        columns: { id: ['a'], name: ['A'], x: [0], star: [0], owner: ['comstar'], flags: [0] },
      }).success,
    ).toBe(false);
  });

  it('каталог лежит структурой массивов, а не массивом объектов', () => {
    expect(GALAXY.x).toBeInstanceOf(Float32Array);
    expect(GALAXY.owner).toBeInstanceOf(Uint16Array);
    expect(GALAXY.flags).toBeInstanceOf(Uint8Array);
  });
});

describe('вторжение кланов (эпоха 3053)', () => {
  const owned = (id: string): number[] => {
    const out: number[] = [];
    for (let i = 0; i < GALAXY.count; i++) if (GALAXY.ownerId(i) === id) out.push(i);
    return out;
  };

  const CLANS = ['jade_falcon', 'wolf', 'ghost_bear', 'smoke_jaguar', 'steel_viper', 'nova_cat'];

  it('четыре зоны оккупации стоят на карте, и все шесть кланов держат миры', () => {
    for (const id of CLANS) {
      expect(FACTIONS.get(id)?.kind).toBe('clan');
      expect(owned(id).length).toBeGreaterThan(10);
    }
    // Кланы заняли заметную долю приграничья, но не половину Сферы.
    const total = CLANS.reduce((s, id) => s + owned(id).length, 0);
    expect(total).toBeGreaterThan(150);
    expect(total / GALAXY.count).toBeLessThan(0.2);
  });

  it('Стальная Гадюка делит зону с Нефритовым Кречетом, Новая Кошка — с Дымчатым Ягуаром', () => {
    for (const [guest, host] of [
      ['steel_viper', 'jade_falcon'],
      ['nova_cat', 'smoke_jaguar'],
    ]) {
      const worlds = owned(guest as string);
      expect(worlds.length).toBeGreaterThan(0);
      // Миры лежат ВПЕРЕМЕШКУ, а не отдельным куском: у каждого мира гостя
      // есть сосед в одном прыжке, принадлежащий хозяину зоны.
      for (const i of worlds) {
        expect(GALAXY.neighbors(i).some((j) => GALAXY.ownerId(j) === host)).toBe(true);
      }
    }
  });

  it('столица каждого клана принадлежит ему же', () => {
    for (const id of CLANS) {
      const capital = FACTIONS.get(id)?.capital as string;
      expect(GALAXY.ownerId(GALAXY.require(capital))).toBe(id);
      expect(GALAXY.hasFlag(GALAXY.require(capital), 'capital')).toBe(true);
    }
  });

  it('ни одна столица Великого Дома не пала', () => {
    for (const id of ['steiner', 'kurita', 'davion', 'liao', 'marik', 'comstar']) {
      const capital = FACTIONS.get(id)?.capital as string;
      expect(GALAXY.ownerId(GALAXY.require(capital))).toBe(id);
    }
  });

  it('Волкотт остался куритским островом внутри зоны Ягуара', () => {
    const i = GALAXY.require('wolcott');
    expect(GALAXY.ownerId(i)).toBe('kurita');
    expect(GALAXY.neighbors(i).filter((j) => GALAXY.ownerId(j) === 'smoke_jaguar').length).toBeGreaterThan(0);
  });

  it('занятый кланом мир — не фронтир: рынок сферный, техуровень выше', () => {
    const clanWorlds = CLANS.flatMap(owned);
    for (const i of clanWorlds) {
      expect(systemProfile(1, i).marketClass).not.toBe('periphery');
    }
    const avg = (list: number[]): number =>
      list.reduce((s, i) => s + systemProfile(1, i).techLevel, 0) / list.length;
    const houses = ['steiner', 'kurita', 'davion', 'liao', 'marik'].flatMap(owned);
    expect(avg(clanWorlds)).toBeGreaterThan(avg(houses));
  });

  it('Аутрич принадлежит наёмному отряду — владелец это ссылка в реестр, а не вид актора', () => {
    expect(GALAXY.ownerId(GALAXY.require('outreach'))).toBe('dragoons');
    expect(FACTIONS.get('dragoons')?.kind).toBe('mercenary');
    expect(START_SYSTEM_ID).toBe('outreach');
  });
});

describe('связность', () => {
  it('из любой системы достижима любая другая при дальности прыжка 30 св. лет', () => {
    const seen = new Uint8Array(GALAXY.count);
    const stack = [0];
    seen[0] = 1;
    let reached = 1;
    while (stack.length > 0) {
      const cur = stack.pop() as number;
      for (const j of GALAXY.neighbors(cur)) {
        if (seen[j] === 1) continue;
        seen[j] = 1;
        reached++;
        stack.push(j);
      }
    }
    expect(reached).toBe(GALAXY.count);
  });

  it('маршрут находится между случайными парами и симметричен по числу прыжков', () => {
    const rng = new Rng(7);
    for (let k = 0; k < 12; k++) {
      const a = rng.int(0, GALAXY.count - 1);
      const b = rng.int(0, GALAXY.count - 1);
      const there = findRoute(a, b);
      const back = findRoute(b, a);
      expect(there).not.toBeNull();
      expect(back).not.toBeNull();
      expect((there as { jumps: number }).jumps).toBe(jumpDistance(a, b));
      expect((back as { jumps: number }).jumps).toBe((there as { jumps: number }).jumps);
    }
  });

  it('матрица смежности не строится: соседей у системы единицы, а не тысячи', () => {
    let total = 0;
    for (let i = 0; i < GALAXY.count; i++) total += GALAXY.neighbors(i).length;
    expect(total / GALAXY.count).toBeLessThan(20);
  });
});

describe('маршрут и его цена', () => {
  it('путь в самого себя — ноль прыжков, ноль суток и ноль денег', () => {
    const i = GALAXY.require(START_SYSTEM_ID);
    expect(findRoute(i, i)).toEqual({ path: [i], jumps: 0, days: 0, cost: 0, legs: [] });
  });

  it('соседняя система — один прыжок и два транзита', () => {
    const from = GALAXY.require(START_SYSTEM_ID);
    const to = GALAXY.require(neighborOf(START_SYSTEM_ID));
    expect(isAdjacent(from, to)).toBe(true);
    const route = findRoute(from, to);
    expect(route?.jumps).toBe(1);
    // Один прыжок зарядки не требует: корабль уходит на заряженном парусе.
    expect(route?.days).toBe(GALAXY_RULES.jump.transitDays * 2);
  });

  it('дальний маршрут дороже и дольше ближнего', () => {
    const from = GALAXY.require('galatea');
    const near = findRoute(from, GALAXY.require(neighborOf('galatea')));
    const far = findRoute(from, GALAXY.require('luthien'));
    expect(far?.jumps).toBeGreaterThan(near?.jumps as number);
    expect(far?.days).toBeGreaterThan(near?.days as number);
    expect(far?.cost).toBeGreaterThan(near?.cost as number);
  });

  it('сумма ног равна сроку маршрута, а последняя нога приводит в цель', () => {
    const route = findRoute(GALAXY.require('galatea'), GALAXY.require('sian'));
    expect(route).not.toBeNull();
    const legs = (route as { legs: readonly { to: number; days: number }[] }).legs;
    expect(legs.reduce((s, l) => s + l.days, 0)).toBe(route?.days);
    expect(legs.length).toBe(route?.jumps);
    expect(GALAXY.id(legs[legs.length - 1]?.to as number)).toBe('sian');
  });
});

describe('профиль системы', () => {
  const BIOME_IDS = new Set(BIOME_LIST.map((b) => b.id));

  it('детерминирован: один сид мира — один и тот же профиль', () => {
    for (const id of ['tharkad', 'sian', 'galatea', 'terra']) {
      expect(systemProfile(42, id)).toEqual(systemProfile(42, id));
      expect(systemProfile(42, id)).toEqual(systemProfile(42, GALAXY.require(id)));
    }
  });

  it('разные сиды мира дают разные миры', () => {
    let differ = 0;
    for (let i = 0; i < 200; i++) {
      if (systemProfile(1, i).populationM !== systemProfile(2, i).populationM) differ++;
    }
    expect(differ).toBeGreaterThan(190);
  });

  it('биом планеты всегда один из шести боевых — карты без биома быть не может', () => {
    for (let i = 0; i < GALAXY.count; i++) {
      expect(BIOME_IDS.has(systemProfile(3, i).biome)).toBe(true);
    }
  });

  it('числа профиля лежат в объявленных границах', () => {
    for (let i = 0; i < GALAXY.count; i += 7) {
      const p = systemProfile(5, i);
      expect(p.populationM).toBeGreaterThan(0);
      expect(p.industryCivil).toBeGreaterThanOrEqual(0);
      expect(p.industryCivil).toBeLessThanOrEqual(10);
      expect(p.industryMilitary).toBeGreaterThanOrEqual(0);
      expect(p.industryMilitary).toBeLessThanOrEqual(10);
      expect(p.techLevel).toBeGreaterThanOrEqual(1);
      expect(p.techLevel).toBeLessThanOrEqual(5);
      expect(p.garrison).toBeGreaterThanOrEqual(0);
      expect(p.garrison).toBeLessThanOrEqual(5);
      expect(p.temperatureC).toBeGreaterThanOrEqual(-60);
      expect(p.temperatureC).toBeLessThanOrEqual(60);
      expect(p.gravityG).toBeGreaterThanOrEqual(0.5);
      expect(p.gravityG).toBeLessThanOrEqual(1.8);
      expect('ABCDEF').toContain(p.spaceport);
    }
  });

  it('столица Дома — столичный рынок, мир за границами Домов — периферийный', () => {
    expect(systemProfile(1, 'tharkad').marketClass).toBe('capital');
    expect(systemProfile(1, 'luthien').marketClass).toBe('capital');
    // Пиратская вольница не торгует армейским классом ни при каком броске.
    const pirate = GALAXY.ids.findIndex((_, i) => FACTIONS.get(GALAXY.ownerId(i))?.kind === 'pirates');
    expect(systemProfile(1, pirate).marketClass).toBe('periphery');
  });

  it('стартовый мир (Аутрич) и столицы канона имеют жилые биомы и не бывают безатмосферными лунами', () => {
    const testSeeds = [1, 42, 1337, 20260901, 9999];
    const capitals = GALAXY.ids.filter((_, i) => GALAXY.hasFlag(i, 'capital'));

    for (const seed of testSeeds) {
      const outreach = systemProfile(seed, 'outreach');
      expect(outreach.biome).toBe('temperate');
      expect(outreach.atmosphere).not.toBe('vacuum');
      expect(outreach.atmosphere).not.toBe('toxic');

      // Проверяем все столицы каталога
      for (const cap of capitals) {
        const p = systemProfile(seed, cap);
        expect(p.biome, `${cap} не должен быть безатмосферной луной`).not.toBe('lunar');
        expect(p.biome, `${cap} не должен быть лавовым адом`).not.toBe('volcanic');
        expect(p.atmosphere, `${cap} не должен быть вакуумом`).not.toBe('vacuum');
        expect(p.atmosphere, `${cap} не должен быть токсичным`).not.toBe('toxic');
      }

      // Канонические привязки ключевых столиц
      expect(systemProfile(seed, 'terra').biome).toBe('temperate');
      expect(systemProfile(seed, 'new-avalon').biome).toBe('temperate');
      expect(systemProfile(seed, 'tharkad').biome).toBe('tundra');
      expect(systemProfile(seed, 'luthien').biome).toBe('temperate');
      expect(systemProfile(seed, 'sian').biome).toBe('jungle');
      expect(systemProfile(seed, 'atreus').biome).toBe('temperate');
    }
  });

  it('канонические биомы привязаны к существующим системам', () => {
    // Схема проверяет только значения (id биомов): каталога систем она не видит.
    // Опечатка в ключе молча выключила бы привязку, поэтому ключи сверяются здесь.
    const canonical = GALAXY_RULES.profile.canonicalBiomes ?? {};
    const keys = Object.keys(canonical).filter((k) => k !== '$comment');
    expect(keys.length).toBeGreaterThan(0);
    for (const id of keys) {
      expect(GALAXY.ids, `${id} нет в каталоге систем`).toContain(id);
    }
  });

  it('без разведки видны класс рынка, биом и полоса гарнизона — точные числа только после неё', () => {
    const blind = systemKnowledge(9, 'sian', false);
    const known = systemKnowledge(9, 'sian', true);
    expect(blind.profile).toBeNull();
    expect(known.profile).not.toBeNull();
    expect(blind.marketClass).toBe(known.marketClass);
    expect(blind.biome).toBe(known.biome);
    expect(blind.garrisonBand).toBe(garrisonBand((known.profile as { garrison: number }).garrison));
  });
});

/**
 * Биом стал экономикой (шаг 24, фаза 1 Части 3).
 *
 * Проверяется не арифметика, а три решения шага: порядок бросков ГПСЧ не
 * сдвинулся, справочник биомов полон, и сырьё останавливается на военной
 * промышленности, не протекая в гарнизон и технологию.
 */
describe('биом — экономика (шаг 24)', () => {
  const ECO = GALAXY_RULES.profile.biomeEconomy as unknown as Record<
    string,
    { habitability: number; populationCapM: number | null; richness: number }
  > & { richnessBonus: number; capitalCapLog: number; factoryCapLog: number };

  it('порядок бросков ГПСЧ не сдвинулся: биом, климат и атмосфера те же, что до шага 24', () => {
    // ГЛАВНЫЙ тест шага, и единственный, который нельзя переснять: шаг 24
    // переносит арифметику профиля ВНИЗ, за бросок биома, ничего не двигая в
    // самой последовательности обращений к `rng`. Эталон снят настоящим кодом
    // ДО правки; пересозданный эталон совпадёт с чем угодно и не докажет ничего.
    const fixture = JSON.parse(
      readFileSync(new URL('./fixtures/biome-rolls.json', import.meta.url), 'utf8'),
    ) as { seeds: Record<string, readonly string[]> };

    for (const [seed, rows] of Object.entries(fixture.seeds)) {
      expect(rows).toHaveLength(GALAXY.count);
      const now: string[] = [];
      for (let i = 0; i < GALAXY.count; i++) {
        const p = systemProfile(Number(seed), i);
        now.push(`${p.biome}|${p.temperatureC}|${p.gravityG}|${p.atmosphere}`);
      }
      expect(now).toEqual([...rows]);
    }
  });

  it('у каждого биома из biomes.json есть экономика — забытый биом останавливает загрузку', () => {
    // Это же требует схема (`biomeRecord`), и тест здесь на случай, если её
    // однажды ослабят: без записи биом молча получил бы нулевую обитаемость и
    // нулевые недра, а замер увидел бы «расслоение почти состоялось».
    for (const b of BIOME_LIST) {
      const e = ECO[b.id];
      expect(e, `нет экономики для биома ${b.id}`).toBeDefined();
      expect((e as { richness: number }).richness).toBeGreaterThanOrEqual(0);
      expect((e as { richness: number }).richness).toBeLessThanOrEqual(1);
    }
  });

  it('потолок биома держит мир без флага, а флаг канона его ПОДНИМАЕТ, а не подменяет', () => {
    // Столица или завод на безжизненном камне — это канон Внутренней Сферы, и
    // срезать такой мир до пятнадцати миллионов по одному броску биома значило
    // бы сдвинуть географию канона. Поднимается именно потолок: население мира
    // с флагом и без того велико, губит его только срез.
    let capped = 0;
    let raised = 0;
    for (let seed = 1; seed <= 3; seed++) {
      for (let i = 0; i < GALAXY.count; i++) {
        const p = systemProfile(seed, i);
        const cap = ECO[p.biome]?.populationCapM;
        if (cap === null || cap === undefined) continue;

        const isCapital = GALAXY.hasFlag(i, 'capital');
        const flagged = isCapital || GALAXY.hasFlag(i, 'industrial') || GALAXY.hasFlag(i, 'mechFactory');
        const limit = flagged
          ? Math.pow(10, Math.max(Math.log10(cap), isCapital ? ECO.capitalCapLog : ECO.factoryCapLog))
          : cap;

        expect(p.populationM).toBeLessThanOrEqual(limit + 0.01);
        if (!flagged && p.populationM > cap * 0.99) capped++;
        if (flagged && p.populationM > cap * 1.01) raised++;
      }
    }
    // Обе половины правила должны хоть где-то сработать, иначе тест сторожит пустоту.
    expect(capped).toBeGreaterThan(0);
    expect(raised).toBeGreaterThan(0);
  });

  it('миры, ГДЕ ЖИВУТ, и миры, ГДЕ ДОБЫВАЮТ: расслоение, которого до шага 24 не было', () => {
    // До шага 24 лунный мир держал ровно столько же жителей, сколько умеренный
    // (медианы 4.4 и 4.5 млн), а вулканический имел самую высокую гражданскую
    // промышленность на карте. Здесь проверяется, что это позади.
    const stat = new Map<string, { pop: number[]; civil: number; military: number; n: number }>();
    for (let i = 0; i < GALAXY.count; i++) {
      const p = systemProfile(1, i);
      const s = stat.get(p.biome) ?? { pop: [], civil: 0, military: 0, n: 0 };
      s.pop.push(p.populationM);
      s.civil += p.industryCivil;
      s.military += p.industryMilitary;
      s.n++;
      stat.set(p.biome, s);
    }
    const median = (xs: number[]): number => {
      const a = [...xs].sort((x, y) => x - y);
      return a[a.length >> 1] as number;
    };
    const of = (b: string) => stat.get(b) as { pop: number[]; civil: number; military: number; n: number };

    // Жилой мир держит на порядок больше населения, чем добывающий.
    expect(median(of('temperate').pop)).toBeGreaterThan(median(of('lunar').pop) * 10);
    expect(median(of('jungle').pop)).toBeGreaterThan(median(of('volcanic').pop) * 10);
    // Гражданская промышленность идёт за населением, военная — за недрами.
    expect(of('temperate').civil / of('temperate').n).toBeGreaterThan(of('volcanic').civil / of('volcanic').n);
    expect(of('volcanic').military / of('volcanic').n).toBeGreaterThan(
      of('temperate').military / of('temperate').n,
    );
  });

  it('недра двигают военную промышленность, но НЕ гарнизон и не техуровень', () => {
    // Рудник — не крепость (решение пользователя 2026-09-05). Если пустить
    // сырьё по всей цепочке, шахтёрский мир получит заодно сильный гарнизон и
    // высокую технологию, содержание Сферы вырастет на 10 %, а у войны пропадёт
    // повод рейдить: богатый рудой и слабо защищённый мир — заманчивая цель, и
    // разделение здесь ровно для того, чтобы он таким остался.
    const mean = (b: string, pick: (p: ReturnType<typeof systemProfile>) => number): number => {
      let sum = 0;
      let n = 0;
      for (let i = 0; i < GALAXY.count; i++) {
        const p = systemProfile(1, i);
        if (p.biome !== b) continue;
        sum += pick(p);
        n++;
      }
      return sum / n;
    };
    for (const rich of ['volcanic', 'lunar']) {
      expect(mean(rich, (p) => p.industryMilitary)).toBeGreaterThan(mean('temperate', (p) => p.industryMilitary));
      expect(mean(rich, (p) => p.garrison)).toBeLessThan(mean('temperate', (p) => p.garrison));
      expect(mean(rich, (p) => p.techLevel)).toBeLessThan(mean('temperate', (p) => p.techLevel));
    }
  });

  it('богатство недр — чистая функция биома и в снимок не попадает', () => {
    for (let i = 0; i < GALAXY.count; i += 13) {
      const p = systemProfile(7, i);
      expect(p.richness).toBe(ECO[p.biome]?.richness);
    }
  });
});

describe('дельты и сохранение', () => {
  it('пустая дельта не хранится, непустая — хранится', () => {
    const empty = withDelta({}, 'terra', {});
    expect(Object.keys(empty)).toHaveLength(0);
    const one = withDelta({}, 'terra', { surveyed: true });
    expect(one['terra']?.surveyed).toBe(true);
  });

  it('дельта переживает круговой прогон сохранения', () => {
    const state = rich(11);
    state.deltas = withDelta(state.deltas, 'sarna', { surveyed: true, visited: true });
    state.deltas = withDelta(state.deltas, 'terra', { owner: 'kurita' });
    const before = hashCampaignState(state);

    const back = restore(parseSaveFile(JSON.parse(JSON.stringify(makeSaveFile(snapshot(state))))));
    expect(hashCampaignState(back)).toBe(before);
    expect(isSurveyed(back.deltas, 'sarna')).toBe(true);
    expect(back.deltas['terra']?.owner).toBe('kurita');
  });

  it('профиль в сохранение НЕ попадает: снимок не растёт вместе с галактикой', () => {
    const state = rich(12);
    const emptySize = JSON.stringify(makeSaveFile(snapshot(state))).length;

    // Выводим профиль каждой системы каталога — если бы он где-то оседал,
    // снимок вырос бы на две тысячи записей.
    for (let i = 0; i < GALAXY.count; i++) systemProfile(state.worldSeed, i);

    const text = JSON.stringify(makeSaveFile(snapshot(state)));
    expect(text.length).toBe(emptySize);
    expect(text).not.toContain('populationM');
    expect(text).not.toContain('industryCivil');
    expect(text).not.toContain('marketClass');
  });
});

describe('перелёт', () => {
  it('списывает деньги при постановке и приводит роту ровно в назначенный день', () => {
    const state = rich(21);
    const target = neighborOf(START_SYSTEM_ID);
    const before = state.company.cbills;

    const plan = run(state, { kind: 'travel', systemId: target })[0] as Extract<
      CampaignEvent,
      { kind: 'travelStarted' }
    >;
    expect(plan.kind).toBe('travelStarted');
    expect(state.company.cbills).toBe(before - plan.cost);
    expect(state.travel).not.toBeNull();
    expect(state.systemId).toBe(START_SYSTEM_ID);

    run(state, { kind: 'advanceTo', day: plan.arrivalDay });
    expect(state.systemId).toBe(target);
    expect(state.travel).toBeNull();
    expect(state.deltas[target]?.visited).toBe(true);
  });

  it('многопрыжковый маршрут идёт по ногам, и рота движется по карте', () => {
    const state = rich(22);
    const plan = run(state, { kind: 'travel', systemId: 'sian' })[0] as Extract<
      CampaignEvent,
      { kind: 'travelStarted' }
    >;
    expect(plan.jumps).toBeGreaterThan(1);

    const seen: string[] = [];
    for (let day = state.day + 1; day <= plan.arrivalDay; day++) {
      for (const e of run(state, { kind: 'advanceTo', day })) {
        if (e.kind === 'jumpCompleted') seen.push(e.systemId);
      }
    }
    expect(seen).toHaveLength(plan.jumps);
    expect(seen[seen.length - 1]).toBe('sian');
    expect(state.systemId).toBe('sian');
    expect(state.travel).toBeNull();
  });

  it('перелёт НЕ останавливает очередь суток: содержание и работа стапеля идут в пути', () => {
    const assembly = generateAssembly({ chassisCode: 'IS-H55-R3F2', role: 'brawler' }, new Rng(1));
    const record = makeRecord({ id: 'M-1', assembly });
    const damaged = {
      ...record,
      condition: {
        ...record.condition,
        zones: record.condition.zones.map((z, i) => (i === 0 ? { ...z, armor: 0 } : z)),
      },
    };
    const state = rich(23, 50_000_000, { mechs: [damaged] });

    const job = run(state, { kind: 'repairZone', recordId: 'M-1', zone: 'head' })[0] as Extract<
      CampaignEvent,
      { kind: 'jobScheduled' }
    >;
    const plan = run(state, { kind: 'travel', systemId: 'sian' })[0] as Extract<
      CampaignEvent,
      { kind: 'travelStarted' }
    >;
    // Маршрут заведомо длиннее и работы стапеля, и месячного содержания.
    expect(plan.days).toBeGreaterThan(30);
    expect(plan.days).toBeGreaterThan(job.days);

    const events = run(state, { kind: 'advanceTo', day: plan.arrivalDay });
    const kinds = events.map((e) => e.kind);
    expect(kinds).toContain('jobCompleted');
    expect(kinds).toContain('payrollPaid');
    // И работа, и зарплата отработали ДО прибытия, а не по прилёте.
    expect(kinds.indexOf('jobCompleted')).toBeLessThan(kinds.lastIndexOf('arrived'));
  });

  it('прыжок ходит только к соседям, перелёт — куда угодно', () => {
    const state = rich(24);
    expect(execute(state, { kind: 'jump', systemId: 'luthien' })).toEqual({
      ok: false,
      reason: CampaignRejectReason.NotAdjacent,
    });
    const target = neighborOf(START_SYSTEM_ID);
    expect(execute(state, { kind: 'jump', systemId: target }).ok).toBe(true);
  });

  it('отклонённый перелёт не оставляет следа', () => {
    const state = rich(25, 1000);
    const before = hashCampaignState(state);

    expect(execute(state, { kind: 'travel', systemId: 'нет-такой-системы' })).toEqual({
      ok: false,
      reason: CampaignRejectReason.SystemNotFound,
    });
    expect(execute(state, { kind: 'travel', systemId: START_SYSTEM_ID })).toEqual({
      ok: false,
      reason: CampaignRejectReason.AlreadyThere,
    });
    expect(execute(state, { kind: 'travel', systemId: 'luthien' })).toEqual({
      ok: false,
      reason: CampaignRejectReason.InsufficientFunds,
    });
    expect(hashCampaignState(state)).toBe(before);
  });

  it('маршрут не переигрывается на полдороге', () => {
    const state = rich(26);
    run(state, { kind: 'travel', systemId: 'sian' });
    expect(execute(state, { kind: 'travel', systemId: 'luthien' })).toEqual({
      ok: false,
      reason: CampaignRejectReason.AlreadyTravelling,
    });
    expect(execute(state, { kind: 'survey' })).toEqual({
      ok: false,
      reason: CampaignRejectReason.AlreadyTravelling,
    });
  });

  it('кампания, сохранённая в пути, долетает туда же и в тот же день', () => {
    const state = rich(27);
    const plan = run(state, { kind: 'travel', systemId: 'sian' })[0] as Extract<
      CampaignEvent,
      { kind: 'travelStarted' }
    >;
    run(state, { kind: 'advance', days: 20 });

    const back = restore(parseSaveFile(JSON.parse(JSON.stringify(makeSaveFile(snapshot(state))))));
    expect(hashCampaignState(back)).toBe(hashCampaignState(state));

    run(state, { kind: 'advanceTo', day: plan.arrivalDay });
    run(back, { kind: 'advanceTo', day: plan.arrivalDay });
    expect(back.systemId).toBe('sian');
    expect(hashCampaignState(back)).toBe(hashCampaignState(state));
  });
});

describe('разведка', () => {
  it('стоит денег и времени, а открывает точные числа', () => {
    const state = rich(31);
    const { cost, days } = GALAXY_RULES.survey;
    const before = state.company.cbills;

    expect(isSurveyed(state.deltas, state.systemId)).toBe(false);
    run(state, { kind: 'survey' });
    expect(state.company.cbills).toBe(before - cost);
    expect(isSurveyed(state.deltas, state.systemId)).toBe(false);

    run(state, { kind: 'advance', days: Math.ceil(days) });
    expect(isSurveyed(state.deltas, state.systemId)).toBe(true);
    expect(systemKnowledge(state.worldSeed, state.systemId, true).profile).not.toBeNull();
  });

  it('второй раз платить не за что', () => {
    const state = rich(32);
    run(state, { kind: 'survey' });
    expect(execute(state, { kind: 'survey' })).toEqual({
      ok: false,
      reason: CampaignRejectReason.AlreadySurveyed,
    });
    run(state, { kind: 'advance', days: 30 });
    expect(execute(state, { kind: 'survey' })).toEqual({
      ok: false,
      reason: CampaignRejectReason.AlreadySurveyed,
    });
  });

  it('разведка меняет знание игрока, а не мир: профиль остаётся тем же', () => {
    const state = rich(33);
    const before = systemProfile(state.worldSeed, state.systemId);
    run(state, { kind: 'survey' });
    run(state, { kind: 'advance', days: 30 });
    expect(systemProfile(state.worldSeed, state.systemId)).toEqual(before);
  });
});
