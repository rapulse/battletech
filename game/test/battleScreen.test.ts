import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CampaignState,
  contractBoard,
  execute,
  GALAXY,
  makeCompany,
  makeRecord,
  makeSaveFile,
  snapshot,
  type BattleOutcome,
  type Company,
  type MechRecord,
} from '../src/core/campaign/index.js';
import { generateAssembly, makePilot } from '../src/core/rules/index.js';
import { Rng } from '../src/core/rng/index.js';
import { campaign } from '../src/ui/state/campaign.svelte.js';
import { enterBattleScreen } from '../src/ui/state/battleScreen.js';

/**
 * Вход на экран боя один, и это проверяется обходом исходников.
 *
 * Стор боя живёт только в памяти вкладки: в сохранение он не пишется и после
 * перезагрузки страницы поднимается песочницей из конструктора. Кампания при
 * этом помнит вылет (`ActiveContract.sortie` лежит в сохранении) и рисует
 * кнопку «в бой». Голое `screen = 'battle'` в такой момент открывает ЧУЖОЙ бой —
 * учебную стычку «звено на звено», где нет ни машин роты, ни панели исхода, а
 * значит и победа никуда не доходит.
 *
 * Чинится это не на кнопке, а тем, что кнопок с таким присваиванием больше нет:
 * все ходят через `enterBattleScreen`, который сверяет бой с вылетом. Тест
 * грубый — регулярное выражение по разметке, — но ловит ровно тот способ, каким
 * второй вход и заводится: кто-то пишет присваивание ещё в одном месте.
 */
const UI = resolve(__dirname, '..', 'src', 'ui');
const GATE = join(UI, 'state', 'battleScreen.ts');

function collect(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) collect(path, out);
    else if (entry.endsWith('.svelte') || entry.endsWith('.ts')) out.push(path);
  }
}

describe('вход на экран боя', () => {
  it('никто, кроме battleScreen.ts, не ставит screen = «battle»', () => {
    const files: string[] = [];
    collect(UI, files);
    const guilty = files.filter(
      (f) => f !== GATE && /screen\s*=\s*'battle'/.test(readFileSync(f, 'utf8')),
    );
    expect(guilty, `экран боя открывается в обход enterBattleScreen: ${guilty.join(', ')}`).toEqual([]);
  });

  it('единственный вход спрашивает вылет и сверяет с ним бой', () => {
    const gate = readFileSync(GATE, 'utf8');
    expect(gate).toContain('campaign.sortieBrief');
    expect(gate).toContain('battle.matchesContract');
    expect(gate).toContain('battle.startFromBrief');
  });

  /*
   * Отчёт разбора живёт до кнопки «закрыть» и переживает закрытие контракта.
   * Если брифинг глушится отчётом, то игрок, ушедший с разбора вкладкой и
   * взявший следующий контракт, попадал в ПРОШЛЫЙ бой: брифинг нового вылета
   * был `null`, и вход не пересобирал бой. Глушит брифинг только `pending` —
   * отыгранный, но ещё не отданный итог.
   */
  it('брифинг вылета не глушится отчётом прошлого контракта', () => {
    const store = readFileSync(join(UI, 'state', 'campaign.svelte.ts'), 'utf8');
    const getter = /get sortieBrief\(\)[\s\S]*?\n {2}\}/.exec(store)?.[0] ?? '';
    expect(getter, 'геттер sortieBrief не найден').not.toBe('');
    expect(getter).toContain('this.pending !== null');
    expect(getter).not.toMatch(/if \([^)]*this\.report/);
  });
});

/**
 * «БОЙ» и «РАЗБОР» — взаимоисключающие (2026-09-17).
 *
 * До этого обе тревожные кнопки могли гореть разом, и случайный клик на «БОЙ»
 * сбрасывал прогресс уже отыгранного боя: вход пересобирал бой по брифингу
 * вылета, а разбор при этом ждал своего подтверждения.
 *
 * Здесь проверяется САМО ПОВЕДЕНИЕ, а не текст исходника: кампания собирается
 * ядром, доводится до состояния «бой отыгран, разбор не закрыт» и в этом
 * состоянии зовётся единственный вход на экран боя.
 */
