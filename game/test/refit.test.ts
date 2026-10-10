import { describe, expect, it } from 'vitest';
import { zoneFromId as zoneIndexOf } from '../src/core/model/HitZone.js';
import { WEAPONS as WEAPON_TABLE } from '../src/core/data/tables.js';
import {
  CampaignRejectReason,
  isStripOnly,
  stripBlockers,
  CampaignState,
  GALAXY,
  availableMechs,
  execute,
  hashCampaignState,
  isRefittable,
  makeCompany,
  makeRecord,
  makeSaveFile,
  marketProfile,
  recordChassisDef,
  mechLotCount,
  mechStock,
  parseSaveFile,
  refitPlan,
  restore,
  snapshot,
  type CampaignCommand,
  type CampaignEvent,
  type Company,
  type MarketClass,
  type MechRecord,
  type WarehouseEntry,
} from '../src/core/campaign/index.js';
import {
  generateAssembly,
  getChassisCatalogEntry,
  type MechAssembly,
  type MountedItem,
} from '../src/core/rules/index.js';
import { Rng } from '../src/core/rng/index.js';
import { zoneFromId } from '../src/core/model/HitZone.js';
import { replacePartPlan, zoneRepairPlan } from '../src/core/campaign/company/jobs.js';
import { ECONOMY, WEAPONS } from '../src/core/data/index.js';
import { REPAINT_DAYS, repaintCost } from '../src/core/campaign/mech/repaint.js';
import { bayStep, buyMechStep } from '../src/sim/campaign/manager.js';

/**
 * Шаг 19a — мехлаб, покупка машин, первая ступень цеха.
 *
 * Проверяется то, на чём стоит весь шаг: переоснащение — работа стапеля со
 * складом на входе и на выходе, а не редактор с бесконечным ассортиментом;
 * паспортное состояние машины — условие, а не пожелание; лестница цеха идёт
 * только вверх и только по одной ступени за раз; прилавок машин выводится
 * ровно так же, как прилавок узлов, и не хранится.
 */

const CODE = 'IS-H55-R3F2';
const WORLD = 1;

function freshRecord(id: string, seed = 1, code = CODE): MechRecord {
  return makeRecord({ id, assembly: generateAssembly({ chassisCode: code, role: 'brawler' }, new Rng(seed)) });
}

function systemOfClass(cls: MarketClass): string {
  for (let i = 0; i < GALAXY.count; i++) {
    const id = GALAXY.id(i);
    if (marketProfile(WORLD, id).marketClass === cls) return id;
  }
  throw new Error(`На карте нет ни одной системы класса ${cls}`);
}

function stateAt(systemId: string, company: Partial<Company> = {}): CampaignState {
  const state = new CampaignState(1, { worldSeed: WORLD, systemId });
  state.company = { ...makeCompany(), ...company };
  return state;
}

function run(state: CampaignState, command: CampaignCommand): readonly CampaignEvent[] {
  const result = execute(state, command);
  if (!result.ok) throw new Error(`Команда ${command.kind} отклонена: ${result.reason}`);
  return result.events;
}

function reasonOf(state: CampaignState, command: CampaignCommand): CampaignRejectReason | null {
  const result = execute(state, command);
  return result.ok ? null : result.reason;
}

/** Первое орудие сборки — то, что мехлабу есть смысл снимать. */
function firstWeapon(assembly: MechAssembly): MountedItem {
  const weapon = assembly.items.find((it) => WEAPONS.has(it.id));
  if (weapon === undefined) throw new Error('В сборке нет ни одного орудия');
  return weapon;
}

function without(assembly: MechAssembly, item: MountedItem): MechAssembly {
  const at = assembly.items.indexOf(item);
  return { ...assembly, items: assembly.items.filter((_, i) => i !== at) };
}

function stockItem(id: string, itemId: string): WarehouseEntry {
  return { sort: 'item', id, itemId, kind: 'weapon' };
}

/** Виды замечаний плана одной строкой — для сообщения упавшей проверки. */
function kinds(issues: readonly { readonly kind: string }[]): string {
  return issues.map((i) => i.kind).join('; ');
}

