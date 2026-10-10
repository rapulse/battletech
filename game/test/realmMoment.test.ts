import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PLAYER_ACTOR_ID } from '../src/core/campaign/index.js';
import type { WarLine } from '../src/ui/state/campaign.svelte.js';
import { latestMoment, MOMENT_DAYS, MOMENT_IMAGE, momentOf, REALM_MOMENTS } from '../src/ui/realm/realmMoment.js';

/** Поворот державы картинкой (после шага 93): какая строка сводки — какой поворот, и картинки на месте. */

const line = (over: Partial<WarLine>): WarLine => ({
  day: 100,
  kind: 'capture',
  systemId: 'a',
  attacker: 'davion',
  defender: 'liao',
  ruined: 0,
  ...over,
});

const clash = (attacker: string, defender: string, outcome: 'captured' | 'tributed' | 'repelled'): WarLine =>
  line({
    kind: 'clash',
    attacker,
    defender,
    clash: { outcome, attackerSize: 4, defenderSize: 2, attackerLost: 1, defenderLost: 2, lostWorld: defender === PLAYER_ACTOR_ID },
  });

describe('Поворот державы', () => {
  it('строки сводки — повороты', () => {
    expect(momentOf(line({ kind: 'warDeclared', attacker: 'davion', defender: PLAYER_ACTOR_ID }))).toBe('war');
    expect(momentOf(line({ kind: 'warEnded', attacker: PLAYER_ACTOR_ID, ended: 'free' }))).toBe('peace');
    expect(momentOf(line({ kind: 'warEnded', attacker: PLAYER_ACTOR_ID, ended: 'realmFallen' }))).toBeNull();
    expect(momentOf(line({ kind: 'revolt', defender: PLAYER_ACTOR_ID }))).toBe('revolt');
    expect(momentOf(line({ kind: 'revolt', defender: PLAYER_ACTOR_ID, detail: 'won' }))).toBeNull();
    expect(momentOf(line({ kind: 'seceded', defender: PLAYER_ACTOR_ID }))).toBe('lost');
    expect(momentOf(clash(PLAYER_ACTOR_ID, 'davion', 'captured'))).toBe('taken');
    expect(momentOf(clash('davion', PLAYER_ACTOR_ID, 'captured'))).toBe('lost');
    expect(momentOf(clash('davion', PLAYER_ACTOR_ID, 'repelled'))).toBeNull();
    expect(momentOf(line({ kind: 'capture', attacker: PLAYER_ACTOR_ID }))).toBe('taken');
    expect(momentOf(line({ kind: 'capture' }))).toBeNull();
    expect(momentOf(line({ kind: 'realmLoss' }))).toBeNull();
  });

  it('берётся последний поворот не старше срока', () => {
    const lines = [
      line({ kind: 'realmLoss', day: 300 }),
      clash(PLAYER_ACTOR_ID, 'davion', 'captured'),
      line({ kind: 'warDeclared', day: 50, attacker: PLAYER_ACTOR_ID, defender: 'davion' }),
    ];
    expect(latestMoment(lines, 100 + MOMENT_DAYS)?.moment).toBe('taken');
    expect(latestMoment(lines, 101 + MOMENT_DAYS)).toBeNull();
  });

  it('у каждого поворота есть картинка в public/', () => {
    for (const m of REALM_MOMENTS) expect(existsSync(resolve(__dirname, '../public', MOMENT_IMAGE[m].replace(/^\//, ''))), m).toBe(true);
  });
});
