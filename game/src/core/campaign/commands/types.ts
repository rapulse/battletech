import type { ZoneId } from '../../model/HitZone.js';
import type { MechAssembly } from '../../rules/construction.js';
import type { BattleOutcome } from '../bridge/fromBattle.js';
import type { Contract } from '../contracts/board.js';
import type { WorldFocus } from '../galaxy/schema.js';
// Исход контракта объявлен рядом с трофеями (`contracts/salvage.ts`): его
// читает и предпросмотр разбора, который командам ничего не должен.
import type { ContractResult } from '../contracts/salvage.js';
import type { ReputationOutcome, ReputationReason } from '../reputation/index.js';
import type { QualityClass } from '../../model/QualityClass.js';
import type { RepairWork, ScheduledTask } from '../clock.js';
import type { WearNode } from '../mech/MechRecord.js';
import type { DropshipId } from '../../data/schema.js';
import type { WarGoal } from '../war/playerWar.js';
import type { GarrisonPolicy } from '../company/garrison.js';
import type { BuildingKind, GovernorPriority } from '../war/schema.js';
import type { FrontStance } from '../realm/sectors.js';
import type { PolicyAct, PolicyActor } from '../realm/policy.js';
import type { HireEnd } from '../rivals/hire.js';
import type { DemandOutcome, RefusalPunishment } from '../war/demands.js';

/**
 * Команды — единственный способ изменить `CampaignState` (game_core.md §2).
 * Зеркало `core/commands/types.ts`: размеченное объединение, полнота `switch`
 * проверяется компилятором.
 *
 * Шаг 13 добавляет ангар: ремонт, склад, казармы, деньги. `CancelJob` не
 * значится в списке команд брифинга шага 13, но нужна тесту «отмена
 * возвращает часть средств по правилу» — без неё поставленную работу нечем
 * отозвать. Шаг 14 добавляет место: `Travel`, `Jump`, `Survey`. Покупка и
 * контракт приходят шагами 15–16. Шаг 15 добавляет рынок: покупка, продажа,
 * заказ с доставкой, продажа машины целиком и установка узла со склада.
 * `InstallPart` в списке команд брифинга не значится, но без неё рынок некому
 * потреблять: купленный или заказанный узел мог бы только лежать и
 * перепродаваться — то есть ровно та петля арбитража, которую брифинг
 * запрещает, и ни одной петли вверх. Разбор `ScrapMech` перестаёт быть
 * мгновенным и становится работой стапеля.
 *
 * Шаг 16 добавляет РАБОТУ и замыкает вертикальный срез: `TakeContract`,
 * `AbandonContract`, `Deploy`, `ResolveContract`. Последняя — тот самый
 * формальный шов, которого не было до этого шага: свод боевого результата в
 * ростер шёл в обход команд (`sim/campaign/batch.ts`, `state.company = {...}`),
 * потому что называть его командой раньше времени значило бы выдумать API,
 * которое сам шаг 16 и перепишет.
 *
 * Шаг 19a добавляет мехлаб и два стока денег, которых роте не хватало:
 * `RefitMech` (переоснащение со склада работой стапеля), `BuyMech` (покупка
 * машины целиком) и `UpgradeBays` (первая ступень лестницы цеха).
 */
/**
 * Строка заказа: какой узел, под какой тоннаж, какого тира и класса (шаг 45).
 *
 * Тоннаж и тир здесь ЗАДАЮТСЯ, а не выводятся из машины: в этом вся разница
 * между «доставить недостающее качество» и «собрать нужную машину». Годность
 * узла проверяет установка (`installPart`), а не заказ, — ровно как у узла,
 * купленного с прилавка.
 */
export interface OrderSpec {
  readonly node: WearNode;
  readonly tonnage: number;
  readonly tier: number;
  readonly targetClass: QualityClass;
}