describe('мехлаб: план переоснащения', () => {
  it('снятое орудие уходит на склад, а поставленное с него берётся', () => {
    const record = freshRecord('M-1');
    const weapon = firstWeapon(record.assembly);
    const company = makeCompany();

    const strip = refitPlan(company, record, without(record.assembly, weapon));
    expect(strip.valid, kinds(strip.issues)).toBe(true);
    expect(strip.removed).toHaveLength(1);
    expect(strip.returns.map((r) => r.id)).toEqual([weapon.id]);
    expect(strip.partIds).toHaveLength(0);

    // Обратный ход: поставить то же орудие, не имея его на складе, нельзя.
    // Запись собирается заново: состояние индексируется по установкам сборки,
    // и подменить одну сборку другой, оставив старое состояние, значило бы
    // получить машину, которой не бывает.
    const stripped: MechRecord = makeRecord({ id: 'M-1', assembly: without(record.assembly, weapon) });
    const noStock = refitPlan(company, stripped, record.assembly);
    expect(noStock.valid).toBe(false);
    // Замечание — данными (шаг 52): какой установки и сколько не хватает; словами
    // его называет экран.
    expect(noStock.issues).toContainEqual({ kind: 'missingStock', params: { item: weapon.id, count: 1 } });

    const withStock = refitPlan(
      { ...company, warehouse: [stockItem('w-1', weapon.id)] },
      stripped,
      record.assembly,
    );
    expect(withStock.valid, kinds(withStock.issues)).toBe(true);
    expect(withStock.partIds).toEqual(['w-1']);
  });

  it('перестановка внутри машины стоит работы, но склада не касается', () => {
    const record = freshRecord('M-1');
    const weapon = firstWeapon(record.assembly);
    const moved: MountedItem = { ...weapon, zone: weapon.zone === 'leftArm' ? 'rightArm' : 'leftArm' };
    const target = { ...without(record.assembly, weapon), items: [...without(record.assembly, weapon).items, moved] };

    const plan = refitPlan(makeCompany(), record, target);
    expect(plan.removed).toHaveLength(1);
    expect(plan.installed).toHaveLength(1);
    expect(plan.partIds).toHaveLength(0);
    expect(plan.returns).toHaveLength(0);
    expect(plan.cost).toBeGreaterThan(0);
  });

  it('сборка, не проходящая валидатор, не годится и без всякого склада', () => {
    const record = freshRecord('M-1');
    const weapon = firstWeapon(record.assembly);
    // Вешаем то же орудие ещё трижды: масса и ячейки не сойдутся.
    const target: MechAssembly = {
      ...record.assembly,
      items: [...record.assembly.items, weapon, weapon, weapon],
    };
    const plan = refitPlan(
      { ...makeCompany(), warehouse: [stockItem('w-1', weapon.id), stockItem('w-2', weapon.id), stockItem('w-3', weapon.id)] },
      record,
      target,
    );
    expect(plan.valid).toBe(false);
    expect(plan.report.valid).toBe(false);
  });

  it('расстрелянный боезапас не запрещает переоснащение, а входит в его цену', () => {
    const record = freshRecord('M-1');
    const def = recordChassisDef(record);
    const bin = def.mounts.findIndex((m) => m.ammo !== null && m.ammo > 0);
    if (bin < 0) throw new Error('У эталонной сборки нет ни одного бункера');
    const spent: MechRecord = {
      ...record,
      condition: { ...record.condition, ammo: record.condition.ammo.map((a, i) => (i === bin ? 0 : a)) },
    };

    expect(isRefittable(spent)).toBe(true);
    const weapon = firstWeapon(record.assembly);
    const full = refitPlan(makeCompany(), record, without(record.assembly, weapon));
    const empty = refitPlan(makeCompany(), spent, without(record.assembly, weapon));
    // Тот же наряд, но с доснаряжением бункера — значит, он дороже ровно на него.
    expect(empty.ammoAdded).toBeGreaterThan(0);
    expect(empty.cost).toBeGreaterThan(full.cost);
  });

  it('доливка брони считается расходником по ценам ремонта, а снятие не возвращает ничего', () => {
    const record = freshRecord('M-1');
    const lighter: MechAssembly = { ...record.assembly, armorTons: record.assembly.armorTons - 1 };
    const record2: MechRecord = makeRecord({ id: 'M-2', assembly: lighter });

    const up = refitPlan(makeCompany(), record2, record.assembly);
    expect(up.armorAdded).toBeGreaterThan(0);
    expect(up.cost).toBeGreaterThan(0);

    const down = refitPlan(makeCompany(), record, lighter);
    expect(down.valid).toBe(true);
    expect(down.armorAdded).toBe(0);
    expect(down.returns).toHaveLength(0);
  });
});

