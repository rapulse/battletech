import { describe, expect, it } from 'vitest';
import {
  CHASSIS_CATALOG_LIST,
  CHASSIS_LIST as CHASSIS,
  CONSTRUCTION,
  EQUIPMENT,
  WEAPONS,
} from '../src/core/data/tables.js';
import { Rng } from '../src/core/rng/index.js';
import {
  allocateByZone,
  armorPointsPerTon,
  canMount,
  assemblyToChassisDef,
  FRAME_TIER_COUNT,
  frameTiersFor,
  generateAssembly,
  LOCOMOTIONS,
  makePlatform,
  REACTOR_TIER_COUNT,
  validateAssembly,
  AMMO_FOR_WEAPON,
  ammoPerVolley,
  type AssemblyRole,
  type MechAssembly,
  mountIssue,
} from '../src/core/rules/construction.js';

describe('Валидатор конструирования (MechLab)', () => {
  it('корректная сборка проходит валидацию', () => {
    const assembly: MechAssembly = {
      chassisCode: 'IS-H55-R3F2',
      name: 'Shadow Hawk Custom',
      role: 'brawler',
      techBase: 'is',
      tonnage: 55,
      armorTons: 4.0,
      items: [
        { id: 'is_ac10', kind: 'weapon', zone: 'torso', ammo: 10 },
        { id: 'ammo_ac10', kind: 'ammo', zone: 'torso' },
        { id: 'is_ml', kind: 'weapon', zone: 'leftArm', ammo: null },
        { id: 'is_ml', kind: 'weapon', zone: 'rightArm', ammo: null },
      ],
    };

    const report = validateAssembly(assembly);
    expect(report.valid).toBe(true);
    expect(report.issues).toHaveLength(0);
    expect(report.totalMass).toBeLessThanOrEqual(55);
  });

  it('перевес по массе бракуется валидатором', () => {
    const assembly: MechAssembly = {
      chassisCode: 'IS-H35-R5F3',
      name: 'Overweight Jenner',
      role: 'scout',
      techBase: 'is',
      tonnage: 35,
      armorTons: 6.0,
      items: [
        { id: 'is_ac20', kind: 'weapon', zone: 'torso', ammo: 5 }, // 14 тонн!
        { id: 'ammo_ac20', kind: 'ammo', zone: 'torso' },
      ],
    };

    const report = validateAssembly(assembly);
    expect(report.valid).toBe(false);
    expect(report.issues.some((i) => i.kind === 'overweight')).toBe(true);
  });

  it('переполнение слотов зоны бракуется валидатором', () => {
    const assembly: MechAssembly = {
      chassisCode: 'IS-H55-R3F2',
      name: 'Overloaded Arm',
      role: 'brawler',
      techBase: 'is',
      tonnage: 55,
      armorTons: 6.0,
      items: [
        { id: 'is_ac10', kind: 'weapon', zone: 'rightArm', ammo: 10 }, // 7 слотов
        { id: 'is_ac10', kind: 'weapon', zone: 'rightArm', ammo: 10 }, // ещё 7 слотов -> 14 > 6!
      ],
    };

    const report = validateAssembly(assembly);
    expect(report.valid).toBe(false);
    expect(report.issues.some((i) => i.kind === 'slotOverflow' && i.params.zone === 'rightArm')).toBe(true);
  });
});

describe('Процедурный генератор роботов', () => {
  const roles: AssemblyRole[] = [
    'brawler',
    'sniper',
    'missile_boat',
    'skirmisher',
    'scout',
    'juggernaut',
  ];

  it('генерирует валидные сборки для всех ролей в Сфере и Кланах', () => {
    const rng = new Rng(12345);
    const tonnages = [20, 35, 50, 55, 75, 85, 100];

    for (const tech of ['is', 'clan'] as const) {
      for (const tonnage of tonnages) {
        for (const role of roles) {
          const assembly = generateAssembly({ techBase: tech, tonnage, role }, rng);
          const report = validateAssembly(assembly);

          expect(report.valid).toBe(true);
          expect(report.totalMass).toBeLessThanOrEqual(tonnage);

          // Проверка конвертации в ChassisDef
          const chassisDef = assemblyToChassisDef(assembly);
          expect(chassisDef.tons).toBe(tonnage);
          expect(chassisDef.mounts.length).toBeGreaterThan(0);
        }
      }
    }
  });

  it('сгенерированный мех имеет оружие и защиту', () => {
    const rng = new Rng(42);
    const assembly = generateAssembly(
      { chassisCode: 'CL-H75-R4F3', role: 'skirmisher' },
      rng,
    );

    expect(assembly.chassisCode).toBe('CL-H75-R4F3');
    expect(assembly.items.length).toBeGreaterThan(1);

    const report = validateAssembly(assembly);
    expect(report.valid).toBe(true);
    expect(report.heatDissipation).toBeGreaterThanOrEqual(20);
  });
});