export type CampaignCommand =
  | {
      /** Прокрутить время вперёд на `days` суток, исполняя всё, что подошло. */
      readonly kind: 'advance';
      readonly days: number;
    }
  | {
      /** То же, но до конкретного дня. Удобнее для «долететь и оказаться там». */
      readonly kind: 'advanceTo';
      readonly day: number;
    }
  | {
      readonly kind: 'schedule';
      readonly day: number;
      readonly task: ScheduledTask;
    }
  | {
      readonly kind: 'setCompanyName';
      readonly name: string;
    }
  | {
      /** Довести зону (броня, структура, ячейки) до паспорта. Не годится для разрушенной зоны — там `replacePart`. */
      readonly kind: 'repairZone';
      readonly recordId: string;
      readonly zone: ZoneId;
    }
  | {
      /** Купить узел лучшего класса. Повышение — покупка, а не ремонт (`mech/repair.ts::replaceJob`). */
      readonly kind: 'upgradeClass';
      readonly recordId: string;
      readonly node: WearNode;
      readonly targetClass: QualityClass;
    }
  | {
      /** Снять износ узла без смены класса. */
      readonly kind: 'restoreWorn';
      readonly recordId: string;
      readonly node: WearNode;
    }
  | {
      /** Полевая замена узла из разрушенной (не торс, не голова) зоны — по шансу, ловушка 1 шага 13. */
      readonly kind: 'replacePart';
      readonly recordId: string;
      readonly zone: ZoneId;
    }
  | {
      /**
       * Разобрать машину. Работа стапеля со сроком и ценой (шаг 15): по
       * завершении запись уходит из ростера, а на склад ложится ВСЁ уцелевшее —
       * узлы, целые орудия, теплоотводы, ускорители, оборудование.
       */
      readonly kind: 'scrapMech';
      readonly recordId: string;
    }
  | {
      /** Посадить пилота в машину (или высадить, если `pilotId: null`). Прежняя посадка снимается сама. */
      readonly kind: 'assignPilot';
      readonly recordId: string;
      readonly pilotId: string | null;
    }
  | {
      /**
       * Переставить парк местами — перетаскивание в списке ангара/мехлаба
       * (шаг про полосу износа и порядок). Порядок — это порядок самого
       * `company.mechs`, отдельного поля под него не заводится: списки читают
       * массив как есть, звеньями по `CONTRACTS.lanceSize` его пока не режут
       * (см. заметку в notes.md).
       */
      readonly kind: 'reorderMechs';
      readonly order: readonly string[];
    }
  | {
      /**
       * Дать объявление о найме (переработка 2026-09-10).
       *
       * Не покупка пилота, а ПОПЫТКА: деньги за поиск и сама попытка списываются
       * сразу, кандидат ложится в состояние, и по нему остаётся решить —
       * `hireRecruit` или `rejectRecruit`. Раз в две недели, копить попытки
       * нельзя (`economy.json → hiring`).
       *
       * `id` задаёт вызывающий: номера пилотов принадлежат роте, а не броску.
       */
      readonly kind: 'searchRecruit';
      readonly id: string;
    }
  | {
      /** Взять кандидата в роту. Дороже он уже не станет: за поиск уплачено. */
      readonly kind: 'hireRecruit';
    }
  | {
      /** Отпустить кандидата. Ни денег, ни попытки не возвращает — за это и решение. */
      readonly kind: 'rejectRecruit';
    }
  | {
      readonly kind: 'dismissPilot';
      readonly pilotId: string;
    }
  | {
      /** Опыт → уровень навыка (`rules/skills.ts::trainSkill`), с учётом потолка таланта. */
      readonly kind: 'trainPilot';
      readonly pilotId: string;
      readonly skillId: string;
    }
  | {
      /**
       * Отправить раненого пилота в лазарет, не дожидаясь порога (правка
       * 2026-09-08).
       *
       * Травмы заживают и сами — раз в декаду по одной (`restTick`), — но
       * ждать полсотни суток игрок не обязан: за срок лечения пилот выходит с
       * нулём. Плата та же, что у всех работ кампании, — время: пока идёт
       * лечение, пилот в вылет не годится.
       */
      readonly kind: 'treatPilot';
      readonly pilotId: string;
    }
  | {
      /** Отменить незавершённую работу стапеля. Возвращает часть уплаченного (`data/economy.json::cancellation`). */
      readonly kind: 'cancelJob';
      readonly jobId: string;
    }
  | {
      /** Перелёт по маршруту: A* по прыжкам, деньги списываются при постановке (`galaxy/navigation.ts`). */
      readonly kind: 'travel';
      readonly systemId: string;
    }
  | {
      /** Один прыжок к соседней системе (≤ 30 св. лет). То же, что `travel` в один шаг, но без поиска маршрута. */
      readonly kind: 'jump';
      readonly systemId: string;
    }
  | {
      /**
       * Купить мир у его владельца (шаг 25, часть C) — ступень 4 лестницы
       * `wiki/overview/vision.md`: рота перестаёт быть только исполнителем.
       *
       * Мир покупается ТОТ, В КОТОРОМ РОТА СТОИТ: планету не берут по каталогу
       * из другого конца Сферы, её берут там, куда прилетели и договорились.
       */
      readonly kind: 'buyWorld';
    }
  | {
      /**
       * ЗАХВАТИТЬ мир, в котором рота стоит (шаг 38, путь меча).
       *
       * Вторая дверь к первому миру и ответ на парадокс анклава: покупка ведёт
       * в глубокий тыл дружественного Дома, где вокруг только союзники и
       * расширяться силой некуда вовсе. Захват берёт мир со владельцем
       * `pirates` или `independent` на Периферии — а вокруг такого мира полно
       * таких же, и военный контур включается без предательства благодетеля.
       *
       * Платит не касса, а ДЕЛО: победы роты именно на этом мире, а для
       * пиратского логова ещё и его вычищенность (шаг 37a). Захват читается как
       * продолжение зачистки, а не как отдельная механика.
       */
      readonly kind: 'conquerWorld';
    }
  | {
      /**
       * ПРИНЯТЬ ЛЕН — земельное пожалование Дома (шаг 38, путь службы).
       *
       * Третья дверь. В каноне Дома почти никогда не жаловали наёмникам землю в
       * ядре: землю давали на неспокойных окраинах, буферными баронствами —
       * Аутрич у границы Конфедерации, Гленгарри у лиранского фронтира. Дом
       * решал свою проблему чужими руками.
       *
       * Отсюда и условие, которого нет у покупки: мир обязан быть
       * ПРИГРАНИЧНЫМ (фронтовой индекс шага 37). Игрок получает не случайную
       * тыловую планету, а геополитическую позицию: за спиной союзник и рынок
       * снабжения, впереди законный враг. Мир достаётся даром.
       */
      readonly kind: 'claimGrant';
    }
  | {
      /**
       * Поставить в строй или распустить ПОЛЕВЫЕ ПОЛКИ державы игрока (шаг 27,
       * часть C) — ступень 4 лестницы `wiki/overview/vision.md`: у роты
       * появляется армия сверх собственных машин.
       *
       * `mechs` — сколько машин поставить в строй (плюс) или распустить
       * (минус). Роспуск возвращает половину цены: разоружаться дешевле, чем
       * вооружаться, но и не бесплатно.
       *
       * **Куда полки поедут, игрок не выбирает, и это не упрощение.** Правило
       * §2 дорожной карты Части 3 — «одна планета, одно решение в год, а не
       * десять решений в месяц»; раскладку по направлениям делает та же
       * логистика, что у фракций (`war/logistics.ts`), тем же кодом и по той же
       * доле фронта. Решение игрока здесь — СКОЛЬКО держать под ружьём и чем
       * владеть, а не куда каждую декаду возить полк.
       */
      readonly kind: 'raiseRegiment';
      readonly mechs: number;
    }
  | {
      /**
       * Военный бюджет державы (проект державы, шаг 2): какую долю итога за декаду откладывать в
       * военный фонд против врагов. Доля — один из шагов `domain.warBudgetSteps`. Фонд
       * раскладывается и тратится по правилам фракций; ноль — всё в кассу, как до шага.
       */
      readonly kind: 'setWarBudget';
      readonly share: number;
    }
  | {
      /**
       * Положить деньги кассы в военный фонд державы (шаг 80). Раскладка по врагам — та же, что у
       * бюджета (`placeWarFund`). Решение явное: игра не тратит кассу без спроса, а фонд от одного
       * бюджета копится малой державе приказ за ~30 декад.
       */
      readonly kind: 'fundWar';
      readonly amount: number;
    }
  | {
      /**
       * Приказ армии державы наступать на мир врага у границы (проект державы, шаг 3): тот же
       * участок, силы и бой, что у такта фронта; цена — из военного фонда державы. `war/offensive.ts`.
       */
      readonly kind: 'orderOffensive';
      readonly systemId: string;
    }
  | {
      /**
       * Выгрузить машины роты гарнизоном на мир державы, где стоит рота (шаг 86b, `company/garrison.ts`):
       * не в перелёте, машина на корабле, с пилотом, не в звене взятого контракта. Место в ангаре освобождается.
       */
      readonly kind: 'garrisonUnload';
      readonly recordIds: readonly string[];
    }
  | {
      /** Забрать машины гарнизона этой системы на корабль (шаг 86b): рота здесь, машина прибыла, есть место. */
      readonly kind: 'garrisonLoad';
      readonly recordIds: readonly string[];
    }
  | {
      /** Политика гарнизона мира (шаг 86b): «драться» или «отходить при двойном перевесе». */
      readonly kind: 'setGarrisonPolicy';
      readonly systemId: string;
      readonly policy: GarrisonPolicy;
    }
  | {
      /**
       * Поставить стройку на своём мире (шаг 87, `war/buildings.ts`): цена списывается сразу, срок — трудоёмкость
       * ÷ очки мира. Одна стройка на мир; корабль в системе не нужен.
       */
      readonly kind: 'startBuilding';
      readonly systemId: string;
      readonly building: BuildingKind;
    }
  | {
      /** Отменить стройку мира (шаг 87): возвращается доля цены `buildings.cancelRefund`. */
      readonly kind: 'cancelBuilding';
      readonly systemId: string;
    }
  | {
      /**
       * Назначить губернатора сектора (шаг 88, `realm/sectors.ts`): сектор — свои миры в пределах
       * `realm.sectorJumps` прыжков от центра. Пилот снимается с машины и не воюет, пока на посту. Сектор с этим
       * центром уже есть — губернатор и приоритет меняются, прежний губернатор свободен. Новый сектор — в пределах
       * `floor(миров ÷ realm.worldsPerSector)`.
       */
      readonly kind: 'appointGovernor';
      readonly centerId: string;
      readonly pilotId: string;
      readonly priority: GovernorPriority;
    }
  | {
      /** Сменить приоритет губернатора сектора (шаг 88). */
      readonly kind: 'setSectorPriority';
      readonly centerId: string;
      readonly priority: GovernorPriority;
    }
  | {
      /** Снять губернатора: сектор распускается, пилот снова свободен (шаг 88). */
      readonly kind: 'releaseGovernor';
      readonly centerId: string;
    }
  | {
      /** Закрепить свой мир за собой или снять закрепление: губернатор по нему команд не отдаёт (шаг 88). */
      readonly kind: 'pinWorld';
      readonly systemId: string;
      readonly pinned: boolean;
    }
  | {
      /** Резерв кассы державы — один из `realm.reserveSteps`: губернаторы не опускают кассу ниже (шаг 88). */
      readonly kind: 'setRealmReserve';
      readonly amount: number;
    }
  | {
      /**
       * Стойка фронта против врага, с которым идёт война (шаг 88): наступать — приказы армии по цели, держать —
       * ничего, уступать — мир, как только он даром.
       */
      readonly kind: 'setFrontStance';
      readonly factionId: string;
      readonly stance: FrontStance;
    }
  | {
      /**
       * Цель стойки «наступать» против врага (шаг 93): участок фронта, который стойка бьёт вместо выбранного
       * ядром. `null` — снова выбирает ядро (`policy.ts::stanceTarget`).
       */
      readonly kind: 'setStanceTarget';
      readonly factionId: string;
      readonly systemId: string | null;
    }
  | {
      /**
       * Явно отнести свой мир к сектору (шаг 93): центр — не дальше `realm.sectorJumps` прыжков. `null` — снова по
       * геометрии, к ближайшему центру.
       */
      readonly kind: 'assignWorldSector';
      readonly systemId: string;
      readonly center: string | null;
    }
  | {
      /**
       * Нанять великий полк MRBC против врага, с которым у державы запись войны (шаг 89, `rivals/hire.ts`): цена
       * из кассы разом, полк встаёт на мир державы, ближайший к врагу, и на срок берёт подряды против него.
       */
      readonly kind: 'hireGreatRegiment';
      readonly regimentId: string;
      readonly against: string;
    }
  | {
      /**
       * Ответить на требование соседа (шаг 89, `war/demands.ts`): принять — мир платит ему дань стандартного срока,
       * отказать — отношение соседа к роте падает. Пока карточка открыта, время стоит.
       */
      readonly kind: 'answerDemand';
      readonly accept: boolean;
    }
  | {
      /**
       * Задать фокус своему миру (шаг 25, часть A + C).
       *
       * Переделка стоит денег и длится игровой год: это решение раз в год, а не
       * рутина. Пока она идёт, мир работает по-старому.
       */
      readonly kind: 'setWorldFocus';
      readonly systemId: string;
      readonly focus: WorldFocus;
    }
  | {
      /**
       * Вложиться в развитие своего мира (шаг 25, часть C) — ровно то же, что
       * делают государства с шага 23, той же ценой и той же ступенью.
       */
      readonly kind: 'developWorld';
      readonly systemId: string;
    }
  | {
      /**
       * Отказаться от своего мира (шаг 75; до него — продажа шага 72e) — выход
       * из неудачного места.
       *
       * Малую державу у враждебной границы соседи обкладывают данью раз за
       * разом (`war/diplomacy.ts::tributePull`), и без этой команды игроку
       * оставалось бы только ждать. Мир возвращается владельцу по канону 3053
       * года без денег, и армия роты `domain.abandonHoldDays` суток на него не
       * наступает. Отказ от последнего мира — конец державы.
       */
      readonly kind: 'abandonWorld';
      readonly systemId: string;
    }
  | {
      /**
       * Перенести столицу державы роты на свой мир (шаг 72a).
       *
       * От столицы считается плечо снабжения — прибавка к содержанию каждого
       * мира за прыжок до неё — и из неё логистика везёт полки. По умолчанию
       * столица — первый мир роты по каталогу, то есть случайность покупки;
       * перенос делает её решением. Стоит денег, действует сразу, а следующий
       * перенос — не раньше чем через полгода (шаг 72b).
       */
      readonly kind: 'moveCapital';
      readonly systemId: string;
    }
  | {
      /**
       * Объявить войну соседу державы (шаг 76): фронт в ту же декаду, работа
       * фракции закрыта. Правила — `war/playerWar.ts`. `goal` — цель войны (шаг 81),
       * её выдаёт мир по предложению фракции; без поля войну ведут без цели.
       */
      readonly kind: 'declareWar';
      readonly factionId: string;
      readonly goal?: WarGoal;
    }
  | {
      /**
       * Ответить на карточку события мира (шаг 84): закрыть её, а на приглашение в коалицию —
       * принять (`accept: true`) или отказать. Пока карточка открыта, время стоит.
       */
      readonly kind: 'answerEvent';
      readonly id: string;
      readonly accept?: boolean;
    }
  | {
      /**
       * Заключить мир (шаг 76) на условиях `peaceTerms`: даром, за отступные
       * или, когда фракция это предлагает, уступив пограничный мир (`cede`).
       */
      readonly kind: 'makePeace';
      readonly factionId: string;
      readonly cede?: boolean;
      /** Мир, где фракция вместо цели признаёт сюзеренитет державы (шаг 90, `protectorateByPeace`). */
      readonly protectorate?: boolean;
    }
  | {
      /**
       * Заключить соглашение с владельцем соседнего мира (шаг 26, часть C,
       * ступень 1).
       *
       * `truce` — договор о ненападении: пара не воюет, пока договор действует.
       * `trade` — торговый договор: обе стороны получают прибавку к доходу.
       * Проходит через тот же `signPact`, что и договоры фракций между собой:
       * второго способа заключить договор в игре нет.
       */
      readonly kind: 'proposePact';
      readonly factionId: string;
      readonly pact: 'truce' | 'trade';
    }
  | {
      /**
       * Выкупить дань со своего мира (шаг 26, часть C, ступень 1).
       *
       * Мир роты нельзя отнять, но можно обложить данью, и это единственное, чем
       * война давит на домен. Выкуп — деньгами и разом.
       */
      readonly kind: 'buyOffTribute';
      readonly systemId: string;
    }
  | {
      /**
       * Обложить данью мир соседа (шаг 26, часть C, ступень 2).
       *
       * Мир обязан граничить с миром роты: держава давит на то, до чего
       * дотягивается. Тем же `imposeTribute`, что и у фракций.
       */
      readonly kind: 'demandTribute';
      readonly systemId: string;
    }
  | {
      /**
       * Принять державу под протекторат (шаг 26, часть C, ступень 2).
       *
       * Условия те же, что у фракций (`diplomacy.ts::canSubmit`): сосед уже
       * платит роте дань несколькими мирами, его армия просела, рота крупнее.
       * Разница одна — решение принимает игрок, а не пороги тикера.
       */
      readonly kind: 'offerProtectorate';
      readonly factionId: string;
    }
  | {
      /** Разведать систему, в которой рота стоит: деньги и срок в обмен на точные числа профиля. */
      readonly kind: 'survey';
    }
  | {
      /** Купить позицию из лавки текущей системы. Ассортимент выводится, покупка записывается дельтой. */
      readonly kind: 'buyPart';
      readonly lotId: string;
    }
  | {
      /** Продать складскую запись — узел или установку. Цена заметно ниже покупки (ловушка 3). */
      readonly kind: 'sellPart';
      readonly partId: string;
    }
  | {
      /**
       * Заказать узел под конкретную машину с доставкой.
       *
       * Способ достать недоступное на месте: медленно и дороже.
       *
       * **Шаг 45 снял привязку к машине.** До него тоннаж и тир брались у
       * машины, под которую заказ оформлен, и менять можно было только КЛАСС.
       * Из-за этого тир (R1..R5, F1..F3) — то есть единственное конструктивное
       * решение о машине — доставался игроку исключительно случайной находкой
       * на прилавке: пространство узлов насчитывает 544 различимые позиции, а
       * лавка выкладывает за декаду около трёх. Теперь заказывается
       * СПЕЦИФИКАЦИЯ, и мир решает не «есть ли это», а «почём и как быстро».
       */
      readonly kind: 'orderPart';
      /**
       * Что заказываем. Список, а не одна позиция: игрок выбирает СВЯЗКУ
       * реактор + каркас и платит за неё одним счётом с одной доставкой
       * (шаг 45). Полусобранных состояний «реактор приехал, каркас ещё нет»
       * при этом не заводится.
       */
      readonly items: readonly OrderSpec[];
    }
  | {
      /** Поставить узел со склада на машину. Работа стапеля; износ узел приносит с собой. */
      readonly kind: 'installPart';
      readonly recordId: string;
      readonly partId: string;
    }
  | {
      /** Продать машину целиком и на ходу. Разрушенный торс или голова — это не машина, а лом. */
      readonly kind: 'sellMech';
      readonly recordId: string;
    }
  | {
      /**
       * Переоснастить машину — мехлаб (шаг 19a).
       *
       * Работа стапеля, как ремонт и разбор: срок, цена и место в цеху.
       * Ставится только то, что лежит на складе, снятое туда же и ложится
       * (`company/refit.ts`). Целевая сборка приходит целиком — команда не
       * «сними ствол», а «собери вот эту машину»: любой пошаговый API
       * пришлось бы валидировать между шагами, а сборка посреди перестановки
       * законной не бывает.
       */
      readonly kind: 'refitMech';
      readonly recordId: string;
      readonly assembly: MechAssembly;
    }
  | {
      /**
       * Перекрасить машину (шаг 50) — работа стапеля: срок, цена от тоннажа,
       * место в цеху, отмена с возвратом половины. `paint` — id из
       * `data/paints.json`; `null` — снять перекраску и вернуть цвета того, от
       * кого машина пришла.
       */
      readonly kind: 'repaintMech';
      readonly recordId: string;
      readonly paint: string | null;
    }
  | {
      /**
       * Расширить цех на ступень (шаг 19a, вариант Б решения 2026-09-02).
       *
       * Ступени и цены — `data/economy.json` → `bays.steps`. Команда без
       * параметров намеренно: ступень всегда следующая по порядку, выбирать
       * тут нечего.
       */
      readonly kind: 'upgradeBays';
    }
  | {
      /**
       * Открыть ячейку ангара корабля (шаг 75). Лестница та же, что у цеха
       * (`bays.steps`); потолок — `mechCapacity` корабля. Без параметров, как
       * `upgradeBays`: ступень всегда следующая.
       */
      readonly kind: 'upgradeHangar';
    }
  | {
      /**
       * Модернизировать десантный корабль (Leopard -> Union -> Overlord).
       *
       * Поднимает потолок ангара (8 -> 16 -> 24) и стапелей цеха (4 -> 8 -> 16);
       * открытых ячеек и стапелей становится не меньше минимума нового корабля.
       * Доступна только на верфях (космопорт A/B, столицы/хабы, развитые миры).
       */
      readonly kind: 'upgradeDropship';
    }
  | {
      /**
       * Купить машину целиком с прилавка системы (шаг 19a).
       *
       * Зеркало `buyPart`: в сохранение уходит только факт покупки, сам
       * прилавок выводится (`market/mechs.ts`). Машина приходит подержанной и
       * без пилота — сажает его `assignPilot`.
       */
      readonly kind: 'buyMech';
      readonly lotId: string;
    }
  | {
      /**
       * Взять контракт с биржи системы, в которой рота стоит.
       *
       * Аванс зачисляется сразу, срок ставится задачей в очередь суток. Взятое
       * записывается дельтой — той же, что и покупка на рынке: сам список
       * предложений не хранится, он выводится (`contracts/board.ts`).
       */
      readonly kind: 'takeContract';
      readonly contractId: string;
    }
  | {
      /**
       * Разорвать контракт в одностороннем порядке: аванс возвращается
       * нанимателю, сверх того берётся штраф. Уход в минус при этом РАЗРЕШЁН —
       * неустойка не спрашивает, есть ли чем платить.
       */
      readonly kind: 'abandonContract';
    }
  | {
      /**
       * Вывести звено на бой. Состояния боя команда не создаёт — она фиксирует
       * состав вылета и сид, из которых `contracts/active.ts::contractBrief`
       * собирает `BattleBrief` (и на выходе в бой, и потом при разборе).
       */
      readonly kind: 'deploy';
      readonly recordIds: readonly string[];
      /**
       * Вылет под авто-расчёт штабом, а не на поле (шаг 74). Работа «только на
       * поле» (`contracts/board.ts::fieldOnly`) такой вылет отклоняет — ДО
       * списания платы за высадку. Бот замера флага не ставит и запрета не видит.
       */
      readonly auto?: boolean;
    }
  | {
      /**
       * Закрыть контракт по итогам боя — ШОВ, которого не было до шага 16.
       *
       * Здесь и только здесь боевой результат попадает в ростер командой:
       * повреждения, износ, опыт, трофеи по доле из условий контракта,
       * постановка раненых в лазарет очередью суток и расчёт с нанимателем.
       *
       * `withdrew` — организованное отступление, а не поражение (ловушка 3
       * брифинга): поле остаётся за противником (и выбывшие свои машины
       * теряются вместе с ним), но неустойки нет — отряд отработал честно.
       */
      /**
       * Экстренный заём Гильдии наёмников (шаг 35).
       *
       * Берётся, когда рота на мели: касса ниже порога и непогашенного займа
       * нет. Второго займа поверх первого Гильдия не даёт.
       */
      readonly kind: 'takeLoan';
    }
  | {
      /**
       * Кредит песочницы (шаг 74): +`sandbox.loanStep` в кассу и столько же в
       * долг. Беспроцентный, без сроков и без лимита; только в режиме `sandbox`.
       */
      readonly kind: 'takeSandboxLoan';
    }
  | {
      /** Вернуть один шаг кредита песочницы (шаг 74): касса и долг — минус `sandbox.loanStep`. */
      readonly kind: 'repaySandboxLoan';
    }
  | {
      readonly kind: 'resolveContract';
      readonly outcome: BattleOutcome;
      readonly withdrew?: boolean;
      /**
       * Какие трофеи забрать — выбор ИГРОКА (шаг 16a).
       *
       * Не задано — движок берёт самые дорогие, сколько позволяют очки выбора.
       * Задано — берётся ровно перечисленное, и команда отказывается, если
       * очков не хватает или позиции нет на поле. Список того, что вообще
       * предложено, экран получает у `contracts/salvage.ts::salvageOffer` — она
       * чистая и состояния не трогает, поэтому спрашивать её можно до команды.
       */
      readonly salvage?: readonly string[];
      /**
       * Какие трофеи разобрать НА ПОЛЕ вместо того, чтобы брать целиком
       * (шаг 34).
       *
       * Корпус остаётся на поле, а уцелевшее железо — орудия, охладители,
       * прыжковые, реактор и каркас — уходит на склад роты. Трюм запчастей
       * стойками десантного корабля не ограничен, поэтому разбор работает и при
       * полном ангаре: ровно та ситуация, в которой заработанный трофей раньше
       * просто пропадал (questions.md п. 11).
       *
       * Стоит того же очка выбора, что и целая машина: это выбор ФОРМЫ трофея,
       * а не способ получить больше.
       */
      readonly salvageScrap?: readonly string[];
      /**
       * Бой рассчитан штабом, а не отыгран игроком (шаг 69). Такой бой
       * боевых достижений не даёт и счёт добиваний не двигает; всё остальное
       * в расчёте контракта от него не зависит.
       */
      readonly auto?: boolean;
    };