describe('мехлаб: работа стапеля', () => {
  it('переоснащение списывает деньги при постановке, а склад меняет по завершении', () => {
    const record = freshRecord('M-1');
    const weapon = firstWeapon(record.assembly);
    const state = stateAt(systemOfClass('capital'), { mechs: [record], cbills: 2_000_000 });

    const target = without(record.assembly, weapon);
    const plan = refitPlan(state.company, record, target);
    const before = state.company.cbills;

    run(state, { kind: 'refitMech', recordId: 'M-1', assembly: target });
    expect(state.company.cbills).toBe(before - plan.cost);
    // До срока машина не тронута: сборка прежняя, склад пуст.
    expect(state.company.mechs[0]?.assembly.items).toHaveLength(record.assembly.items.length);
    expect(state.company.warehouse).toHaveLength(0);

    run(state, { kind: 'advance', days: Math.ceil(plan.days) + 1 });
    const after = state.company.mechs[0] as MechRecord;
    expect(after.assembly.items).toHaveLength(record.assembly.items.length - 1);
    expect(state.company.warehouse.map((w) => (w.sort === 'item' ? w.itemId : w.node))).toEqual([weapon.id]);
    // Машина выходит из цеха в паспортном состоянии по НОВОЙ спецификации.
    expect(isRefittable(after)).toBe(true);
  });

  it('снятая пачка боезапаса возвращается на склад так же, как ствол', () => {
    // Симметрия склада (правка 2026-09-08). С шага 32 пачка боезапаса —
    // складская запись: поставить её можно только со склада, и план честно
    // списывает её оттуда. Обратный ход не работал: снятая пачка не
    // возвращалась никуда, и «сними и поставь обратно» тихо съедало ящик.
    const record = freshRecord('M-1');
    const weapon = record.assembly.items.find(
      (it) => WEAPONS.has(it.id) && record.assembly.items.some((a) => a.kind === 'ammo'),
    );
    const bin = record.assembly.items.find((it) => it.kind === 'ammo');
    expect(bin, 'в сборке нет ни одной пачки боезапаса').toBeDefined();
    expect(weapon).toBeDefined();

    // Снимается орудие вместе со своей пачкой — ровно то, что делает мехлаб:
    // осиротевший боекомплект уходит с последним орудием.
    const target = without(without(record.assembly, weapon as MountedItem), bin as MountedItem);
    const state = stateAt(systemOfClass('capital'), { mechs: [record], cbills: 2_000_000 });
    const plan = refitPlan(state.company, record, target);
    expect(plan.valid, kinds(plan.issues)).toBe(true);

    run(state, { kind: 'refitMech', recordId: 'M-1', assembly: target });
    run(state, { kind: 'advance', days: Math.ceil(plan.days) + 1 });

    const shelf = state.company.warehouse.filter((w) => w.sort === 'item').map((w) => w.itemId);
    expect(shelf).toContain((bin as MountedItem).id);
    expect(shelf).toContain((weapon as MountedItem).id);

    // И обратный ход замыкается: снятое ставится назад с той же полки, ничего
    // не докупая.
    const back = refitPlan(state.company, state.company.mechs[0] as MechRecord, record.assembly);
    expect(back.valid, kinds(back.issues)).toBe(true);
  });

  it('в побитую машину МОНТИРОВАТЬ нельзя: правило против обхода ремонта живо', () => {
    const record = freshRecord('M-1');
    const damaged: MechRecord = {
      ...record,
      condition: {
        ...record.condition,
        zones: record.condition.zones.map((z, i) => (i === 2 ? { ...z, armor: 0 } : z)),
      },
    };
    // На складе есть что поставить — отказ должен быть по состоянию машины,
    // а не по пустому складу.
    const state = stateAt(systemOfClass('capital'), {
      mechs: [damaged],
      cbills: 2_000_000,
      warehouse: [{ sort: 'item', id: 'P-1', itemId: 'is_ml', kind: 'weapon' }],
    });
    expect(isRefittable(damaged)).toBe(false);
    const added: MechAssembly = {
      ...record.assembly,
      items: [...record.assembly.items, { id: 'is_ml', kind: 'weapon', zone: 'torso', ammo: null }],
    };
    expect(reasonOf(state, { kind: 'refitMech', recordId: 'M-1', assembly: added })).toBe(
      CampaignRejectReason.MechNotRepaired,
    );
  });

  it('с побитой машины СНИМАЮТ уцелевшее железо без предварительного ремонта (шаг 33)', () => {
    // questions.md п. 15: боеспособный мех стоял без оружия, а рядом на стапеле
    // обездвиженная машина с целыми дорогими стволами — и переставить их было
    // нельзя, пока не оплачена полная полевая замена ноги. Обходить ремонт
    // можно было только монтажом, а под запрет попало и снятие.
    const record = freshRecord('M-1');
    const damaged: MechRecord = {
      ...record,
      condition: {
        ...record.condition,
        zones: record.condition.zones.map((z, i) => (i === 2 ? { ...z, armor: 0 } : z)),
      },
    };
    const state = stateAt(systemOfClass('capital'), { mechs: [damaged], cbills: 2_000_000 });
    expect(isRefittable(damaged)).toBe(false);

    const gun = firstWeapon(record.assembly);
    const stripped = without(record.assembly, gun);
    expect(isStripOnly(damaged, stripped)).toBe(true);
    expect(reasonOf(state, { kind: 'refitMech', recordId: 'M-1', assembly: stripped })).toBeNull();

    const plan = refitPlan(state.company, damaged, stripped);
    run(state, { kind: 'refitMech', recordId: 'M-1', assembly: stripped });
    run(state, { kind: 'advance', days: Math.ceil(plan.days) + 1 });
    // Ствол уехал на склад, повреждение зоны осталось при машине: цех снял
    // навеску, а не починил броню.
    expect(state.company.warehouse.some((w) => w.sort === 'item' && w.itemId === gun.id)).toBe(true);
    expect(state.company.mechs[0]!.condition.zones[2]!.armor).toBe(0);
  });

  it('демонтаж не воскрешает выбитое: снятое чинит склад, а не критом убитый ствол', () => {
    // Дыра, найденная при разрешении демонтажа с побитой машины (шаг 33):
    // `applyRefit` пересобирал состояние по паспорту, и снятие одного малого
    // лазера чинило бы всю броню и все выбитые критами стволы разом.
    const record = freshRecord('M-1');
    const gun = firstWeapon(record.assembly);
    // Выбита ПОСЛЕДНЯЯ установка, снимается ПЕРВАЯ: проверяется именно перенос
    // состояния, а не совпадение индексов.
    const lastIndex = record.condition.destroyedMounts.length - 1;
    const damaged: MechRecord = {
      ...record,
      condition: {
        ...record.condition,
        zones: record.condition.zones.map((z, i) => (i === 1 ? { ...z, armor: 0 } : z)),
        destroyedMounts: record.condition.destroyedMounts.map((_, i) => i === lastIndex),
      },
    };
    const state = stateAt(systemOfClass('capital'), { mechs: [damaged], cbills: 2_000_000 });
    const stripped = without(record.assembly, gun);
    const plan = refitPlan(state.company, damaged, stripped);
    run(state, { kind: 'refitMech', recordId: 'M-1', assembly: stripped });
    run(state, { kind: 'advance', days: Math.ceil(plan.days) + 1 });

    const after = state.company.mechs[0] as MechRecord;
    expect(after.condition.zones[1]!.armor).toBe(0);
    expect(after.condition.destroyedMounts.some((d) => d)).toBe(true);
  });

  it('из разрушенной зоны не снимают — и план называет установку и зону (плейтест 2026-09-15)', () => {
    // Мехлаб давал нажать «Снять» у ствола в разрушенной руке, а в ответ писал
    // общее «сначала ремонт». Теперь отказ — по позиции, словами игрока.
    const record = freshRecord('M-1');
    const gun = firstWeapon(record.assembly);
    const zi = zoneIndexOf(gun.zone);
    const damaged: MechRecord = {
      ...record,
      condition: {
        ...record.condition,
        zones: record.condition.zones.map((z, i) => (i === zi ? { armor: 0, structure: 0, destroyed: true } : z)),
      },
    };
    const stripped = without(record.assembly, gun);
    expect(isStripOnly(damaged, stripped)).toBe(false);
    expect(stripBlockers(damaged, stripped)).toContainEqual({ kind: 'zoneDestroyed', id: gun.id, zone: gun.zone });

    const state = stateAt(systemOfClass('capital'), { mechs: [damaged], cbills: 2_000_000 });
    const plan = refitPlan(state.company, damaged, stripped);
    expect(plan.valid).toBe(false);
    expect(plan.blockers).toContainEqual({ kind: 'zoneDestroyed', id: gun.id, zone: gun.zone });
    // Ядро отдаёт причину данными, а не фразой: словами её называет экран. Причина
    // демонтажа живёт в `blockers` и в замечания сборки не дублируется.
    expect(plan.issues.map((i) => i.kind)).not.toContain('zoneDestroyed');
    expect(reasonOf(state, { kind: 'refitMech', recordId: 'M-1', assembly: stripped })).toBe(
      CampaignRejectReason.MechNotRepaired,
    );
  });

  it('с целой зоны машины-лома снимают: разрушенный торс снятию из руки не мешает', () => {
    const record = freshRecord('M-1');
    const armGun = record.assembly.items.find(
      (it) => WEAPON_TABLE.has(it.id) && (it.zone === 'leftArm' || it.zone === 'rightArm'),
    );
    if (armGun === undefined) throw new Error('у тестовой машины нет ствола в руке');
    const torso = zoneIndexOf('torso');
    const wreck: MechRecord = {
      ...record,
      condition: {
        ...record.condition,
        zones: record.condition.zones.map((z, i) => (i === torso ? { armor: 0, structure: 0, destroyed: true } : z)),
      },
    };
    const stripped = without(record.assembly, armGun);
    expect(stripBlockers(wreck, stripped)).toEqual([]);
    const state = stateAt(systemOfClass('capital'), { mechs: [wreck], cbills: 2_000_000 });
    expect(reasonOf(state, { kind: 'refitMech', recordId: 'M-1', assembly: stripped })).toBeNull();
  });

  it('занятое одной работой железо не достаётся второй', () => {
    const base = freshRecord('M-1');
    const weapon = firstWeapon(base.assembly);
    const stripped: MechRecord = makeRecord({ id: 'M-1', assembly: without(base.assembly, weapon) });
    const other: MechRecord = makeRecord({ id: 'M-2', assembly: without(base.assembly, weapon) });

    const state = stateAt(systemOfClass('capital'), {
      mechs: [stripped, other],
      warehouse: [stockItem('w-1', weapon.id)],
      cbills: 2_000_000,
    });

    run(state, { kind: 'refitMech', recordId: 'M-1', assembly: base.assembly });
    expect(reasonOf(state, { kind: 'refitMech', recordId: 'M-2', assembly: base.assembly })).toBe(
      CampaignRejectReason.BadRefit,
    );
  });

  it('снимок переживает незавершённое переоснащение вместе с целевой сборкой', () => {
    const record = freshRecord('M-1');
    const target = without(record.assembly, firstWeapon(record.assembly));
    const state = stateAt(systemOfClass('capital'), { mechs: [record], cbills: 2_000_000 });
    run(state, { kind: 'refitMech', recordId: 'M-1', assembly: target });

    const back = restore(parseSaveFile(makeSaveFile(snapshot(state))));
    expect(hashCampaignState(back)).toBe(hashCampaignState(state));

    run(state, { kind: 'advance', days: 10 });
    run(back, { kind: 'advance', days: 10 });
    expect(hashCampaignState(back)).toBe(hashCampaignState(state));
    expect(back.company.mechs[0]?.assembly.items).toHaveLength(target.items.length);
  });

  it('хэш различает две одинаковые машины с разной навеской', () => {
    const record = freshRecord('M-1');
    const a = stateAt(systemOfClass('capital'), { mechs: [record] });
    const b = stateAt(systemOfClass('capital'), {
      mechs: [makeRecord({ id: 'M-1', assembly: without(record.assembly, firstWeapon(record.assembly)) })],
    });
    expect(hashCampaignState(a)).not.toBe(hashCampaignState(b));
  });
});

