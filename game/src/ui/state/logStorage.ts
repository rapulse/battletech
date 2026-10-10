import type { Storage } from '../../platform/Storage.js';
import type { ReputationReason, ReputationSource } from '../../core/campaign/index.js';

/**
 * Кэш последних событий интерфейса в хранилище браузера.
 *
 * Журнал роты (`logs`), сводка войны (`warLog`) и журнал репутации (`repLog`)
 * не входят в снимок кампании ядра (`CampaignSnapshot`), чтобы:
 * 1) ядро не знало о текстах и показе;
 * 2) строки журнала не привязывались к языку интерфейса в файле сохранения;
 * 3) не ломалась версия схемы правил (`rulesVersion`).
 *
 * При этом начинать каждую сессию с чистого листа неудобно: бегущий журнал
 * и сводка войны пусты до первого нового события. Этот модуль кэширует
 * последние строки событий в браузере с жесткой проверкой привязки:
 * `seed`, `day` и `companyName`. Если сохранение чужое, сид не совпал
 * или день изменился (например, загружен откат) — кэш отвергается.
 */

export const LOGS_SLOT = 'campaign_logs';

/** Сколько строк держит бегущий журнал. */
export const LOG_LIMIT = 120;

/** Сколько строк держит журнал репутации. */
export const REP_LOG_LIMIT = 200;

/** Сколько строк держит сводка войны. */
export const WAR_LOG_LIMIT = 200;

export interface LogLine {
  readonly text: string;
  readonly kind: 'info' | 'money' | 'warn' | 'battle';
  readonly day: number;
}

export interface RepLine {
  readonly day: number;
  readonly factionId: string;
  readonly delta: number;
  readonly after: number;
  readonly reason: ReputationReason;
  readonly source: ReputationSource;
}

/**
 * Виды строк сводки войны. Список, а не только тип: ярлык строки собирается из вида
 * (`war.kind.${kind}`), и полноту словаря проверяет `test/i18n.test.ts` по этому списку.
 */
export const WAR_LINE_KINDS = [
  'capture',
  'raid',
  'effort',
  'rivalHere',
  'rivalGone',
  'rivalBack',
  'commission',
  // Шаг 82: великий полк перешёл к другому фронту.
  'regimentMoved',
  'planDeclared',
  'planDone',
  'planSpent',
  // Шаг 78: бой с державой роты при любом исходе и итог её потерь за такт фронта.
  'clash',
  'realmLoss',
  // Шаг 79: война державы кончилась — миром, договором, подчинением, падением державы или без границы.
  'warEnded',
  // Шаг 83: договор пары (перемирие или торговля) и перемирие-коалиция против общей угрозы.
  'pact',
  'coalition',
  // Шаг 84: событие мира — веха эпохи (`data/events.json`).
  'event',
  // Шаг 85: восстание на мире роты (подавлено — `detail: 'won'`) и мир, отпавший к прежнему владельцу.
  'revolt',
  'seceded',
  // Шаг 88: команда политики державы — губернатора сектора или стойки фронта.
  'policy',
  // После шага 93: война державы объявлена — ею или ей; поворот державы с картинкой (`realm/realmMoment.ts`).
  'warDeclared',
] as const;

/**
 * Строки политики (шаг 88) — `war.policy.${by}.${act}`: губернатор строит, развивает и меняет фокус, стойка
 * приказывает и заключает мир. Список пар — для проверки полноты словаря.
 */
export const WAR_POLICY_KEYS = [
  'governor.build',
  'governor.develop',
  'governor.focus',
  'stance.offensive',
  'stance.peace',
] as const;

/** Роды договора в строке `pact` — `war.pact.${kind}` (шаг 83). */
export const WAR_PACT_KINDS = ['truce', 'trade'] as const;

/** Исходы боя с державой — `war.clash.${outcome}`. */
export const WAR_CLASH_OUTCOMES = ['captured', 'tributed', 'repelled'] as const;

/**
 * Как кончилась война державы — `war.ended.${how}` (шаг 79). Первые четыре — мир командой (`goal` — на
 * цели роты, шаг 81), `forced` — мир на пределе усталости (шаг 81).
 */
export const WAR_END_KINDS = [
  'free',
  'paid',
  'ceded',
  'goal',
  'forced',
  'pact',
  'vassal',
  'realmFallen',
  'noBorder',
  // Шаг 83: мир на цели фракции — держава проиграла войну, объявленную ей по угрозе.
  'yielded',
] as const;

