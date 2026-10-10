import type { AchievementsState } from './achievements/index.js';
import type { GarrisonState } from './company/garrison.js';
import type { RealmState } from './realm/sectors.js';
import type { ScheduledEvent } from './clock.js';
import type { Company } from './company/types.js';
import type { ActiveContract } from './contracts/active.js';
import type { GalaxyDeltas } from './galaxy/index.js';
import type { Pilot } from '../model/Pilot.js';
import type { ReputationState } from './reputation/index.js';
import type { Rival, RivalsState } from './rivals/types.js';
import type { WarState } from './war/index.js';
import type { CampaignRngState } from './rng.js';
import { CampaignState, type CampaignMode, type TravelState } from './state.js';

/**
 * Снимок кампании (game_core.md §8).
 *
 * **Сохранение — снимок состояния, а не журнал команд.** Реплей (сид + журнал)
 * живёт отдельно и действителен только для той версии правил, при которой
 * записан.
 *
 * Снимок — простой объект без классов и без методов: он должен ложиться в JSON
 * и подниматься обратно без потерь. Состояние ГПСЧ входит в него обязательно,
 * иначе загруженная кампания продолжит бросать кубики с начала
 * последовательности, и сохранение станет способом переиграть неудачный бросок.
 */
export interface CampaignSnapshot {
  readonly rulesVersion: number;
  readonly seed: number;
  readonly day: number;
  readonly companyName: string;
  /** Режим кампании (шаг 74). */
  readonly mode: CampaignMode;
  readonly nextSeq: number;
  readonly queue: readonly ScheduledEvent[];
  readonly rng: CampaignRngState;
  readonly company: Company;
  readonly worldSeed: number;
  readonly systemId: string;
  readonly travel: TravelState | null;
  /** Найм: день, с которого доступна попытка, и кандидат, ждущий решения (2026-09-10). */
  readonly hireReadyDay: number;
  readonly recruit: Pilot | null;
  /**
   * Взятый контракт целиком (шаг 16). Биржа в снимок НЕ попадает: она
   * выводится, как и ассортимент лавки, — в дельте системы лежит только факт
   * взятия. А вот подписанный контракт обязан пережить смену декады ровно тем,
   * чем был подписан, поэтому он и лежит здесь целиком.
   */
  readonly contract: ActiveContract | null;
  /**
   * Дельты систем — и ТОЛЬКО они. Ни каталога, ни профилей: каталог одинаков
   * для всех кампаний, профиль выводится (`galaxy/profile.ts`). Ровно поэтому
   * снимок не растёт вместе с галактикой, сколько бы в ней ни было систем.
   */
  readonly deltas: GalaxyDeltas;
  /**
   * Репутация отряда (шаг 20). Разрежённая по обеим картам: в снимок попадают
   * только фракции с ненулевым отношением и только пары, отличные от
   * выведенных из `data/galaxy/relations.json`. Плотная запись стоила бы 20
   * фракций и 190 пар в каждом сохранении с первого дня.
   */
  readonly reputation: ReputationState;
  /**
   * Экономика фракций (шаг 21a). Карта экономик ПЛОТНАЯ — двадцать акторов, у
   * каждого экономика есть всегда, — а военный фонд по направлениям разрежён по
   * обоим уровням: направление появляется, когда по нему начинают копить.
   *
   * Начальные суммы выводятся из карты, но в снимок всё равно ложатся: они уже
   * успели уехать от начальных к первому же сохранению, а пересчёт «с нуля» при
   * загрузке отменил бы всю прожитую кампанией историю войны.
   */
  readonly war: WarState;
  /**
   * Отряды-соперники (шаг 22). Список ПЛОТНЫЙ, в отличие от дельт, репутации и
   * военного фонда, и это не небрежность: соперников восемь, а не две тысячи, и
   * «отличается от начального» для них не определено — отряд, потерявший машину
   * в первом же бою, отличается от начального навсегда.
   *
   * Внутри лежит `Company` целиком — тот же объект, что у роты игрока. Ровно
   * поэтому схема снимка не заводит для соперника ни одного нового описания
   * машины, пилота или склада: она переиспользует `companySchema`.
   */
  readonly rivals: RivalsState;
  /** Достижения роты (шаг 69). */
  readonly achievements: AchievementsState;
  /** Гарнизоны миров из машин роты (шаг 86b). */
  readonly garrison: GarrisonState;
  /** Секторы, губернаторы, резерв, закреплённые миры и стойки фронтов (шаг 88). */
  readonly realm: RealmState;
}