describe('лестница цеха и десантные корабли', () => {
  it('на «Леопарде» цех растёт по +1 до четырёх и упирается в потолок судна', () => {
    const state = stateAt(systemOfClass('capital'), { cbills: 30_000_000 });
    expect(state.company.dropship).toBe('leopard');
    expect(state.company.bays).toBe(2);

    // Ступень 1: 2 -> 3
    run(state, { kind: 'upgradeBays' });
    expect(reasonOf(state, { kind: 'upgradeBays' })).toBe(CampaignRejectReason.BaysUpgrading);
    run(state, { kind: 'advance', days: 11 });
    expect(state.company.bays).toBe(3);

    // Ступень 2: 3 -> 4
    run(state, { kind: 'upgradeBays' });
    run(state, { kind: 'advance', days: 15 });
    expect(state.company.bays).toBe(4);

    // Потолок Леопарда достигнут!
    expect(reasonOf(state, { kind: 'upgradeBays' })).toBe(CampaignRejectReason.BaysMaxed);

    // Модернизация до Union на столичной верфи
    run(state, { kind: 'upgradeDropship' });
    expect(state.company.dropship).toBe('union');
    expect(state.company.bays).toBe(4);

    // На Union цех растёт дальше: 4 -> 5, 6, 7, 8
    for (let to = 5; to <= 8; to++) {
      run(state, { kind: 'upgradeBays' });
      run(state, { kind: 'advance', days: 25 });
      expect(state.company.bays).toBe(to);
    }
    expect(reasonOf(state, { kind: 'upgradeBays' })).toBe(CampaignRejectReason.BaysMaxed);

    // Модернизация до Overlord
    run(state, { kind: 'upgradeDropship' });
    expect(state.company.dropship).toBe('overlord');

    // На Overlord цех растёт до 16
    for (let to = 9; to <= 16; to++) {
      run(state, { kind: 'upgradeBays' });
      run(state, { kind: 'advance', days: 40 });
      expect(state.company.bays).toBe(to);
    }
    expect(reasonOf(state, { kind: 'upgradeBays' })).toBe(CampaignRejectReason.BaysMaxed);
    expect(reasonOf(state, { kind: 'upgradeDropship' })).toBe(CampaignRejectReason.DropshipMaxed);
  });

  it('вместимость ангара ограничивает покупку машин на рынке', () => {
    const state = stateAt(systemOfClass('capital'), { cbills: 50_000_000 });
    expect(state.company.dropship).toBe('leopard');

    // Наполняем парк роты фиктивными машинами до лимита Леопарда (4 машины)
    const dummyMechs: MechRecord[] = [
      freshRecord('M-1'),
      freshRecord('M-2'),
      freshRecord('M-3'),
      freshRecord('M-4'),
    ];
    state.company = { ...state.company, mechs: dummyMechs };
    expect(state.company.mechs.length).toBe(4);

    const lots = mechStock(WORLD, state.systemId, state.day);
    const lot = lots[0]!;

    // Пятая машина отклоняется: ангар полон
    expect(reasonOf(state, { kind: 'buyMech', lotId: lot.id })).toBe(CampaignRejectReason.HangarFull);

    // Покупаем Union: вместимость расширяется до 12
    run(state, { kind: 'upgradeDropship' });
    expect(state.company.dropship).toBe('union');
    expect(execute(state, { kind: 'buyMech', lotId: lot.id }).ok).toBe(true);
    expect(state.company.mechs.length).toBe(5);
  });

  it('модернизация судна невозможна в захолустье без верфи', () => {
    const id = systemOfClass('backwater');
    const state = stateAt(id, { cbills: 50_000_000 });
    expect(reasonOf(state, { kind: 'upgradeDropship' })).toBe(CampaignRejectReason.NotAtShipyard);
  });

  it('бот-менеджер не покупает мехов сверх вместимости корабля, даже если fleetCap выше', () => {
    // `fleetCap` политики (6) выше вместимости Leopard (4) — без учёта
    // корабля бот бился бы в HangarFull до конца прогона (шаг про DropShip,
    // разошедшийся с execute.ts дубликат `nextBaySteps`).
    const state = stateAt(systemOfClass('capital'), {
      mechs: [freshRecord('M-1'), freshRecord('M-2'), freshRecord('M-3'), freshRecord('M-4')],
      cbills: 50_000_000,
    });
    const policy = {
      repairThreshold: 0,
      fleetCap: 6,
      supplyThreshold: 0,
      supplyJumps: 3,
      contractOdds: 0.75,
      loyaltyThreshold: null,
    };
    const before = state.company.cbills;
    const result = buyMechStep(state, policy);
    expect(result).toEqual({ spent: 0, bought: 0 });
    expect(state.company.mechs.length).toBe(4);
    expect(state.company.cbills).toBe(before);
  });

  it('бот-менеджер не пытается расширить цех выше потолка текущего корабля', () => {
    // Все четыре стапеля Leopard заняты настоящими работами (иначе `bayStep`
    // отсеет попытку раньше, чем дойдёт до лестницы, и тест ничего не проверит).
    const mkDamaged = (id: string): MechRecord => {
      const record = freshRecord(id);
      return {
        ...record,
        condition: {
          ...record.condition,
          zones: record.condition.zones.map((z, i) => (i === 2 ? { ...z, armor: 0 } : z)),
        },
      };
    };
    const mechs = ['M-1', 'M-2', 'M-3', 'M-4'].map(mkDamaged);
    const state = stateAt(systemOfClass('capital'), { mechs, bays: 4, cbills: 50_000_000 });
    for (const m of mechs) {
      expect(execute(state, { kind: 'repairZone', recordId: m.id, zone: 'leftArm' }).ok).toBe(true);
    }

    const policy = {
      repairThreshold: 0,
      fleetCap: 6,
      supplyThreshold: 0,
      supplyJumps: 3,
      contractOdds: 0.75,
      loyaltyThreshold: null,
    };
    const before = state.company.cbills;
    const result = bayStep(state, policy);
    expect(result).toEqual({ spent: 0, upgrades: 0 });
    expect(state.company.bays).toBe(4);
    expect(state.company.cbills).toBe(before);
  });

  it('расширение цеха не занимает стапель: работы продолжают ставиться', () => {
    const record = freshRecord('M-1');
    const damaged: MechRecord = {
      ...record,
      condition: {
        ...record.condition,
        zones: record.condition.zones.map((z, i) => (i === 2 ? { ...z, armor: 0 } : z)),
      },
    };
    const state = stateAt(systemOfClass('capital'), { mechs: [damaged], cbills: 10_000_000 });
    run(state, { kind: 'upgradeBays' });
    expect(execute(state, { kind: 'repairZone', recordId: 'M-1', zone: 'leftArm' }).ok).toBe(true);
  });

  it('денег не хватило — ступень не ставится и очередь чиста', () => {
    const state = stateAt(systemOfClass('capital'), { cbills: 1000 });
    expect(reasonOf(state, { kind: 'upgradeBays' })).toBe(CampaignRejectReason.InsufficientFunds);
    expect(state.queue.some((e) => e.task.kind === 'baysUpgraded')).toBe(false);
  });
});

