import { describe, expect, it } from 'vitest';
import {
  EMPTY_TALLY,
  CampaignState,
  GALAXY,
  awardBattle,
  awardState,
  contractBoard,
  contractBrief,
  execute,
  makeCompany,
  makeRecord,
  makeSaveFile,
  parseSaveFile,
  recordToUnit,
  restore,
  serializeCampaignState,
  snapshot,
  type BattleBrief,
  type BattleFacts,
  type BattleOutcome,
  type CampaignCommand,
  type CampaignEvent,
  type Company,
  type Contract,
  type MechRecord,
  type UnitOutcome,
} from '../src/core/campaign/index.js';
import { ACHIEVEMENTS } from '../src/core/data/index.js';
import { Direction } from '../src/core/hex/index.js';
import { HitZone, type MechUnit, type Pilot } from '../src/core/model/index.js';
import { generateAssembly, makePilot } from '../src/core/rules/index.js';
import { Rng } from '../src/core/rng/index.js';
import { hasKey } from '../src/ui/i18n/index.js';

/**
 * Шаг 69 — достижения роты.
 *
 * Итог боя собирается вручную, тем же приёмом, что в `contracts.test.ts`:
 * проверка чистая, настоящий бой ей не нужен. На каждое условие — «открывается
 * ровно там, где должно», и отдельно — «не открывается дважды» и «бой,
 * рассчитанный штабом, боевых не даёт».
 */

const WORLD = 1;

function record(id: string, code: string, seed = 1): MechRecord {
  return makeRecord({ id, assembly: generateAssembly({ chassisCode: code, role: 'brawler' }, new Rng(seed)) });
}

function crew(id: string): Pilot {
  return makePilot(new Rng(7), { id, callsign: id, tier: 4 });
}

function unitOf(r: MechRecord, side: 'player' | 'opfor'): MechUnit {
  return recordToUnit(r, crew(`${side}-${r.id}`), { q: 0, r: 0 }, Direction.NE, side);
}

function withZone(unit: MechUnit, zone: HitZone, patch: Partial<MechUnit['zones'][number]>): MechUnit {
  return { ...unit, zones: unit.zones.map((z, i) => (i === zone ? { ...z, ...patch } : z)) };
}

interface Side {
  readonly record: MechRecord;
  readonly unit?: (u: MechUnit) => MechUnit;
  readonly victims?: readonly string[];
  readonly kills?: number;
}

/** Бой из явных списков: кто вышел, в каком виде вернулся, кого добил. */
function facts(
  own: readonly Side[],
  enemy: readonly Side[],
  opts: { won?: boolean; beyond?: boolean; taken?: readonly MechRecord[] } = {},
): BattleFacts {
  const brief: BattleBrief = {
    mapSeed: 1,
    battleSeed: 1,
    company: own.map((s) => ({ record: s.record, pilot: crew(`p-${s.record.id}`) })),
    enemy: enemy.map((s) => ({ record: s.record, pilot: crew(`e-${s.record.id}`) })),
  };
  const out = (s: Side, side: 'player' | 'opfor'): UnitOutcome => {
    const base = unitOf(s.record, side);
    return {
      recordId: s.record.id,
      side,
      unit: s.unit === undefined ? base : s.unit(base),
      ...EMPTY_TALLY,
      kills: s.kills ?? s.victims?.length ?? 0,
      victims: s.victims ?? [],
    };
  };
  const won = opts.won ?? true;
  const outcome: BattleOutcome = {
    winner: won ? 'player' : 'opfor',
    heldField: won,
    units: [...own.map((s) => out(s, 'player')), ...enemy.map((s) => out(s, 'opfor'))],
  };
  return { brief, outcome, won, beyond: opts.beyond ?? false, taken: opts.taken ?? [] };
}

const down = (u: MechUnit): MechUnit => ({ ...u, destroyed: true });

const LIGHT = 'IS-H20-R1F1';
const MEDIUM = 'IS-H55-R1F1';
const ASSAULT = 'IS-H100-R1F1';
const CLAN = 'CL-H55-R1F1';

function lance(n: number, code = MEDIUM): Side[] {
  return Array.from({ length: n }, (_, i) => ({ record: record(`M-${i + 1}`, code, i + 1) }));
}