export function snapshot(state: CampaignState): CampaignSnapshot {
  return {
    rulesVersion: state.rulesVersion,
    seed: state.seed,
    day: state.day,
    companyName: state.companyName,
    mode: state.mode,
    nextSeq: state.nextSeq,
    queue: state.queue.map((e) => ({ day: e.day, seq: e.seq, task: { ...e.task } })),
    rng: state.rng.getState(),
    company: state.company,
    worldSeed: state.worldSeed,
    systemId: state.systemId,
    travel: state.travel === null ? null : { ...state.travel, path: [...state.travel.path] },
    hireReadyDay: state.hireReadyDay,
    recruit: state.recruit,
    contract:
      state.contract === null
        ? null
        : {
            ...state.contract,
            contract: { ...state.contract.contract },
            sortie:
              state.contract.sortie === null
                ? null
                : { ...state.contract.sortie, recordIds: [...state.contract.sortie.recordIds] },
          },
    deltas: state.deltas,
    reputation: {
      ...state.reputation,
      standing: { ...state.reputation.standing },
      relations: { ...state.reputation.relations },
    },
    war: {
      economy: Object.fromEntries(
        Object.keys(state.war.economy).map((id) => [id, { ...state.war.economy[id] }]),
      ) as WarState['economy'],
      funds: Object.fromEntries(
        Object.keys(state.war.funds).map((from) => [from, { ...state.war.funds[from] }]),
      ) as WarState['funds'],
      theaters: Object.fromEntries(
        Object.keys(state.war.theaters).map((from) => [from, { ...state.war.theaters[from] }]),
      ) as WarState['theaters'],
      plans: Object.fromEntries(
        Object.keys(state.war.plans).map((id) => [id, { ...state.war.plans[id] }]),
      ) as WarState['plans'],
      vassals: Object.fromEntries(
        Object.keys(state.war.vassals).map((id) => [id, { ...state.war.vassals[id] }]),
      ) as WarState['vassals'],
      pacts: Object.fromEntries(
        Object.keys(state.war.pacts).map((pair) => [pair, { ...state.war.pacts[pair] }]),
      ) as WarState['pacts'],
      // Войны роты (шаг 76) — только когда есть: поле разрежённое и необязательное.
      ...(state.war.playerWars === undefined
        ? {}
        : {
            playerWars: Object.fromEntries(
              Object.keys(state.war.playerWars).map((id) => [id, { ...state.war.playerWars?.[id] }]),
            ) as NonNullable<WarState['playerWars']>,
          }),
      ...(state.war.realmWarShare === undefined ? {} : { realmWarShare: state.war.realmWarShare }),
      conquests: { ...state.war.conquests },
      events: Object.fromEntries(
        Object.keys(state.war.events).map((id) => {
          const e = state.war.events[id] as WarState['events'][string];
          return [id, e.invite === undefined ? { ...e } : { ...e, invite: { ...e.invite, allies: [...e.invite.allies] } }];
        }),
      ) as WarState['events'],
      truceLifted: [...state.war.truceLifted],
      // Требования соседей (шаг 89) — только когда были.
      ...(state.war.demands === undefined
        ? {}
        : {
            demands: {
              ...(state.war.demands.pending === undefined ? {} : { pending: { ...state.war.demands.pending } }),
              last: { ...state.war.demands.last },
              ...(state.war.demands.quiet === undefined ? {} : { quiet: { ...state.war.demands.quiet } }),
            },
          }),
    },
    rivals: {
      ...state.rivals,
      regiments: state.rivals.regiments.map((r) => (r.hire === undefined ? { ...r } : { ...r, hire: { ...r.hire } })),
      list: state.rivals.list.map(
        (r): Rival => ({
          ...r,
          company: r.company,
          reputation: {
            ...r.reputation,
            standing: { ...r.reputation.standing },
            relations: { ...r.reputation.relations },
          },
        }),
      ),
    },
    achievements: {
      unlocked: state.achievements.unlocked.map((e) => ({ ...e })),
      kills: state.achievements.kills,
    },
    garrison: {
      posts: Object.fromEntries(Object.entries(state.garrison.posts).map(([id, p]) => [id, { ...p }])),
      withdraw: [...state.garrison.withdraw],
    },
    realm: {
      sectors: state.realm.sectors.map((x) => ({ ...x })),
      pinned: [...state.realm.pinned],
      reserve: state.realm.reserve,
      stances: { ...state.realm.stances },
      ...(state.realm.assigned === undefined ? {} : { assigned: { ...state.realm.assigned } }),
      ...(state.realm.targets === undefined ? {} : { targets: { ...state.realm.targets } }),
    },
  };
}

/**
 * Восстановление состояния из снимка.
 *
 * Версию правил здесь НЕ проверяет: это делает загрузка файла
 * (`schema.ts` → `parseSaveFile`), потому что отказ по версии — это ответ
 * пользователю, а не ошибка структуры.
 */
export function restore(snap: CampaignSnapshot): CampaignState {
  const state = new CampaignState(snap.seed, {
    companyName: snap.companyName,
    mode: snap.mode,
    startDay: snap.day,
    worldSeed: snap.worldSeed,
    systemId: snap.systemId,
  });
  state.nextSeq = snap.nextSeq;
  state.queue = snap.queue.map((e) => ({ day: e.day, seq: e.seq, task: { ...e.task } }));
  state.rng.setState(snap.rng);
  state.company = snap.company;
  state.travel = snap.travel === null ? null : { ...snap.travel, path: [...snap.travel.path] };
  state.hireReadyDay = snap.hireReadyDay;
  state.recruit = snap.recruit;
  state.contract = snap.contract;
  state.deltas = snap.deltas;
  state.reputation = snap.reputation;
  state.war = snap.war;
  state.rivals = snap.rivals;
  state.achievements = snap.achievements;
  state.garrison = snap.garrison;
  state.realm = snap.realm;
  return state;
}
