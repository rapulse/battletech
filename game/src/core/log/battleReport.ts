import type { BattleEvent } from '../commands/types.js';
import { ZONE_IDS } from '../model/HitZone.js';
import { skillLevel, type SkillId } from '../model/Pilot.js';
import type { MechUnit } from '../model/MechUnit.js';
import { SKILL_IDS, weapon } from '../data/tables.js';
import { formatEvents, lineText, type LogNames } from './combatLog.js';
import { phraseText } from './phrase.js';
import { tr } from './dictionary.js';

/**
 * Отчёт о бое, который можно выгрузить (шаг 29).
 *
 * **Прибор, а не оформление.** Ни одно правило здесь не считается заново: всё,
 * что нужно, уже лежит в событиях боя — целевое число, разбор слагаемых, база,
 * перебор потолка и выпавший бросок. Модуль только сводит это в два вида:
 * текст для чтения глазами и JSON для `tools/`.
 *
 * Появился он потому, что жалобу «три машины сделали двадцать выстрелов и ни
 * разу не попали» невозможно было ни подтвердить, ни опровергнуть: наружу
 * уходил исход, а не то, из чего он сложился. Четыре числа сводки
 * (`ShotStats`) — та линейка, по которой шаг 30 меряет правку боевой
 * математики.
 */

export interface ShotStats {
  readonly shots: number;
  readonly hits: number;
  /** Попаданий на выстрел. */
  readonly hitRate: number;
  /** Среднее целевое число по всем выстрелам. */
  readonly avgTarget: number;
  /** Доля выстрелов, где целевое число 11 или 12, — то есть шанс почти нулевой. */
  readonly hardShare: number;
  /** Доля выстрелов, где обстановка упёрлась в свой потолок (`maxSituational`). */
  readonly situationalCapShare: number;
  /** Доля выстрелов, вышедших за край шкалы 2d6. Обязана быть близкой к нулю. */
  readonly cappedShare: number;
  /** Средний срезанный перебор по тем выстрелам, где он был. */
  readonly avgOverflow: number;
}

export interface BattleReport {
  readonly stats: ShotStats;
  /** Сколько раз бросали на равновесие и сколько раз не удержались. */
  readonly piloting: { readonly checks: number; readonly falls: number };
  readonly lines: readonly string[];
}

/**
 * Что нужно знать, чтобы бой можно было ВОСПРОИЗВЕСТИ, а не только прочитать.
 *
 * Сиды здесь обязательны и лежат первыми: без них отчёт отвечает на вопрос
 * «что случилось», но не на вопрос «покажи мне это ещё раз». Карта и бой
 * сидируются раздельно (`sim/scenario.ts`), поэтому и в отчёте их два.
 */
export interface BattleMeta {
  readonly mapSeed: number;
  readonly battleSeed: number;
  readonly biome?: string | undefined;
  readonly mapSize?: string | undefined;
  /** Состав сторон НА НАЧАЛО боя: с чем машина вышла, а не с чем осталась. */
  readonly roster: readonly MechUnit[];
}

/**
 * Оборудование машины по зонам: охладители, прыжковые ускорители, приборы,
 * пачки боезапаса.
 *
 * Берётся из РАСКЛАДКИ СЛОТОВ, а не из отдельного списка: раскладка — то, по
 * чему бьют криты, и именно она отвечает на вопрос «что стояло в оторванной
 * руке». Многослотовые узлы лежат в раскладке несколькими одинаковыми ячейками
 * подряд и схлопываются здесь в одну запись.
 */
const CARRIED_SLOT_KINDS: ReadonlySet<string> = new Set([
  'ammo',
  'heatsink',
  'jump_jet',
  'equipment',
]);

function equipmentOf(u: MechUnit): { id: string; zone: string; kind: string }[] {
  const out: { id: string; zone: string; kind: string }[] = [];
  u.slots.forEach((zoneSlots, z) => {
    const zone = ZONE_IDS[z] ?? String(z);
    let prev: string | undefined;
    for (const slot of zoneSlots) {
      // Несъёмное — кокпит, сенсоры, реактор, гироскоп, приводы — не
      // оборудование, а сама машина. В отчёте оно только зашумляет список: его
      // нельзя ни снять, ни поставить, и вопросов оно не вызывает.
      if (slot.id === undefined || !CARRIED_SLOT_KINDS.has(slot.kind)) {
        prev = undefined;
        continue;
      }
      if (slot.id !== prev) out.push({ id: slot.id, zone, kind: slot.kind });
      prev = slot.id;
    }
  });
  return out;
}