function foes(n: number, code = MEDIUM, unit: (u: MechUnit) => MechUnit = down): Side[] {
  return Array.from({ length: n }, (_, i) => ({ record: record(`E-${i + 1}`, code, i + 11), unit }));
}

function fresh(): CampaignState {
  return new CampaignState(1, { worldSeed: WORLD });
}

describe('данные и словари', () => {
  it('у каждого достижения есть название и подсказка', () => {
    for (const a of ACHIEVEMENTS.achievements) {
      expect(hasKey(`achievement.${a.id}.name`), `нет achievement.${a.id}.name`).toBe(true);
      expect(hasKey(`achievement.${a.id}.hint`), `нет achievement.${a.id}.hint`).toBe(true);
    }
  });

  it('все 25 ячеек атласа заняты ровно по одному разу', () => {
    const icons = ACHIEVEMENTS.achievements.map((a) => a.icon).sort((a, b) => a - b);
    expect(icons).toEqual(Array.from({ length: 25 }, (_, i) => i));
  });
});

describe('боевые условия', () => {
  const opened = (f: BattleFacts): string[] => awardBattle(fresh(), f);

  it('один в поле воин — победа ровно одной машиной', () => {
    expect(opened(facts(lance(1), foes(2)))).toContain('loneWolf');
    expect(opened(facts(lance(2), foes(2)))).not.toContain('loneWolf');
    expect(opened(facts(lance(1), foes(2, MEDIUM, (u) => u), { won: false }))).not.toContain('loneWolf');
  });

  it('малыми силами — врагов вдвое больше', () => {
    expect(opened(facts(lance(2), foes(4)))).toContain('outnumbered');
    expect(opened(facts(lance(2), foes(3)))).not.toContain('outnumbered');
  });

  it('разгром звена — от четырёх, все выведены, никто не ушёл', () => {
    expect(opened(facts(lance(4), foes(4)))).toContain('lanceWipe');
    expect(opened(facts(lance(4), foes(3)))).not.toContain('lanceWipe');
    const oneLeft = [...foes(3), { record: record('E-9', MEDIUM, 9), unit: (u: MechUnit) => ({ ...u, withdrawn: true }) }];
    expect(opened(facts(lance(4), oneLeft))).not.toContain('lanceWipe');
  });

  it('убийца титанов — выведена машина от 100 т', () => {
    expect(opened(facts(lance(4), foes(1, ASSAULT)))).toContain('titanSlayer');
    expect(opened(facts(lance(4), foes(1, ASSAULT, (u) => u)))).not.toContain('titanSlayer');
    expect(opened(facts(lance(4), foes(1, MEDIUM)))).not.toContain('titanSlayer');
  });

  it('хирург — разрушена кабина противника', () => {
    const head = (u: MechUnit): MechUnit => down(withZone(u, HitZone.Head, { destroyed: true, structure: 0 }));
    expect(opened(facts(lance(4), foes(1, MEDIUM, head)))).toContain('headshot');
    expect(opened(facts(lance(4), foes(1)))).not.toContain('headshot');
  });

  it('без царапины — броня снята можно, структура нет', () => {
    const scratched = lance(2).map((s) => ({ ...s, unit: (u: MechUnit) => withZone(u, HitZone.Torso, { armor: 0 }) }));
    expect(opened(facts(scratched, foes(2)))).toContain('flawless');
    const hurt = lance(2).map((s, i) =>
      i === 0 ? { ...s, unit: (u: MechUnit) => withZone(u, HitZone.Torso, { structure: u.zones[HitZone.Torso]!.structure - 1 }) } : s,
    );
    expect(opened(facts(hurt, foes(2)))).not.toContain('flawless');
  });

  it('лёгкое звено — от четырёх машин, каждая до 35 т', () => {
    expect(opened(facts(lance(4, LIGHT), foes(4)))).toContain('lightLance');
    expect(opened(facts(lance(3, LIGHT), foes(4)))).not.toContain('lightLance');
    expect(opened(facts(lance(4, MEDIUM), foes(4)))).not.toContain('lightLance');
  });

  it('давид и голиаф — лёгкая машина добила тяжёлую', () => {
    const giant = { record: record('E-1', ASSAULT, 5), unit: down };
    const david = { record: record('M-1', LIGHT, 1), victims: ['opfor:E-1'] };
    // Добивание записано по id боевого юнита — такому, какой строит `recordToUnit`.
    expect(unitOf(giant.record, 'opfor').id).toBe('opfor:E-1');
    expect(opened(facts([david], [giant]))).toContain('davidGoliath');
    const goliathByMedium = { record: record('M-1', MEDIUM, 1), victims: ['opfor:E-1'] };
    expect(opened(facts([goliathByMedium], [giant]))).not.toContain('davidGoliath');
    expect(opened(facts([{ record: record('M-1', LIGHT, 1) }], [giant]))).not.toContain('davidGoliath');
  });

  it('на одной ноге — победа, у уцелевшей машины разрушена нога', () => {
    const limp = [{ record: record('M-1', MEDIUM, 1), unit: (u: MechUnit) => withZone(u, HitZone.LeftLeg, { destroyed: true }) }];
    expect(opened(facts(limp, foes(1)))).toContain('limpHome');
    const lost = [{ record: record('M-1', MEDIUM, 1), unit: (u: MechUnit) => down(withZone(u, HitZone.LeftLeg, { destroyed: true })) }];
    expect(opened(facts([...lost, ...lance(1)], foes(1)))).not.toContain('limpHome');
  });

  it('трофеи и клановый трофей — по тому, что рота забрала', () => {
    expect(opened(facts(lance(1), foes(1), { taken: [record('T-1', MEDIUM)] }))).toEqual(
      expect.arrayContaining(['firstTrophy']),
    );
    expect(opened(facts(lance(1), foes(1), { taken: [record('T-1', MEDIUM)] }))).not.toContain('clanTrophy');
    expect(opened(facts(lance(1), foes(1), { taken: [record('T-1', CLAN)] }))).toContain('clanTrophy');
    expect(opened(facts(lance(1), foes(1)))).not.toContain('firstTrophy');
  });

  it('сверх задачи — по исходу `beyond`', () => {
    expect(opened(facts(lance(1), foes(1), { beyond: true }))).toContain('beyond');
    expect(opened(facts(lance(1), foes(1)))).not.toContain('beyond');
  });

  it('открытое не открывается второй раз, а день записывается', () => {
    const state = fresh();
    state.day = 42;
    expect(awardBattle(state, facts(lance(1), foes(2)))).toContain('loneWolf');
    expect(awardBattle(state, facts(lance(1), foes(2)))).not.toContain('loneWolf');
    expect(state.achievements.unlocked.filter((e) => e.id === 'loneWolf')).toEqual([{ id: 'loneWolf', day: 42 }]);
  });

  it('боевая проверка не открывает достижений из состояния', () => {
    const state = fresh();
    state.company = { ...state.company, cbills: 5_000_000 };
    expect(awardBattle(state, facts(lance(1), foes(1)))).not.toContain('millionaire');
  });
});

