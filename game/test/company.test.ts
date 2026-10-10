import { describe, expect, it } from 'vitest';
import {
  CampaignRejectReason,
  CampaignState,
  execute,
  isInsolvent,
  makeCompany,
  makeRecord,
  makeSaveFile,
  maxZones,
  recordMaxZones,
  hasPatches,
  attemptReplacePart,
  recordNodeSpec,
  withQuality,
  parseSaveFile,
  recordChassisDef,
  recordQuality,
  restore,
  snapshot,
  hashCampaignState,
  foundCompany,
  foundingInit,
  stripOutfit,
  FULL_OUTFIT,
  type Company,
  type MechRecord,
} from '../src/core/campaign/index.js';
import { HitZone, ZONE_IDS, zoneFromId, type ZoneId } from '../src/core/model/index.js';
import {
  allocateByZone,
  AMMO_FOR_WEAPON,
  generateAssembly,
  makePilot,
  validateAssembly,
} from '../src/core/rules/index.js';
import { chassisCatalog, EQUIPMENT, WEAPONS } from '../src/core/data/tables.js';
import { ECONOMY, NAMES, REPAIR } from '../src/core/data/index.js';
import { Rng } from '../src/core/rng/index.js';

/**
 * Шаг 13 — ангар: ремонт, склад, казармы, деньги.
 *
 * Компаньон-состояние собирается фикстурами напрямую (`state.company = ...`),
 * тем же приёмом, что `campaign.test.ts` собирает `state.rng` для настройки:
 * это не команда, а подготовка сцены перед тем, как командой её менять.
 */

const CODE = 'IS-H55-R3F2';

function freshRecord(id: string, seed = 1): MechRecord {
  const assembly = generateAssembly({ chassisCode: CODE, role: 'brawler' }, new Rng(seed));
  return makeRecord({ id, assembly });
}

/** Записывает зону повреждённой (не разрушенной) — есть что чинить `repairZone`. */
function withDamagedZone(record: MechRecord, zone: ZoneId): MechRecord {
  const idx = zoneFromId(zone);
  const zones = record.condition.zones.map((z, i) => (i === idx ? { ...z, armor: 0 } : z));
  return { ...record, condition: { ...record.condition, zones } };
}

/** Записывает зону разрушенной — годится только для `replacePart`. */
function withDestroyedZone(record: MechRecord, zone: ZoneId): MechRecord {
  const idx = zoneFromId(zone);
  const zones = record.condition.zones.map((z, i) =>
    i === idx ? { armor: 0, structure: 0, destroyed: true } : z,
  );
  return { ...record, condition: { ...record.condition, zones } };
}

/** Бросок, который всегда удаётся: проверяется исход замены, а не удача. */
function alwaysSucceeds(): Rng {
  return { next: () => 0 } as unknown as Rng;
}

const withDestroyedLeg = (record: MechRecord): MechRecord =>
  withDestroyedZone(record, 'leftLeg');

function companyState(seed: number, company: Partial<Company> = {}): CampaignState {
  const state = new CampaignState(seed);
  state.company = { ...makeCompany(), ...company };
  return state;
}

function run(state: CampaignState, command: Parameters<typeof execute>[1]): ReturnType<typeof execute> {
  return execute(state, command);
}

/** Причина отказа команды или `null`, если команда прошла. */
function reasonOf(
  state: CampaignState,
  command: Parameters<typeof execute>[1],
): CampaignRejectReason | null {
  const result = execute(state, command);
  return result.ok ? null : result.reason;
}

describe('ремонт зоны', () => {
  it('чинит броню/структуру зоны до паспорта, деньги списываются сразу, работа завершается по сроку', () => {
    const record = withDamagedZone(freshRecord('M-1'), 'leftArm');
    const state = companyState(1, { mechs: [record], cbills: 200_000 });
    const before = state.company.cbills;

    const res = run(state, { kind: 'repairZone', recordId: 'M-1', zone: 'leftArm' });
    expect(res.ok).toBe(true);
    expect(state.company.cbills).toBeLessThan(before); // списано сразу, не по завершении
    const stillDamaged = state.company.mechs[0]!.condition.zones[HitZone.LeftArm]!;
    expect(stillDamaged.armor).toBe(0); // работа ещё не подошла по сроку

    // Прокрутка меньше срока работы ничего не меняет.
    run(state, { kind: 'advance', days: 1 });
    // Полная прокрутка: работа обязана завершиться, а не раньше и не позже.
    run(state, { kind: 'advanceTo', day: 30 });
    const lim = maxZones(recordChassisDef(record))[HitZone.LeftArm]!;
    const repaired = state.company.mechs[0]!.condition.zones[HitZone.LeftArm]!;
    expect(repaired.armor).toBe(lim.armor);
  });

  it('отказывает на разрушенной зоне и на уже целой', () => {
    const destroyed = withDestroyedZone(freshRecord('M-1'), 'leftArm');
    const state = companyState(1, { mechs: [destroyed], cbills: 200_000 });
    expect(run(state, { kind: 'repairZone', recordId: 'M-1', zone: 'leftArm' })).toEqual({
      ok: false,
      reason: CampaignRejectReason.ZoneDestroyed,
    });

    const pristine = freshRecord('M-2');
    const state2 = companyState(1, { mechs: [pristine], cbills: 200_000 });
    expect(run(state2, { kind: 'repairZone', recordId: 'M-2', zone: 'leftArm' })).toEqual({
      ok: false,
      reason: CampaignRejectReason.NothingToRepair,
    });
  });

  it('отказывает без денег и без свободного стапеля', () => {
    const record = withDamagedZone(freshRecord('M-1'), 'leftArm');
    const poor = companyState(1, { mechs: [record], cbills: 0 });
    expect(run(poor, { kind: 'repairZone', recordId: 'M-1', zone: 'leftArm' })).toEqual({
      ok: false,
      reason: CampaignRejectReason.InsufficientFunds,
    });

    const mechs = Array.from({ length: ECONOMY.company.bays + 1 }, (_, i) =>
      withDamagedZone(freshRecord(`M-${i}`, i + 1), 'leftArm'),
    );
    const busy = companyState(1, { mechs, cbills: 10_000_000, bays: ECONOMY.company.bays });
    for (let i = 0; i < ECONOMY.company.bays; i++) {
      expect(run(busy, { kind: 'repairZone', recordId: `M-${i}`, zone: 'leftArm' }).ok).toBe(true);
    }
    expect(
      run(busy, { kind: 'repairZone', recordId: `M-${ECONOMY.company.bays}`, zone: 'leftArm' }),
    ).toEqual({ ok: false, reason: CampaignRejectReason.NoBay });
  });
});