export interface WarLine {
  readonly day: number;
  readonly kind: (typeof WAR_LINE_KINDS)[number];
  readonly systemId: string;
  readonly attacker: string;
  readonly defender: string;
  readonly ruined: number;
  readonly who?: string;
  readonly detail?: 'won' | 'lost';
  readonly size?: number;
  readonly lost?: number;
  /**
   * Строка касается державы роты: рота — одна из сторон (шаг 78). По метке экран войны отбирает
   * ленту «Держава», а экран державы — свои последние строки; второго журнала нет.
   */
  readonly realm?: true;
  /** Бой с державой (`clash`): исход и числа боя. */
  readonly clash?: {
    readonly outcome: (typeof WAR_CLASH_OUTCOMES)[number];
    readonly attackerSize: number;
    readonly defenderSize: number;
    readonly attackerLost: number;
    readonly defenderLost: number;
    /** Мир роты взят или обложен данью — строка-предупреждение. */
    readonly lostWorld: boolean;
    /** Столкновение звена роты в приказе (шаг 86): машин роты, отряд против неё, выбито ротой, её потери. */
    readonly company?: {
      readonly mechs: number;
      readonly detachment: number;
      readonly knocked: number;
      readonly lost: number;
    };
    /**
     * Гарнизон роты в бою за свой мир (шаг 86b): машин гарнизона, отряд против него, выбито, потери;
     * `withdrew` — ушёл без боя по политике.
     */
    readonly garrison?: {
      readonly mechs: number;
      readonly detachment: number;
      readonly knocked: number;
      readonly lost: number;
      readonly withdrew: boolean;
    };
  };
  /** Итог потерь (`realmLoss`): армия державы после такта. Боёв — `size`, потеряно — `lost`. */
  readonly army?: number;
  /** Конец войны (`warEnded`): как кончилась. Противник — `defender`, мир при уступке — `systemId`. */
  readonly ended?: (typeof WAR_END_KINDS)[number];
  /** Род договора (`pact`, шаг 83). */
  readonly pact?: (typeof WAR_PACT_KINDS)[number];
  /** Против кого коалиция (`coalition`, шаг 83). */
  readonly against?: string;
  /** Какое событие мира (`event`, шаг 84): заголовок — `worldEvent.${eventId}.title`. */
  readonly eventId?: string;
  /**
   * Команда политики державы (`policy`, шаг 88): кто (`by`) и что (`act`); у губернатора — центр сектора, позывной —
   * в `who`; у стойки — враг в `defender`. Постройка и фокус — для текста строки.
   */
  readonly policy?: {
    readonly by: 'governor' | 'stance';
    readonly act: 'build' | 'develop' | 'focus' | 'offensive' | 'peace';
    readonly center?: string;
    readonly building?: string;
    readonly focus?: string;
  };
}

export interface CachedUiLogs {
  readonly seed: number;
  readonly day: number;
  readonly companyName: string;
  readonly logs: readonly LogLine[];
  readonly warLog: readonly WarLine[];
  readonly repLog: readonly RepLine[];
}

export function isCachedUiLogs(val: unknown): val is CachedUiLogs {
  if (typeof val !== 'object' || val === null) return false;
  const o = val as Record<string, unknown>;
  return (
    typeof o.seed === 'number' &&
    typeof o.day === 'number' &&
    typeof o.companyName === 'string' &&
    Array.isArray(o.logs) &&
    Array.isArray(o.warLog) &&
    Array.isArray(o.repLog)
  );
}

/**
 * Сохранить кэш событий интерфейса в хранилище.
 */
export async function saveCachedLogs(storage: Storage, payload: CachedUiLogs): Promise<void> {
  const data: CachedUiLogs = {
    seed: payload.seed,
    day: payload.day,
    companyName: payload.companyName,
    logs: payload.logs.slice(0, LOG_LIMIT),
    warLog: payload.warLog.slice(0, WAR_LOG_LIMIT),
    repLog: payload.repLog.slice(0, REP_LOG_LIMIT),
  };
  await storage.save(LOGS_SLOT, new TextEncoder().encode(JSON.stringify(data)));
}

/**
 * Загрузить кэш событий, строго проверив совпадение сида, дня и имени роты.
 * При любом несовпадении или ошибке возвращает `null`.
 */
export async function loadCachedLogs(
  storage: Storage,
  seed: number,
  day: number,
  companyName: string,
): Promise<{ logs: LogLine[]; warLog: WarLine[]; repLog: RepLine[] } | null> {
  try {
    const bytes = await storage.load(LOGS_SLOT);
    if (bytes === null) return null;
    const json: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (!isCachedUiLogs(json)) return null;
    if (json.seed !== seed || json.day !== day || json.companyName !== companyName) {
      return null;
    }
    return {
      logs: json.logs.slice(0, LOG_LIMIT) as LogLine[],
      warLog: json.warLog.slice(0, WAR_LOG_LIMIT) as WarLine[],
      repLog: json.repLog.slice(0, REP_LOG_LIMIT) as RepLine[],
    };
  } catch {
    return null;
  }
}