describe('покупка машины целиком', () => {
  it('прилавок машин выводится, а не хранится: один и тот же мир даёт тот же список', () => {
    const id = systemOfClass('capital');
    const first = mechStock(WORLD, id, 0);
    const again = mechStock(WORLD, id, 5);
    expect(first.map((l) => l.id)).toEqual(again.map((l) => l.id));
    expect(first.map((l) => l.price)).toEqual(again.map((l) => l.price));

    // Другая декада — другой прилавок.
    const later = mechStock(WORLD, id, 100);
    expect(later.map((l) => l.id)).not.toEqual(first.map((l) => l.id));
  });

  it('на периферии машин не продают, в столице продают', () => {
    expect(mechLotCount(marketProfile(WORLD, systemOfClass('periphery')))).toBe(0);
    expect(mechLotCount(marketProfile(WORLD, systemOfClass('capital')))).toBeGreaterThan(0);
  });

  it('покупка ставит машину в ростер и вычёркивает лот из прилавка', () => {
    const id = systemOfClass('capital');
    const state = stateAt(id, { cbills: 50_000_000 });
    const lot = mechStock(WORLD, id, state.day)[0];
    if (lot === undefined) throw new Error('В столице пустой прилавок машин');

    const before = state.company.cbills;
    const events = run(state, { kind: 'buyMech', lotId: lot.id });
    expect(state.company.cbills).toBe(before - lot.price);
    expect(state.company.mechs).toHaveLength(1);
    expect(state.company.mechs[0]?.pilotId).toBeNull();
    expect(events.some((e) => e.kind === 'mechBought')).toBe(true);

    expect(availableMechs(WORLD, id, state.day, ['x']).length).toBeGreaterThan(0);
    expect(reasonOf(state, { kind: 'buyMech', lotId: lot.id })).toBe(CampaignRejectReason.LotNotAvailable);
  });

  it('цена машины выше её оценочной стоимости: наценка прилавка — правило', () => {
    const id = systemOfClass('capital');
    for (const lot of mechStock(WORLD, id, 0)) {
      expect(lot.price).toBeGreaterThan(lot.value);
    }
  });

  it('в пути машин не покупают', () => {
    const id = systemOfClass('capital');
    const state = stateAt(id, { cbills: 50_000_000 });
    const lot = mechStock(WORLD, id, state.day)[0];
    if (lot === undefined) throw new Error('В столице пустой прилавок машин');
    state.travel = { path: [id, id], legIndex: 0, startDay: 0, arrivalDay: 10, cost: 0 };
    expect(reasonOf(state, { kind: 'buyMech', lotId: lot.id })).toBe(CampaignRejectReason.NotAtMarket);
  });
});