/**
 * События для слоя показа и журнала. Показ ничего не пересчитывает — он
 * проигрывает то, что произошло (то же правило, что и в бою).
 */
export type CampaignEvent =
  | { readonly kind: 'dayAdvanced'; readonly from: number; readonly to: number }
  | {
      readonly kind: 'taskScheduled';
      readonly day: number;
      readonly seq: number;
      readonly task: ScheduledTask;
    }
  | {
      /** Задача подошла по сроку и исполнена. */
      readonly kind: 'taskDue';
      readonly day: number;
      readonly seq: number;
      readonly task: ScheduledTask;
    }
  | { readonly kind: 'companyRenamed'; readonly from: string; readonly to: string }
  | { readonly kind: 'jobScheduled'; readonly jobId: string; readonly recordId: string; readonly work: RepairWork; readonly cost: number; readonly days: number }
  | {
      readonly kind: 'jobCompleted';
      readonly jobId: string;
      readonly recordId: string;
      readonly work: RepairWork;
      /** Для `replacePart` — исход броска. У остальных работ всегда `true`. */
      readonly success: boolean;
    }
  /** Машина и вид работы едут в событии: задача к этому моменту уже снята из очереди, и журналу их больше не у кого спросить. */
  | { readonly kind: 'jobCancelled'; readonly jobId: string; readonly recordId: string; readonly work: RepairWork; readonly refund: number }
  | { readonly kind: 'payrollPaid'; readonly amount: number; readonly cbillsAfter: number; readonly bankrupt: boolean }
  | { readonly kind: 'pilotRecovered'; readonly pilotId: string }
  | {
      /** Травма зажила сама, тактом отдыха. `injuries` — сколько осталось. */
      readonly kind: 'pilotRested';
      readonly pilotId: string;
      readonly injuries: number;
    }
  | { readonly kind: 'mechScrapped'; readonly recordId: string; readonly warehousePartIds: readonly string[] }
  | { readonly kind: 'pilotAssigned'; readonly recordId: string; readonly pilotId: string | null }
  /** Перестановка парка — событие не про журнал (см. `reorderMechs`), а про сам факт для тестов и реплея. */
  | { readonly kind: 'mechsReordered' }
  | { readonly kind: 'pilotHired'; readonly pilotId: string; readonly cost: number }
  /** Объявление дало кандидата: кто пришёл и во что обошёлся поиск. */
  | {
      readonly kind: 'recruitFound';
      readonly pilotId: string;
      readonly name: string;
      readonly affiliation: string;
      readonly cost: number;
      readonly nextTryDay: number;
    }
  | { readonly kind: 'recruitRejected'; readonly pilotId: string; readonly name: string }
  | { readonly kind: 'pilotDismissed'; readonly pilotId: string }
  | { readonly kind: 'pilotTrained'; readonly pilotId: string; readonly skillId: string; readonly level: number }
  | {
      readonly kind: 'travelStarted';
      readonly toSystemId: string;
      readonly jumps: number;
      readonly days: number;
      readonly cost: number;
      readonly arrivalDay: number;
    }
  | { readonly kind: 'jumpCompleted'; readonly systemId: string; readonly leg: number; readonly remaining: number }
  | { readonly kind: 'arrived'; readonly systemId: string; readonly day: number }
  | { readonly kind: 'surveyStarted'; readonly systemId: string; readonly cost: number; readonly days: number }
  | { readonly kind: 'surveyed'; readonly systemId: string }
  | {
      readonly kind: 'partBought';
      readonly lotId: string;
      readonly partId: string;
      readonly cost: number;
    }
  | { readonly kind: 'partSold'; readonly partId: string; readonly price: number }
  | {
      readonly kind: 'partOrdered';
      readonly orderId: string;
      readonly partId: string;
      readonly cost: number;
      readonly arrivalDay: number;
    }
  | { readonly kind: 'partDelivered'; readonly orderId: string; readonly partId: string }
  | {
      /**
       * Снятый с машины узел лёг на склад (шаг 45): замена реактора или каркаса
       * возвращает старый узел так же, как мехлаб возвращает снятое орудие.
       */
      readonly kind: 'partStowed';
      readonly recordId: string;
      readonly partId: string;
      readonly node: WearNode;
    }
  | { readonly kind: 'mechSold'; readonly recordId: string; readonly price: number }
  | {
      /** Машина куплена целиком: запись уже в ростере, пилота в ней нет. */
      readonly kind: 'mechBought';
      readonly lotId: string;
      readonly recordId: string;
      readonly cost: number;
    }
  | {
      /** Переоснащение закончено: на машине новая навеска, снятое — на складе. */
      readonly kind: 'mechRefitted';
      readonly recordId: string;
      readonly warehousePartIds: readonly string[];
      readonly consumedPartIds: readonly string[];
    }
  | {
      /** Перекраска закончена (шаг 50). `paint: null` — машина снова в цветах происхождения. */
      readonly kind: 'mechRepainted';
      readonly recordId: string;
      readonly paint: string | null;
    }
  | { readonly kind: 'baysUpgraded'; readonly to: number }
  | { readonly kind: 'hangarUpgraded'; readonly to: number }
  | { readonly kind: 'dropshipUpgraded'; readonly dropship: DropshipId; readonly cost: number }
  | {
      readonly kind: 'contractTaken';
      readonly contract: Contract;
      readonly advance: number;
      readonly deadlineDay: number;
    }
  | { readonly kind: 'contractAbandoned'; readonly contractId: string; readonly charged: number }
  | { readonly kind: 'contractFailed'; readonly contractId: string; readonly penalty: number }
  | {
      /** Взят экстренный заём Гильдии наёмников (шаг 35). */
      readonly kind: 'loanTaken';
      readonly principal: number;
      /** Сколько предстоит вернуть всего, с процентом. */
      readonly debt: number;
      readonly installment: number;
    }
  | {
      /** Взят кредит песочницы (шаг 74). `debt` — долг после команды. */
      readonly kind: 'sandboxLoanTaken';
      readonly amount: number;
      readonly debt: number;
    }
  | {
      /** Возвращён шаг кредита песочницы (шаг 74). `debt` — долг после команды. */
      readonly kind: 'sandboxLoanRepaid';
      readonly amount: number;
      readonly debt: number;
    }
  | {
      /** Трофей разобран на поле: корпус остался, железо ушло на склад (шаг 34). */
      readonly kind: 'trophyScrapped';
      readonly recordId: string;
      readonly parts: number;
    }
  | {
      /**
       * Невостребованные очки утиля выкуплены нанимателем (шаг 34).
       *
       * До этого шага они просто сгорали: игрок торговался за долю утиля при
       * подписании, побеждал, удерживал поле — и оставлял машину на поле даром,
       * если ангар полон (questions.md п. 11).
       */
      readonly kind: 'salvageBoughtOut';
      readonly machines: number;
      readonly amount: number;
    }
  | {
      readonly kind: 'deployed';
      readonly contractId: string;
      readonly recordIds: readonly string[];
      readonly enemyUnits: number;
    }
  | {
      /**
       * Плата за высадку сверх нормы нанимателя (шаг 67). Приходит вслед за
       * `deployed` и только когда звено сильнее нормы: в пределах нормы вылет
       * оплачивает наниматель.
       */
      readonly kind: 'landingPaid';
      readonly contractId: string;
      readonly amount: number;
      /** Перевес, по которому взята плата (`LandingQuote.feeRatio`), — за что заплачено. */
      readonly feeRatio: number;
      readonly cbillsAfter: number;
    }
  | {
      readonly kind: 'contractResolved';
      readonly contractId: string;
      readonly result: ContractResult;
      /** Доплата (успех) или неустойка со знаком минус (провал). Аванс уже уплачен при взятии. */
      readonly settlement: number;
      /** Сколько трофеев рота имела право забрать по условиям и сколько было доступно. */
      readonly salvagePoints: number;
      readonly salvageAvailable: number;
      readonly trophyRecordIds: readonly string[];
      readonly lostRecordIds: readonly string[];
    }
  | { readonly kind: 'pilotAdmitted'; readonly pilotId: string; readonly days: number }
  | { readonly kind: 'pilotLost'; readonly pilotId: string }
  | {
      /**
       * Наниматель заплатил за долю трофеев, которой не хватило на целую
       * машину. Бывает ровно тогда, когда очков выбора ноль, а поле удержано.
       */
      readonly kind: 'salvageCompensated';
      readonly amount: number;
      readonly share: number;
    }
  | {
      /**
       * Отношение фракции к отряду изменилось (шаг 20).
       *
       * Из этих событий журнал репутации собирается САМ — ровно как боевой
       * журнал из `BattleEvent` (`game_core.md` §4.4). Отдельного списка
       * «история отношений» в состоянии нет и не будет: он был бы вторым
       * источником истины рядом с самими осями и однажды разошёлся бы с ними.
       *
       * `after` — значение ПОСЛЕ упора в край шкалы, поэтому сумма дельт
       * журнала может не сойтись с текущим числом, а `after` сойдётся всегда.
       */
      readonly kind: 'reputationChanged';
      readonly factionId: string;
      readonly delta: number;
      readonly after: number;
      readonly reason: ReputationReason;
      /** Чем вызвано: исход контракта или затухание. */
      readonly source: ReputationSource;
    }
  | {
      /** Известность и надёжность — оси отряда, не фракции, поэтому событие своё. */
      readonly kind: 'companyReputationChanged';
      readonly fame: number;
      readonly reliability: number;
      readonly fameDelta: number;
      readonly reliabilityDelta: number;
      readonly source: ReputationSource;
    }
  | {
      /**
       * Такт экономики фракции (шаг 21a).
       *
       * Событие одно на фракцию, а не одно на весь такт: сводка новостей 21b
       * собирается из событий, как журнал репутации, и «Ляо третий год живёт в
       * долг» обязано читаться по одной фракции, а не выуживаться из общей
       * суммы. Второго списка «история бюджетов» в состоянии нет и не будет.
       */
      readonly kind: 'factionEconomyTicked';
      readonly factionId: string;
      /** Доход минус содержание за этот такт. Отрицательный — фракция живёт в долг. */
      readonly surplus: number;
      readonly treasuryAfter: number;
      /** Военный фонд по всем направлениям после такта. */
      readonly warFundAfter: number;
    }
  | {
      /**
       * Фронт сдвинулся (шаг 21b): мир сменил владельца либо пережил клановый
       * набег.
       *
       * Одно событие на СОБЫТИЕ МИРА, а не одно на такт: из них собирается
       * сводка новостей (часть D) ровно тем же приёмом, что журнал репутации из
       * `reputationChanged`. Второго списка «история войны» в состоянии нет и не
       * будет — он был бы вторым источником истины рядом с владением и
       * разорением и однажды разошёлся бы с ними.
       *
       * `kind: 'raid'` — перемирие Тукайида: клан разорил сферный мир, но не
       * занял его (решение 2). Владелец в этом случае не менялся, и `attacker`
       * пришёл и ушёл.
       */
      readonly kind: 'frontMoved';
      readonly systemId: string;
      readonly kindOfMove: 'capture' | 'raid';
      readonly attacker: string;
      readonly defender: string;
      /** Разорение мира ПОСЛЕ события, 0..1. */
      readonly ruined: number;
      /**
       * Шанс, посчитанный ДО боя: «взяли с трудом» и «смяли» — разные новости.
       *
       * С шага 22c это именно ОЖИДАНИЕ, а не то, чем всё решилось: исход даёт
       * настоящий бой (`war/battle.ts`), и он с ожиданием спорит. Ровно ради
       * этого спора кубик и убрали.
       */
      readonly odds: number;
      /** Сколько машин вывела каждая сторона и сколько потеряла (шаг 22c). */
      readonly attackerSize: number;
      readonly defenderSize: number;
      readonly attackerLost: number;
      readonly defenderLost: number;
    }
  | {
      /**
       * Государство объявило наступление, взяло своё или выдохлось (шаг 23,
       * часть B).
       *
       * `systemId` — мир, к которому стягиваются силы. Это и есть та половина
       * ответа на «где искать войну», которой у игрока не было: до замысла
       * фракция давила всюду понемногу, и лететь было некуда конкретно.
       */
      readonly kind: 'warPlan';
      readonly factionId: string;
      readonly against: string;
      readonly systemId: string;
      readonly result: 'declared' | 'done' | 'spent';
    }
  | {
      /**
       * Мир развился или просел (шаг 23, часть A).
       *
       * `from`/`to` — ступени ОТКЛОНЕНИЯ от канонического профиля, а не сам
       * профиль: что одна ступень делает с миром, знает `galaxy/profile.ts`, и
       * второго ответа на этот вопрос в игре нет.
       */
      readonly kind: 'worldDeveloped';
      readonly systemId: string;
      readonly owner: string;
      readonly from: number;
      readonly to: number;
      readonly built: boolean;
    }
  | {
      /**
       * Пиратский набег прорвался в тылу (шаг 37a).
       *
       * Отбитый набег события не рождает — и это не экономия на строке: тыл
       * держится именно тем, что набеги идут постоянно, а разоряет мир только
       * прорвавшийся. Событие «пираты попробовали и не смогли» захламляло бы
       * журнал ровно тем, что ничего не изменило.
       */
      readonly kind: 'pirateRaid';
      readonly systemId: string;
      readonly owner: string;
      /** На сколько выросло разорение мира. */
      readonly ruined: number;
      /** Вольница вывезла ступень развития, а не только сожгла. */
      readonly sacked: boolean;
    }
  | {
      /**
       * Мир стал чище: выигранный подряд против вольницы (шаг 37a).
       *
       * Свойство МИРА, а не роты: событие рождается и когда вычистил соперник.
       */
      readonly kind: 'pirateCleared';
      readonly systemId: string;
      readonly cleared: number;
    }
  | {
      /**
       * Рота купила мир (шаг 25, часть C) — ступень 4 лестницы `vision.md`.
       */
      readonly kind: 'worldBought';
      readonly systemId: string;
      readonly from: string;
      readonly price: number;
    }
  | {
      /**
       * Рота ЗАХВАТИЛА мир силой (шаг 38, путь меча). Отдельное событие, а не
       * покупка за ноль: в летописи мира это разные строки, и в интерфейсе тоже.
       */
      readonly kind: 'worldConquered';
      readonly systemId: string;
      readonly from: string;
      /** Трофеи захвата в кассу роты (шаг 90, ступень 8). Нет поля — нечего было взять. */
      readonly loot?: number;
    }
  | {
      /** Дом пожаловал роте приграничный лен (шаг 38, путь службы). */
      readonly kind: 'worldGranted';
      readonly systemId: string;
      readonly from: string;
      /** До какого дня лен платит дань жалующему Дому (проект державы, шаг 1). */
      readonly tributeUntil: number;
    }
  | {
      /**
       * Держава игрока поставила в строй или распустила полевые полки (шаг 27).
       */
      readonly kind: 'regimentRaised';
      readonly mechs: number;
      readonly armyAfter: number;
      readonly price: number;
    }
  | {
      /** Касса легла в военный фонд державы (шаг 80): сколько разложено по врагам. */
      readonly kind: 'warFunded';
      readonly amount: number;
    }
  | {
      /** Держава роты сменила военный бюджет (проект державы, шаг 2). */
      readonly kind: 'warBudgetSet';
      readonly share: number;
    }
  | {
      /**
       * Бой фронта с державой роты при любом исходе (шаг 78): бой такта (`war/front.ts::FrontClash`)
       * или приказ армии (проект державы, шаг 3). До шага 78 проигранный бой и отбитая оборона
       * события не рождали, а приказ отдавал своё (`offensiveOrdered`); теперь событие одно.
       */
      readonly kind: 'frontClash';
      readonly systemId: string;
      readonly attacker: string;
      readonly defender: string;
      readonly outcome: 'captured' | 'tributed' | 'repelled';
      /** Соотношение сил до боя, `sectorForces.odds`. */
      readonly odds: number;
      readonly attackerSize: number;
      readonly defenderSize: number;
      readonly attackerLost: number;
      readonly defenderLost: number;
      /** Приказ армии: сколько ушло из военного фонда. Нет поля — бой такта. */
      readonly cost?: number;
      /** Трофеи выигранного приказа в кассу роты (шаг 90, ступень 8): казна мира и доля фонда врага. */
      readonly loot?: number;
      /** Разорение взятого по приказу мира. У боя такта оно — в `frontMoved`. */
      readonly ruined?: number;
      /**
       * Столкновение звена роты в приказе (шаг 86): сколько машин роты, сколько противник отделил против
       * неё и сколько из них рота выбила до главного боя; машины роты, потерянные в столкновении. Нет
       * поля — роты в бою не было. Потери армии — `attackerLost`, выбитое ротой входит в `defenderLost`.
       */
      readonly company?: {
        readonly mechs: number;
        readonly detachment: number;
        readonly knocked: number;
        readonly lostRecordIds: readonly string[];
      };
      /**
       * Гарнизон роты в бою за свой мир (шаг 86b): то же, что `company`, на стороне обороны; `withdrew` —
       * ушёл без боя по политике (тогда `mechs` — сколько ушло, `knocked` 0). Выбитое гарнизоном входит в
       * `attackerLost`.
       */
      readonly garrison?: {
        readonly mechs: number;
        readonly detachment: number;
        readonly knocked: number;
        readonly lostRecordIds: readonly string[];
        readonly withdrew: boolean;
      };
    }
  | {
      /** Машины выгружены гарнизоном на мир (шаг 86b). */
      readonly kind: 'garrisonUnloaded';
      readonly systemId: string;
      readonly recordIds: readonly string[];
    }
  | {
      /** Машины гарнизона забраны на корабль (шаг 86b). */
      readonly kind: 'garrisonLoaded';
      readonly systemId: string;
      readonly recordIds: readonly string[];
    }
  | {
      /** Политика гарнизона мира изменена (шаг 86b). */
      readonly kind: 'garrisonPolicySet';
      readonly systemId: string;
      readonly policy: GarrisonPolicy;
    }
  | {
      /**
       * Гарнизон ушёл с мира на свой мир в прыжке (шаг 86b): по политике перед боем (`policy`) или потому,
       * что мир ушёл от роты (`worldLost`). До дня `arrives` машины в пути.
       */
      readonly kind: 'garrisonWithdrawn';
      readonly from: string;
      readonly to: string;
      readonly arrives: number;
      readonly recordIds: readonly string[];
      readonly reason: 'policy' | 'worldLost';
    }
  | {
      /** Машина гарнизона без пилота наняла его сама по цене поиска (шаг 86b). */
      readonly kind: 'garrisonPilotHired';
      readonly systemId: string;
      readonly recordId: string;
      readonly pilotId: string;
      readonly cost: number;
    }
  | {
      /** Стройка поставлена (шаг 87): цена списана, `decades` — срок при нынешних очках мира. */
      readonly kind: 'buildingStarted';
      readonly systemId: string;
      readonly building: BuildingKind;
      readonly cost: number;
      readonly decades: number;
    }
  | {
      /** Стройка отменена (шаг 87): вернулось `refund`. */
      readonly kind: 'buildingCancelled';
      readonly systemId: string;
      readonly building: BuildingKind;
      readonly refund: number;
    }
  | {
      /** Постройка готова (шаг 87). */
      readonly kind: 'buildingDone';
      readonly systemId: string;
      readonly building: BuildingKind;
    }
  | {
      /** Губернатор назначен (шаг 88); `replaced` — прежний губернатор того же сектора, теперь свободен. */
      readonly kind: 'governorAppointed';
      readonly centerId: string;
      readonly pilotId: string;
      readonly priority: GovernorPriority;
      readonly replaced?: string;
    }
  | { readonly kind: 'sectorPrioritySet'; readonly centerId: string; readonly priority: GovernorPriority }
  | {
      /**
       * Сектор распущен (шаг 88): командой или потерей центра. `pilotId` — губернатор, снова свободный; `null` —
       * пост был пуст.
       */
      readonly kind: 'sectorDissolved';
      readonly centerId: string;
      readonly pilotId: string | null;
      readonly reason: 'command' | 'centerLost';
    }
  | {
      /** Губернатора уволили (шаг 88): пост пуст, сектор ничего не делает, пока не назначат другого. */
      readonly kind: 'governorLeft';
      readonly centerId: string;
      readonly pilotId: string;
    }
  | { readonly kind: 'worldPinned'; readonly systemId: string; readonly pinned: boolean }
  | { readonly kind: 'realmReserveSet'; readonly amount: number }
  | {
      /** Стойка фронта задана (шаг 88); `ended` — война кончилась, и такт снял стойку. */
      readonly kind: 'frontStanceSet';
      readonly factionId: string;
      readonly stance: FrontStance;
      readonly ended?: true;
    }
  | {
      /** Цель стойки задана игроком (шаг 93); `systemId: null` — снята, `ended` — такт снял её с войной или участком. */
      readonly kind: 'stanceTargetSet';
      readonly factionId: string;
      readonly systemId: string | null;
      readonly ended?: true;
    }
  | { readonly kind: 'worldSectorAssigned'; readonly systemId: string; readonly center: string | null }
  | {
      /**
       * Команда политики державы (шаг 88): кто отдал (губернатор сектора или стойка фронта) и что. События самой
       * команды (стройка поставлена, бой фронта, мир) идут следом, как от игрока.
       */
      readonly kind: 'realmPolicy';
      readonly by: PolicyActor;
      readonly act: PolicyAct;
    }
  | {
      /**
       * Мир ушёл от роты (шаг 87): `lost` снесены, `kept` уцелели и спят до возврата мира, `construction` —
       * пропавший недострой.
       */
      readonly kind: 'buildingsLost';
      readonly systemId: string;
      readonly lost: readonly BuildingKind[];
      readonly kept: readonly BuildingKind[];
      readonly construction?: BuildingKind;
    }
  | {
      /** Мир ушёл от роты, а своего мира в прыжке нет: гарнизон потерян вместе с пилотами (шаг 86b). */
      readonly kind: 'garrisonLost';
      readonly systemId: string;
      readonly recordIds: readonly string[];
    }
  | {
      /**
       * Гарнизон дал бой восстанию на своём мире (шаг 86b): противник — работы «подавить восстание» этой
       * декады. `won` — восстание подавлено.
       */
      readonly kind: 'garrisonRevoltBattle';
      readonly systemId: string;
      readonly won: boolean;
      readonly mechs: number;
      readonly enemy: number;
      readonly lostRecordIds: readonly string[];
    }
  | {
      /**
       * Итог боёв державы роты за такт фронта (шаг 78): сколько было боёв и сколько армия потеряла.
       * Армия — `totalArmy` до и после такта, а не сумма потерь боёв: машины, которых на театре не
       * было, списать не с чего (`withTheaterLoss`), и строка говорит, что стало с армией на деле.
       */
      readonly kind: 'realmFrontTally';
      readonly battles: number;
      readonly armyBefore: number;
      readonly armyAfter: number;
    }
  | {
      /**
       * Домен роты отработал такт (шаг 25, часть C): доход своих миров минус их
       * содержание, прямо в кассу. Событие есть, только пока миры есть.
       */
      readonly kind: 'domainTicked';
      readonly worlds: number;
      readonly income: number;
      readonly upkeep: number;
      /** Содержание полевой армии роты за декаду (проект державы, шаг 1). */
      readonly army: number;
      /** Сколько из итога легло в военный фонд по бюджету державы (проект державы, шаг 2). */
      readonly fund: number;
      /** Содержание построек державы за декаду (шаг 87). */
      readonly buildings: number;
    }
  | {
      /**
       * Мир меняет специализацию (шаг 25, часть A).
       *
       * Два события на одну переделку, а не одно: `started` — владелец заплатил
       * и начал, `done` — год прошёл и мир стал другим. Между ними мир работает
       * по-старому, и это видно в сводке: специализация — решение с отложенным
       * следствием, а не мгновенная покупка.
       */
      readonly kind: 'worldFocus';
      readonly systemId: string;
      readonly owner: string;
      readonly from: WorldFocus;
      readonly to: WorldFocus;
      readonly started: boolean;
    }
  | {
      /**
       * Подчинение сдвинулось (шаг 26): дань наложена или истекла, протекторат
       * установлен или разорван, договор заключён или истёк.
       *
       * Одно событие на все шесть родов, а не шесть событий: сводка новостей
       * читает `kind` и рассказывает своими словами, а второго списка «что
       * случилось с дипломатией» в состоянии не заводится — правда это карта и
       * состояние войны, а событие лишь рассказывает, как они такими стали.
       */
      readonly kind: 'diplomacyMoved';
      readonly move:
        | 'tribute'
        | 'tributeLapsed'
        | 'protectorate'
        | 'protectorateBroken'
        | 'pact'
        | 'pactLapsed'
        | 'war'
        | 'peaceOffer'
        | 'coalition';
      readonly over: string;
      readonly under: string;
      readonly systemId?: string;
      readonly pact?: 'truce' | 'trade';
      /** Против кого коалиция (шаг 83) — только у `coalition`. */
      readonly against?: string;
      /** Кто ведёт коалицию против державы роты (шаг 91) — только у `war`, объявленной вслед за ведущим. */
      readonly leader?: string;
    }
  | {
      /**
       * Сработало событие мира (шаг 84): веха эпохи из `data/events.json`. Что оно сделало — те же
       * отношения, договоры и замыслы, что видны в состоянии; карточку экран собирает по `id`.
       */
      readonly kind: 'worldEvent';
      readonly id: string;
      /** Касается державы роты — метка «держава» в сводке. */
      readonly realm: boolean;
      /** Держава приглашена в коалицию — на карточке выбор. */
      readonly invite: boolean;
    }
  | {
      /** Карточку события закрыли (шаг 84); `accept` — ответ на приглашение, если оно было. */
      readonly kind: 'worldEventAnswered';
      readonly id: string;
      readonly accept?: boolean;
    }
  | {
      /**
       * Мир роты с фракцией (шаг 76): `cost` — отступные (0 — даром),
       * `ceded` — мир, уступленный вместо них.
       */
      readonly kind: 'peaceMade';
      readonly factionId: string;
      readonly cost: number;
      readonly ceded?: string;
      /** До какого дня действует перемирие — с надбавкой за взятые миры (шаг 3b). */
      readonly truceUntil: number;
      /** Шаг 81: миры цели, перешедшие роте, — мир по предложению фракции. */
      readonly gained?: readonly string[];
      /** Шаг 81: миры цели, ставшие данниками роты. */
      readonly tributaries?: readonly string[];
      /** Шаг 81: выдана цель «унижение». */
      readonly humiliated?: true;
      /** Шаг 81: взятое сверх цели, ушедшее назад фракции. */
      readonly returned?: readonly string[];
      /** Шаг 81: мир заключён сам — усталость этой стороны дошла до предела. */
      readonly forced?: 'realm' | 'foe';
      /** Шаг 90: фракция миром признала сюзеренитет державы. */
      readonly protectorate?: true;
      /** Шаг 83: миры цели фракции, отданные державой, — держава проиграла войну, объявленную по угрозе. */
      readonly yielded?: readonly string[];
    }
  | {
      /**
       * Война роты кончилась без команды мира (шаг 79): договор, подчинение, падение державы или
       * потеря общей границы с пиратами и кланами. Мир командой — `peaceMade`.
       */
      readonly kind: 'warEnded';
      readonly factionId: string;
      readonly how: 'pact' | 'vassal' | 'realmFallen' | 'noBorder';
    }
  | {
      /** Рота отказалась от мира (шаг 75): он вернулся владельцу по канону `to`. */
      readonly kind: 'worldAbandoned';
      readonly systemId: string;
      readonly to: string;
    }
  | {
      /** Мир роты восстал (шаг 85): лояльность упала ниже порога; на его бирже — подавление. */
      readonly kind: 'worldRevolt';
      readonly systemId: string;
      /** Прежний владелец: его ополчение поднимает восстание, ему мир отойдёт. */
      readonly formerOwner: string;
    }
  | {
      /** Рота подавила восстание на своём мире (шаг 85): лояльность вверх, восстание снято. */
      readonly kind: 'worldRevoltSuppressed';
      readonly systemId: string;
      /** Подавила армия державы в последнюю декаду срока (шаг 90) — и сколько машин стоило; нет поля — рота. */
      readonly by?: 'army';
      readonly mechs?: number;
    }
  | {
      /** Восстание не подавлено в срок (шаг 85): мир отошёл прежнему владельцу `to`. */
      readonly kind: 'worldSeceded';
      readonly systemId: string;
      readonly to: string;
    }
  | {
      /** Столица державы роты перенесена (шаг 72a). `from` — прежняя столица. */
      readonly kind: 'capitalMoved';
      readonly systemId: string;
      readonly from: string;
      readonly price: number;
    }
  | {
      /**
       * Рота стала державой или перестала ею быть (шаг 72a, с 72c — первый мир
       * получен или последний потерян, `war/domain.ts::isPlayerRealm`).
       *
       * Держава не хранится, а считается, поэтому событие рождает не команда,
       * а сам `execute`, сравнивая до и после. Заведено ради предупреждения:
       * с первого мира рота на фронте, её миры можно отнять, и узнать об этом
       * игрок обязан в тот же день, а не по первой потере.
       */
      readonly kind: 'realmChanged';
      readonly realm: boolean;
    }
  | {
      /** Рота открыла достижение (шаг 69). Название — на экране, по id. */
      readonly kind: 'achievementUnlocked';
      readonly id: string;
    }
  | {
      /** Рота выкупила дань со своего мира (шаг 26, часть C). */
      readonly kind: 'tributeBought';
      readonly systemId: string;
      readonly from: string;
      readonly price: number;
    }
  | {
      /**
       * Рота повлияла на войну (шаг 21b, часть C, решение 5).
       *
       * Выигранный контракт добавляет нанимателю силы на участке против цели.
       * Четыре машины не выигрывают войну, поэтому событие есть, а заметного
       * следа на карте нет: вклад обязан читаться в сводке.
       */
      readonly kind: 'warEffort';
      readonly employer: string;
      readonly target: string;
      readonly amount: number;
    }
  | {
      /**
       * Соперник отработал контракт (шаг 22).
       *
       * Одно событие на КОНТРАКТ, а не одно на такт, — тем же приёмом, что
       * `frontMoved` и `reputationChanged`: из этих событий собирается строка
       * сводки «работу забрали из-под носа», и второго списка «история
       * соперников» в состоянии нет и не будет.
       *
       * `systemId` здесь не украшение: работа, взятая в системе, где стоит рота,
       * — это прямая конкуренция за биржу, а взятая за три прыжка — просто
       * новость. Различает их тот, кто читает событие, а не тот, кто его пишет.
       */
      readonly kind: 'rivalContract';
      readonly rivalId: string;
      readonly rivalName: string;
      readonly systemId: string;
      readonly contractId: string;
      readonly employer: string;
      readonly target: string;
      readonly mission: string;
      readonly result: 'won' | 'withdrawn' | 'lost';
      readonly payout: number;
      readonly mechsLost: number;
      readonly trophies: number;
    }
  | {
      /** Соперник перелетел в соседнюю систему: там работы больше. */
      readonly kind: 'rivalMoved';
      readonly rivalId: string;
      readonly rivalName: string;
      readonly from: string;
      readonly to: string;
    }
  | {
      /**
       * Великий полк отработал подряд (шаг 22c).
       *
       * Редкое и крупное событие — полковая операция идёт месяцами, — поэтому,
       * в отличие от гарнизонной работы за три прыжка, ей в сводке войны место.
       */
      readonly kind: 'regimentCommission';
      readonly regimentId: string;
      readonly regimentName: string;
      readonly systemId: string;
      readonly employer: string;
      readonly target: string;
      readonly won: boolean;
      /** Машин выведено и машин потеряно: цена подряда читается числом. */
      readonly size: number;
      readonly lost: number;
      readonly enemyLost: number;
    }
  | {
      /**
       * Великий полк перешёл к другому фронту (шаг 82): встал на мир `to`, и его владелец
       * `employer` — новый наниматель.
       */
      readonly kind: 'regimentMoved';
      readonly regimentId: string;
      readonly regimentName: string;
      readonly from: string;
      readonly to: string;
      readonly employer: string;
    }
  | {
      /** Держава наняла великий полк (шаг 89): против кого, где встал, цена и последний день срока. */
      readonly kind: 'greatRegimentHired';
      readonly regimentId: string;
      readonly regimentName: string;
      readonly against: string;
      readonly systemId: string;
      readonly price: number;
      readonly until: number;
    }
  | {
      /** Титул державы сменился (шаг 89): по числу миров; `null` — державы нет. */
      readonly kind: 'realmTitleChanged';
      readonly from: string | null;
      readonly to: string | null;
    }
  | {
      /** Прорвавшийся набег на мир роты (шаг 89): на бирже мира — оборона против вольницы до дня `until`. */
      readonly kind: 'homeRaidPosted';
      readonly systemId: string;
      readonly until: number;
    }
  | {
      /** Работа «пираты у дома» выиграна (шаг 89): ротой по контракту или гарнизоном в такте. */
      readonly kind: 'homeRaidRepelled';
      readonly systemId: string;
      readonly by: 'company' | 'garrison';
    }
  | {
      /** Гарнизон бился с вольницей на своём мире (шаг 89): как `garrisonRevoltBattle`. */
      readonly kind: 'garrisonRaidBattle';
      readonly systemId: string;
      readonly won: boolean;
      readonly mechs: number;
      readonly enemy: number;
      readonly lostRecordIds: readonly string[];
    }
  | {
      /** Сосед требует дань с мира державы (шаг 89): карточка открыта, время стоит до ответа. */
      readonly kind: 'demandIssued';
      readonly from: string;
      readonly systemId: string;
    }
  | {
      /** Ответ на требование (шаг 89): принято, отказано или потеряло смысл (мир ушёл, война, договор). */
      readonly kind: 'demandAnswered';
      readonly from: string;
      readonly systemId: string;
      readonly outcome: DemandOutcome;
      /** Ответ соседа на отказ (2026-10-07): набег на мир или отношение вниз. Только у `refused`. */
      readonly punishment?: RefusalPunishment;
    }
  | {
      /** Найм полка державой кончился (шаг 89): срок, мир с врагом, потеря мира стоянки. */
      readonly kind: 'greatRegimentHireEnded';
      readonly regimentId: string;
      readonly regimentName: string;
      readonly against: string;
      readonly how: HireEnd;
    }
  | {
      /**
       * Соперник разорился, и на его место пришёл новый отряд.
       *
       * Уход и приход — одно событие, а не два: рынок наёмников не пустует, и
       * «сверху всегда есть кто-то, кого можно догнать» перестало бы быть
       * правдой к середине кампании, если бы список только убывал.
       */
      readonly kind: 'rivalGone';
      readonly rivalId: string;
      readonly rivalName: string;
      readonly replacedById: string;
      readonly replacedByName: string;
      readonly systemId: string;
    };