describe('ремонт зоны возвращает её в паспортное состояние целиком', () => {
  /** Гасит установки зоны: выбитое орудие и расстрелянный бункер. */
  function withSpentZone(record: MechRecord, zone: ZoneId): MechRecord {
    const def = recordChassisDef(record);
    return {
      ...record,
      condition: {
        ...record.condition,
        ammo: record.condition.ammo.map((a, m) => (def.mounts[m]?.zone === zone && a !== null ? 0 : a)),
        destroyedMounts: record.condition.destroyedMounts.map((d, m) => (def.mounts[m]?.zone === zone ? true : d)),
      },
    };
  }

  it('пополняет боекомплект и снимает метку с выбитых установок этой зоны', () => {
    const fresh = freshRecord('M-1');
    const def = recordChassisDef(fresh);
    const zone = def.mounts.find((m) => m.ammo !== null)?.zone;
    if (zone === undefined) throw new Error('в фикстуре нет установки с боезапасом');

    const record = withSpentZone(fresh, zone);
    const state = companyState(1, { mechs: [record], cbills: 5_000_000 });

    // Пустой бункер и выбитая установка — это недостача до паспорта, а не «чинить нечего».
    expect(run(state, { kind: 'repairZone', recordId: 'M-1', zone }).ok).toBe(true);
    run(state, { kind: 'advanceTo', day: 29 });

    const after = state.company.mechs[0]!;
    def.mounts.forEach((mount, m) => {
      if (mount.zone !== zone) return;
      expect(after.condition.destroyedMounts[m]).toBe(false);
      expect(after.condition.ammo[m]).toBe(mount.ammo);
    });
    // Установки соседних зон работа не трогает.
    def.mounts.forEach((mount, m) => {
      if (mount.zone === zone) return;
      expect(after.condition.ammo[m]).toBe(record.condition.ammo[m]);
    });
  });

  it('машина в паспортном состоянии по-прежнему отклоняет ремонт', () => {
    const state = companyState(1, { mechs: [freshRecord('M-1')], cbills: 5_000_000 });
    expect(run(state, { kind: 'repairZone', recordId: 'M-1', zone: 'torso' })).toEqual({
      ok: false,
      reason: CampaignRejectReason.NothingToRepair,
    });
  });
});

describe('стапель занимает машина, а не работа', () => {
  it('вторая работа по той же машине не требует нового стапеля', () => {
    const record = withDamagedZone(withDamagedZone(freshRecord('M-1'), 'leftArm'), 'rightArm');
    const state = companyState(1, { mechs: [record], cbills: 5_000_000, bays: 1 });

    expect(run(state, { kind: 'repairZone', recordId: 'M-1', zone: 'leftArm' }).ok).toBe(true);
    expect(run(state, { kind: 'repairZone', recordId: 'M-1', zone: 'rightArm' }).ok).toBe(true);

    // Повторный наряд на ту же зону той же машины отклоняется цехом — работа уже в очереди.
    expect(run(state, { kind: 'repairZone', recordId: 'M-1', zone: 'leftArm' })).toEqual({
      ok: false,
      reason: CampaignRejectReason.NothingToRepair,
    });

    // А вот вторая МАШИНА на единственный стапель уже не встаёт.
    const two = companyState(1, {
      mechs: [record, withDamagedZone(freshRecord('M-2', 2), 'leftArm')],
      cbills: 5_000_000,
      bays: 1,
    });
    expect(run(two, { kind: 'repairZone', recordId: 'M-1', zone: 'leftArm' }).ok).toBe(true);
    expect(run(two, { kind: 'repairZone', recordId: 'M-2', zone: 'leftArm' })).toEqual({
      ok: false,
      reason: CampaignRejectReason.NoBay,
    });
  });
});

describe('отмена работы', () => {
  it('возвращает часть уплаченного, а работа не завершается', () => {
    const record = withDamagedZone(freshRecord('M-1'), 'leftArm');
    const state = companyState(1, { mechs: [record], cbills: 200_000 });
    const before = state.company.cbills;

    const res = run(state, { kind: 'repairZone', recordId: 'M-1', zone: 'leftArm' });
    if (!res.ok) throw new Error('ремонт отклонён');
    const scheduled = res.events.find((e) => e.kind === 'jobScheduled');
    if (scheduled?.kind !== 'jobScheduled') throw new Error('нет события jobScheduled');
    const spent = before - state.company.cbills;

    expect(scheduled.work).toBe('repairZone');

    const cancel = run(state, { kind: 'cancelJob', jobId: scheduled.jobId });
    if (!cancel.ok) throw new Error('отмена отклонена');
    const refund = Math.round(spent * ECONOMY.cancellation.refundShare);
    expect(state.company.cbills).toBe(before - spent + refund);
    // Журнал пишет «какая работа и на какой машине»: задача уже снята из
    // очереди, поэтому и машина, и вид работы обязаны приехать в самом событии.
    expect(cancel.events).toContainEqual({
      kind: 'jobCancelled',
      jobId: scheduled.jobId,
      recordId: 'M-1',
      work: 'repairZone',
      refund,
    });

    run(state, { kind: 'advanceTo', day: 30 });
    expect(state.company.mechs[0]!.condition.zones[HitZone.LeftArm]!.armor).toBe(0);
  });

  it('отклоняет отмену несуществующей работы', () => {
    const state = companyState(1);
    expect(run(state, { kind: 'cancelJob', jobId: 'job-999' })).toEqual({
      ok: false,
      reason: CampaignRejectReason.JobNotFound,
    });
  });
});