describe('смена реактора (шаг 32)', () => {
  // Постановка пользователя 2026-09-07: свободный вес, появившийся после шага
  // 31, должен быть во что вкладывать, и скорость — главное, за что его стоит
  // отдавать. До шага 32 узел другого тира отвергался как несовместимый, и
  // подвижность машины оставалась намертво такой, какой её выдал каталог.

  it('реактор старшего тира встаёт и меняет код шасси, сохраняя запись машины', () => {
    const record = freshRecord('M-1');
    const state = stateAt(systemOfClass('capital'), { mechs: [record], cbills: 20_000_000 });
    const tier = getChassisCatalogEntry(record.assembly.chassisCode).reactorTier;
    const faster = tier + 1;
    if (faster > 5) return;

    const partId = 'P-swap';
    state.company = {
      ...state.company,
      warehouse: [
        ...state.company.warehouse,
        {
          sort: 'node',
          id: partId,
          node: 'reactor',
          quality: 'standard',
          wear: 0,
          sourceTonnage: record.assembly.tonnage,
          tier: faster,
        },
      ],
    };

    const res = execute(state, { kind: 'installPart', recordId: record.id, partId });
    if (!res.ok) {
      // Навеска может не поместиться на более тяжёлый реактор — это законный
      // отказ, а не поломка: проверяется, что причина именно такая.
      expect([CampaignRejectReason.BadRefit, CampaignRejectReason.PartMismatch]).toContain(res.reason);
      return;
    }

    run(state, { kind: 'advance', days: 60 });
    const after = state.company.mechs.find((m) => m.id === record.id)!;
    expect(getChassisCatalogEntry(after.assembly.chassisCode).reactorTier).toBe(faster);
    // Машина ТА ЖЕ: тоннаж, каркас и пилот не тронуты, поменяли двигатель.
    expect(after.assembly.tonnage).toBe(record.assembly.tonnage);
    expect(getChassisCatalogEntry(after.assembly.chassisCode).frameTier).toBe(
      getChassisCatalogEntry(record.assembly.chassisCode).frameTier,
    );
    expect(after.pilotId).toBe(record.pilotId);
    // Реактор старше — машина быстрее: за это свободный вес и отдают.
    expect(getChassisCatalogEntry(after.assembly.chassisCode).walkMP).toBeGreaterThan(
      getChassisCatalogEntry(record.assembly.chassisCode).walkMP,
    );
  });
});

