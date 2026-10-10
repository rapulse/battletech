import { describe, expect, it } from 'vitest';
import { CONSTRUCTION, QUALITY, REPAIR, tierPriceFactor } from '../src/core/data/index.js';
import {
  DEFAULT_QUALITY_CLASS,
  QUALITY_CLASS_IDS,
  qualityRank,
  shiftQuality,
  STANDARD_QUALITY,
  type MechQuality,
  type QualityClass,
} from '../src/core/model/index.js';
import {
  assemblyToChassisDef,
  generateAssembly,
  makePlatform,
  qualitySuffix,
  validateAssembly,
  type MechAssembly,
} from '../src/core/rules/index.js';
import { Rng } from '../src/core/rng/index.js';
import {
  applyWear,
  makeRecord,
  partCost,
  recordChassisDef,
  recordQuality,
  repairPlan,
  replaceJob,
  restoreJob,
  withQuality,
  type WearInput,
} from '../src/core/campaign/index.js';

/**
 * Шаг 11 — класс исполнения и машина вне боя.
 *
 * Главное, что здесь охраняется: класс доминирует НАМЕРЕННО (это вторая валюта,
 * он платится деньгами), а отсутствие класса означает серийный — только так
 * весь замер баланса Части 1 остаётся действительным.
 */

const CODE = 'IS-H55-R3F2';

function q(reactor: QualityClass, frame: QualityClass): MechQuality {
  return { reactor, frame };
}

function assembly(quality?: MechQuality): MechAssembly {
  return generateAssembly(
    { chassisCode: CODE, role: 'brawler', ...(quality !== undefined ? { quality } : {}) },
    new Rng(4242),
  );
}