/**
 * Вооружение по классу машины (шаг 47).
 *
 * Проверяется ПРАВИЛО, а не конкретный жребий. Сравниваются средние по выборке
 * и никогда — идентификаторы оружия: пулы лежат в данных и меняются калибровкой,
 * и тест, проверяющий «у стотонника есть гаусс», сломался бы от любой такой
 * правки, ничего при этом не поймав. Числа порогов взяты с большим запасом от
 * замера `pnpm loadoutstat`, чтобы тест ловил слом правила, а не шум жребия.
 */
describe('Вооружение соответствует классу (шаг 47)', () => {
  /** Средняя масса ствола по выборке машин этого тоннажа. */
  function meanGunTons(tonnage: number, tech: 'is' | 'clan', seed: number, n = 60): number {
    const rng = new Rng(seed);
    let tons = 0;
    let guns = 0;
    for (let i = 0; i < n; i++) {
      const a = generateAssembly({ techBase: tech, tonnage }, rng);
      for (const it of a.items) {
        const w = WEAPONS.get(it.id);
        if (w !== undefined) {
          tons += w.mass;
          guns++;
        }
      }
    }
    return guns === 0 ? 0 : tons / guns;
  }

  it('штурмовая машина несёт стволы тяжелее, чем лёгкая', () => {
    for (const tech of ['is', 'clan'] as const) {
      const light = meanGunTons(35, tech, 4701);
      const assault = meanGunTons(100, tech, 4702);
      // Вдвое — с запасом: на замере разрыв втрое с лишним (1.7 т против 6.2).
      expect(assault).toBeGreaterThan(light * 2);
    }
  });

  it('калибр растёт по классам монотонно, без провалов посередине', () => {
    for (const tech of ['is', 'clan'] as const) {
      const byBand = [35, 55, 75, 100].map((t, i) => meanGunTons(t, tech, 4710 + i));
      for (let i = 1; i < byBand.length; i++) {
        expect(byBand[i]!).toBeGreaterThan(byBand[i - 1]!);
      }
    }
  });

  it('тяжёлое оружие каталога реально встречается на тяжёлых машинах', () => {
    const rng = new Rng(4720);
    const heavy = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const a = generateAssembly({ techBase: 'is', tonnage: 100 }, rng);
      for (const it of a.items) {
        const w = WEAPONS.get(it.id);
        if (w !== undefined && w.mass >= 10) heavy.add(w.id);
      }
    }
    // Стволы от десяти тонн — гаусс, АП/20, РДД-20: до шага 47 их не было ни
    // одного на сотню штурмовых машин.
    expect(heavy.size).toBeGreaterThan(0);
  });

  it('мелочь не исчезла у лёгких машин', () => {
    const rng = new Rng(4730);
    let small = 0;
    let total = 0;
    for (let i = 0; i < 60; i++) {
      for (const it of generateAssembly({ techBase: 'is', tonnage: 25 }, rng).items) {
        const w = WEAPONS.get(it.id);
        if (w === undefined) continue;
        total++;
        if (w.mass <= 1) small++;
      }
    }
    expect(small / total).toBeGreaterThan(0.3);
  });

  it('роль взвешена весом, но ничего не запрещено наглухо', () => {
    // Веса МЯГКИЕ (решение пользователя 2026-09-09): стотонный разведчик — не
    // ошибка, а редкость. Проверяется, что редкость осталась редкостью.
    const rng = new Rng(4740);
    let scouts = 0;
    for (let i = 0; i < 300; i++) {
      if (generateAssembly({ techBase: 'is', tonnage: 100 }, rng).role === 'scout') scouts++;
    }
    expect(scouts / 300).toBeLessThan(0.05);
  });

  it('прыжковые двигатели не исчезли у лёгких и средних', () => {
    // Ради них роли и разводили (шаг 6, часть C): весовой множитель не должен
    // выдавить skirmisher и scout из лёгкой половины парка.
    const rng = new Rng(4750);
    let jumpers = 0;
    for (let i = 0; i < 200; i++) {
      const a = generateAssembly({ techBase: 'is', tonnage: i % 2 === 0 ? 35 : 50 }, rng);
      if (a.items.some((it) => EQUIPMENT.get(it.id)?.category === 'jump_jet')) jumpers++;
    }
    expect(jumpers / 200).toBeGreaterThan(0.15);
  });

  it('боезапаса хватает на бой, а не на шесть ходов', () => {
    const rng = new Rng(4760);
    for (let i = 0; i < 80; i++) {
      const a = generateAssembly({ techBase: rng.pick(['is', 'clan'] as const), tonnage: 85 }, rng);
      const guns = new Map<string, number>();
      const tons = new Map<string, number>();
      for (const it of a.items) {
        const ammoId = AMMO_FOR_WEAPON[it.id];
        if (WEAPONS.has(it.id) && ammoId !== undefined) {
          guns.set(ammoId, (guns.get(ammoId) ?? 0) + 1);
        }
        if (EQUIPMENT.get(it.id)?.category === 'ammo') {
          tons.set(it.id, (tons.get(it.id) ?? 0) + 1);
        }
      }
      for (const [ammoId, gunCount] of guns) {
        const shots = (EQUIPMENT.get(ammoId)?.shots ?? 0) * (tons.get(ammoId) ?? 0);
        expect(shots / gunCount).toBeGreaterThanOrEqual(10);
      }
    }
  });

  it('норма боезапаса считается ЗАЛПАМИ и совпадает с расходом в бою (2026-09-16)', () => {
    // Проверка стыка, а не арифметики: цех набирает `ammoVolleys` залпов, бой
    // тратит `ammoPerVolley` выстрелов за залп. Разойдись эти две величины — и
    // ракетная машина снова выйдет немой со второго хода, а замер этого не
    // покажет: сборка останется валидной, полной и правильной на вид.
    const rng = new Rng(4761);
    const norm = CONSTRUCTION.weapons.ammoVolleys;
    for (let i = 0; i < 200; i++) {
      const a = generateAssembly({ chassisCode: rng.pick(CHASSIS_CATALOG_LIST).code }, rng);
      for (const m of assemblyToChassisDef(a).mounts) {
        if (m.ammo === null) continue;
        const w = WEAPONS.get(m.weapon)!;
        expect(Math.floor(m.ammo / ammoPerVolley(w))).toBeGreaterThanOrEqual(norm - 2);
      }
    }
  });

  it('у каждой платформы каталога есть чем стрелять (2026-09-16)', () => {
    // Сборка без единого орудия не отбраковывалась, а МОЛЧА получала средний
    // лазер в `assemblyToChassisDef`: платформа, которая его не поднимает,
    // выходила в бой с оружием даром. Ловится только перебором всего каталога —
    // пустой выходила одна платформа из 850 (IS-H20-R5F1, навеска 0.6 т).
    const rng = new Rng(4762);
    for (const entry of CHASSIS_CATALOG_LIST) {
      const a = generateAssembly({ chassisCode: entry.code }, rng);
      expect(a.items.some((it) => WEAPONS.has(it.id))).toBe(true);
    }
  });
});

