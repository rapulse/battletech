import { ECONOMY } from '../data/index.js';
import type { ZoneCondition } from './mech/MechRecord.js';
import type { ScheduledTask } from './clock.js';
import type { Company, WarehouseEntry } from './company/types.js';
import type { ActiveContract } from './contracts/active.js';
import type { GalaxyDeltas } from './galaxy/index.js';
import type { ReputationState } from './reputation/index.js';
import type { RivalsState } from './rivals/types.js';
import type { WarState } from './war/index.js';
import type { CampaignState } from './state.js';
import { realmIsDefault } from './realm/sectors.js';
import type { MechRecord } from './mech/MechRecord.js';
import type { Pilot } from '../model/Pilot.js';
import type { MechAssembly } from '../rules/construction.js';

/**
 * Хэш состояния кампании — зеркало `core/model/hash.ts`.
 *
 * Смысл тот же: golden-replay хранит сид, журнал команд и этот хэш. Уехало
 * правило — тест показывает это сразу, а не через месяц через «кампания стала
 * какой-то другой».
 *
 * Строка строится в явном, отсортированном порядке. Полагаться на порядок
 * обхода объектов нельзя (game_core.md §4.7), а очередь задач уже отсортирована
 * по `(day, seq)` самой вставкой.
 */
function cyrb32(text: string): number {
  let h = 0x9e3779b9;
  for (let i = 0; i < text.length; i++) {
    h = Math.imul(h ^ text.charCodeAt(i), 0x85ebca6b);
    h ^= h >>> 13;
  }
  h = Math.imul(h ^ (h >>> 16), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/** Каноническая строка состояния. Читаема глазами — при расхождении видно, что уехало. */
export function serializeCampaignState(state: CampaignState): string {
  const parts: string[] = [
    `rules=${state.rulesVersion}`,
    `seed=${state.seed}`,
    `day=${state.day}`,
    `company=${state.companyName}`,
    `nextSeq=${state.nextSeq}`,
    `world=${state.worldSeed}`,
    `system=${state.systemId}`,
    `travel=${serializeTravel(state)}`,
    `contract=${serializeContract(state.contract)}`,
    // Найм входит в хэш обеими половинами: уплаченный поиск с кандидатом на
    // руках — такое же состояние, как незавершённая работа цеха. Снимок,
    // потерявший кандидата, молча возвращал бы деньги.
    `hireReady=${state.hireReadyDay}`,
    `recruit=${state.recruit === null ? '—' : serializePilot(state.recruit)}`,
  ];
  // Режим (шаг 74) — только у песочницы: иначе хэш каждой стандартной кампании
  // сменился бы, а с ним — эталоны тестов и замеры против main.
  if (state.mode !== 'standard') parts.push(`mode=${state.mode}`);

  const rng = state.rng.getState();
  for (const name of Object.keys(rng).sort()) {
    parts.push(`rng.${name}=${rng[name as keyof typeof rng]}`);
  }

  // Очередь входит в хэш целиком и намеренно: незавершённые работы — такая же
  // часть состояния, как деньги. Сохранение, потерявшее «ремонт закончится
  // через три дня», молча отменяет оплаченную работу.
  for (const ev of state.queue) {
    parts.push(`task=${ev.day}:${ev.seq}:${ev.task.kind}:${taskDetail(ev.task)}`);
  }

  serializeCompany(state.company).forEach((line) => parts.push(line));
  serializeDeltas(state.deltas).forEach((line) => parts.push(line));
  serializeReputation(state.reputation).forEach((line) => parts.push(line));
  serializeWar(state.war).forEach((line) => parts.push(line));
  serializeRivals(state.rivals).forEach((line) => parts.push(line));
  // Достижения (шаг 69) — только когда есть что писать: иначе хэш каждой
  // кампании без единого значка сменился бы, а с ним — эталоны тестов.
  const ach = state.achievements;
  if (ach.unlocked.length > 0 || ach.kills > 0) {
    parts.push(`achievements=${ach.unlocked.map((e) => `${e.id}@${e.day}`).join(',')};kills=${ach.kills}`);
  }
  // Гарнизон (шаг 86b) — только когда он есть, по той же причине, что достижения.
  for (const id of Object.keys(state.garrison.posts).sort()) {
    const p = state.garrison.posts[id] as { systemId: string; arrives: number; depot?: true };
    parts.push(`garrison=${id}@${p.systemId}:${p.arrives}${p.depot === true ? ':depot' : ''}`);
  }
  if (state.garrison.withdraw.length > 0) parts.push(`garrisonWithdraw=${state.garrison.withdraw.join(',')}`);
  // Управление державой (шаг 88) — только когда отличается от начального, по той же причине.
  const realm = state.realm;
  if (!realmIsDefault(realm)) {
    const sectors = realm.sectors.map((x) => `${x.center}:${x.governor ?? '-'}:${x.priority}`).join(',');
    const stances = Object.keys(realm.stances)
      .sort()
      .map((f) => `${f}:${realm.stances[f]}`)
      .join(',');
    parts.push(`realm=${sectors};pinned=${realm.pinned.join(',')};reserve=${realm.reserve};stances=${stances}`);
    // Шаг 93 — отдельными строками и только когда есть: держава без них хэширует как прежде.
    const pairs = (r: Readonly<Record<string, string>> | undefined): string =>
      Object.keys(r ?? {})
        .sort()
        .map((k) => `${k}:${(r as Record<string, string>)[k]}`)
        .join(',');
    if (realm.assigned !== undefined) parts.push(`realmAssigned=${pairs(realm.assigned)}`);
    if (realm.targets !== undefined) parts.push(`realmTargets=${pairs(realm.targets)}`);
  }

  return parts.join('\n');
}

/** Маршрут входит в хэш целиком: рота на полпути и рота на стоянке — разные состояния. */
function serializeTravel(state: CampaignState): string {
  const t = state.travel;
  return t === null ? '' : `${t.path.join('>')}:${t.legIndex}:${t.startDay}:${t.arrivalDay}:${t.cost}`;
}

/**
 * Взятый контракт входит в хэш целиком, включая состав вылета.
 *
 * Не «есть контракт / нет контракта»: подписанные условия — такая же часть
 * состояния, как деньги, а сид вылета решает, кто выйдет против роты. Снимок,
 * потерявший сид, отдал бы при загрузке другой бой.
 */
function serializeContract(active: ActiveContract | null): string {
  if (active === null) return '';
  const c = active.contract;
  const sortie =
    active.sortie === null ? '' : `${active.sortie.recordIds.join('.')}@${active.sortie.battleSeed}/${active.sortie.mapSeed}`;
  return [
    c.id,
    c.systemId,
    c.employer,
    c.target,
    c.mission,
    c.opforType,
    c.opforTechBase,
    c.strength,
    c.supply,
    c.tension,
    c.biome,
    c.payout,
    c.penalty,
    c.salvageShare,
    active.takenDay,
    active.deadlineDay,
    active.advancePaid,
    sortie,
    // Только когда отметка есть: иначе хэш каждого обычного контракта сменился
    // бы на лишний разделитель, а с ним — эталоны тестов и сверка сохранений.
    ...(c.atonement === true ? ['atonement'] : []),
    ...(c.revolt === true ? ['revolt'] : []),
    ...(c.homeRaid === true ? ['homeRaid'] : []),
    ...(c.warWork === true ? ['warWork'] : []),
    ...(c.allies === undefined
      ? []
      : [`allies=${c.allies.units}/${c.allies.opforType}/${c.allies.techBase}/${c.allies.supply}/${c.allies.share}`]),
    ...(c.fortified === undefined
      ? []
      : [`fort=${c.fortified.targets.join('+')}/${c.fortified.bunkers.map((b) => b.join('+')).join(',')}`]),
  ].join(':');
}

/**
 * Дельты систем. Ключи сортируются явно: разрежённая карта — обычный объект, а
 * на порядок его обхода полагаться нельзя (game_core.md §4.7).
 */
function serializeDeltas(deltas: GalaxyDeltas): string[] {
  return Object.keys(deltas)
    .sort()
    .map((id) => {
      const d = deltas[id] as NonNullable<GalaxyDeltas[string]>;
      const bought = d.bought === undefined ? '' : [...d.bought].sort().join('.');
      const taken = d.taken === undefined ? '' : [...d.taken].sort().join('.');
      // Фокус мира (шаг 25) и дань (шаг 26) дописаны В КОНЕЦ строки, а не
      // вставлены по смыслу: порядок полей здесь — часть хэша, и перестановка
      // сделала бы другими все сохранённые кампании сразу. То же правило, что у
      // порядка бросков в тикере.
      const focus = `${d.focus ?? ''}.${d.focusTo ?? ''}.${d.focusUntil ?? ''}`;
      const tribute = `${d.tribute ?? ''}.${d.tributeUntil ?? ''}`;
      return `delta.${id}=${d.owner ?? ''}/${d.ruined ?? ''}/${d.surveyed === true ? 1 : 0}/${d.visited === true ? 1 : 0}/${d.boughtDecade ?? ''}/${bought}/${d.takenDecade ?? ''}/${taken}/${d.development ?? ''}/${focus}/${tribute}${d.realmCapitalSince === undefined ? '' : `/capital${d.realmCapitalSince}`}${d.realmCapital === true ? '/capitalMark' : ''}${d.abandonedUntil === undefined ? '' : `/abandoned${d.abandonedUntil}`}${d.loyalty === undefined ? '' : `/loyal${d.loyalty}.${d.formerOwner ?? ''}.${d.revoltSince ?? ''}`}${d.buildings === undefined ? '' : `/built${d.buildings.join('.')}`}${d.building === undefined ? '' : `/building${d.building}.${d.buildProgress ?? 0}`}${d.raidedUntil === undefined ? '' : `/raided${d.raidedUntil}`}${d.tributeShare === undefined ? '' : `/tshare${d.tributeShare}`}${d.realmWon === undefined ? '' : `/realmWon${d.realmWon}`}`;
    });
}

/**
 * Репутация (шаг 20). Обе карты разрежённые, ключи сортируются явно — тем же
 * правилом, что и дельты: полагаться на порядок обхода объекта нельзя
 * (game_core.md §4.7).
 *
 * Оси пишутся с двумя знаками, ровно так, как они и хранятся (`roundAxis`):
 * иначе одно и то же состояние давало бы разные строки в зависимости от того,
 * пришло оно из свежей кампании или из JSON сохранения.
 */
function serializeReputation(rep: ReputationState): string[] {
  const parts = [`fame=${rep.fame.toFixed(2)}`, `reliability=${rep.reliability.toFixed(2)}`];
  for (const id of Object.keys(rep.standing).sort()) {
    parts.push(`standing.${id}=${(rep.standing[id] as number).toFixed(2)}`);
  }
  for (const key of Object.keys(rep.relations).sort()) {
    parts.push(`relation.${key}=${(rep.relations[key] as number).toFixed(3)}`);
  }
  return parts;
}

/**
 * Экономика фракций (шаг 21a). Ключи сортируются явно на обоих уровнях — тем же
 * правилом, что дельты и репутация: полагаться на порядок обхода объекта нельзя
 * (game_core.md §4.7).
 *
 * Экономика пишется по ВСЕМ фракциям карты, а фонд — только по заведённым
 * направлениям: первая карта плотная, вторая разрежённая, и хэш обязан отражать
 * ровно это. Направление пишется как `откуда>против кого`, стрелкой, а не
 * чертой пары: `relation.a|b` рядом в той же строке описывает пару целиком, и
 * два разных понятия не должны выглядеть одинаково.
 */
function serializeWar(war: WarState): string[] {
  const parts: string[] = [];
  for (const id of Object.keys(war.economy).sort()) {
    const e = war.economy[id] as WarState['economy'][string];
    parts.push(`economy.${id}=${e.treasury}/${e.income}/${e.upkeep}/${e.worlds}/${e.army}`);
  }
  for (const from of Object.keys(war.funds).sort()) {
    const row = war.funds[from] as Readonly<Record<string, number>>;
    for (const against of Object.keys(row).sort()) {
      parts.push(`fund.${from}>${against}=${row[against]}`);
    }
  }
  // Замысел государства (шаг 23, часть B). Входит в хэш целиком: две кампании,
  // одинаковые всем прочим, но с разными направлениями главного удара, — это
  // два РАЗНЫХ состояния, и следующая же декада разведёт их на карте.
  for (const id of Object.keys(war.plans).sort()) {
    const p = war.plans[id] as NonNullable<WarState['plans'][string]>;
    parts.push(`plan.${id}=${p.against}/${p.target}/${p.fromDay}/${p.untilDay}/${p.taken}`);
  }
  // Подчинение (шаг 26). Входит в хэш по той же причине, что замысел: две
  // кампании, одинаковые всем прочим, но с разными вассалами и договорами, —
  // это два РАЗНЫХ состояния, и следующая же декада разведёт их на карте, потому
  // что протекторат снимает участки фронта.
  for (const id of Object.keys(war.vassals).sort()) {
    const v = war.vassals[id] as NonNullable<WarState['vassals'][string]>;
    parts.push(`vassal.${id}=${v.suzerain}/${v.sinceDay}`);
  }
  for (const pair of Object.keys(war.pacts).sort()) {
    const p = war.pacts[pair] as NonNullable<WarState['pacts'][string]>;
    parts.push(`pact.${pair}=${p.kind}/${p.untilDay}`);
  }
  // Войны роты (шаг 76) — только когда есть: бот замера державы не заводит, и
  // его хэш остаётся прежним.
  for (const id of Object.keys(war.playerWars ?? {}).sort()) {
    const w = war.playerWars?.[id] as NonNullable<WarState['playerWars']>[string];
    // Шаг 81: цель, усталость и взятое тоже решают будущее — мир по ним выдаёт и отдаёт миры.
    const goal = w.goal === undefined ? '' : w.goal.kind === 'humiliation' ? 'humiliation' : `${w.goal.kind}:${w.goal.systems.join(',')}`;
    parts.push(
      `playerWar.${id}=${w.since}/${w.won}/${w.lost}/${w.offerUntil ?? ''}` +
        `/${goal}/${w.byRealm === true ? 1 : ''}/${w.fatigue ?? ''}/${w.foeFatigue ?? ''}/${(w.taken ?? []).join(',')}` +
        // Шаг 83: цель фракции — только когда есть, чтобы хэш старых войн не сдвинулся.
        (w.foeGoal === undefined ? '' : `/foe:${w.foeGoal.join(',')}`),
    );
  }
  // Память захватов (шаг 83): из неё угроза и перемирие второго фронта — она решает будущее карты.
  for (const pair of Object.keys(war.conquests).sort()) parts.push(`conquest.${pair}=${war.conquests[pair]}`);
  // События мира (шаг 84): сработавшее не сработает снова, а снятое перемирие Тукайида открывает фронт.
  for (const id of Object.keys(war.events).sort()) {
    const e = war.events[id] as WarState['events'][string];
    const invite = e.invite === undefined ? '' : `/${e.invite.against}:${e.invite.allies.join(',')}`;
    parts.push(`event.${id}=${e.day}/${e.pending ? 1 : 0}/${e.realm ? 1 : 0}${invite}`);
  }
  parts.push(`truceLifted=${war.truceLifted.join(',')}`);
  // Требования соседей (шаг 89) — только когда были: без них хэш тот же, что до шага.
  if (war.demands !== undefined) {
    const p = war.demands.pending;
    parts.push(`demand.pending=${p === undefined ? '' : `${p.from}/${p.systemId}/${p.day}`}`);
    for (const f of Object.keys(war.demands.last).sort()) parts.push(`demand.last.${f}=${war.demands.last[f]}`);
    const quiet = war.demands.quiet ?? {};
    for (const f of Object.keys(quiet).sort()) parts.push(`demand.quiet.${f}=${quiet[f]}`);
  }
  return parts;
}

/**
 * Отряды-соперники (шаг 22).
 *
 * Каждый пишется ТЕМ ЖЕ `serializeCompany`, что и рота игрока, с префиксом id
 * отряда — и это та же проверка, что и в схеме снимка: понадобилась бы вторая
 * сериализация, значит, соперник не та же структура данных, что рота.
 *
 * Список идёт в порядке хранения, а не отсортированный: порядок в нём ЗНАЧИМ —
 * им идёт такт, и соперник, походивший вторым, взял ту работу, которую не взял
 * первый. Порядок, потерянный при загрузке, увёл бы кампанию по другой ветке.
 */
function serializeRivals(rivals: RivalsState): string[] {
  const parts = [
    `rivals.before=${rivals.playerRatingBefore.toFixed(2)}`,
    `rivals.bankrupt=${rivals.bankrupt}`,
    `rivals.formed=${rivals.formed}`,
    `rivals.nextId=${rivals.nextId}`,
  ];
  for (const r of rivals.list) {
    parts.push(
      `rival.${r.id}=${r.name}/${r.unitId}/${r.emblem}/${r.tier}/${r.registered ? 1 : 0}/${r.systemId}/${r.contracts}/${r.wins}/${r.ratingBefore.toFixed(2)}`,
    );
    for (const line of serializeCompany(r.company)) parts.push(`rival.${r.id}.${line}`);
    for (const line of serializeReputation(r.reputation)) parts.push(`rival.${r.id}.${line}`);
  }
  // Полки — агрегатом, ровно теми полями, которые двигает такт: состав, место и
  // счёт. Списка машин у них нет и в снимке (`rivals/types.ts::Regiment`).
  for (const r of rivals.regiments) {
    parts.push(
      `regiment.${r.id}=${r.mechs}/${r.fullMechs}/${r.cbills}/${r.quality}/${r.tons}/${r.skill}/${r.systemId}/${r.employer}/${r.contracts}/${r.wins}/${r.ratingBefore.toFixed(2)}`,
    );
    // Наём державой (шаг 89) — только когда есть: без найма строка та же, что до шага.
    if (r.hire !== undefined) parts.push(`regiment.${r.id}.hire=${r.hire.against}/${r.hire.until}`);
  }
  return parts;
}

function serializeZone(z: ZoneCondition): string {
  return `${z.armor}/${z.structure}/${z.destroyed ? 1 : 0}`;
}

/**
 * Навеска и броня сборки (шаг 19a).
 *
 * До мехлаба сборка машины не менялась НИКОГДА: она задавалась при основании
 * роты или приходила трофеем и дальше была неизменной, поэтому в хэш хватало
 * шасси с классом. Переоснащение меняет её каждым вызовом, и снимок, не
 * различающий две одинаковые машины с разными стволами, перестал бы ловить
 * ровно то, ради чего хэш заведён.
 *
 * Позиции сортируются: порядок `items` внутри сборки — как их набрал редактор,
 * и он ничего не значит.
 */
function serializeAssembly(a: MechAssembly): string {
  const items = a.items
    .map((it) => `${it.id}@${it.zone}`)
    .sort()
    .join('.');
  return `${a.armorTons}/${items}`;
}

function serializeMech(m: MechRecord): string {
  const q = m.assembly.quality;
  return [
    `mech.${m.id}=`,
    `chassis=${m.assembly.chassisCode}`,
    `outfit=${serializeAssembly(m.assembly)}`,
    `quality=${q?.reactor ?? ''}/${q?.frame ?? ''}`,
    `wear=${m.wear.reactor}/${m.wear.frame}`,
    `zones=${m.condition.zones.map(serializeZone).join(',')}`,
    `slots=${m.condition.destroyedSlots.map((s) => s.join('.')).join(',')}`,
    `ammo=${m.condition.ammo.join(',')}`,
    `mounts=${m.condition.destroyedMounts.map((d) => (d ? 1 : 0)).join(',')}`,
    `pilot=${m.pilotId ?? ''}`,
    `battles=${m.battles}`,
  ].join(';');
}

function serializePilot(p: Pilot): string {
  const skills = Object.keys(p.skills)
    .sort()
    .map((k) => `${k}:${p.skills[k]}/${p.xp[k] ?? 0}`)
    .join(',');
  return (
    `pilot.${p.id}=status=${p.status};injuries=${p.injuries};` +
    `who=${p.affiliation}/${p.gender}/${p.face};skills=${skills}`
  );
}

/** Склад двух сортов (шаг 15): узел с классом, износом и тиром либо целая установка. */
function serializePart(w: WarehouseEntry): string {
  return w.sort === 'node'
    ? `part.${w.id}=node/${w.node}/${w.quality}/${w.wear}/${w.sourceTonnage}/${w.tier}`
    : `part.${w.id}=item/${w.kind}/${w.itemId}`;
}

/** Часть состояния, добавленная шагом 13 (`company/types.ts`): деньги, парк, пилоты, склад. */
function serializeCompany(c: Company): string[] {
  const parts = [
    `cbills=${c.cbills}`,
    `bays=${c.bays}`,
    `bankrupt=${c.bankrupt ? 1 : 0}/${c.bankruptDay ?? ''}`,
  ];
  // Долг песочницы (шаг 74) — только когда он есть, по той же причине, что режим.
  if (c.sandboxDebt !== undefined) parts.push(`sandboxDebt=${c.sandboxDebt}`);
  // Ангар (шаг 75) — только выкупленный сверх минимума корабля: рота, не
  // купившая ни одной ячейки, хэшируется как до шага, и замер против main
  // сверяется побитово.
  if (c.hangar !== ECONOMY.dropships[c.dropship].minMechs) parts.push(`hangar=${c.hangar}`);
  for (const m of [...c.mechs].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    parts.push(serializeMech(m));
  }
  for (const p of [...c.pilots].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    parts.push(serializePilot(p));
  }
  for (const w of [...c.warehouse].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    parts.push(serializePart(w));
  }
  return parts;
}

function taskDetail(task: ScheduledTask): string {
  switch (task.kind) {
    case 'debug':
      return task.label;
    case 'payroll':
      return '';
    case 'medbayDone':
      return task.pilotId;
    case 'restTick':
      return '';
    case 'repairJob':
      return [
        task.jobId,
        task.recordId,
        task.work,
        task.zone ?? '',
        task.node ?? '',
        task.targetClass ?? '',
        task.partId ?? '',
        // Переоснащение (шаг 19a): в хэш входит ЦЕЛЕВАЯ сборка и занятые
        // складские записи. Работа, потерявшая при загрузке половину списка,
        // выпустила бы из цеха другую машину.
        task.assembly === undefined ? '' : serializeAssembly(task.assembly),
        (task.partIds ?? []).join('.'),
        task.cost,
        // Перекраска (шаг 50): раскраска входит в хэш, только когда задана. У
        // остальных работ строка задачи не меняется, и эталонные хэши не едут.
        ...(task.paint === undefined ? [] : [task.paint]),
        // Цех мира (шаг 87) — тем же приёмом: только когда работа в цехе.
        ...(task.workshop === undefined ? [] : [`workshop:${task.workshop}`]),
      ].join(':');
    case 'travelLeg':
      return String(task.leg);
    case 'surveyDone':
      return task.systemId;
    case 'deliveryArrived':
      return `${task.orderId}:${serializePart(task.part)}`;
    case 'contractExpired':
      return task.contractId;
    case 'baysUpgraded':
    case 'hangarUpgraded':
      return String(task.to);
    case 'decayTick':
      return '';
    case 'economyTick':
      return '';
    case 'frontTick':
      return '';
    case 'developmentTick':
    case 'eventTick':
    case 'rivalTick':
      return '';
  }
}

export function hashCampaignState(state: CampaignState): string {
  return cyrb32(serializeCampaignState(state)).toString(16).padStart(8, '0');
}