describe('класс исполнения в уравнении массы', () => {
  it('отсутствие класса — это серийный, а не «никакой»', () => {
    // Ровно это сохраняет действительным весь замер Части 1: 850 платформ
    // каталога и эталонные сценарии считаются как раньше, до единой цифры.
    const implicit = makePlatform('is', 55, 3, 2);
    const explicit = makePlatform('is', 55, 3, 2, STANDARD_QUALITY);
    expect(implicit).toEqual(explicit);
    expect(implicit.quality).toEqual(STANDARD_QUALITY);
  });

  it('классы доминируют — и это проверяется на доминирование, а не против него', () => {
    // Обратный по смыслу тест к «ни одна комбинация тиров не доминирует»
    // (test/construction.test.ts). Он стоит здесь именно затем, чтобы уронить
    // сборку, если кто-то решит «починить» классы, вернув их в честный обмен.
    const line = QUALITY_CLASS_IDS.map((c) => makePlatform('is', 55, 3, 2, q(c, c)));
    for (let i = 1; i < line.length; i++) {
      const worse = line[i - 1]!;
      const better = line[i]!;
      expect(better.payloadMass).toBeGreaterThan(worse.payloadMass);
      expect(better.totalStructure).toBeGreaterThanOrEqual(worse.totalStructure);
      expect(better.baseHeatDiss).toBeGreaterThanOrEqual(worse.baseHeatDiss);
      expect(better.freeSlotsTotal).toBeGreaterThanOrEqual(worse.freeSlotsTotal);
      expect(better.reactorCritHeat).toBeLessThanOrEqual(worse.reactorCritHeat);
    }
  });

  it('подвижность классом не покупается — она осталась платой за тир', () => {
    // Иначе класс съел бы вторую ось конструирования целиком.
    const walks = QUALITY_CLASS_IDS.map((c) => makePlatform('is', 55, 3, 2, q(c, c)).walkMP);
    expect(new Set(walks).size).toBe(1);
  });

  it('структура каркаса складывается сама с собой через потолок брони', () => {
    // Известная ловушка (classification.md §5): потолок брони считается как
    // удвоенная структура, поэтому мастерский каркас поднимает и запас
    // прочности, и потолок защиты. Тест не запрещает эффект, а фиксирует его —
    // чтобы он не пропал молча при следующей правке.
    const std = makePlatform('is', 55, 3, 2, STANDARD_QUALITY);
    const master = makePlatform('is', 55, 3, 2, q('standard', 'master'));
    const factor = QUALITY.master.frame.structureFactor;
    // Округление ОДНО и последнее: структура считается как
    // `round(тоннаж × perTon × множитель)`. Прежняя запись брала уже округлённую
    // серийную структуру и округляла ещё раз — совпадало это с кодом только
    // потому, что при `perTon` 1.0 серийная структура выходила целой сама
    // собой. Шаг 53 поднял коэффициент до 1.3, и два округления разошлись на
    // очко (82 против 83), хотя правило не менялось.
    const perTon = CONSTRUCTION.structure.perTon;
    expect(master.totalStructure).toBe(Math.round(55 * perTon * factor));
    expect(master.totalStructure).toBeGreaterThan(std.totalStructure);
    expect(master.maxArmorPts).toBe(master.totalStructure * 2);
    expect(master.maxArmorPts).toBeGreaterThan(std.maxArmorPts);
  });

  it('множители применяются ровно один раз', () => {
    // assemblyToChassisDef зовёт makePlatform, а тот уже применил класс.
    // Повторное умножение — самый вероятный способ сломать этот шаг незаметно.
    const master = q('master', 'master');
    const def = assemblyToChassisDef(assembly(master));
    const platform = makePlatform('is', 55, 3, 2, master);
    const structure = Object.values(def.zones).reduce((n, z) => n + z.structure, 0);
    expect(structure).toBe(platform.totalStructure);
  });

  it('дельта слотов кладётся в торс целиком и точно', () => {
    const std = makePlatform('is', 55, 3, 2, STANDARD_QUALITY);
    const master = makePlatform('is', 55, 3, 2, q('standard', 'master'));
    const worn = makePlatform('is', 55, 3, 2, q('standard', 'recovered'));
    expect(master.freeSlots.torso - std.freeSlots.torso).toBe(QUALITY.master.frame.slotDelta);
    expect(worn.freeSlots.torso - std.freeSlots.torso).toBe(QUALITY.recovered.frame.slotDelta);
    expect(master.freeSlots.leftArm).toBe(std.freeSlots.leftArm);
  });

  it('генератор без явного класса собирает серийную машину', () => {
    // Предохранитель: генератор не видит цены и, дай ему выбирать, всегда взял
    // бы мастерский — батч превратился бы в замер мастерских против мастерских.
    const a = assembly();
    expect(a.quality).toBeUndefined();
    expect(recordQuality(makeRecord({ id: 'т', assembly: a }))).toEqual(STANDARD_QUALITY);
  });

  it('несерийная сборка получает своё имя шасси, серийная — прежнее', () => {
    // registerDynamicChassis держит ОДНУ глобальную таблицу: без суффикса
    // армейская сборка того же шасси затёрла бы серийную.
    expect(qualitySuffix(STANDARD_QUALITY)).toBe('');
    expect(qualitySuffix(undefined)).toBe('');
    expect(assemblyToChassisDef(assembly()).id).toBe(CODE);

    const military = assemblyToChassisDef(assembly(q('military', 'military'))).id;
    expect(military).not.toBe(CODE);
    expect(military.startsWith(CODE)).toBe(true);
    expect(assemblyToChassisDef(assembly(q('master', 'standard'))).id).not.toBe(military);
  });

  it('тепло за крит реактора становится свойством машины', () => {
    expect(assemblyToChassisDef(assembly()).reactorHeatPerHit).toBeUndefined();
    expect(assemblyToChassisDef(assembly(q('recovered', 'standard'))).reactorHeatPerHit).toBe(
      QUALITY.recovered.reactor.critHeatPerHit,
    );
    expect(assemblyToChassisDef(assembly(q('master', 'standard'))).reactorHeatPerHit).toBe(
      QUALITY.master.reactor.critHeatPerHit,
    );
  });

  it('валидатор считает бюджет по классу, а не по серийному', () => {
    const master = validateAssembly(assembly(q('master', 'master')));
    const std = validateAssembly(assembly());
    expect(master.slotsAvailable.torso).toBeGreaterThan(std.slotsAvailable.torso);
    expect(master.maxArmor).toBeGreaterThan(std.maxArmor);
  });

  it('шкала классов упорядочена и не выходит за края', () => {
    expect(qualityRank('recovered')).toBe(0);
    expect(qualityRank(DEFAULT_QUALITY_CLASS)).toBe(1);
    expect(shiftQuality('recovered', -1)).toBe('recovered');
    expect(shiftQuality('master', 1)).toBe('master');
    expect(shiftQuality('standard', 1)).toBe('military');
  });
});

describe('машина вне боя', () => {
  it('новая запись собрана по паспорту', () => {
    const record = makeRecord({ id: 'Гончая', assembly: assembly() });
    const def = recordChassisDef(record);
    expect(record.condition.zones).toHaveLength(6);
    expect(record.condition.zones[0]?.armor).toBe(def.zones.head.armor);
    expect(record.condition.ammo).toHaveLength(def.mounts.length);
    expect(record.wear).toEqual({ reactor: 0, frame: 0 });
  });

  it('смена класса каркаса подрезает состояние под новый паспорт', () => {
    // Иначе понижение класса давало бы машину крепче паспорта: сохранённая
    // броня оказалась бы выше нового потолка.
    const master = makeRecord({ id: 'м', assembly: assembly(q('master', 'master')) });
    const downgraded = withQuality(master, 'frame', 'recovered');
    const limits = recordChassisDef(downgraded);
    expect(downgraded.condition.zones[1]!.structure).toBeLessThanOrEqual(
      limits.zones.torso.structure,
    );
    expect(downgraded.condition.zones[1]!.armor).toBeLessThanOrEqual(limits.zones.torso.armor);
  });
});

