import { companyRating } from '../contracts/threat.js';
import { isShattered, regimentRating } from './regiments.js';
import type { CampaignState } from '../state.js';

/**
 * Рейтинг MRBC (шаг 22, часть C).
 *
 * **Что рейтинг даёт, кроме места в таблице, — ничего, и это решение** (решение
 * 5 плана шага 22). Четвёртой оси репутации здесь не заводится: у неё их три, и
 * новая, дублирующая известность, разошлась бы с ней на первом же шаге. Рейтинг
 * — ВИДИМОЕ выражение силы, а порог работы держит известность
 * (`reputation/access.ts::missionAllowed`). Поэтому здесь нет ни одного нового
 * числа и ни одной новой калибровки: таблица считается той же
 * `companyRating`, что и сила роты на экране ангара.
 *
 * Таблица не хранится: она выводится из состояния одним вызовом. Хранится
 * только то, что вывести нельзя, — рейтинг ПРЕДЫДУЩЕЙ декады, из которого
 * берётся движение вверх и вниз (`rivals/types.ts`).
 */

export interface RatingRow {
  /** `player` — строка роты игрока. У соперника — его id. */
  readonly id: string;
  readonly name: string;
  /**
   * Номер герба. У соперника — ячейка набора НАЁМНИКОВ (`ui/mercenaries.jpg`), у
   * роты игрока — набора игрока (`ui/company.jpg`). Какой набор брать, решает
   * `isPlayer`: два разных атласа под одним номером — единственное место экрана,
   * где ошибиться легко и видно сразу.
   */
  readonly emblem: number;
  readonly rating: number;
  /** Место в таблице, с единицы. */
  readonly rank: number;
  /** Насколько рейтинг сдвинулся с прошлого такта. */
  readonly change: number;
  readonly isPlayer: boolean;
  /** Где отряд стоит. У роты игрока — где она стоит сейчас. */
  readonly systemId: string;
  /** Сколько работы отряд взял за кампанию и сколько довёл до конца. */
  readonly contracts: number;
  readonly wins: number;
  /** Соперник стоит в той же системе, что рота: прямая конкуренция за биржу. */
  readonly here: boolean;
  /**
   * Значится ли отряд в реестре MRBC.
   *
   * Вольных отрядов в мире сотни, и списком они таблицу не украсят: игрок видит
   * их, только когда они стоят с ним в одной системе, — иначе он о них и не
   * узнал бы (`ratingTable`).
   */
  readonly registered: boolean;
  /** Состав словами — у великих полков реестра, из данных (`rivals.json`). У остальных пусто. */
  readonly force: string;
  /**
   * Состав полка числами: полков и батальонов (шаг 52). Словами его называет
   * экран; до шага 52 ядро само писало «2 п. 1 бат.». `null` — не полк.
   */
  readonly forceSize: ForceSize | null;
  /** Полк разбит и отстраивается. */
  readonly shattered: boolean;
}

const PLAYER_ID = 'player';

/**
 * Таблица целиком: рота игрока и все живые соперники, по силе сверху вниз.
 *
 * Рота игрока считается ТОЙ ЖЕ формулой, что соперник, и стоит в общем списке
 * без особого случая — обещание `reputation.md` («отряд игрока попадает в общий
 * рейтинг той же формулой»).
 */
export function ratingTable(state: CampaignState): readonly RatingRow[] {
  const rows: Omit<RatingRow, 'rank'>[] = [
    {
      id: PLAYER_ID,
      name: state.companyName,
      emblem: state.company.emblem,
      rating: companyRating(state.company).total,
      change: round(companyRating(state.company).total - state.rivals.playerRatingBefore),
      isPlayer: true,
      systemId: state.systemId,
      contracts: 0,
      wins: 0,
      here: true,
      registered: true,
      force: '',
      forceSize: null,
      shattered: false,
    },
    // Полки — те же строки таблицы, только записанные составом.
    ...state.rivals.regiments.map((r) => {
      const rating = regimentRating(r);
      return {
        id: r.id,
        name: r.name,
        emblem: r.emblem,
        rating,
        change: round(rating - r.ratingBefore),
        isPlayer: false,
        systemId: r.systemId,
        contracts: r.contracts,
        wins: r.wins,
        here: r.systemId === state.systemId,
        registered: true,
        force: '',
        forceSize: forceSize(r.mechs),
        shattered: isShattered(r),
      };
    }),
    // Ротные отряды. Вольные попадают в таблицу, ТОЛЬКО если стоят с ротой в
    // одной системе: их сотни, и списком они таблицу бы утопили, а не наполнили.
    // Зато встреченный виден — иначе игрок никогда бы не узнал, что в системе
    // кто-то есть, хотя в расчёте они всё это время были.
    ...state.rivals.list
      .filter((r) => r.registered || r.systemId === state.systemId)
      .map((r) => {
        const rating = companyRating(r.company).total;
        return {
          id: r.id,
          name: r.name,
          emblem: r.emblem,
          rating,
          change: round(rating - r.ratingBefore),
          isPlayer: false,
          systemId: r.systemId,
          contracts: r.contracts,
          wins: r.wins,
          here: r.systemId === state.systemId,
          registered: r.registered,
          force: '',
          forceSize: null,
          shattered: false,
        };
      }),
  ];

  // Порядок при равной силе — по id, а не по порядку в списке: две роты с
  // одинаковым рейтингом обязаны стоять в таблице одинаково от захода к заходу
  // (game_core.md §4.7).
  rows.sort((a, b) => (a.rating !== b.rating ? b.rating - a.rating : a.id < b.id ? -1 : 1));
  return rows.map((row, i) => ({ ...row, rank: i + 1 }));
}

/** Место роты игрока в таблице. Отдельной функцией — её спрашивает и экран, и замер. */
export function playerRank(state: CampaignState): number {
  return ratingTable(state).find((r) => r.isPlayer)?.rank ?? 1;
}

function round(v: number): number {
  return Math.round(v * 100) / 100;
}

export interface ForceSize {
  readonly regiments: number;
  readonly battalions: number;
}

/**
 * Состав полка: полков и батальонов.
 *
 * Полк меряется полками и батальонами, а не «условными машинами»: показать его
 * силу только числом значило бы поставить рядом две несравнимые величины и
 * промолчать об этом. Меньше полка — хотя бы один батальон.
 */
function forceSize(mechs: number): ForceSize {
  const regiments = Math.floor(mechs / 108);
  if (regiments >= 1) return { regiments, battalions: Math.round((mechs % 108) / 36) };
  return { regiments: 0, battalions: Math.max(1, Math.round(mechs / 36)) };
}