/**
 * ПАКЕТНЫЙ РЕМОНТ (шаг 39) — правила, а не кнопка.
 *
 * Сама кнопка живёт в интерфейсе и ставит N команд `repairZone`, но правило, на
 * котором она стоит, проверяется здесь: **оторванные зоны в пакет не идут.**
 * Оторванный узел требует `replacePart` с шансом провала и понижением класса
 * каркаса — это отдельное взвешенное решение игрока, и превращать его в
 * побочный эффект пакетной кнопки нельзя. Если фильтр однажды съедет, сломается
 * именно это, и тихо.
 */
describe('пакетный ремонт: оторванное не чинится наравне с поцарапанным', () => {
  it('оторванная зона в латальные работы не идёт, её берёт полевая замена', () => {
    // Признак оторванного — ФЛАГ `destroyed`, и он же граница между двумя
    // разными операциями. Пакетная кнопка обязана остановиться ровно здесь:
    // полевая замена имеет шанс провала и понижает класс каркаса, и делать её
    // побочным эффектом пакета нельзя.
    //
    // Проверяется и обратное: зона с обнулёнными числами, но БЕЗ флага, для
    // ядра всё ещё цела и латается. Значит опознавать оторванное по структуре
    // нельзя — только по флагу.
    const base = freshRecord('M-torn');
    const idx = zoneFromId('leftArm');
    const zeroed: MechRecord = {
      ...base,
      condition: {
        ...base.condition,
        zones: base.condition.zones.map((z, i) => (i === idx ? { ...z, armor: 0, structure: 0 } : z)),
      },
    };
    expect(zoneRepairPlan(zeroed, 'leftArm').jobCount).toBeGreaterThan(0);

    const torn: MechRecord = {
      ...zeroed,
      condition: {
        ...zeroed.condition,
        zones: zeroed.condition.zones.map((z, i) => (i === idx ? { ...z, destroyed: true } : z)),
      },
    };
    expect(zoneRepairPlan(torn, 'leftArm').jobCount).toBe(0);
    expect(replacePartPlan(torn, 'leftArm').jobCount).toBeGreaterThan(0);
  });

  it('поцарапанная зона в план попадает и стоит денег', () => {
    // Вторая половина того же правила: пакет обязан ЧТО-ТО делать, иначе первая
    // проверка прошла бы и на плане, который пуст всегда.
    const base = freshRecord('M-scratch', 2);
    const idx = zoneFromId('rightArm');
    const scratched: MechRecord = {
      ...base,
      condition: {
        ...base.condition,
        zones: base.condition.zones.map((z, i) => (i === idx ? { ...z, armor: 1 } : z)),
      },
    };
    const plan = zoneRepairPlan(scratched, 'rightArm');
    expect(plan.jobCount).toBeGreaterThan(0);
    expect(plan.cost).toBeGreaterThan(0);
  });
});