describe('условия состояния', () => {
  it('касса, корабль и парк открываются по состоянию', () => {
    const state = fresh();
    state.company = { ...state.company, cbills: 1_000_000, dropship: 'union' };
    const got = awardState(state, { hadLoan: false });
    expect(got).toContain('millionaire');
    expect(got).toContain('union');
    expect(got).not.toContain('overlord');
    expect(awardState(state, { hadLoan: false })).toEqual([]);
  });

  it('долг уплачен — только переход «был заём → нет займа»', () => {
    const state = fresh();
    expect(awardState(state, { hadLoan: false })).not.toContain('debtFree');
    expect(awardState(state, { hadLoan: true })).toContain('debtFree');
  });

  it('длинный счёт копит добивания отыгранных боёв', () => {
    const state = fresh();
    state.achievements = { ...state.achievements, kills: 49 };
    awardBattle(state, facts([{ record: record('M-1', MEDIUM), kills: 1 }], foes(1)));
    expect(state.achievements.kills).toBe(50);
    expect(awardState(state, { hadLoan: false })).toContain('fiftyKills');
  });

  it('открывается любой командой — хоть переименованием роты', () => {
    const state = fresh();
    state.company = { ...state.company, cbills: 2_000_000 };
    const result = execute(state, { kind: 'setCompanyName', name: 'Новое имя' });
    expect(result.ok && result.events).toContainEqual({ kind: 'achievementUnlocked', id: 'millionaire' });
  });
});