describe('Уравнение массы', () => {
  const TECHS = ['is', 'clan'] as const;
  // Число тиров берётся из данных, а не пишется числом: шаг 7 сократил шкалу
  // каркаса с пяти ступеней до трёх, и тест, знающий «5» наизусть, начал бы
  // проверять несуществующие тиры.
  const REACTOR_TIERS = Array.from({ length: REACTOR_TIER_COUNT }, (_, i) => i + 1);
  const FRAME_TIERS = Array.from({ length: FRAME_TIER_COUNT }, (_, i) => i + 1);

  it('каждая платформа каталога сходится по массе', () => {
    for (const c of CHASSIS_CATALOG_LIST) {
      const p = makePlatform(c.techBase, c.tonnage, c.reactorTier, c.frameTier);
      // Реактор + каркас + СИСТЕМЫ + броня по умолчанию + навеска = тоннаж, без
      // остатка. Кабина и гироскоп добавлены шагом 31: до него их не было в
      // уравнении вовсе, и серийный 65-тонник со штатной навеской и полной
      // бронёй весил 34.5 из 65 тонн.
      const sum =
        p.reactorMass + p.frameMass + p.systemsMass + p.defArmorMass + p.payloadMass;
      expect(sum).toBeCloseTo(c.tonnage, 6);
      expect(p.payloadMass).toBeGreaterThan(0);
    }
  });

  it('каталог совпадает с уравнением очко в очко', () => {
    for (const c of CHASSIS_CATALOG_LIST) {
      const p = makePlatform(c.techBase, c.tonnage, c.reactorTier, c.frameTier);
      expect(p.reactorMass).toBe(c.reactorMass);
      expect(p.frameMass).toBe(c.frameMass);
      expect(p.systemsMass).toBe(c.systemsMass);
      expect(p.maxArmorPts).toBe(c.maxArmorPts);
      expect(p.payloadMass).toBe(c.payloadMass);
      expect(p.freeSlotsTotal).toBe(c.freeSlotsTotal);
      expect(p.freeSlots.torso).toBe(c.freeSlotsTorso);
    }
  });

  it('ни одна комбинация тиров не доминирует безусловно', () => {
    // Внутри одного тоннажа и техбазы платформа не должна быть не хуже другой
    // по всем осям сразу и лучше хотя бы по одной: такой тир просто выпадает
    // из игры. Так уже случилось дважды — F1 против F2 (равные слоты) и R3
    // против R2 у тяжёлых (равная скорость).
    //
    // ВНИМАНИЕ (шаг 11). Проверка идёт СТРОГО НА СЕРИЙНОМ классе: makePlatform
    // здесь зовётся четырьмя аргументами, и пятый — класс исполнения — остаётся
    // умолчанием. Классы доминируют НАМЕРЕННО, они вторая валюта и платятся
    // деньгами (wiki/design/mechs/classification.md §5). Если добавить сюда
    // перебор классов, тест упадёт, и его почти наверняка «починят», ослабив
    // классы обратно в честный обмен — это отменит всю затею. Классы
    // проверяются отдельно и на обратное: test/quality.test.ts.
    const axes = ['walkMP', 'payloadMass', 'freeSlotsTotal'] as const;

    for (const tech of TECHS) {
      for (const tonnage of CONSTRUCTION.tonnages) {
        const all = REACTOR_TIERS.flatMap((r) =>
          FRAME_TIERS.map((f) => makePlatform(tech, tonnage, r, f)),
        );

        for (const a of all) {
          for (const b of all) {
            if (a.code === b.code) continue;
            const noWorse = axes.every((ax) => b[ax] >= a[ax]);
            const better = axes.some((ax) => b[ax] > a[ax]);
            expect(
              noWorse && better,
              `${a.code} строго хуже ${b.code} — тир выпал из игры`,
            ).toBe(false);
          }
        }
      }
    }
  });

  it('обе шкалы каркаса строго монотонны', () => {
    for (const tech of TECHS) {
      const line = FRAME_TIERS.map((f) => makePlatform(tech, 55, 3, f));
      for (let i = 1; i < line.length; i++) {
        expect(line[i]!.payloadMass).toBeGreaterThan(line[i - 1]!.payloadMass);
        expect(line[i]!.freeSlotsTotal).toBeLessThan(line[i - 1]!.freeSlotsTotal);
      }
    }
  });

  it('тир вне таблиц отвергается — по обеим шкалам', () => {
    expect(() => makePlatform('is', 55, 0, 1)).toThrow(RangeError);
    expect(() => makePlatform('is', 55, REACTOR_TIER_COUNT + 1, 1)).toThrow(RangeError);
    expect(() => makePlatform('is', 55, 3, 0)).toThrow(RangeError);
    expect(() => makePlatform('is', 55, 3, FRAME_TIER_COUNT + 1)).toThrow(RangeError);
  });
});