/** Снимок машины на начало боя: чем вооружена, чем укомплектована, кто в кабине. */
function unitSnapshot(u: MechUnit): Record<string, unknown> {
  const skills: Record<string, number> = {};
  for (const id of SKILL_IDS) skills[id] = skillLevel(u.pilot, id as SkillId);

  const equipment = equipmentOf(u);

  return {
    id: u.id,
    side: u.side,
    chassis: u.chassis,
    weight_class: u.weightClass,
    walk_mp: u.walkMP,
    pilot: { callsign: u.pilot.callsign, id: u.pilot.id, skills, injuries: u.pilot.injuries },
    start_hex: { q: u.hex.q, r: u.hex.r },
    heat_dissipation_note: phraseText('report.heatNote'),
    weapons: u.mounts.map((m) => {
      const w = weapon(m.weapon);
      return {
        id: m.weapon,
        name: tr(w.key),
        zone: ZONE_IDS[m.zone] ?? String(m.zone),
        ammo: m.ammo,
        damage: w.damage,
        heat: w.heat,
        range: { short: w.short, medium: w.medium, long: w.long },
      };
    }),
    equipment,
    zones: u.zones.map((z, i) => ({
      zone: ZONE_IDS[i] ?? String(i),
      armor: z.armor,
      structure: z.structure,
    })),
  };
}

const EMPTY: ShotStats = {
  shots: 0,
  hits: 0,
  hitRate: 0,
  avgTarget: 0,
  hardShare: 0,
  situationalCapShare: 0,
  cappedShare: 0,
  avgOverflow: 0,
};

function ratio(part: number, whole: number): number {
  return whole === 0 ? 0 : Math.round((part / whole) * 1000) / 1000;
}

/** Четыре числа, по которым меряется боевая математика. */
export function shotStats(events: readonly BattleEvent[]): ShotStats {
  const shots = events.filter((e) => e.kind === 'shot');
  if (shots.length === 0) return EMPTY;

  let hits = 0;
  let targetSum = 0;
  let hard = 0;
  let situationalCapped = 0;
  let capped = 0;
  let overflowSum = 0;

  for (const s of shots) {
    if (s.hit) hits += 1;
    targetSum += s.toHitTarget;
    if (s.toHitTarget >= 11) hard += 1;
    if (s.toHitSituationalCut > 0) situationalCapped += 1;
    if (s.toHitOverflow > 0) {
      capped += 1;
      overflowSum += s.toHitOverflow;
    }
  }

  return {
    shots: shots.length,
    hits,
    hitRate: ratio(hits, shots.length),
    avgTarget: Math.round((targetSum / shots.length) * 100) / 100,
    hardShare: ratio(hard, shots.length),
    situationalCapShare: ratio(situationalCapped, shots.length),
    cappedShare: ratio(capped, shots.length),
    avgOverflow: capped === 0 ? 0 : Math.round((overflowSum / capped) * 100) / 100,
  };
}

function pilotingStats(events: readonly BattleEvent[]): { checks: number; falls: number } {
  let checks = 0;
  let falls = 0;
  for (const e of events) {
    if (e.kind === 'pilotingCheck') {
      checks += 1;
      if (!e.passed) falls += 1;
    }
  }
  return { checks, falls };
}

export function buildReport(events: readonly BattleEvent[], names: LogNames): BattleReport {
  return {
    stats: shotStats(events),
    piloting: pilotingStats(events),
    lines: formatEvents(events, names).map(lineText),
  };
}

