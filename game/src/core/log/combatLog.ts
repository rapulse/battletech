import { weapon } from '../data/tables.js';
import { MoveMode } from '../map/index.js';
import { ZONE_KEYS, type HitZone } from '../model/HitZone.js';
import type { BattleState } from '../model/BattleState.js';
import type { BattleEvent } from '../commands/types.js';
import { tr } from './dictionary.js';
import { partsText, phrase, phraseText, toned, type LogPart, type LogTone, type PhraseParam } from './phrase.js';

/**
 * Текстовый боевой журнал.
 *
 * Не украшение: правило из wiki/design/pilots/skills.md требует, чтобы срыв
 * исполнения был **всегда объяснён**. Необъяснённый срыв читается игроком как
 * жульничество игры, и вся двухэтапность превращается в раздражение вместо
 * характера. Поэтому журнал — часть механики, а не слоя показа, и живёт в ядре.
 *
 * С шага 52 строка журнала — данные (`LogLine`): вид строки и куски фразы из
 * словаря ядра (`ru.json → log.*`). Вид строки раньше угадывал экран по тексту
 * («начинается с └», «содержит „выведен из строя“») — на другом языке это
 * перестало бы работать, а «контакт … потерян» заодно красился как выбывшая
 * машина.
 */

export interface LogNames {
  unit(id: string): string;
  pilot(id: string): string;
}

/** Имена из состояния боя. Робот зовётся своим id, пилот — позывным. */
export function namesFrom(state: BattleState): LogNames {
  return {
    unit: (id) => state.getUnit(id)?.id ?? id,
    pilot: (id) => state.units.find((u) => u.pilot.id === id)?.pilot.callsign ?? id,
  };
}

/**
 * Вид строки: `info` — действие верхнего уровня, `sub` — следствие предыдущего
 * (урон, крит, бросок на равновесие), `turn` — граница хода, `out` — машина
 * выбыла из боя.
 */
export type LogLineKind = 'info' | 'sub' | 'turn' | 'out';

export interface LogLine {
  readonly kind: LogLineKind;
  readonly parts: readonly LogPart[];
}

/**
 * Строка текстом. Вложенные строки начинаются с `└`, чтобы связь с выстрелом
 * читалась глазами без разметки — в отчёте и в терминале.
 */
export function lineText(line: LogLine): string {
  return (line.kind === 'sub' ? '  └ ' : '') + partsText(line.parts);
}

function line(kind: LogLineKind, key: string, params: Readonly<Record<string, PhraseParam>> = {}): LogLine {
  return { kind, parts: phrase(key, params) };
}

function pct(x: number): string {
  return `${Math.round(x * 100)} %`;
}

function signed(n: number): string {
  return n >= 0 ? `+${n}` : `${n}`;
}

function zoneName(z: HitZone): string {
  return tr(ZONE_KEYS[z]);
}

function weaponName(id: string): string {
  return tr(weapon(id).key);
}

/** Как называется румб в журнале. Порядок — Direction. */
const DIRECTION_KEYS: readonly string[] = [
  'log.direction.nw',
  'log.direction.ne',
  'log.direction.e',
  'log.direction.se',
  'log.direction.sw',
  'log.direction.w',
];

/** Как называется уровень контакта в журнале. Порядок — ContactLevel. */
const CONTACT_KEYS: readonly string[] = [
  'log.contactLevel.none',
  'log.contactLevel.blip',
  'log.contactLevel.silhouette',
  'log.contactLevel.identified',
];

function damageAmount(n: number): LogPart {
  return toned(phraseText('log.damageAmount', { n }), 'dmg');
}

function botchReasons(composure: number, reasons: readonly string[]): string {
  return [phraseText('log.composure', { n: composure }), ...reasons.map(tr)].join(', ');
}

function critDescription(e: Extract<BattleEvent, { kind: 'critical' }>): PhraseParam {
  const item = e.itemId ? tr(`equipment.${e.itemId}`) : '';
  switch (e.effect) {
    case 'weaponDestroyed':
      return phraseText('log.crit.weaponDestroyed', {
        item: e.weaponLost ? weaponName(e.weaponLost) : (e.itemId ?? ''),
      });
    case 'ammoExplosion':
      return phraseText('log.crit.ammoExplosion', { item });
    case 'heatsinkDamaged':
      return phraseText('log.crit.heatsinkDamaged', { item });
    case 'reactorHit':
      return phraseText('log.crit.reactorHit');
    case 'reactorDestroyed':
      return toned(phraseText('log.crit.reactorDestroyed'), 'crit');
    case 'gyroHit':
      return phraseText('log.crit.gyroHit');
    case 'gyroDestroyed':
      return toned(phraseText('log.crit.gyroDestroyed'), 'crit');
    case 'cockpitDestroyed':
      return toned(phraseText('log.crit.cockpitDestroyed'), 'crit');
    case 'sensorHit':
      return phraseText('log.crit.sensorHit');
    case 'actuatorHit':
      return phraseText(e.slotKind === 'arm_actuator' ? 'log.crit.actuatorArm' : 'log.crit.actuatorLeg');
    case 'jumpJetDamaged':
      return phraseText('log.crit.jumpJetDamaged');
    case 'equipmentDamaged':
      return phraseText('log.crit.equipmentDamaged', { item });
    case 'empty':
    default:
      return phraseText('log.crit.empty');
  }
}

