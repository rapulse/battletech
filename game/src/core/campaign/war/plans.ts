import type { Rng } from '../../rng/index.js';
import { GALAXY } from '../galaxy/catalog.js';
import {
  armyReadiness,
  economyOf,
  fundOf,
  planOf,
  prosperityOf,
  withPlan,
  type WarState,
} from './economy.js';
import type { FrontSector } from './front.js';
import { WAR } from './schema.js';

/**
 * Замысел государства (шаг 23, часть B) — направление главного удара.
 *
 * **Что было не так.** `front.ts::pickSector` выбирал участок взвешенно по силе
 * наступающего на КАЖДУЮ попытку. Поэтому фракция давила всюду понемногу: ни
 * цели, ни памяти о ней у неё не было, и фраза «в этом году Курита ломится на
 * Люсьен» не имела в коде носителя. Военный фонд страдал тем же — он размазан
 * по всем врагам сразу.
 *
 * **Что заведено.** Направление главного удара на несколько декад: фракция
 * выбирает цель, копит против неё фонд, стягивает силы и бьёт туда, пока не
 * возьмёт своё или не выдохнется по сроку.
 *
 * **Перевес, а не запрет** (решение пользователя 2026-09-04). Участки в зоне
 * замысла получают большой множитель веса, но наступать в другом месте фракция
 * по-прежнему может. Жёсткая цель читалась бы ярче, зато остальная граница у
 * этой фракции замерла бы на годы, и карта распалась бы на набор отдельных
 * войн вместо одного фронта. Фронт обязан оставаться ПОЛОСОЙ, а не строкой, —
 * это то же требование, из-за которого `pickSector` и выбирает взвешенно, а не
 * перебором лучшего.
 *
 * **Замысел — часть состояния, а не вывод.** Он и есть та самая ПАМЯТЬ о цели,
 * которой не хватало: вывести «куда Курита ломится в этом году» из карты и
 * фондов нельзя, потому что фонды сами двигаются замыслом. Карта разрежённая:
 * запись заводится, когда наступление объявлено, и уходит, когда оно кончилось.
 */

const P = WAR.plans;

/**
 * Насколько сильнее фракция давит на этот участок из-за своего замысла.
 *
 * Единица — участок к замыслу отношения не имеет. Больше единицы — он и есть
 * главный удар: тот же враг И тот же угол карты. Расстояние считается в
 * световых годах от цели замысла, а не в прыжках: прыжковый обход стоил бы
 * поиска в ширину на каждую попытку выбора участка, а тут нужна не дорога, а
 * близость.
 */
export function planWeight(war: WarState, sector: FrontSector): number {
  const plan = war.plans[sector.attacker];
  if (plan === undefined || plan.against !== sector.defender) return 1;
  const target = GALAXY.index(plan.target);
  if (target < 0) return 1;
  return GALAXY.distance(target, sector.system) <= P.radiusLy ? P.sectorWeight : 1;
}

/** Что случилось с замыслами за такт. Из этого собирается сводка новостей. */
export interface PlanMove {
  readonly factionId: string;
  readonly against: string;
  readonly systemId: string;
  /** `declared` — объявлено, `done` — цель взята, `spent` — выдохлось по сроку. */
  readonly kind: 'declared' | 'done' | 'spent';
}

export interface PlanTickResult {
  readonly war: WarState;
  readonly moves: readonly PlanMove[];
}

/**
 * Такт замыслов — первое, что делает такт фронта.
 *
 * Порядок здесь и есть порядок круга из постановки задачи: *силы накапливаются
 * → государства выбирают цель → проводится рейд по целям*. Сперва решают, куда
 * бить, и только потом бьют; замысел, объявленный ПОСЛЕ наступлений той же
 * декады, опоздал бы на декаду ко всему, на что он влияет.
 *
 * **Бросков два**: закрывать ли выдохшийся замысел (нет, это не бросок — срок)
 * и какой участок взять целью. Второй взвешен теми же величинами, что и выбор
 * участка под наступление, и это намеренно: замысел — не другая логика, а та же
 * логика, ЗАПОМНЕННАЯ на несколько декад.
 */