/** Шапка текстового отчёта: сиды и состав сторон. */
function headerLines(meta: BattleMeta): string[] {
  const out = [
    phraseText('report.header'),
    phraseText('report.seeds', { map: meta.mapSeed, battle: meta.battleSeed }) +
      (meta.biome === undefined ? '' : phraseText('report.biome', { biome: meta.biome })) +
      (meta.mapSize === undefined ? '' : phraseText('report.mapSize', { size: meta.mapSize })),
    '',
    phraseText('report.roster'),
  ];
  for (const u of meta.roster) {
    const armor = u.zones.reduce((n, z) => n + z.armor, 0);
    const structure = u.zones.reduce((n, z) => n + z.structure, 0);
    out.push(
      phraseText('report.unit', { id: u.id, side: u.side, chassis: u.chassis, walk: u.walkMP, armor, structure }),
    );
    out.push(
      phraseText('report.pilot', {
        callsign: u.pilot.callsign,
        skills: SKILL_IDS.map((id) => `${tr(`skill.${id}`)} ${skillLevel(u.pilot, id as SkillId)}`).join(', '),
      }),
    );
    for (const m of u.mounts) {
      const w = weapon(m.weapon);
      out.push(
        phraseText('report.weapon', {
          weapon: tr(w.key),
          zone: tr(`zone.${ZONE_IDS[m.zone] ?? ''}`),
          damage: w.damage,
          heat: w.heat,
          short: w.short,
          medium: w.medium,
          long: w.long,
          ammo: m.ammo === null ? '' : phraseText('report.weaponAmmo', { n: m.ammo }),
        }),
      );
    }
    // Оборудование отдельным списком: охладители, прыжковые ускорители, ЭПП,
    // пачки боезапаса. Без него не ответить на вопрос «почему эта машина
    // грелась», а он в разборе боя возникает чаще всего.
    const gear = equipmentOf(u);
    if (gear.length > 0) {
      const byZone = gear.map((g) => `${tr(`equipment.${g.id}`)} (${tr(`zone.${g.zone}`)})`);
      out.push(phraseText('report.equipment', { items: byZone.join(', ') }));
    }
  }
  out.push('');
  out.push(phraseText('report.battle'));
  return out;
}

/** Текстовая выгрузка: шапка, журнал построчно, сводка в конце. */
export function reportToText(report: BattleReport, meta?: BattleMeta): string {
  const s = report.stats;
  const pct = (x: number): string => `${Math.round(x * 100)} %`;
  const summary = [
    '',
    phraseText('report.summary'),
    phraseText('report.shots', { shots: s.shots, hits: s.hits, rate: pct(s.hitRate) }),
    phraseText('report.avgTarget', { n: s.avgTarget }),
    phraseText('report.hardShare', { n: pct(s.hardShare) }),
    phraseText('report.situational', { n: pct(s.situationalCapShare) }),
    phraseText('report.capped', { n: pct(s.cappedShare) }) +
      (s.cappedShare > 0 ? phraseText('report.cappedAvg', { n: s.avgOverflow }) : ''),
    phraseText('report.piloting', { checks: report.piloting.checks, falls: report.piloting.falls }),
  ];
  const head = meta === undefined ? [] : headerLines(meta);
  return [...head, ...report.lines, ...summary].join('\n');
}

/**
 * Машиночитаемая выгрузка.
 *
 * Каждый выстрел развёрнут по слагаемым с уже переведёнными названиями: файл
 * читают и офлайн-инструменты `tools/`, и человек, а второй словарь заводить
 * ради этого незачем.
 */
export function reportToJson(
  events: readonly BattleEvent[],
  names: LogNames,
  meta?: BattleMeta,
): Record<string, unknown> {
  const shots = events
    .filter((e) => e.kind === 'shot')
    .map((s) => ({
      attacker: names.unit(s.unitId),
      target: names.unit(s.targetId),
      weapon: s.weapon,
      range: s.range,
      base: s.toHitBase,
      factors: s.factors.map((f) => ({ key: f.key, label: tr(f.key), amount: f.amount })),
      raw: s.toHitBase + s.factors.reduce((a, f) => a + f.amount, 0),
      target_number: s.toHitTarget,
      situational_cut: s.toHitSituationalCut,
      overflow: s.toHitOverflow,
      roll: s.roll,
      intent_hit: s.intentHit,
      poise_saved: s.poiseSaved,
      botched: s.botched,
      hit: s.hit,
    }));

  const report = buildReport(events, names);
  return {
    // Сиды первыми: с ними отчёт воспроизводим, без них — только читаем.
    seeds: meta === undefined ? null : { map: meta.mapSeed, battle: meta.battleSeed },
    map: meta === undefined ? null : { biome: meta.biome ?? null, size: meta.mapSize ?? null },
    roster: meta === undefined ? null : meta.roster.map(unitSnapshot),
    stats: report.stats,
    piloting: report.piloting,
    shots,
    // Все события боя, а не только выстрелы: как ходил, что взорвалось, кто
    // упал. Выстрелы продублированы выше развёрнуто — так их читают глазами,
    // не листая весь бой.
    events: events.map((e) => ({ ...e })),
  };
}