function destroyedWhy(reason: string): string {
  switch (reason) {
    case 'cockpit':
      return phraseText('log.destroyedWhy.cockpit');
    case 'torso':
      return phraseText('log.destroyedWhy.torso');
    case 'reactor':
      return phraseText('log.destroyedWhy.reactor');
    case 'ammoExplosion':
      return phraseText('log.destroyedWhy.ammoExplosion');
    case 'leg':
      return phraseText('log.destroyedWhy.leg');
    case 'gyro':
      return phraseText('log.destroyedWhy.gyro');
    case 'ejected':
      return phraseText('log.destroyedWhy.ejected');
    default:
      return phraseText('log.destroyedWhy.pilot');
  }
}

/** Одно событие — одна или несколько строк. */
export function formatEvent(e: BattleEvent, n: LogNames): LogLine[] {
  switch (e.kind) {
    case 'moved': {
      const how =
        e.mode === MoveMode.Jump ? 'log.moveHow.jump' : e.mode === MoveMode.Run ? 'log.moveHow.run' : 'log.moveHow.walk';
      return [
        line('info', 'log.moved', {
          unit: n.unit(e.unitId),
          how: phraseText(how),
          hexes: e.path.length - 1,
          mp: e.mpSpent,
          checks: e.pilotingChecks > 0 ? phraseText('log.movedChecks', { n: e.pilotingChecks }) : '',
          deep: e.submerged > 0 ? phraseText('log.movedDeep', { n: e.submerged }) : '',
        }),
      ];
    }

    case 'turned':
      // Разворот на месте. Пишется в журнал наравне с ходом: пока фасинг не
      // читает ни одно правило боя, это единственное место, где видно, что
      // команда вообще исполнилась.
      return [
        line('info', 'log.turned', {
          unit: n.unit(e.unitId),
          from: tr(DIRECTION_KEYS[e.from] ?? '?'),
          to: tr(DIRECTION_KEYS[e.to] ?? '?'),
        }),
      ];

    case 'shot': {
      // Разбор пишется УРАВНЕНИЕМ, а не списком: «база 4 + бег 2 + цель 3 +
      // дальняя 4 = 13 → цель 12 (перебор +1)». Список слагаемых в квадратных
      // скобках не показывал ни базы, ни того, что сумма упёрлась в потолок, —
      // а именно потолок и делал попадание по быстрой цели лотереей 1:36
      // (шаг 29).
      const parts = e.factors.map((f) => `${tr(f.key)} ${signed(f.amount)}`);
      const sum = [phraseText('log.toHitBase', { n: e.toHitBase }), ...parts].join(' ');
      const raw = e.toHitBase + e.factors.reduce((a, f) => a + f.amount, 0);
      const cuts: string[] = [];
      if (e.toHitSituationalCut > 0) cuts.push(phraseText('log.cutSituational', { n: signed(-e.toHitSituationalCut) }));
      if (e.toHitOverflow > 0) cuts.push(phraseText('log.cutOverflow', { n: signed(-e.toHitOverflow) }));
      const capped =
        cuts.length > 0
          ? phraseText('log.toHitCapped', { raw, target: e.toHitTarget, cuts: cuts.join(', ') })
          : phraseText('log.toHitPlain', { target: e.toHitTarget });

      // Ракетная пачка (шаг 66b): у каждой ракеты свой бросок попадания, и
      // одной строкой «попал/промах» это уже не показать. Разбор целевого
      // числа общий на всю пачку — он не зависит от того, какая по счёту
      // ракета летит, — поэтому уравнение остаётся тем же, а вердикт
      // заменяется на «долетело N из M». Судьба каждой ракеты по отдельности
      // (Собранность, срыв) в журнал не выносится — иначе залп РДД-20 давал
      // бы до двадцати дополнительных строк на один выстрел.
      if (e.clusterTotal !== undefined) {
        const landed = e.clusterLanded ?? 0;
        const tone: LogTone = landed === 0 ? 'miss' : landed === e.clusterTotal ? 'hit' : 'warn';
        return [
          line('info', 'log.clusterShot', {
            unit: n.unit(e.unitId),
            weapon: weaponName(e.weapon),
            target: n.unit(e.targetId),
            need: e.toHitTarget,
            verdict: toned(phraseText('log.clusterLanded', { landed, total: e.clusterTotal }), tone),
            table: e.zoneTable ? ` · [${e.zoneTable}]` : '',
            sum,
            capped,
          }),
        ];
      }

      const lines = [
        line('info', 'log.shot', {
          unit: n.unit(e.unitId),
          weapon: weaponName(e.weapon),
          target: n.unit(e.targetId),
          need: e.toHitTarget,
          roll: e.roll,
          verdict: e.intentHit ? toned(phraseText('log.hit'), 'hit') : toned(phraseText('log.miss'), 'miss'),
          table: e.zoneTable ? ` · [${e.zoneTable}]` : '',
          sum,
          capped,
        }),
      ];
      if (e.poiseSaved) {
        lines.push(line('sub', 'log.poise', { composure: e.composure }));
      }
      if (e.botched) {
        lines.push(
          line('sub', 'log.botchShot', {
            reasons: botchReasons(e.composure, e.botchReasons),
            chance: pct(e.botchChance),
          }),
        );
      }
      return lines;
    }

    case 'damaged': {
      const state = e.zoneDestroyed
        ? toned(phraseText('log.zoneDestroyed'), 'crit')
        : e.armorHeld
          ? phraseText('log.armorLeft', { n: e.armorAfter })
          : phraseText('log.armorPierced', { n: e.structureAfter });
      return [
        line('sub', 'log.damaged', {
          zone: zoneName(e.zone),
          via: e.transferredFrom !== null ? phraseText('log.damageVia', { zone: zoneName(e.transferredFrom) }) : '',
          damage: damageAmount(e.amount),
          state,
        }),
      ];
    }

    case 'pilotingCheck':
      return [
        line('sub', 'log.pilotingCheck', {
          reason: tr(e.reason),
          target: e.target,
          roll: e.roll,
          result: e.passed ? phraseText('log.pilotingHeld') : toned(phraseText('log.pilotingFailed'), 'warn'),
        }),
      ];

    case 'moveBotched': {
      const reasons = botchReasons(e.composure, e.botchReasons);
      const chance = pct(e.botchChance);
      return e.hexesShort > 0
        ? [line('sub', 'log.moveBotchShort', { reasons, chance, n: e.hexesShort })]
        : [line('sub', 'log.moveBotchStumble', { reasons, chance, stumbled: toned(phraseText('log.stumbled'), 'warn') })];
    }

    case 'weaponLost':
      return [line('sub', 'log.weaponLost', { zone: zoneName(e.zone), weapon: weaponName(e.weapon) })];

    case 'fell':
      return [line('sub', 'log.fell', { unit: n.unit(e.unitId), fell: toned(phraseText('log.fellWord'), 'warn') })];

    case 'pilotInjured':
      return [
        line('sub', 'log.pilotInjured', {
          pilot: n.pilot(e.pilotId),
          cause: tr(`injury.${e.cause}`),
          chance: pct(e.chance),
          n: e.injuries,
        }),
      ];

    case 'pilotEjected': {
      // Гарантированный уход бросок не тратит — про шанс тогда и говорить нечего.
      const odds = e.chance >= 1 ? phraseText('log.ejectAuto') : phraseText('log.chance', { chance: pct(e.chance) });
      const outcome = e.success
        ? phraseText('log.ejectSuccess', { pilot: n.pilot(e.pilotId) })
        : phraseText('log.ejectFailed');

      // Добровольный уход — самостоятельное действие юнита, а не следствие
      // чужого выстрела: его строка идёт верхним уровнем, иначе в журнале она
      // прилипает к предыдущему действию другой стороны.
      if (e.trigger === 'voluntary') {
        return [line('info', 'log.ejectVoluntary', { unit: n.unit(e.unitId), odds, outcome })];
      }

      // Повод НЕ называет разрушенную зону, и это не потеря точности, а её
      // возвращение: поводов ухода три (`pilots.json` → ejection.triggers), а
      // причин разрушения семь, и всё, что не голова, катапультируется по
      // корзине `torso`. Строка «разрушен торс» врала на оторванной ноге,
      // детонации, реакторе и гироскопе. Настоящую причину называет соседняя
      // строка `unitDestroyed`, где она различается полностью.
      const why = e.trigger === 'head' ? phraseText('log.ejectWhyHead') : phraseText('log.ejectWhyMech');
      return [line('sub', 'log.ejectForced', { why, odds, outcome })];
    }

    case 'contactChanged': {
      const params = {
        side: e.side === 'player' ? phraseText('log.contactSide.player') : phraseText('log.contactSide.opfor'),
        unit: n.unit(e.unitId),
        level: tr(CONTACT_KEYS[e.to] ?? '?'),
      };
      return e.to > e.from ? [line('info', 'log.contactGained', params)] : [line('info', 'log.contactLost', params)];
    }

    case 'cockpitBreach':
      return [
        line('sub', 'log.cockpitBreach', {
          roll: e.roll,
          from: e.lostFrom,
          outcome: e.pilotLost ? phraseText('log.breachThrough') : phraseText('log.breachInstruments'),
        }),
      ];

    case 'pilotLost': {
      const pilot = n.pilot(e.pilotId);
      if (e.reason === 'ejectionFailed') return [line('sub', 'log.pilotLostEjectFailed', { pilot })];
      if (e.reason === 'cockpitBreach') return [line('sub', 'log.pilotLostBreach', { pilot })];
      return [
        e.reason === 'cockpit'
          ? line('sub', 'log.pilotLostCockpit', { pilot })
          : line('sub', 'log.pilotOutInjuries', { pilot }),
      ];
    }

    case 'critical':
      return [
        line('sub', 'log.critical', {
          crit: toned(phraseText('log.critWord'), 'crit'),
          zone: zoneName(e.zone),
          slot: e.slotIndex + 1,
          desc: critDescription(e),
        }),
      ];

    case 'ammoExplosion': {
      const detail: PhraseParam = e.contained
        ? phraseText('log.caseContained')
        : e.transferred
          ? phrase('log.blastTransferred', { damage: damageAmount(e.damage) })
          : damageAmount(e.damage);
      return [
        line('sub', 'log.ammoExplosion', {
          blast: toned(phraseText('log.blastWord'), 'crit'),
          ammo: e.ammoId ? tr(`equipment.${e.ammoId}`) : phraseText('log.ammoGeneric'),
          zone: zoneName(e.zone),
          detail,
        }),
      ];
    }

    case 'shutdown':
      return [
        line('info', 'log.shutdown', {
          unit: n.unit(e.unitId),
          shutdown: toned(phraseText('log.shutdownWord'), 'danger'),
          heat: e.heat,
          limit: e.limit,
        }),
      ];

    case 'restarted':
      return [line('info', 'log.restarted', { unit: n.unit(e.unitId) })];

    case 'ambushWoke':
      return [line('info', e.instant ? 'log.ambushWoke' : 'log.ambushRestart', { unit: n.unit(e.unitId) })];

    case 'ambushSpotted':
      return [line('info', 'log.ambushSpotted', { unit: n.unit(e.unitId) })];

    case 'stoodUp':
      return [line('info', 'log.stoodUp', { unit: n.unit(e.unitId) })];

    case 'unitDestroyed':
      return [line('out', 'log.unitDestroyed', { unit: n.unit(e.unitId), why: destroyedWhy(e.reason) })];

    case 'initiative': {
      const rolls = e.rolls.map((r) => `${r.side} ${r.roll}${r.mod !== 0 ? signed(r.mod) : ''}`).join(', ');
      return [
        line('info', 'log.initiative', {
          rolls,
          act: e.phase === 'attack' ? phraseText('log.initiativeAttack') : phraseText('log.initiativeMove'),
          side: e.order[0] ?? '?',
        }),
      ];
    }

    case 'sideWithdrawing': {
      // Отход обязан быть виден словами, а не только уменьшившимся списком
      // трофеев: игрок иначе не поймёт, куда делись машины противника (шаг 43).
      const side =
        e.side === 'player' ? phraseText('log.side.player') : e.side === 'opfor' ? phraseText('log.side.opfor') : e.side;
      return [line('info', 'log.sideWithdrawing', { side, n: e.units })];
    }

    case 'unitAbandoned':
      return [line('info', 'log.unitAbandoned', { unit: n.unit(e.unitId) })];

    case 'unitWithdrew':
      return [line('info', 'log.unitWithdrew', { unit: n.unit(e.unitId) })];

    case 'phaseEnded':
      return [];

    case 'turnStarted':
      return [line('turn', 'log.turnStarted', { turn: e.turn })];
  }
}

export function formatEvents(events: readonly BattleEvent[], n: LogNames): LogLine[] {
  return events.flatMap((e) => formatEvent(e, n));
}

/** Накопитель строк журнала. Ограничен по длине: бой на 30 ходов иначе распухает. */
export class CombatLog {
  private readonly lines: LogLine[] = [];
  constructor(private readonly limit = 2000) {}

  push(events: readonly BattleEvent[], n: LogNames): LogLine[] {
    const added = formatEvents(events, n);
    for (const entry of added) {
      this.lines.push(entry);
      if (this.lines.length > this.limit) this.lines.shift();
    }
    return added;
  }

  get all(): readonly LogLine[] {
    return this.lines;
  }

  tail(count: number): LogLine[] {
    return this.lines.slice(Math.max(0, this.lines.length - count));
  }

  clear(): void {
    this.lines.length = 0;
  }
}