describe('Раскладка брони по зонам', () => {
  it('раскладка ничего не теряет', () => {
    for (const total of [23, 36, 46, 49, 72, 98, 131]) {
      const a = allocateByZone(total);
      const sum = a.head + a.torso + a.leftArm + a.rightArm + a.leftLeg + a.rightLeg;
      expect(sum).toBe(total);
    }
  });

  it('кокпит гуще рук, но заметно тоньше торса (шаг 9e), ноги гуще рук', () => {
    // Инвариант, который остаётся жёстким несмотря на пересмотр шагом 9e:
    // если кокпит станет тоньше рук, он начнёт отказывать первым и пилоты
    // посыплются (провал шага 3, см. wiki/decisions.md). Соотношение с торсом
    // сознательно снижено с 0.7-1.1 до ~0.5-0.65: при старой раскладке голова
    // разрушалась в 60-85 раз реже торса и ног — редкость избыточная,
    // подтверждено батч-прогоном (3000 боёв, wiki/decisions.md 2026-08-28).
    for (const c of CHASSIS) {
      const pool = (z: keyof typeof c.zones): number =>
        c.zones[z].armor + c.zones[z].structure;

      const head = pool('head');
      const torso = pool('torso');
      const arm = pool('leftArm');
      const leg = pool('leftLeg');

      expect(head / torso).toBeGreaterThan(0.45);
      expect(head / torso).toBeLessThan(0.7);
      expect(arm).toBeLessThan(head);
      expect(arm).toBeLessThan(leg);
      expect(leg).toBeLessThan(torso);
      expect(arm).toBeLessThan(head);
    }
  });

  it('боевые шасси пересобираются уравнением', () => {
    // chassis.json собирается тулом; если кто-то поправит числа руками,
    // расхождение вылезет здесь, а не через сотню боёв.
    for (const c of CHASSIS) {
      const p = makePlatform('is', c.tons, c.reactorTier, c.frameTier);
      const armor = allocateByZone(Math.round(c.armorTons * armorPointsPerTon('is')));
      const structure = allocateByZone(p.totalStructure);

      for (const z of ['head', 'torso', 'leftArm', 'rightArm', 'leftLeg', 'rightLeg'] as const) {
        expect(c.zones[z].armor, `${c.id} ${z} броня`).toBe(armor[z]);
        expect(c.zones[z].structure, `${c.id} ${z} структура`).toBe(structure[z]);
      }
    }
  });
});