describe('полевая замена узла (ловушка 1 брифинга)', () => {
  it('торс и голова не подлежат замене', () => {
    const destroyed = withDestroyedZone(freshRecord('M-1'), 'torso');
    const state = companyState(1, { mechs: [destroyed], cbills: 200_000 });
    expect(run(state, { kind: 'replacePart', recordId: 'M-1', zone: 'torso' })).toEqual({
      ok: false,
      reason: CampaignRejectReason.ZoneUnrepairable,
    });
  });

  it('отказывает, если зона цела', () => {
    const state = companyState(1, { mechs: [freshRecord('M-1')], cbills: 200_000 });
    expect(run(state, { kind: 'replacePart', recordId: 'M-1', zone: 'leftArm' })).toEqual({
      ok: false,
      reason: CampaignRejectReason.ZoneNotDestroyed,
    });
  });

  it('исход решает бросок: оба случая достижимы, деньги списаны в любом случае', () => {
    let sawSuccess = false;
    let sawFailure = false;

    for (let seed = 1; seed <= 40 && (!sawSuccess || !sawFailure); seed++) {
      const record = withDestroyedZone(freshRecord('M-1', seed), 'leftArm');
      const state = companyState(seed, { mechs: [record], cbills: 5_000_000 });
      const before = state.company.cbills;

      const res = run(state, { kind: 'replacePart', recordId: 'M-1', zone: 'leftArm' });
      if (!res.ok) throw new Error('replacePart отклонён');
      expect(state.company.cbills).toBeLessThan(before);

      run(state, { kind: 'advanceTo', day: 60 });
      const zone = state.company.mechs[0]!.condition.zones[HitZone.LeftArm]!;
      if (zone.destroyed) {
        sawFailure = true;
      } else {
        sawSuccess = true;
        // Запас прочности (шаг 66): одна удачная замена класс ещё не роняет,
        // только копит счётчик — падение проверяется отдельно, ниже.
        expect(recordQuality(state.company.mechs[0]!).frame).toBe('standard');
        expect(state.company.mechs[0]!.condition.frameLossCount).toBe(1);
      }
    }

    expect(sawSuccess).toBe(true);
    expect(sawFailure).toBe(true);
  });

  it('при успешной замене узла очищаются выбитые ячейки и повреждённые установки зоны', () => {
    let succeeded = false;
    for (let seed = 1; seed <= 50 && !succeeded; seed++) {
      let record = withDestroyedZone(freshRecord('M-1', seed), 'leftArm');
      const destroyedSlots = record.condition.destroyedSlots.map((s, i) =>
        i === HitZone.LeftArm ? [0, 1, 2] : s,
      );
      const def = recordChassisDef(record);
      const destroyedMounts = record.condition.destroyedMounts.map((d, m) =>
        def.mounts[m]?.zone === 'leftArm' ? true : d,
      );
      record = { ...record, condition: { ...record.condition, destroyedSlots, destroyedMounts } };

      const state = companyState(seed, { mechs: [record], cbills: 5_000_000 });
      const res = run(state, { kind: 'replacePart', recordId: 'M-1', zone: 'leftArm' });
      if (!res.ok) continue;

      run(state, { kind: 'advanceTo', day: 60 });
      const mech = state.company.mechs[0]!;
      const zone = mech.condition.zones[HitZone.LeftArm]!;
      if (!zone.destroyed) {
        succeeded = true;
        expect(mech.condition.destroyedSlots[HitZone.LeftArm]).toEqual([]);
        def.mounts.forEach((m, idx) => {
          if (m.zone === 'leftArm') {
            expect(mech.condition.destroyedMounts[idx]).toBe(false);
          }
        });
      }
    }
    expect(succeeded).toBe(true);
  });
});

describe('смена класса и снятие износа', () => {
  it('upgradeClass поднимает класс узла после срока, sameClass отклоняет', () => {
    const state = companyState(1, { mechs: [freshRecord('M-1')], cbills: 5_000_000 });
    expect(
      run(state, { kind: 'upgradeClass', recordId: 'M-1', node: 'reactor', targetClass: 'standard' }),
    ).toEqual({ ok: false, reason: CampaignRejectReason.SameClass });

    const res = run(state, { kind: 'upgradeClass', recordId: 'M-1', node: 'reactor', targetClass: 'military' });
    expect(res.ok).toBe(true);
    expect(recordQuality(state.company.mechs[0]!).reactor).toBe('standard'); // ещё не подошло

    run(state, { kind: 'advanceTo', day: 30 });
    expect(recordQuality(state.company.mechs[0]!).reactor).toBe('military');
  });

  it('restoreWorn отказывает без износа и сбрасывает его после срока', () => {
    const worn: MechRecord = { ...freshRecord('M-1'), wear: { reactor: 50, frame: 0 } };
    const state = companyState(1, { mechs: [worn], cbills: 500_000 });

    expect(run(state, { kind: 'restoreWorn', recordId: 'M-1', node: 'frame' })).toEqual({
      ok: false,
      reason: CampaignRejectReason.NoWear,
    });

    expect(run(state, { kind: 'restoreWorn', recordId: 'M-1', node: 'reactor' }).ok).toBe(true);
    run(state, { kind: 'advanceTo', day: 30 });
    expect(state.company.mechs[0]!.wear.reactor).toBe(0);
  });
});

describe('склад и разбор машины', () => {
  // Шаг 15 сделал разбор работой стапеля: он стоит денег и времени, а машина
  // уходит из ростера по завершении работы, а не в момент команды.
  it('scrapMech — работа стапеля: по её завершении машина уходит из ростера, узлы ложатся на склад', () => {
    const record = freshRecord('M-1');
    const state = companyState(1, { mechs: [record], cbills: 500_000 });

    const res = run(state, { kind: 'scrapMech', recordId: 'M-1' });
    expect(res.ok).toBe(true);
    expect(state.company.mechs).toHaveLength(1);
    expect(state.company.warehouse).toHaveLength(0);

    run(state, { kind: 'advanceTo', day: 20 });
    expect(state.company.mechs).toHaveLength(0);
    expect(
      state.company.warehouse
        .filter((w) => w.sort === 'node')
        .map((w) => w.node)
        .sort(),
    ).toEqual(['frame', 'reactor']);
  });

  it('разбор без денег отклоняется — это работа, а не кнопка', () => {
    const state = companyState(1, { mechs: [freshRecord('M-1')], cbills: 0 });
    expect(run(state, { kind: 'scrapMech', recordId: 'M-1' })).toEqual({
      ok: false,
      reason: CampaignRejectReason.InsufficientFunds,
    });
  });

  it('отказывает, пока у машины есть незавершённая работа', () => {
    const record = withDamagedZone(freshRecord('M-1'), 'leftArm');
    const state = companyState(1, { mechs: [record], cbills: 200_000 });
    run(state, { kind: 'repairZone', recordId: 'M-1', zone: 'leftArm' });
    expect(run(state, { kind: 'scrapMech', recordId: 'M-1' })).toEqual({
      ok: false,
      reason: CampaignRejectReason.MechHasPendingJob,
    });
  });
});