// --- через команду расчёта контракта -------------------------------------------

function systemWithOffers(): { id: string; offers: readonly Contract[] } {
  const war = new CampaignState(1, { worldSeed: WORLD }).war;
  for (let i = 0; i < GALAXY.count; i++) {
    const id = GALAXY.id(i);
    const offers = contractBoard(WORLD, {}, id, 0, undefined, war);
    if (offers.length > 0) return { id, offers };
  }
  throw new Error('Ни одной системы с контрактами — это не тест, это сломанные данные');
}

function run(state: CampaignState, command: CampaignCommand): readonly CampaignEvent[] {
  const result = execute(state, command);
  if (!result.ok) throw new Error(`Команда ${command.kind} отклонена: ${result.reason}`);
  return result.events;
}

function deployedSolo(): CampaignState {
  const { id, offers } = systemWithOffers();
  const state = new CampaignState(1, { worldSeed: WORLD, systemId: id });
  const company: Partial<Company> = {
    mechs: [{ ...record('M-1', MEDIUM), pilotId: 'P-1' }],
    pilots: [crew('P-1')],
    cbills: 100_000,
    dropship: 'union',
  };
  state.company = { ...makeCompany(), ...company };
  run(state, { kind: 'takeContract', contractId: offers[0]!.id });
  run(state, { kind: 'deploy', recordIds: ['M-1'] });
  return state;
}

function wonOutcome(state: CampaignState): BattleOutcome {
  const brief = contractBrief(state);
  return {
    winner: 'player',
    heldField: true,
    units: [
      ...brief.company.map((p) => ({
        recordId: p.record.id,
        side: 'player' as const,
        unit: unitOf(p.record, 'player'),
        ...EMPTY_TALLY,
        kills: brief.enemy.length,
      })),
      ...brief.enemy.map((p) => ({
        recordId: p.record.id,
        side: 'opfor' as const,
        unit: down(unitOf(p.record, 'opfor')),
        ...EMPTY_TALLY,
      })),
    ],
  };
}

const unlockedIn = (events: readonly CampaignEvent[]): string[] =>
  events.flatMap((e) => (e.kind === 'achievementUnlocked' ? [e.id] : []));

describe('расчёт контракта', () => {
  it('отыгранный бой одной машиной даёт и боевые, и достижения из состояния', () => {
    const state = deployedSolo();
    const events = run(state, { kind: 'resolveContract', outcome: wonOutcome(state), salvage: [] });
    const ids = unlockedIn(events);
    expect(ids).toContain('loneWolf');
    expect(ids).toContain('firstContract');
    expect(state.achievements.kills).toBeGreaterThan(0);
  });

  it('бой, рассчитанный штабом, боевых не даёт и добивания не считает', () => {
    const state = deployedSolo();
    const events = run(state, { kind: 'resolveContract', outcome: wonOutcome(state), salvage: [], auto: true });
    const ids = unlockedIn(events);
    expect(ids).not.toContain('loneWolf');
    // «Первое дело» выводится из памяти мира, а она пишется и за расчёт штаба.
    expect(ids).toContain('firstContract');
    expect(state.achievements.kills).toBe(0);
  });

  it('достижения переживают сохранение и загрузку', () => {
    const state = deployedSolo();
    run(state, { kind: 'resolveContract', outcome: wonOutcome(state), salvage: [] });
    const loaded = restore(parseSaveFile(JSON.parse(JSON.stringify(makeSaveFile(snapshot(state))))));
    expect(loaded.achievements).toEqual(state.achievements);
    expect(serializeCampaignState(loaded)).toBe(serializeCampaignState(state));
  });
});

describe('сохранение', () => {
  it('снимок без поля достижений не читается: старые сохранения не поддерживаются', () => {
    const { achievements: _drop, ...old } = snapshot(fresh());
    expect(() => parseSaveFile(JSON.parse(JSON.stringify({ format: 'battletech-campaign', state: old })))).toThrow();
  });

  it('пустые достижения не меняют хэш кампании', () => {
    expect(serializeCampaignState(fresh())).not.toContain('achievements=');
  });
});