describe('Правила зон (шаг 31)', () => {
  // До шага 31 валидатор проверял ОДНО — влезает ли деталь по числу ячеек, —
  // и поэтому разрешал ППК в голову (3 слота из трёх свободных) и большой
  // лазер в ногу. Ни то ни другое не бывает в каноне и не имеет смысла в игре.

  it('оружие в ногу не ставится вовсе', () => {
    expect(mountIssue('is_ll', 'leftLeg')).not.toBeNull();
    expect(mountIssue('is_sl', 'rightLeg')).not.toBeNull();
    expect(canMount('is_ml', 'leftLeg')).toBe(false);
  });

  it('в ногу по-прежнему ставятся охладители, прыжковые и боезапас', () => {
    expect(canMount('is_shs', 'leftLeg')).toBe(true);
    expect(canMount('is_jj', 'rightLeg')).toBe(true);
    expect(canMount('ammo_ac10', 'leftLeg')).toBe(true);
  });

  it('в голову идёт оружие не крупнее одной ячейки', () => {
    expect(canMount('is_sl', 'head')).toBe(true);
    expect(mountIssue('is_ppc', 'head')).not.toBeNull();
  });

  it('в руках и торсе ограничений нет', () => {
    for (const zone of ['torso', 'leftArm', 'rightArm'] as const) {
      expect(canMount('is_ppc', zone)).toBe(true);
      expect(canMount('is_ll', zone)).toBe(true);
    }
  });

  it('валидатор бракует сборку с оружием в ноге', () => {
    const report = validateAssembly({
      chassisCode: 'IS-H55-R3F2',
      role: 'brawler',
      techBase: 'is',
      tonnage: 55,
      armorTons: 3.0,
      items: [{ id: 'is_ml', kind: 'weapon', zone: 'leftLeg', ammo: null }],
    });
    expect(report.valid).toBe(false);
  });

  it('НИ ОДНА машина каталога не несёт оружия в ногах и крупного в голове', () => {
    // Прямая проверка того, что перегенерация каталога прошла: старые сборки
    // с ППК в голове обязаны были исчезнуть вместе со сменой уравнения массы.
    for (const c of CHASSIS_CATALOG_LIST.slice(0, 40)) {
      for (const role of ['brawler', 'sniper', 'skirmisher', 'scout'] as const) {
        const built = generateAssembly({ chassisCode: c.code, role }, new Rng(c.tonnage));
        for (const it of built.items) {
          expect(mountIssue(it.id, it.zone), `${c.code}/${role}: ${it.id} в ${it.zone}`).toBeNull();
        }
      }
    }
  });
});