describe('перекраска (шаг 50)', () => {
  it('работа стапеля: деньги при постановке, цвета по завершении', () => {
    const record = freshRecord('M-1');
    const state = stateAt(systemOfClass('capital'), { mechs: [record], cbills: 2_000_000 });
    const cost = repaintCost(record);
    expect(cost).toBeGreaterThan(0);

    run(state, { kind: 'repaintMech', recordId: 'M-1', paint: 'kurita' });
    expect(state.company.cbills).toBe(2_000_000 - cost);
    // До срока машина в прежних цветах.
    expect(state.company.mechs[0]?.paint).toBeUndefined();

    const events = run(state, { kind: 'advance', days: REPAINT_DAYS + 1 });
    expect(state.company.mechs[0]?.paint).toBe('kurita');
    expect(events.some((e) => e.kind === 'mechRepainted' && e.paint === 'kurita')).toBe(true);
  });

  it('«как досталась» снимает перекраску целиком, а не пишет пустое поле', () => {
    const record = { ...freshRecord('M-1'), paint: 'steiner' };
    const state = stateAt(systemOfClass('capital'), { mechs: [record], cbills: 2_000_000 });

    run(state, { kind: 'repaintMech', recordId: 'M-1', paint: null });
    run(state, { kind: 'advance', days: REPAINT_DAYS + 1 });
    expect('paint' in (state.company.mechs[0] as object)).toBe(false);
  });

  it('отказы: нет такой раскраски, те же цвета, вторая перекраска в очереди', () => {
    const record = freshRecord('M-1');
    const state = stateAt(systemOfClass('capital'), { mechs: [record], cbills: 2_000_000 });

    expect(reasonOf(state, { kind: 'repaintMech', recordId: 'M-1', paint: 'нет-такой' })).toBe(
      CampaignRejectReason.PaintNotAvailable,
    );
    expect(reasonOf(state, { kind: 'repaintMech', recordId: 'M-1', paint: null })).toBe(
      CampaignRejectReason.SamePaint,
    );
    run(state, { kind: 'repaintMech', recordId: 'M-1', paint: 'kurita' });
    expect(reasonOf(state, { kind: 'repaintMech', recordId: 'M-1', paint: 'steiner' })).toBe(
      CampaignRejectReason.MechHasPendingJob,
    );
  });

  it('перекраска занимает стапель наравне с ремонтом', () => {
    const mechs = [freshRecord('M-1'), freshRecord('M-2', 2), freshRecord('M-3', 3)];
    const state = stateAt(systemOfClass('capital'), { mechs, cbills: 2_000_000, bays: 2 });

    run(state, { kind: 'repaintMech', recordId: 'M-1', paint: 'kurita' });
    run(state, { kind: 'repaintMech', recordId: 'M-2', paint: 'kurita' });
    expect(reasonOf(state, { kind: 'repaintMech', recordId: 'M-3', paint: 'kurita' })).toBe(
      CampaignRejectReason.NoBay,
    );
  });

  it('отмена возвращает половину, цвета не меняются', () => {
    const record = freshRecord('M-1');
    const state = stateAt(systemOfClass('capital'), { mechs: [record], cbills: 2_000_000 });
    const cost = repaintCost(record);

    const scheduled = run(state, { kind: 'repaintMech', recordId: 'M-1', paint: 'kurita' }).find(
      (e) => e.kind === 'jobScheduled',
    );
    expect(scheduled?.kind).toBe('jobScheduled');
    const jobId = scheduled?.kind === 'jobScheduled' ? scheduled.jobId : '';
    run(state, { kind: 'cancelJob', jobId });
    run(state, { kind: 'advance', days: REPAINT_DAYS + 1 });

    expect(state.company.cbills).toBe(
      2_000_000 - cost + Math.round(cost * ECONOMY.cancellation.refundShare),
    );
    expect(state.company.mechs[0]?.paint).toBeUndefined();
  });
});