describe('казармы', () => {
  it('поиск: без денег отказ, с деньгами — кандидат, и он ждёт решения', () => {
    const state = companyState(1, { cbills: 0 });
    expect(run(state, { kind: 'searchRecruit', id: 'P-1' })).toEqual({
      ok: false,
      reason: CampaignRejectReason.InsufficientFunds,
    });

    const rich = companyState(1, { cbills: 200_000 });
    expect(run(rich, { kind: 'searchRecruit', id: 'P-1' }).ok).toBe(true);
    // Деньги за ПОИСК списаны сразу, а пилота в роте ещё нет: он кандидат.
    expect(rich.company.cbills).toBe(200_000 - ECONOMY.hiring.searchFee);
    expect(rich.company.pilots).toHaveLength(0);
    expect(rich.recruit).not.toBeNull();

    // Второе объявление, пока не решено по первому, — отказ.
    expect(run(rich, { kind: 'searchRecruit', id: 'P-2' })).toEqual({
      ok: false,
      reason: CampaignRejectReason.RecruitPending,
    });

    expect(run(rich, { kind: 'hireRecruit' }).ok).toBe(true);
    expect(rich.company.pilots).toHaveLength(1);
    expect(rich.recruit).toBeNull();
  });

  it('попытка даётся раз в две недели и не копится', () => {
    const state = companyState(1, { cbills: 500_000 });
    expect(run(state, { kind: 'searchRecruit', id: 'P-1' }).ok).toBe(true);
    expect(run(state, { kind: 'rejectRecruit' }).ok).toBe(true);

    // Сразу вторая попытка не даётся: срок.
    expect(run(state, { kind: 'searchRecruit', id: 'P-2' })).toEqual({
      ok: false,
      reason: CampaignRejectReason.HireNotReady,
    });

    // Прошло вдвое больше срока — попытка всё равно ОДНА.
    run(state, { kind: 'advance', days: ECONOMY.hiring.searchIntervalDays * 2 });
    expect(run(state, { kind: 'searchRecruit', id: 'P-2' }).ok).toBe(true);
    expect(run(state, { kind: 'rejectRecruit' }).ok).toBe(true);
    expect(run(state, { kind: 'searchRecruit', id: 'P-3' })).toEqual({
      ok: false,
      reason: CampaignRejectReason.HireNotReady,
    });
  });

  it('отказ не возвращает ни денег, ни попытки', () => {
    const state = companyState(1, { cbills: 200_000 });
    run(state, { kind: 'searchRecruit', id: 'P-1' });
    const after = state.company.cbills;
    expect(run(state, { kind: 'rejectRecruit' }).ok).toBe(true);
    expect(state.company.cbills).toBe(after);
    expect(state.company.pilots).toHaveLength(0);
    expect(state.recruit).toBeNull();
  });

  it('отклонённый поиск не трогает поток camp.events', () => {
    const state = companyState(1, { cbills: 0 });
    const before = state.rng.stream('camp.events').next();
    // Пересоздаём состояние с тем же сидом, чтобы сравнить поток «до» и «после» отказа.
    const state2 = companyState(1, { cbills: 0 });
    expect(run(state2, { kind: 'searchRecruit', id: 'P-1' }).ok).toBe(false);
    expect(state2.rng.stream('camp.events').next()).toBe(before);
  });

  it('assignPilot сажает пилота, снимает с прежней машины, отклоняет неактивного', () => {
    const pilot = makePilot(new Rng(1), { id: 'P-1', tier: 4 });
    const injured = { ...pilot, id: 'P-2', status: 'out' as const };
    const state = companyState(1, {
      mechs: [freshRecord('M-1'), freshRecord('M-2')],
      pilots: [pilot, injured],
      cbills: 0,
    });

    expect(run(state, { kind: 'assignPilot', recordId: 'M-2', pilotId: 'P-2' })).toEqual({
      ok: false,
      reason: CampaignRejectReason.PilotNotActive,
    });

    expect(run(state, { kind: 'assignPilot', recordId: 'M-1', pilotId: 'P-1' }).ok).toBe(true);
    expect(run(state, { kind: 'assignPilot', recordId: 'M-2', pilotId: 'P-1' }).ok).toBe(true);
    expect(state.company.mechs.find((m) => m.id === 'M-1')!.pilotId).toBeNull();
    expect(state.company.mechs.find((m) => m.id === 'M-2')!.pilotId).toBe('P-1');
  });

  it('dismissPilot убирает пилота из ростера и высаживает его из машины', () => {
    const pilot = makePilot(new Rng(1), { id: 'P-1', tier: 4 });
    const record = { ...freshRecord('M-1'), pilotId: 'P-1' };
    const state = companyState(1, { mechs: [record], pilots: [pilot] });

    expect(run(state, { kind: 'dismissPilot', pilotId: 'P-1' }).ok).toBe(true);
    expect(state.company.pilots).toHaveLength(0);
    expect(state.company.mechs[0]!.pilotId).toBeNull();
  });

  it('trainPilot поднимает уровень навыка на накопленный опыт и отклоняет, когда поднимать нечего', () => {
    const pilot = makePilot(new Rng(1), { id: 'P-1', tier: 4, skills: { gunnery: 4 } });
    const funded = { ...pilot, caps: { ...pilot.caps, gunnery: 8 }, xp: { ...pilot.xp, gunnery: 10_000 } };
    const state = companyState(1, { pilots: [funded] });

    const res = run(state, { kind: 'trainPilot', pilotId: 'P-1', skillId: 'gunnery' });
    expect(res.ok).toBe(true);
    expect(state.company.pilots[0]!.skills.gunnery).toBe(5);

    const capped = { ...pilot, caps: { ...pilot.caps, gunnery: 4 }, xp: { ...pilot.xp, gunnery: 10_000 } };
    const stuck = companyState(1, { pilots: [capped] });
    expect(run(stuck, { kind: 'trainPilot', pilotId: 'P-1', skillId: 'gunnery' })).toEqual({
      ok: false,
      reason: CampaignRejectReason.CannotTrain,
    });
  });
});

describe('содержание роты (payroll)', () => {
  it('списывается раз в интервал, а не при каждой прокрутке', () => {
    const state = companyState(1, { cbills: 10_000_000 });
    const perCycle = state.company.cbills;

    run(state, { kind: 'advance', days: 1 });
    expect(state.company.cbills).toBe(perCycle); // раньше срока — ничего не списано

    run(state, { kind: 'advanceTo', day: ECONOMY.payroll.intervalDays });
    const afterOne = state.company.cbills;
    expect(afterOne).toBeLessThan(perCycle);

    run(state, { kind: 'advanceTo', day: ECONOMY.payroll.intervalDays + 1 });
    expect(state.company.cbills).toBe(afterOne); // между циклами баланс не шевелится

    run(state, { kind: 'advanceTo', day: ECONOMY.payroll.intervalDays * 3 });
    expect(perCycle - state.company.cbills).toBe((perCycle - afterOne) * 3);
  });

  it('уход в минус помечает роту разорившейся с датой', () => {
    const state = companyState(1, { cbills: 100 });
    run(state, { kind: 'advanceTo', day: ECONOMY.payroll.intervalDays });
    expect(state.company.bankrupt).toBe(true);
    expect(state.company.bankruptDay).toBe(ECONOMY.payroll.intervalDays);
  });

  it('неплатёжеспособность — по кассе сейчас: вышла в плюс — рота снова платёжеспособна, история остаётся', () => {
    // Плейтест 2026-09-15: надпись висела при кассе 2.6 млн, потому что читала
    // флаг «хоть раз уходила в минус», который не снимается.
    const state = companyState(1, { cbills: 100 });
    run(state, { kind: 'advanceTo', day: ECONOMY.payroll.intervalDays });
    expect(isInsolvent(state.company)).toBe(true);

    state.company = { ...state.company, cbills: 2_615_238 };
    expect(isInsolvent(state.company)).toBe(false);
    expect(state.company.bankrupt).toBe(true);
  });
});