export function planTick(
  war: WarState,
  sectors: readonly FrontSector[],
  day: number,
  rng: Rng,
): PlanTickResult {
  let next = war;
  const moves: PlanMove[] = [];

  // Кандидаты в цель, разложенные по наступающему: один проход по участкам
  // вместо прохода на каждую фракцию.
  const byAttacker = new Map<string, FrontSector[]>();
  for (const s of sectors) {
    const list = byAttacker.get(s.attacker);
    if (list === undefined) byAttacker.set(s.attacker, [s]);
    else list.push(s);
  }

  // Порядок обхода закреплён именем, а не порядком вставки в карту: бросок
  // обязан быть воспроизводим, а не «как получилось» (game_core.md §4.7).
  const factions = [...new Set([...Object.keys(next.plans), ...byAttacker.keys()])].sort();

  for (const id of factions) {
    const plan = planOf(next, id);
    if (plan !== undefined) {
      // Замысел кончается двумя путями, и это две разные новости: цель взята
      // либо наступление выдохлось. Смешать их значило бы отнять у сводки
      // единственное, что в ней интересно, — чем всё кончилось.
      if (plan.taken >= P.goal) {
        next = withPlan(next, id, undefined);
        moves.push({ factionId: id, against: plan.against, systemId: plan.target, kind: 'done' });
      } else if (day >= plan.untilDay) {
        next = withPlan(next, id, undefined);
        moves.push({ factionId: id, against: plan.against, systemId: plan.target, kind: 'spent' });
      } else {
        continue;
      }
    }

    const candidates = byAttacker.get(id);
    if (candidates === undefined || candidates.length === 0) continue;

    // Наступление объявляют, когда есть чем: обескровленная армия и пустая
    // казна замысла не рождают. Без этой проверки фракция, только что
    // потерявшая половину машин, тут же объявляла бы новый поход — и «объявил
    // наступление» значило бы «прошло десять суток», а не решение.
    if (armyReadiness(next, id) < P.minReadiness) continue;
    const eco = economyOf(next, id);
    if (eco.income <= 0) continue;

    let total = 0;
    const weights = new Array<number>(candidates.length);
    for (let k = 0; k < candidates.length; k++) {
      const s = candidates[k] as FrontSector;
      const fund = fundOf(next, id, s.defender);
      // ПОХОД ОБЯЗАН БЫТЬ ОПЛАЧЕН. Цели, против которых не накоплено
      // `minFundTicks` собственного дохода, в кандидаты не идут вовсе — и это не
      // тонкая настройка, а то, чем замысел отличается от намерения. Первая
      // версия части B порога не имела, и замер показал, во что это выходит:
      // наступление шло у 16.7 фракции из 17 одновременно и в каждый момент
      // прогона, то есть перестало быть событием и стало состоянием по
      // умолчанию.
      //
      // Пауза между походами получается отсюда же и сама: наступление тратит
      // фонд (`front.ts::spend`), и следующего надо ждать, пока накопится
      // снова. Отдельного «отдыха после войны» в состоянии не заводится.
      if (fund < eco.income * P.minFundTicks) {
        weights[k] = 0;
        continue;
      }
      // Те же величины, что взвешивают одиночную попытку наступления
      // (`front.ts::pickSector`), плюс отложенное против этого врага: замысел
      // рождается там, где копят гуще.
      const w =
        s.enmity * s.adjacent * prosperityOf(next, s.attacker) * (1 + fund / (eco.income * P.fundScale));
      weights[k] = w;
      total += w;
    }
    if (total <= 0) continue;

    let roll = rng.next() * total;
    let picked = candidates[candidates.length - 1] as FrontSector;
    for (let k = 0; k < candidates.length; k++) {
      roll -= weights[k] as number;
      if (roll <= 0) {
        picked = candidates[k] as FrontSector;
        break;
      }
    }

    const length = rng.int(P.decadesMin, P.decadesMax) * WAR.front.tickDays;
    const target = GALAXY.id(picked.system);
    next = withPlan(next, id, {
      against: picked.defender,
      target,
      fromDay: day,
      untilDay: day + length,
      taken: 0,
    });
    moves.push({ factionId: id, against: picked.defender, systemId: target, kind: 'declared' });
  }

  return { war: next, moves };
}

/**
 * Отметить, что по замыслу взят ещё один мир.
 *
 * Зовётся захватом фронта. Считается ТОЛЬКО взятое у того, против кого замысел
 * объявлен: мир, отбитый попутно у третьей стороны, к главному удару отношения
 * не имеет и приближать его конец не должен.
 */
export function notePlanCapture(war: WarState, attacker: string, defender: string): WarState {
  const plan = planOf(war, attacker);
  if (plan === undefined || plan.against !== defender) return war;
  return withPlan(war, attacker, { ...plan, taken: plan.taken + 1 });
}