/** Откуда пришло изменение репутации. Растёт вместе с тем, что её меняет. */
export type ReputationSource = ReputationOutcome | 'decay';

export enum CampaignRejectReason {
  /** Время идёт только вперёд: отмотать кампанию назад можно только загрузкой. */
  NonPositiveSpan = 'nonPositiveSpan',
  /** Задача назначена на прошедший день — её никто и никогда не исполнит. */
  DayInPast = 'dayInPast',
  EmptyName = 'emptyName',
  MechNotFound = 'mechNotFound',
  PilotNotFound = 'pilotNotFound',
  JobNotFound = 'jobNotFound',
  InsufficientFunds = 'insufficientFunds',
  /** Все стапели заняты (`company.bays`). */
  NoBay = 'noBay',
  /** Зона уже на паспортном уровне — чинить нечего. */
  NothingToRepair = 'nothingToRepair',
  /** Зона разрушена — `repairZone` не про это, нужна `replacePart`. */
  ZoneDestroyed = 'zoneDestroyed',
  /** `replacePart` — а зона цела, менять нечего. */
  ZoneNotDestroyed = 'zoneNotDestroyed',
  /** Торс и голова не восстанавливаются полевой заменой — правило, не недоработка. */
  ZoneUnrepairable = 'zoneUnrepairable',
  SameClass = 'sameClass',
  NoWear = 'noWear',
  PilotNotActive = 'pilotNotActive',
  /** Лечить нечего: травм у пилота нет. */
  PilotNotInjured = 'pilotNotInjured',
  DuplicatePilotId = 'duplicatePilotId',
  /** Попытка найма ещё не подошла: она даётся раз в две недели и не копится. */
  HireNotReady = 'hireNotReady',
  /** По прошлому кандидату решения нет: сначала принять или отказать. */
  RecruitPending = 'recruitPending',
  /** Кандидата нет — решать не по кому. */
  NoRecruit = 'noRecruit',
  CannotTrain = 'cannotTrain',
  /** У машины есть незавершённая работа стапеля — сначала отменить или дождаться. */
  MechHasPendingJob = 'mechHasPendingJob',
  /** `reorderMechs`: список id не совпадает с парком — ни числом, ни составом. */
  InvalidOrder = 'invalidOrder',
  /** Такой системы нет в каталоге. */
  SystemNotFound = 'systemNotFound',
  /** Рота уже в пути: маршрут не переигрывается на полдороге. */
  AlreadyTravelling = 'alreadyTravelling',
  /** Рота уже в этой системе. */
  AlreadyThere = 'alreadyThere',
  /** Между системами нет пути прыжками по 30 св. лет. */
  NoRoute = 'noRoute',
  /** `Jump` — а система дальше одного прыжка. Дальше ходит `Travel`. */
  NotAdjacent = 'notAdjacent',
  /** Система уже разведана — второй раз платить не за что. */
  AlreadySurveyed = 'alreadySurveyed',
  /** Рынок — по месту: в прыжке и на орбите лавки нет. Ремонт при этом идёт (решение 11 §7). */
  NotAtMarket = 'notAtMarket',
  /** Такой позиции в лавке этой системы на эту декаду нет — либо не было, либо уже куплена. */
  LotNotAvailable = 'lotNotAvailable',
  /** Гильдия займа не даёт: касса ещё не бедственная или прежний долг не погашен. */
  LoanNotAvailable = 'loanNotAvailable',
  /** Работа «только на поле» (шаг 74): укреплённую и решающую судьбу сектора штабу не отдают. */
  FieldOnly = 'fieldOnly',
  /** Кредиты по требованию бывают только в режиме «Песочница» (шаг 74). */
  SandboxOnly = 'sandboxOnly',
  /** Возвращать нечего: долга по кредитам песочницы нет. */
  NoSandboxDebt = 'noSandboxDebt',
  /** Такой записи на складе нет. */
  PartNotFound = 'partNotFound',
  /** Узел не подходит машине: не тот тоннаж, не тот тир или это установка, а не узел. */
  PartMismatch = 'partMismatch',
  /** Узел уже в цеху: его ставит незавершённая работа. Отмени её — вернётся на полку. */
  PartReserved = 'partReserved',
  /** Этот класс исполнения здесь не продают. Ровно это и делает перелёт решением. */
  ClassNotSold = 'classNotSold',
  /** Отсюда не заказывают: периферия живёт тем, что есть под рукой. */
  NoDelivery = 'noDelivery',
  /** Машина не на ходу: оторванные конечности или невосстановленная структура продаются только разбором. */
  MechNotRunning = 'mechNotRunning',
  /** Такого предложения на бирже этой системы на эту декаду нет — либо не было, либо уже взято. */
  ContractNotAvailable = 'contractNotAvailable',
  /** Контракт уже взят. Второй на те же сутки означал бы, что срок ничего не стоит. */
  ContractActive = 'contractActive',
  /** Команда про контракт — а контракта нет. */
  NoContract = 'noContract',
  /** Звено уже выведено: переиграть состав после выхода нельзя. */
  AlreadyDeployed = 'alreadyDeployed',
  /** Разбор боя — а рота на контракт не выходила. */
  NotDeployed = 'notDeployed',
  /** В звене нет ни одной машины, или их больше, чем берёт корабль. */
  BadLance = 'badLance',
  /** Машина не годна к вылету: разрушен торс или голова, нет пилота, пилот в лазарете. */
  MechNotDeployable = 'mechNotDeployable',
  /** Выбор трофеев не сходится: очков не хватает, позиции нет на поле или она названа дважды. */
  BadSalvage = 'badSalvage',
  /** Целевая сборка не годится: не проходит валидатор, меняет платформу или на складе нет железа. */
  BadRefit = 'badRefit',
  /** Машина не в паспортном состоянии: переоснащают исправную, сначала ремонт (`company/refit.ts`). */
  MechNotRepaired = 'mechNotRepaired',
  /** Мир уже принадлежит роте — второй раз покупать нечего. */
  AlreadyOwned = 'alreadyOwned',
  /** Мир роте не принадлежит: фокус и развитие задаёт владелец. */
  NotOwned = 'notOwned',
  /** Мир не продаётся: столица державы или мир, за который сейчас идёт война. */
  WorldNotForSale = 'worldNotForSale',
  /** Владелец не станет иметь дела с ротой: отношение ниже порога продажи мира. */
  StandingTooLow = 'standingTooLow',
  /** Договор (отладка 2026-10-03): отношение с фракцией ниже порога дипломатии — прежде отвечал текст о продаже мира. */
  PactStandingTooLow = 'pactStandingTooLow',
  /** Лен (отладка 2026-10-03): отношение с Домом ниже порога лена — прежде отвечал текст о продаже мира. */
  GrantStandingTooLow = 'grantStandingTooLow',
  /** Мир силой не берётся: не ничейный и не пиратский, либо рота его не заслужила боями. */
  WorldNotConquerable = 'worldNotConquerable',
  /** Лен не жалуют: мир не приграничный, отношение или известность малы, или рота здесь не служила. */
  GrantNotOffered = 'grantNotOffered',
  /** Переделка фокуса уже идёт, или мир уже занят этим фокусом. */
  FocusUnchanged = 'focusUnchanged',
  /** Столица державы уже на этом мире (шаг 72a). */
  AlreadyCapital = 'alreadyCapital',
  /** Последний мир не продаётся, пока у державы есть полевая армия: сперва распустить (шаг 72e). */
  ArmyStillRaised = 'armyStillRaised',
  /** Столицу переносили меньше полугода назад (шаг 72b, `domain.capitalMoveCooldownDays`). */
  CapitalMoveCooldown = 'capitalMoveCooldown',
  /** Мир уже на верхней ступени развития — вкладываться некуда. */
  DevelopmentMaxed = 'developmentMaxed',
  /**
   * Ступень развития не изменила бы в мире ничего, кроме населения: промышленность
   * уже на пределе (`galaxy/profile.ts::developmentStepMatters`). Деньги за неё не берутся.
   */
  DevelopmentNoEffect = 'developmentNoEffect',
  /**
   * Полевую армию некуда растить: она уже упёрлась в промышленную мощность
   * домена (шаг 27). Держава содержит столько полков, сколько её заводы могут
   * чинить, а не столько, на сколько хватило денег.
   */
  ArmyMaxed = 'armyMaxed',
  /** Число машин задано неверно: ноль, дробь или роспуск того, чего нет. */
  BadArmyCount = 'badArmyCount',
  /** Доля военного бюджета не из шагов `domain.warBudgetSteps` (проект державы, шаг 2). */
  BadWarBudget = 'badWarBudget',
  /** Взнос в военный фонд (шаг 80): сумма не целое положительное число C-Bills. */
  BadFundAmount = 'badFundAmount',
  /** Взнос в военный фонд (шаг 80): у державы нет живых врагов — раскладывать не на кого. */
  NoWarEnemies = 'noWarEnemies',
  /** Приказ (шаг 3): мир не участок фронта державы против его владельца — не на границе, перемирие, отказ. */
  NotOnFront = 'notOnFront',
  /** Приказ (шаг 3): на направлении против этого врага нет полков — они ещё в резерве или выбиты. */
  NoTheaterArmy = 'noTheaterArmy',
  /** Приказ (шаг 3): против этой фракции уже наступали в эту декаду. */
  OffensiveCooldown = 'offensiveCooldown',
  /** Приказ (шаг 3): в военном фонде державы меньше цены приказа. */
  NoWarFund = 'noWarFund',
  /** Приказ (шаг 78): мир уже принадлежит державе — наступать не на кого. */
  OffensiveOwnWorld = 'offensiveOwnWorld',
  /** Контракт (шаг 79): наниматель воюет с державой роты — работы ей не даёт, мир — через дипломатию. */
  EmployerAtWar = 'employerAtWar',
  /** Дань (шаг 78): владелец не примет требования — отношение ниже порога дипломатии. */
  TributeStandingTooLow = 'tributeStandingTooLow',
  /** Цех уже на верхней ступени — расширять некуда (`economy.json` → `bays.steps`). */
  BaysMaxed = 'baysMaxed',
  /** Расширение цеха уже идёт: вторую перестройку поверх первой не начинают. */
  BaysUpgrading = 'baysUpgrading',
  /** Ангар открыт до потолка корабля (шаг 75): дальше — только корабль больше. */
  HangarMaxed = 'hangarMaxed',
  /** Ячейка ангара уже открывается (шаг 75). */
  HangarUpgrading = 'hangarUpgrading',
  /** Держава роты уже воюет с этой фракцией (шаг 76). */
  AlreadyAtWar = 'alreadyAtWar',
  /** Войну не объявить: действует договор или подчинение (шаг 76). */
  WarBlocked = 'warBlocked',
  /** Войны с этой фракцией нет — мириться не с кем (шаг 76). */
  NotAtWar = 'notAtWar',
  /** Полк уже нанят державой (шаг 89). */
  RegimentHired = 'regimentHired',
  /** Полк верен Дому, против которого его нанимают (`great.loyalTo`, шаг 89). */
  RegimentLoyal = 'regimentLoyal',
  /** Ни один мир державы не связан прыжками с миром врага: полку негде встать (шаг 89). */
  NoHireStation = 'noHireStation',
  /** Такого великого полка нет в реестре (шаг 89). */
  RegimentNotFound = 'regimentNotFound',
  /** Требования соседа нет — отвечать не на что (шаг 89). */
  NoDemand = 'noDemand',
  /** Мира не просят в первые `playerWar.minWarDays` суток войны (шаг 76). */
  PeaceTooEarly = 'peaceTooEarly',
  /** У пиратской вольницы нет политики — мира с ней нет (шаг 76). */
  NoPeaceWithPirates = 'noPeaceWithPirates',
  /** Уступка мира вместо отступных на этих условиях не предлагается (шаг 76). */
  CedeNotOffered = 'cedeNotOffered',
  /** Цель войны не годится: миры не на границе, столица, больше `goalWorldsMax` (шаг 81). */
  BadWarGoal = 'badWarGoal',
  /** Дипломатия закрыта: у роты нет ни одного мира (с шага 72c держава — это хоть один мир). */
  DiplomacyLocked = 'diplomacyLocked',
  /** Мир не граничит ни с одним миром роты: держава давит на то, до чего дотягивается. */
  NotNeighbour = 'notNeighbour',
  /** Такого соглашения с этой фракцией уже нет или, наоборот, уже есть. */
  PactUnchanged = 'pactUnchanged',
  /** Мир никому дани не платит — выкупать нечего. */
  NoTribute = 'noTribute',
  /** Сосед не готов признать сюзеренитет: условия `canSubmit` не сошлись. */
  WillNotSubmit = 'willNotSubmit',
  /** Протекторат как условие мира (шаг 90): фракция не предложила мир или условия `protectorateByPeace` не сошлись. */
  ProtectorateNotOffered = 'protectorateNotOffered',
  /** В ангаре корабля нет свободного места под новую машину (`dropship.mechCapacity`). */
  HangarFull = 'hangarFull',
  /** Машина стоит гарнизоном на мире (шаг 86b): сперва забрать её на корабль. */
  MechStationed = 'mechStationed',
  /** Машины нет в гарнизоне этой системы или она ещё в пути (шаг 86b). */
  NotInGarrison = 'notInGarrison',
  /** Гарнизон — машина с пилотом (шаг 86b). */
  GarrisonNeedsPilot = 'garrisonNeedsPilot',
  /** Машина в звене взятого контракта (шаг 86b). */
  MechInSortie = 'mechInSortie',
  /** Такая постройка на мире уже есть — действующая или спящая (шаг 87). */
  AlreadyBuilt = 'alreadyBuilt',
  /** На мире уже идёт стройка: одна за раз (шаг 87). */
  BuildBusy = 'buildBusy',
  /** Завод машин — только на мире с военной промышленностью от `buildings.factoryMilitary` (шаг 87). */
  BuildNeedsIndustry = 'buildNeedsIndustry',
  /** На мире нет стройки — отменять нечего (шаг 87). */
  NothingToCancel = 'nothingToCancel',
  /** Машина на мире чинится только наземным цехом этого мира (шаг 87). */
  NoWorkshop = 'noWorkshop',
  /** Гарнизон мира полон: звено без казарм, рота с ними (шаг 87). */
  GarrisonFull = 'garrisonFull',
  /** Склад мира полон (шаг 87). */
  DepotFull = 'depotFull',
  /** Секторов не больше `floor(миров державы ÷ realm.worldsPerSector)` (шаг 88). */
  SectorLimit = 'sectorLimit',
  /** Пилот — губернатор сектора: в машину не садится, на второй пост не идёт (шаг 88). */
  PilotIsGovernor = 'pilotIsGovernor',
  /** Сектора с таким центром нет (шаг 88). */
  NoSector = 'noSector',
  /** Мир дальше радиуса сектора от его центра (шаг 93). */
  SectorTooFar = 'sectorTooFar',
  /** Резерв кассы — только из `realm.reserveSteps` (шаг 88). */
  BadReserve = 'badReserve',
  /** Мир уже закреплён или уже не закреплён; стойка уже такая; губернатор уже с этим приоритетом (шаг 88). */
  RealmUnchanged = 'realmUnchanged',
  /** Флагманский корабль роты уже максимального класса (Overlord). */
  DropshipMaxed = 'dropshipMaxed',
  /** На этой планете нет верфи/космопорта (требуется космопорт A/B, столица/хаб или развитый мир). */
  NotAtShipyard = 'notAtShipyard',
  /** Такой раскраски нет в `data/paints.json` (шаг 50). */
  PaintNotAvailable = 'paintNotAvailable',
  /** Машина уже в этих цветах — перекрашивать не во что. */
  SamePaint = 'samePaint',
  /** Открыта карточка события мира (шаг 84): время стоит, пока на неё не ответят. */
  EventPending = 'eventPending',
  /** Такой открытой карточки события нет (шаг 84). */
  EventNotPending = 'eventNotPending',
  /** На приглашение в коалицию нужен ответ: принять или отказать (шаг 84). */
  EventAnswerRequired = 'eventAnswerRequired',
}

export type CampaignCommandResult =
  | { readonly ok: true; readonly events: readonly CampaignEvent[] }
  | { readonly ok: false; readonly reason: CampaignRejectReason };

export function ok(events: CampaignEvent[]): CampaignCommandResult {
  return { ok: true, events };
}

export function reject(reason: CampaignRejectReason): CampaignCommandResult {
  return { ok: false, reason };
}