describe('лазарет', () => {
  it('пилот возвращается в строй ровно в срок лечения', () => {
    const pilot = makePilot(new Rng(1), { id: 'P-1', tier: 4 });
    const hurt = { ...pilot, status: 'out' as const, injuries: 4 };
    const state = companyState(1, { pilots: [hurt] });

    const res = run(state, { kind: 'schedule', day: 10, task: { kind: 'medbayDone', pilotId: 'P-1' } });
    expect(res.ok).toBe(true);

    run(state, { kind: 'advance', days: 9 });
    expect(state.company.pilots[0]!.status).toBe('out');

    run(state, { kind: 'advance', days: 1 });
    expect(state.company.pilots[0]!.status).toBe('active');
    expect(state.company.pilots[0]!.injuries).toBe(0);
  });

  /**
   * ТРАВМЫ ЗАЖИВАЮТ (правка 2026-09-08). До неё счётчик травм рос только в одну
   * сторону: вылечиться можно было, лишь набрав порог `outAt` и попав в лазарет,
   * то есть ПОСТРАДАВ СИЛЬНЕЕ. Пилот с одной-пятью травмами таскал их до конца
   * кампании вместе с −1 к Стрельбе и Пилотированию за каждые две.
   */
  it('травмы заживают сами: одна за декаду отдыха', () => {
    const pilot = makePilot(new Rng(1), { id: 'P-1', tier: 4 });
    const state = companyState(1, { pilots: [{ ...pilot, injuries: 3 }] });

    run(state, { kind: 'advance', days: ECONOMY.medbay.restDays - 1 });
    expect(state.company.pilots[0]!.injuries, 'до срока не заживает').toBe(3);

    run(state, { kind: 'advance', days: 1 });
    expect(state.company.pilots[0]!.injuries).toBe(2);

    // Круг переставляет себя сам: вторая декада лечит следующую травму.
    run(state, { kind: 'advance', days: ECONOMY.medbay.restDays });
    expect(state.company.pilots[0]!.injuries).toBe(1);

    // До нуля и не ниже; здоровый пилот тактом отдыха не трогается.
    run(state, { kind: 'advance', days: ECONOMY.medbay.restDays * 3 });
    expect(state.company.pilots[0]!.injuries).toBe(0);
    expect(state.company.pilots[0]!.status).toBe('active');
  });

  it('лежащему в лазарете такт отдыха срок не сокращает', () => {
    // Иначе лечение считалось бы дважды: и сроком работы, и заживлением.
    const pilot = makePilot(new Rng(1), { id: 'P-1', tier: 4 });
    const hurt = { ...pilot, status: 'out' as const, injuries: 4 };
    const state = companyState(1, { pilots: [hurt] });
    run(state, { kind: 'advance', days: ECONOMY.medbay.restDays });
    expect(state.company.pilots[0]!.injuries).toBe(4);
  });

  it('раненого можно отправить лечиться, не дожидаясь порога', () => {
    const pilot = makePilot(new Rng(1), { id: 'P-1', tier: 4 });
    const state = companyState(1, { pilots: [{ ...pilot, injuries: 3 }] });

    const res = run(state, { kind: 'treatPilot', pilotId: 'P-1' });
    expect(res.ok).toBe(true);
    expect(state.company.pilots[0]!.status).toBe('out');

    // Возвращается той же задачей и той же выпиской, что и раненный в бою.
    run(state, { kind: 'advance', days: 30 });
    expect(state.company.pilots[0]!.status).toBe('active');
    expect(state.company.pilots[0]!.injuries).toBe(0);
  });

  it('здорового и уже лежащего лечить нельзя', () => {
    const pilot = makePilot(new Rng(1), { id: 'P-1', tier: 4 });
    const state = companyState(1, {
      pilots: [pilot, { ...makePilot(new Rng(2), { id: 'P-2', tier: 3 }), status: 'out', injuries: 2 }],
    });
    expect(reasonOf(state, { kind: 'treatPilot', pilotId: 'P-1' })).toBe(
      CampaignRejectReason.PilotNotInjured,
    );
    expect(reasonOf(state, { kind: 'treatPilot', pilotId: 'P-2' })).toBe(
      CampaignRejectReason.PilotNotActive,
    );
    expect(reasonOf(state, { kind: 'treatPilot', pilotId: 'нет-такого' })).toBe(
      CampaignRejectReason.PilotNotFound,
    );
  });
});

describe('сохранение роты', () => {
  it('снимок и восстановление сохраняют деньги, парк, пилотов и склад', () => {
    const record = withDamagedZone(freshRecord('M-1'), 'leftArm');
    const pilot = makePilot(new Rng(1), { id: 'P-1', tier: 4 });
    const state = companyState(31337, {
      cbills: 321_000,
      mechs: [{ ...record, pilotId: 'P-1' }],
      pilots: [pilot],
      warehouse: [
        { sort: 'node', id: 'w-1', node: 'reactor', quality: 'recovered', wear: 12, sourceTonnage: 55, tier: 3 },
        { sort: 'item', id: 'w-2', itemId: 'is_ml', kind: 'weapon' },
      ],
    });

    const back = restore(parseSaveFile(makeSaveFile(snapshot(state))));
    expect(hashCampaignState(back)).toBe(hashCampaignState(state));
    expect(back.company).toEqual(state.company);
  });
});

// --- основание роты и комплектность (шаг 16a) ---------------------------------