describe('износ', () => {
  const heavy: WearInput = {
    structureLost: 30,
    overheatTurns: 4,
    reactorHits: 1,
    destroyedZones: 1,
  };

  it('детерминирован от сида', () => {
    const record = makeRecord({ id: 'и', assembly: assembly() });
    const a = applyWear(record, heavy, new Rng(7));
    const b = applyWear(record, heavy, new Rng(7));
    expect(b.record.wear).toEqual(a.record.wear);
    expect(new Rng(8).next()).not.toBe(new Rng(7).next());
  });

  it('реактор и каркас изнашиваются от разного', () => {
    // Одинаковая формула на оба узла сделала бы класс каркаса и класс реактора
    // неразличимыми в кампании.
    const record = makeRecord({ id: 'и', assembly: assembly() });
    const heat = applyWear(record, { ...heavy, structureLost: 0, destroyedZones: 0 }, new Rng(1));
    const hits = applyWear(record, { ...heavy, overheatTurns: 0, reactorHits: 0 }, new Rng(1));
    expect(heat.added.reactor).toBeGreaterThan(heat.added.frame);
    expect(hits.added.frame).toBeGreaterThan(hits.added.reactor);
  });

  it('на пороге узел теряет ступень класса, а счётчик падает', () => {
    let record = makeRecord({ id: 'и', assembly: assembly(q('master', 'master')) });
    record = { ...record, wear: { reactor: REPAIR.wear.threshold - 1, frame: 0 } };

    const result = applyWear(record, heavy, new Rng(3));
    expect(result.degraded.map((d) => d.node)).toContain('reactor');
    expect(recordQuality(result.record).reactor).toBe('military');
    expect(result.record.wear.reactor).toBe(REPAIR.wear.resetTo);
  });

  it('ниже восстановленного класс не падает, износ упирается в порог', () => {
    let record = makeRecord({ id: 'и', assembly: assembly(q('recovered', 'recovered')) });
    record = { ...record, wear: { reactor: REPAIR.wear.threshold, frame: 0 } };

    const result = applyWear(record, heavy, new Rng(3));
    expect(result.degraded).toHaveLength(0);
    expect(recordQuality(result.record).reactor).toBe('recovered');
    expect(result.record.wear.reactor).toBe(REPAIR.wear.threshold);
  });

  it('каждый бой считается ровно один раз', () => {
    const record = makeRecord({ id: 'и', assembly: assembly() });
    expect(applyWear(record, heavy, new Rng(1)).record.battles).toBe(1);
  });
});

describe('ремонт', () => {
  function damaged() {
    const record = makeRecord({ id: 'п', assembly: assembly() });
    const zones = record.condition.zones.map((z, i) =>
      i === 1 ? { armor: 0, structure: Math.max(0, z.structure - 5), destroyed: false } : z,
    );
    return { ...record, condition: { ...record.condition, zones } };
  }

  it('план чинит до паспорта и стоит денег и дней', () => {
    const plan = repairPlan(damaged());
    expect(plan.jobs.length).toBeGreaterThan(0);
    expect(plan.cost).toBeGreaterThan(0);
    expect(plan.days).toBeGreaterThan(0);
    expect(plan.blocked).toBe(0);
  });

  it('целая машина не требует работ', () => {
    expect(repairPlan(makeRecord({ id: 'ц', assembly: assembly() })).jobs).toHaveLength(0);
  });

  it('разрушенную зону чинить нечем — работа попадает в план невыполнимой', () => {
    // Правило, а не недоработка: игрок обязан видеть, ЧТО именно нельзя
    // починить, а не пустой список.
    const record = damaged();
    const zones = record.condition.zones.map((z, i) =>
      i === 2 ? { armor: 0, structure: 0, destroyed: true } : z,
    );
    const plan = repairPlan({ ...record, condition: { ...record.condition, zones } });
    expect(plan.blocked).toBe(1);
    expect(plan.jobs.some((j) => !j.possible && j.note !== undefined)).toBe(true);
  });

  it('ремонт не поднимает класс — это отдельная покупка', () => {
    const worn = makeRecord({ id: 'в', assembly: assembly(q('recovered', 'recovered')) });
    const plan = repairPlan(worn);
    expect(plan.jobs.every((j) => j.kind !== 'reactor' && j.kind !== 'frame')).toBe(true);
    expect(replaceJob(worn, 'reactor', 'military').possible).toBe(true);
  });

  it('цена узла растёт и по классу, и по тиру', () => {
    const record = makeRecord({ id: 'ц', assembly: assembly() });
    const cheap = partCost(record, 'reactor', 'recovered');
    const dear = partCost(record, 'reactor', 'master');
    expect(dear).toBeGreaterThan(cheap);
    expect(tierPriceFactor(1)).toBeLessThan(tierPriceFactor(5));
  });

  it('восстановление изношенного дешевле замены и требует износа', () => {
    const record = makeRecord({ id: 'в', assembly: assembly() });
    expect(restoreJob(record, 'reactor').possible).toBe(false);

    const wornOut = { ...record, wear: { reactor: REPAIR.wear.threshold * 0.8, frame: 0 } };
    const restore = restoreJob(wornOut, 'reactor');
    expect(restore.possible).toBe(true);
    expect(restore.cost).toBeLessThan(partCost(record, 'reactor', 'standard'));
  });
});
