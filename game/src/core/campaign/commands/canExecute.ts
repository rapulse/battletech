import { restore, snapshot } from '../save.js';
import type { CampaignState } from '../state.js';
import { advanceRejection, execute } from './execute.js';
import type { CampaignCommand, CampaignRejectReason } from './types.js';

/**
 * Можно ли исполнить команду — БЕЗ её исполнения (шаг 16a).
 *
 * Зачем это заведено до экранов, а не вместе с ними. Экран обязан знать, активна
 * ли кнопка: хватает ли денег, свободен ли стапель, не в пути ли рота, не занят
 * ли узел работой, не взят ли уже контракт. Проверок в кампании больше сорока
 * (`CampaignRejectReason`), и без этой функции каждый экран завёл бы свою копию
 * — ровно тот сценарий, ради которого `enumerateLegalCommands` появился в бою
 * ещё на M2 (`game_core.md` §4.5: «иначе ИИ заведёт вторую копию правил
 * валидации»). Вторая копия опасна не тем, что спорит с ядром, а тем, что
 * молча расходится с ним через месяц.
 *
 * **Как это работает и почему именно так.** Проверка не переписывает условия
 * `execute`, а прогоняет команду на КОПИИ состояния и выбрасывает копию. Отсюда
 * главное свойство: ответ не может разойтись с настоящим исполнением, потому
 * что это и есть настоящее исполнение. Альтернатива — расписать каждую команду
 * на «проверить» и «применить» — дала бы то же самое ценой правки всех двадцати
 * четырёх команд и постоянного риска, что новая команда забудет разделиться.
 *
 * **Чего это стоит.** Один снимок состояния на вызов. Снимок мелкий: рота, парк
 * и склад — неизменяемые значения, они копируются ссылкой, а поэлементно
 * копируется только очередь задач. Для экрана, который спрашивает про десяток
 * кнопок при перерисовке, этого достаточно; для цикла на тысячу итераций —
 * нет, и там надо звать `execute` и читать его отказ.
 *
 * ВАЖНО: ГПСЧ оригинала не сдвигается. Копия получает состояние потоков
 * (`restore` → `rng.setState`), и все броски команды уходят в неё.
 */
export function canExecute(
  state: CampaignState,
  command: CampaignCommand,
): CampaignRejectReason | null {
  // Прокрутку не прогоняем: её отказ целиком решается на входе (`advanceRejection`), а прогон пробных дней
  // мира с державой стоит дороже самой прокрутки.
  if (command.kind === 'advance') return advanceRejection(state, state.day + command.days);
  if (command.kind === 'advanceTo') return advanceRejection(state, command.day);
  const probe = restore(snapshot(state));
  const result = execute(probe, command);
  return result.ok ? null : result.reason;
}

/** Короткая форма: `true`, если команда пройдёт. */
export function isLegal(state: CampaignState, command: CampaignCommand): boolean {
  return canExecute(state, command) === null;
}