describe('основание роты', () => {
  it('одна функция ядра вместо трёх копий: тот же сид — та же рота', () => {
    const a = foundCompany(7);
    const b = foundCompany(7);
    expect(a.mechs.map((m) => m.assembly.chassisCode)).toEqual(b.mechs.map((m) => m.assembly.chassisCode));
    expect(a.mechs.map((m) => m.assembly.armorTons)).toEqual(b.mechs.map((m) => m.assembly.armorTons));
    expect(foundCompany(8).mechs.map((m) => m.assembly.chassisCode)).not.toEqual(
      a.mechs.map((m) => m.assembly.chassisCode),
    );
  });

  it('недокомплект ВИДЕН: корпус держит больше брони, чем на нём висит (шаг 17)', () => {
    // Ровно то, на чём стоит показ комплектности в ангаре. До шага 17 игрок
    // видел «4/4» и не знал, что рука держит десять: паспорт подержанной
    // машины и есть неполный, а потолок корпуса нигде не показывался. Числа
    // берутся у `validateAssembly` — той же функции, которой ядро запрещает
    // перегруз, — и раскладываются по зонам той же таблицей долей.
    let seenShort = 0;

    for (const seed of [1, 5, 9, 17, 42]) {
      for (const m of foundCompany(seed).mechs) {
        const report = validateAssembly(m.assembly);
        // Броня меньше потолка корпуса — иначе показывать было бы нечего.
        expect(report.totalArmor).toBeLessThanOrEqual(report.maxArmor);
        if (report.totalArmor < report.maxArmor) seenShort += 1;

        // Паспорт зоны не может превышать потолок этой же зоны: на этом стоит
        // строка «4/4 из 10» и штриховая обводка на кукле.
        const hull = allocateByZone(report.maxArmor);
        const passport = maxZones(recordChassisDef(m));
        for (const id of ZONE_IDS) {
          const zoneArmor = passport[zoneFromId(id)]?.armor ?? 0;
          expect(zoneArmor, `${id} у ${m.assembly.chassisCode}`).toBeLessThanOrEqual(hull[id]);
        }

        // Грузоподъёмность тоже не выбрана до конца — иначе снятую навеску
        // некуда было бы вернуть мехлабом (шаг 19).
        expect(report.freeMass).toBeGreaterThanOrEqual(0);
        expect(report.totalMass).toBeLessThanOrEqual(report.maxMass);
      }
    }

    // Стартовая рота недоукомплектована ПО ЗАМЫСЛУ (`economy.json` → founding):
    // если недовеса не нашлось ни у одной машины, сломан не показ, а генерация.
    expect(seenShort).toBeGreaterThan(0);
  });

  it('три подержанные машины: два лёгких корпуса и один средний', () => {
    for (const seed of [1, 2, 3, 11, 42]) {
      const { mechs, pilots } = foundCompany(seed);
      expect(mechs).toHaveLength(ECONOMY.founding.weightClasses.length);
      expect(pilots).toHaveLength(mechs.length);

      const classes = mechs.map((m) => recordChassisDef(m).weightClass);
      expect(classes).toEqual([...ECONOMY.founding.weightClasses]);

      for (const m of mechs) {
        // Тиры ограничены сверху: R4–R5 у начинающего отряда не бывает.
        const entry = chassisCatalog(m.assembly.chassisCode);
        expect(entry.reactorTier).toBeLessThanOrEqual(ECONOMY.founding.maxReactorTier);
        expect(entry.frameTier).toBeLessThanOrEqual(ECONOMY.founding.maxFrameTier);
        // Пилот посажен, машина цела: подержанная — не значит побитая.
        expect(m.pilotId).not.toBeNull();
        expect(m.condition.zones.every((z) => !z.destroyed)).toBe(true);
      }
    }
  });

  it('машины недоукомплектованы, но собраны правильно', () => {
    const rng = new Rng(3);
    for (const seed of [1, 5, 9]) {
      for (const m of foundCompany(seed).mechs) {
        const full = generateAssembly({ chassisCode: m.assembly.chassisCode, role: m.assembly.role }, rng);
        // Брони и навески меньше паспортных — это и есть «не всё так просто» на старте.
        expect(m.assembly.armorTons).toBeLessThan(full.armorTons);
        // Но сборка валидна: недогруз — не нарушение, а недогруз.
        expect(validateAssembly(m.assembly).issues).toEqual([]);
        // Последний ствол не снимается никогда: машина без оружия получила бы
        // подставной лазер, то есть недокомплект дал бы бесплатное оружие.
        expect(m.assembly.items.some((it) => it.kind === 'weapon')).toBe(true);
      }
    }
  });

  it('полный комплект по просьбе — для эталонов и тестов', () => {
    // Проверяется САМО правило: полный комплект ничего не снимает. Сравнивать
    // две роты помашинно нельзя — недокомплект тянет броски, и рота с
    // недокомплектом расходится с полной уже на втором шасси; сравнение
    // «машина №2 против машины №2» тогда меряет не комплектность, а разъехавшийся
    // жребий (поймано на шаге 46c, когда генератор стал набирать навеску до
    // упора и число бросков изменилось).
    const rng = new Rng(4);
    for (const seed of [1, 4, 9]) {
      const full = generateAssembly({ tonnage: 55, role: 'brawler' }, new Rng(seed));
      const kept = stripOutfit(full, FULL_OUTFIT, rng);
      expect(kept.armorTons).toBe(full.armorTons);
      expect(kept.items).toEqual(full.items);
    }

    // Сравнивать две РОТЫ (ободранную и полную) нельзя даже в сумме: жребий
    // недокомплекта сдвигает выбор шасси, и суммы меряют разные машины.
    // Комплектность роты проверяется там, где она и живёт, — в самой сборке:
    // рота с полным комплектом не несёт ни одной недоукомплектованной машины.
    for (const m of foundCompany(4, { outfit: FULL_OUTFIT }).mechs) {
      expect(validateAssembly(m.assembly).issues).toEqual([]);
      expect(stripOutfit(m.assembly, FULL_OUTFIT, rng)).toEqual(m.assembly);
    }
  });

  it('рота основывается конструктором, а не присваиванием в состояние', () => {
    const state = new CampaignState(5, { company: foundingInit(5) });
    expect(state.company.mechs).toHaveLength(3);
    expect(state.company.pilots).toHaveLength(3);
    expect(state.company.cbills).toBe(ECONOMY.company.startingCbills);
  });

  it('командир заменяет первого подходящего мужчину в звене с префиксом звания', () => {
    const vanilla = foundCompany(12);
    expect(vanilla.pilots.some((p) => p.name.startsWith('Командир'))).toBe(false);

    const founded = foundCompany(12, { commander: 'Вулкан' });
    const maleIndex = vanilla.pilots.findIndex((p) => p.gender === 'male');
    expect(maleIndex).toBeGreaterThanOrEqual(0);

    const commanderPilot = founded.pilots[maleIndex]!;
    expect(commanderPilot.gender).toBe('male');
    expect(commanderPilot.callsign).toBe('Вулкан');
    expect(commanderPilot.name).toBe('Командир Вулкан');

    founded.pilots.forEach((p, idx) => {
      if (idx !== maleIndex) {
        expect(p.name).toBe(vanilla.pilots[idx]!.name);
        expect(p.callsign).toBe(vanilla.pilots[idx]!.callsign);
      }
    });

    // Звание — имя собственное из names.json, не словарь интерфейса: при
    // английском позывном оно то же, и в сохранении не зависит от языка.
    const enFounded = foundCompany(12, { commander: 'Vulcan' });
    expect(enFounded.pilots[maleIndex]!.name).toBe(`${NAMES.defaults.commander} Vulcan`);
    expect(enFounded.pilots[maleIndex]!.callsign).toBe('Vulcan');

    const alreadyPrefixed = foundCompany(12, { commander: 'Командир Вулкан' });
    expect(alreadyPrefixed.pilots[maleIndex]!.name).toBe('Командир Вулкан');
    expect(alreadyPrefixed.pilots[maleIndex]!.callsign).toBe('Вулкан');
  });

  it('пустой позывной и позывной, равный званию, не дают «Командир Командир»', () => {
    const maleIndex = foundCompany(12).pilots.findIndex((p) => p.gender === 'male');
    for (const typed of ['', '   ', NAMES.defaults.commander, NAMES.defaults.commander.toUpperCase()]) {
      const pilot = foundCompany(12, { commander: typed }).pilots[maleIndex]!;
      expect(pilot.name).toBe(typed.trim() || NAMES.defaults.commander);
      expect(pilot.callsign).toBe(pilot.name);
    }
  });

  it('рота и пилот-командир получают один и тот же позывной по умолчанию', () => {
    const state = new CampaignState(12, { company: { ...foundingInit(12, { commander: '' }), commander: '' } });
    const maleIndex = state.company.pilots.findIndex((p) => p.gender === 'male');
    expect(state.company.commander).toBe(NAMES.defaults.commander);
    expect(state.company.pilots[maleIndex]!.callsign).toBe(NAMES.defaults.commander);
  });
});