describe('Проверка боекомплекта', () => {
  it('орудие без пачки бракуется', () => {
    const report = validateAssembly({
      chassisCode: 'IS-H55-R3F2',
      role: 'brawler',
      techBase: 'is',
      tonnage: 55,
      armorTons: 4.0,
      // AC/10 несёт ammo: 10 как ёмкость магазина — пачкой это не считается.
      items: [{ id: 'is_ac10', kind: 'weapon', zone: 'torso', ammo: 10 }],
    });

    expect(report.valid).toBe(false);
    expect(report.issues.some((i) => i.kind === 'ammoMissing' && i.params.item === 'is_ac10')).toBe(true);
  });

  it('энергетическому оружию боекомплект не нужен', () => {
    const report = validateAssembly({
      chassisCode: 'IS-H55-R3F2',
      role: 'brawler',
      techBase: 'is',
      tonnage: 55,
      armorTons: 4.0,
      items: [{ id: 'is_ppc', kind: 'weapon', zone: 'rightArm', ammo: null }],
    });

    expect(report.valid).toBe(true);
  });
});

/**
 * ПЕРЕНОС НАВЕСКИ МЕЖДУ ЗОНАМИ (шаг 40).
 *
 * Сам список «куда можно перенести» собирает мехлаб, но правило, на котором он
 * стоит, живёт здесь: **годность зоны спрашивается у `mountIssue`, а не
 * проверяется интерфейсом своими `if`.** Это та же функция, которой правила зон
 * спрашивают валидатор и процедурный генератор (шаг 31), и потому экран
 * физически не может предложить сборку, которую валидатор отклонит.
 *
 * Если однажды кто-то заведёт в интерфейсе вторую проверку, сломается именно
 * это, и сломается тихо: подсказка начнёт расходиться с приговором.
 */
describe('перенос навески: интерфейс спрашивает правила у ядра', () => {
  it('ноги отказывают оружию, голова — крупному, руки берут всё', () => {
    // Ровно те правила, что записаны таблицей `mountRules` шагом 31. Проверка
    // идёт через `mountIssue` — единственный вход в таблицу.
    const big = 'is_ppc';
    const small = 'is_sl';
    expect(mountIssue(big, 'leftLeg')).not.toBeNull();
    expect(mountIssue(small, 'rightLeg')).not.toBeNull();
    expect(mountIssue(big, 'head')).not.toBeNull();
    expect(mountIssue(small, 'head')).toBeNull();
    expect(mountIssue(big, 'rightArm')).toBeNull();
    expect(mountIssue(big, 'torso')).toBeNull();
  });

  it('охладитель в ногу идёт, а орудие — нет: ноги отданы оборудованию', () => {
    // Вторая половина правила, без которой первая читалась бы как «в ноги
    // нельзя ничего».
    expect(mountIssue('is_hs', 'leftLeg')).toBeNull();
    expect(mountIssue('is_ml', 'leftLeg')).not.toBeNull();
  });
});

