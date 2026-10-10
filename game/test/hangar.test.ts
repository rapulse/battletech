import { describe, expect, it } from 'vitest';
import {
  CampaignState,
  GALAXY,
  execute,
  isShipyard,
  makeCompany,
  makeSaveFile,
  mechCapacityOf,
  parseSaveFile,
  restore,
  serializeCampaignState,
  snapshot,
  worldProfile,
  type CampaignCommand,
  type CampaignEvent,
} from '../src/core/campaign/index.js';
import { nextBayStep, nextHangarStep } from '../src/core/campaign/commands/execute.js';
import { ECONOMY } from '../src/core/data/index.js';

/**
 * Ангар десантного корабля (шаг 75): 8 / 16 / 24 ячейки, открыта половина,
 * остальное выкупается той же лестницей и той же очередью, что и цех.
 */


function stateWith(cbills = 20_000_000): CampaignState {
  const state = new CampaignState(1);
  state.company = { ...state.company, cbills };
  return state;
}

function run(state: CampaignState, command: CampaignCommand): readonly CampaignEvent[] {
  const result = execute(state, command);
  if (!result.ok) throw new Error(`Команда ${command.kind} отклонена: ${result.reason}`);
  return result.events;
}

/** Открыть ячейку и дождаться её: команда, затем сутки ступени. */
function openSlot(state: CampaignState): void {
  const step = nextHangarStep(state.company.hangar, state.company.dropship);
  if (step === null) throw new Error('ангар уже открыт до потолка');
  run(state, { kind: 'upgradeHangar' });
  run(state, { kind: 'advance', days: Math.ceil(step.days) });
}

function yard(): string {
  for (let i = 0; i < GALAXY.count; i++) {
    if (isShipyard(worldProfile(1, {}, i))) return GALAXY.id(i);
  }
  throw new Error('на карте нет верфи');
}

describe('ангар десантного корабля (шаг 75)', () => {
  it('корабли — 8 / 16 / 24 ячейки, и открыта половина', () => {
    expect(ECONOMY.dropships.leopard).toMatchObject({ mechCapacity: 8, minMechs: 4 });
    expect(ECONOMY.dropships.union).toMatchObject({ mechCapacity: 16, minMechs: 8 });
    expect(ECONOMY.dropships.overlord).toMatchObject({ mechCapacity: 24, minMechs: 12 });
    expect(makeCompany().hangar).toBe(4);
    expect(mechCapacityOf(makeCompany())).toBe(4);
  });

  it('ячейка ангара стоит как стапель с тем же номером', () => {
    for (let hangar = 4; hangar < 16; hangar++) {
      expect(nextHangarStep(hangar, 'overlord')).toEqual(nextBayStep(hangar, 'overlord'));
    }
    // Выше потолка цеха лестница продолжается только для ангара.
    expect(nextBayStep(16, 'overlord')).toBeNull();
    expect(nextHangarStep(16, 'overlord')?.to).toBe(17);
    expect(nextHangarStep(24, 'overlord')).toBeNull();
  });

  it('ступень списывает цену сразу, а ячейку открывает в срок', () => {
    const state = stateWith();
    const step = nextHangarStep(4, 'leopard');
    expect(step?.to).toBe(5);
    const before = state.company.cbills;

    const events = run(state, { kind: 'upgradeHangar' });
    expect(state.company.cbills).toBe(before - step!.cost);
    expect(events[0]).toMatchObject({ kind: 'taskScheduled', task: { kind: 'hangarUpgraded', to: 5 } });
    expect(state.company.hangar).toBe(4);

    // Вторую ступень поверх незавершённой не начать.
    expect(execute(state, { kind: 'upgradeHangar' })).toEqual({ ok: false, reason: 'hangarUpgrading' });

    const opened = run(state, { kind: 'advance', days: Math.ceil(step!.days) });
    expect(opened).toContainEqual({ kind: 'hangarUpgraded', to: 5 });
    expect(mechCapacityOf(state.company)).toBe(5);
  });

  it('без денег ступень не начинается', () => {
    const state = stateWith(0);
    expect(execute(state, { kind: 'upgradeHangar' })).toEqual({ ok: false, reason: 'insufficientFunds' });
    expect(state.queue.some((e) => e.task.kind === 'hangarUpgraded')).toBe(false);
  });

  it('Леопард открывается до восьми, дальше — только корабль больше', () => {
    const state = stateWith();
    while (state.company.hangar < 8) openSlot(state);
    expect(nextHangarStep(state.company.hangar, 'leopard')).toBeNull();
    expect(execute(state, { kind: 'upgradeHangar' })).toEqual({ ok: false, reason: 'hangarMaxed' });
  });

  it('новый корабль поднимает ангар до своего минимума, выкупленное не теряется', () => {
    const fresh = stateWith();
    fresh.systemId = yard();
    run(fresh, { kind: 'upgradeDropship' });
    expect(fresh.company.dropship).toBe('union');
    expect(fresh.company.hangar).toBe(ECONOMY.dropships.union.minMechs);

    const bought = stateWith();
    bought.company = { ...bought.company, hangar: 8 };
    bought.systemId = yard();
    run(bought, { kind: 'upgradeDropship' });
    run(bought, { kind: 'upgradeDropship' });
    expect(bought.company.dropship).toBe('overlord');
    expect(bought.company.hangar).toBe(ECONOMY.dropships.overlord.minMechs);
  });

  it('хэш роты без выкупленных ячеек тот же, что до шага 75', () => {
    const state = stateWith();
    expect(serializeCampaignState(state)).not.toContain('hangar=');
    state.company = { ...state.company, hangar: 5 };
    expect(serializeCampaignState(state)).toContain('hangar=5');
  });

  it('сохранение переносит ангар; снимок без поля ангара не читается', () => {
    const state = stateWith();
    state.company = { ...state.company, hangar: 6 };
    expect(restore(parseSaveFile(makeSaveFile(snapshot(state)))).company.hangar).toBe(6);
    // Старые сохранения не поддерживаются (CLAUDE.md, решение 2026-10-01): миграции ангара шага 75 нет.
    const file = JSON.parse(JSON.stringify(makeSaveFile(snapshot(state))));
    delete file.state.company.hangar;
    expect(() => parseSaveFile(file)).toThrow();
  });
});