describe('комплектность машины', () => {
  it('снятое не возвращается ремонтом: недокомплект — это паспорт, а не пробоина', () => {
    const rng = new Rng(11);
    const full = generateAssembly({ chassisCode: 'IS-H55-R3F2', role: 'brawler' }, rng);
    const stripped = stripOutfit(full, { armorShare: [0.5, 0.5], missingItems: [2, 2] }, new Rng(1));

    expect(stripped.armorTons).toBeLessThan(full.armorTons);
    expect(stripped.items.length).toBeLessThan(full.items.length);

    // Паспорт машины считается ОТ СБОРКИ, значит потолок ремонта у неё ниже.
    const wornMax = maxZones(recordChassisDef(makeRecord({ id: 'w', assembly: stripped })));
    const fullMax = maxZones(recordChassisDef(makeRecord({ id: 'f', assembly: full })));
    const sum = (zs: readonly { armor: number }[]): number => zs.reduce((s, z) => s + z.armor, 0);
    expect(sum(wornMax)).toBeLessThan(sum(fullMax));
  });

  it('осиротевший боезапас уходит вместе с орудием — ВЕСЬ, а не одной пачкой', () => {
    // Пачек у ствола столько, на сколько залпов его снарядили: у АП/20 три, у
    // РДД-20 две. Снималась ОДНА, и машина ополчения увозила остальные мёртвым
    // грузом — тонны, которых нечем расходовать, и ячейки, которые детонируют
    // от крита. Валидатор этого не ловит: лишний БК потолков не нарушает, —
    // поэтому проверка смотрит на состав навески прямо.
    const rng = new Rng(21);
    for (const code of ['IS-H55-R3F2', 'IS-H85-R2F1', 'CL-H75-R3F2']) {
      const full = generateAssembly({ chassisCode: code }, rng);
      for (let s = 0; s < 40; s++) {
        const stripped = stripOutfit(full, { armorShare: [1, 1], missingItems: [1, 4] }, new Rng(s));
        expect(validateAssembly(stripped).issues, `${code}, сид ${s}`).toEqual([]);

        const needed = new Set(
          stripped.items.filter((it) => WEAPONS.has(it.id)).map((it) => AMMO_FOR_WEAPON[it.id]),
        );
        const orphans = stripped.items.filter(
          (it) => EQUIPMENT.get(it.id)?.category === 'ammo' && !needed.has(it.id),
        );
        expect(orphans, `${code}, сид ${s}`).toEqual([]);
      }
    }
  });

  it('полный комплект ничего не трогает', () => {
    const full = generateAssembly({ chassisCode: 'IS-H55-R3F2', role: 'sniper' }, new Rng(2));
    expect(stripOutfit(full, FULL_OUTFIT, new Rng(9))).toEqual(full);
  });
});

describe('деградация после полевой замены (шаг 33)', () => {
  // questions.md п. 19: одна оторванная нога роняла класс каркаса ВСЕЙ машины
  // сразу на дно шкалы, хотя торс, кокпит, реактор и гироскоп не пострадали.
  // За три контракта весь парк оказывался восстановленным, и покупать заводские
  // узлы за 180-580 тысяч становилось бессмысленно.

  const armyFrame = (record: MechRecord): MechRecord => withQuality(record, 'frame', 'military');

  /** N успешных полевых замен подряд — по левой ноге, счётчик их не различает. */
  function replaceLegNTimes(record: MechRecord, n: number): MechRecord {
    let next = record;
    for (let i = 0; i < n; i++) {
      next = attemptReplacePart(withDestroyedLeg(next), 'leftLeg', alwaysSucceeds()).record;
    }
    return next;
  }

  it('класс каркаса падает НА СТУПЕНЬ, а не на дно шкалы (после запаса прочности, шаг 66)', () => {
    const record = armyFrame(freshRecord('M-1'));
    expect(recordQuality(record).frame).toBe('military');
    const res = replaceLegNTimes(record, REPAIR.frameLoss.perStep);
    expect(recordQuality(res).frame).toBe('standard');
  });

  it('реактор полевой заменой ноги не трогается вовсе', () => {
    const record = withQuality(armyFrame(freshRecord('M-1')), 'reactor', 'military');
    const res = attemptReplacePart(withDestroyedLeg(record), 'leftLeg', alwaysSucceeds());
    expect(recordQuality(res.record).reactor).toBe('military');
  });

  it('заменённая конечность получает кустарную латку и держит меньше структуры', () => {
    const record = freshRecord('M-1');
    const full = recordMaxZones(record)[zoneFromId('leftLeg')]!.structure;
    const res = attemptReplacePart(withDestroyedLeg(record), 'leftLeg', alwaysSucceeds());
    expect(hasPatches(res.record)).toBe(true);
    const patched = recordMaxZones(res.record)[zoneFromId('leftLeg')]!.structure;
    expect(patched).toBeLessThan(full);
    // Наказание ЛОКАЛЬНОЕ, и в этом вся правка. Сравнение идёт с машиной того
    // же класса каркаса, но без латки: ступень вниз — отдельное следствие,
    // машинное, и торса оно касается наравне с ногой; латка — только ноги.
    const sameClass = withQuality(record, 'frame', recordQuality(res.record).frame);
    expect(recordMaxZones(res.record)[zoneFromId('torso')]!.structure).toBe(
      recordMaxZones(sameClass)[zoneFromId('torso')]!.structure,
    );
    expect(recordMaxZones(res.record)[zoneFromId('leftLeg')]!.structure).toBeLessThan(
      recordMaxZones(sameClass)[zoneFromId('leftLeg')]!.structure,
    );
  });

  it('латаная машина считается паспортной: мехлаб не закрывается навсегда', () => {
    const res = attemptReplacePart(withDestroyedLeg(freshRecord('M-1')), 'leftLeg', alwaysSucceeds());
    // Броню на латаной ноге ещё долить надо, а вот структура уже по её паспорту.
    const leg = res.record.condition.zones[zoneFromId('leftLeg')]!;
    expect(leg.structure).toBe(recordMaxZones(res.record)[zoneFromId('leftLeg')]!.structure);
    expect(leg.destroyed).toBe(false);
  });
});