describe('Локомоция (2026-09-10)', () => {
  // Ось заведена КОСМЕТИЧЕСКОЙ: разные силуэты при одних правилах. Тесты ниже
  // охраняют именно это обещание — стоит локомоции начать двигать хоть одно
  // число платформы, и она превращается в правило, которого никто не мерил.

  it('локомоция не меняет НИ ОДНОГО числа платформы', () => {
    const numeric = [
      'walkMP', 'runMP', 'baseHeatDiss', 'reactorMass', 'frameMass', 'systemsMass',
      'totalStructure', 'maxArmorPts', 'defArmorMass', 'payloadMass',
      'frameSlotPenalty', 'freeSlotsTotal',
    ] as const;

    for (const tech of ['is', 'clan'] as const) {
      for (const tonnage of CONSTRUCTION.tonnages) {
        for (let r = 1; r <= REACTOR_TIER_COUNT; r++) {
          // Общие тиры каркаса: только на них сравнение вообще возможно.
          const shared = frameTiersFor('H').filter((f) => frameTiersFor('N').includes(f));
          for (const f of shared) {
            const h = makePlatform(tech, tonnage, r, f, undefined, 'H');
            const n = makePlatform(tech, tonnage, r, f, undefined, 'N');
            for (const key of numeric) {
              expect(n[key], `${h.code} против ${n.code}, поле ${key}`).toBe(h[key]);
            }
          }
        }
      }
    }
  });

  it('код шасси несёт букву локомоции, и только её', () => {
    const h = makePlatform('is', 55, 3, 2, undefined, 'H');
    const n = makePlatform('is', 55, 3, 2, undefined, 'N');
    expect(h.code).toBe('IS-H55-R3F2');
    expect(n.code).toBe('IS-N55-R3F2');
    expect(h.locomotion).toBe('H');
    expect(n.locomotion).toBe('N');
  });

  it('несуществующий каркас у локомоции не собирается', () => {
    // F1 есть у гуманоида и нет у негуманоида — иначе тир, которого нет в
    // каталоге, можно было бы посчитать в обход каталога.
    expect(frameTiersFor('H')).toContain(1);
    expect(frameTiersFor('N')).not.toContain(1);
    expect(() => makePlatform('is', 55, 3, 1, undefined, 'N')).toThrow(/локомоции N не существует/);
    expect(() => makePlatform('is', 55, 3, 1, undefined, 'H')).not.toThrow();
  });

  it('шкалы тиров по локомоции лежат в пределах общей шкалы', () => {
    for (const loc of LOCOMOTIONS) {
      const tiers = frameTiersFor(loc);
      expect(tiers.length).toBeGreaterThan(0);
      for (const t of tiers) {
        expect(t).toBeGreaterThanOrEqual(1);
        expect(t).toBeLessThanOrEqual(FRAME_TIER_COUNT);
      }
    }
  });

  it('каталог: обе локомоции представлены, и ни одна не вылезла за свою шкалу', () => {
    for (const loc of LOCOMOTIONS) {
      const rows = CHASSIS_CATALOG_LIST.filter((c) => c.locomotion === loc);
      expect(rows.length, `в каталоге нет шасси локомоции ${loc}`).toBeGreaterThan(0);
      const allowed = frameTiersFor(loc);
      for (const c of rows) {
        expect(allowed, `${c.code}: каркас вне шкалы локомоции`).toContain(c.frameTier);
      }
      // Буква в коде обязана совпадать с полем: по коду её читает и подмена
      // тира в мехлабе, и выбор силуэта в интерфейсе.
      for (const c of rows) expect(c.code.slice(3, 4)).toBe(loc);
    }
  });

  it('все 850 шасси каталога имеют уникальные канонические имена с литерами реакторов A-E', () => {
    const named = CHASSIS_CATALOG_LIST.filter((c) => c.canonName !== '');
    expect(named.length).toBe(850);
    expect(new Set(named.map((c) => c.canonName)).size).toBe(850);
    // 340 негуманоидов (170 IS + 170 Clan) и 510 гуманоидов (255 IS + 255 Clan)
    expect(named.filter((c) => c.locomotion === 'N').length).toBe(340);
    const byName = new Map(named.map((c) => [c.canonName, c]));
    expect(byName.get('Timber Wolf (Mad Cat) D')?.code).toBe('CL-N75-R4F3');
    expect(byName.get('Locust E')?.code).toBe('IS-N20-R5F2');
    expect(byName.get('Atlas C')?.code).toBe('IS-H100-R3F1');
  });
});