describe('кнопки боя и разбора не путаются', () => {
  const WORLD = 1;

  function lance(): Partial<Company> {
    const mechs: MechRecord[] = [];
    const pilots = [];
    for (let i = 1; i <= 4; i++) {
      const assembly = generateAssembly({ chassisCode: 'IS-H55-R3F2', role: 'brawler' }, new Rng(i));
      mechs.push({ ...makeRecord({ id: `M-${i}`, assembly }), pilotId: `P-${i}` });
      pilots.push(makePilot(new Rng(7), { id: `P-${i}`, callsign: `P-${i}`, tier: 4 }));
    }
    return { mechs, pilots, cbills: 2_000_000, dropship: 'union' };
  }

  /** Первая система с непустой биржей: фикстура не должна зависеть от каталога. */
  function stateWithSortie(): CampaignState {
    const war = new CampaignState(1, { worldSeed: WORLD }).war;
    for (let i = 0; i < GALAXY.count; i++) {
      const id = GALAXY.id(i);
      const offers = contractBoard(WORLD, {}, id, 0, undefined, war);
      if (offers.length === 0) continue;
      const state = new CampaignState(1, { worldSeed: WORLD, systemId: id });
      state.company = { ...makeCompany(), ...lance() };
      if (!execute(state, { kind: 'takeContract', contractId: offers[0]!.id }).ok) continue;
      if (!execute(state, { kind: 'deploy', recordIds: ['M-1', 'M-2', 'M-3', 'M-4'] }).ok) continue;
      return state;
    }
    throw new Error('Ни одной системы, где можно подписать контракт и выйти на поле');
  }

  it('при неподтверждённом разборе вход на экран боя уводит на разбор', async () => {
    const state = stateWithSortie();
    const file = new File([JSON.stringify(makeSaveFile(snapshot(state)))], 'save.json', {
      type: 'application/json',
    });
    expect(await campaign.importFile(file)).toBe(true);
    expect(campaign.deployed).toBe(true);
    expect(campaign.hasDebrief).toBe(false);

    // Бой отыгран, но трофеи ещё не подтверждены: ровно то состояние, в котором
    // раньше горели обе кнопки.
    const outcome: BattleOutcome = { winner: 'player', heldField: true, units: [] };
    campaign.battleFinished(outcome, false);
    expect(campaign.hasDebrief).toBe(true);

    campaign.screen = 'hangar';
    enterBattleScreen();
    expect(campaign.screen).toBe('debrief');
  });

  it('закрытый разбор снова открывает дорогу в бой', async () => {
    const state = stateWithSortie();
    const file = new File([JSON.stringify(makeSaveFile(snapshot(state)))], 'save.json', {
      type: 'application/json',
    });
    expect(await campaign.importFile(file)).toBe(true);

    campaign.battleFinished({ winner: 'player', heldField: true, units: [] }, false);
    campaign.closeDebrief();
    expect(campaign.hasDebrief).toBe(false);

    enterBattleScreen();
    expect(campaign.screen).toBe('battle');
  });

  /*
   * Единственная проверка этого файла, которая читает разметку, — и читает её
   * не от лени: `vitest` настроен на `environment: 'node'` (ядро не знает о
   * DOM), компонент Svelte в тестах не рисуется, и увидеть, показана кнопка или
   * нет, больше нечем.
   *
   * Поведение при этом уже закрыто тестами выше: вкладка зовёт
   * `enterBattleScreen`, и даже показанная по ошибке она уведёт на разбор. Эта
   * проверка про другое — про то, что игроку не предлагают кнопку, ведущую не
   * туда, куда она обещает.
   */
  it('шапка терминала не рисует вкладку боя, пока разбор не закрыт', () => {
    const header = readFileSync(join(UI, 'campaign', 'HeaderTerminal.svelte'), 'utf8');
    const at = header.indexOf('data-screen="battle"');
    expect(at, 'вкладка боя в шапке не найдена').toBeGreaterThan(0);
    const guard = header.slice(Math.max(0, at - 200), at);
    expect(guard, 'вкладка боя не закрыта условием hasDebrief').toMatch(/\{#if[^}]*hasDebrief/);
  });
});