describe('запас прочности каркаса (шаг 66)', () => {
  // notes.md §10w: игрок жаловался, что класс каркаса падает уже с первой
  // оторванной конечности. По коду (шаг 33) это была уже ступень, а не дно, но
  // ступень всё равно с первой — запас даёт три (REPAIR.frameLoss.perStep)
  // прежде чем каркас просядет.

  function replaceLegNTimes(record: MechRecord, n: number): MechRecord {
    let next = record;
    for (let i = 0; i < n; i++) {
      next = attemptReplacePart(withDestroyedLeg(next), 'leftLeg', alwaysSucceeds()).record;
    }
    return next;
  }

  it('счётчик копится, а класс не падает раньше perStep-й потери', () => {
    const record = freshRecord('M-1');
    const res = replaceLegNTimes(record, REPAIR.frameLoss.perStep - 1);
    expect(recordQuality(res).frame).toBe('standard');
    expect(res.condition.frameLossCount).toBe(REPAIR.frameLoss.perStep - 1);
  });

  it('на perStep-й потере класс падает РОВНО на ступень и счётчик обнуляется', () => {
    const record = freshRecord('M-1');
    const res = replaceLegNTimes(record, REPAIR.frameLoss.perStep);
    expect(recordQuality(res).frame).toBe('recovered');
    expect(res.condition.frameLossCount).toBe(0);
  });

  it('запас копится по новой на следующую ступень', () => {
    const record = withQuality(freshRecord('M-1'), 'frame', 'military');
    const afterFirstStep = replaceLegNTimes(record, REPAIR.frameLoss.perStep);
    expect(recordQuality(afterFirstStep).frame).toBe('standard');

    const afterOneMore = replaceLegNTimes(afterFirstStep, 1);
    expect(recordQuality(afterOneMore).frame).toBe('standard'); // запас ещё не выбран
    expect(afterOneMore.condition.frameLossCount).toBe(1);
  });

  it('заводская переборка каркаса покупкой на рынке (upgradeClass) обнуляет запас досрочно', () => {
    const record = replaceLegNTimes(freshRecord('M-1'), REPAIR.frameLoss.perStep - 1);
    expect(record.condition.frameLossCount).toBe(REPAIR.frameLoss.perStep - 1);

    const state = companyState(1, { mechs: [record], cbills: 5_000_000 });
    const res = run(state, {
      kind: 'upgradeClass',
      recordId: 'M-1',
      node: 'frame',
      targetClass: 'military',
    });
    expect(res.ok).toBe(true);
    run(state, { kind: 'advanceTo', day: 30 });

    const upgraded = state.company.mechs[0]!;
    expect(recordQuality(upgraded).frame).toBe('military');
    expect(upgraded.condition.frameLossCount).toBe(0);
  });

  it('установка каркаса со склада (installPart) тоже обнуляет запас — не только покупка в лоб', () => {
    const record = replaceLegNTimes(freshRecord('M-1'), REPAIR.frameLoss.perStep - 1);
    expect(record.condition.frameLossCount).toBe(REPAIR.frameLoss.perStep - 1);

    const spec = recordNodeSpec(record, 'frame');
    const state = companyState(1, {
      mechs: [record],
      cbills: 5_000_000,
      warehouse: [
        { sort: 'node', id: 'w-frame', node: 'frame', quality: 'master', wear: 0, sourceTonnage: spec.tonnage, tier: spec.tier },
      ],
    });
    const res = run(state, { kind: 'installPart', recordId: 'M-1', partId: 'w-frame' });
    expect(res.ok).toBe(true);
    run(state, { kind: 'advanceTo', day: 30 });

    const installed = state.company.mechs[0]!;
    expect(recordQuality(installed).frame).toBe('master');
    expect(installed.condition.frameLossCount).toBe(0);
  });

  it('обслуживание на стапеле (ремонт зоны, снятие износа) запас НЕ обнуляет', () => {
    const record = replaceLegNTimes(freshRecord('M-1'), REPAIR.frameLoss.perStep - 1);
    const withWear: MechRecord = { ...record, wear: { ...record.wear, frame: 50 } };
    const state = companyState(1, { mechs: [withDamagedZone(withWear, 'leftArm')], cbills: 5_000_000 });

    run(state, { kind: 'repairZone', recordId: 'M-1', zone: 'leftArm' });
    run(state, { kind: 'restoreWorn', recordId: 'M-1', node: 'frame' });
    run(state, { kind: 'advanceTo', day: 30 });

    expect(state.company.mechs[0]!.condition.frameLossCount).toBe(REPAIR.frameLoss.perStep - 1);
  });
});

describe('право на ошибку (шаг 35)', () => {
  // questions.md п. 22: десять побед подряд и одно поражение — парка нет, а
  // уцелевшего капитала не хватает даже на лёгкий тридцатитонник. Винрейт 91 %
  // выбрасывал игрока из игры. Право на ошибку означает откат назад, к дешёвым
  // машинам и тяжёлым контрактам, а не необратимый тупик.

  it('Гильдия даёт заём только на мели и только один раз', () => {
    const rich = companyState(1, { cbills: ECONOMY.loan.eligibleBelow + 1 });
    expect(execute(rich, { kind: 'takeLoan' })).toEqual({
      ok: false,
      reason: CampaignRejectReason.LoanNotAvailable,
    });

    const broke = companyState(1, { cbills: 1000 });
    const res = execute(broke, { kind: 'takeLoan' });
    expect(res.ok).toBe(true);
    expect(broke.company.cbills).toBe(1000 + ECONOMY.loan.principal);
    // Возвращать надо заметно больше взятого: это страховка, а не подарок.
    expect(broke.company.loan!.debt).toBeGreaterThan(ECONOMY.loan.principal);
    // Второго займа поверх первого нет.
    expect(execute(broke, { kind: 'takeLoan' })).toEqual({
      ok: false,
      reason: CampaignRejectReason.LoanNotAvailable,
    });
  });

  it('взнос по займу списывается с ведомостью и долг в итоге гасится', () => {
    const state = companyState(1, { cbills: 1000 });
    execute(state, { kind: 'takeLoan' });
    const debt = state.company.loan!.debt;
    // Денег заведомо хватает: проверяется погашение, а не разорение.
    state.company = { ...state.company, cbills: 100_000_000 };

    let guard = 0;
    while (state.company.loan !== undefined && guard++ < 100) {
      execute(state, { kind: 'advance', days: ECONOMY.payroll.intervalDays });
    }
    expect(state.company.loan).toBeUndefined();
    expect(guard).toBeLessThanOrEqual(ECONOMY.loan.installments + 2);
    expect(debt).toBeGreaterThan(0);
  });

  it('долг переживает круг через сохранение', () => {
    const state = companyState(7, { cbills: 1000 });
    execute(state, { kind: 'takeLoan' });
    const restored = restore(snapshot(state));
    expect(restored.company.loan).toEqual(state.company.loan);
  });
});
