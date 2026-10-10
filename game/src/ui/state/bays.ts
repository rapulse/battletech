import type { CampaignState } from '../../core/campaign/index.js';
import type { ZoneId } from '../../core/model/HitZone.js';

/**
 * Полоса стапелей: КАКИЕ МАШИНЫ стоят в цеху и что с ними делают.
 *
 * Ячейку занимает МАШИНА, а не работа. Так считает ядро (`execute.ts` →
 * `hasBayFor`: машина, уже стоящая в цеху, второго места не требует), и полоса
 * обязана показывать то же самое. Пока она раскладывала по ячейкам РАБОТЫ,
 * «Починить всё звено» ставило три ремонта зоны на один Javelin — и ангар
 * рисовал один и тот же Javelin на трёх стапелях с надписью «3 / 3», хотя
 * занят был один стапель из четырёх и в цех влезали ещё три машины (плейтест
 * 2026-09-16). Заодно работы сверх числа стапелей просто пропадали с экрана —
 * вместе с единственной кнопкой их отмены.
 *
 * Считается отдельным чистым разбором состояния, а не внутри стора: правило
 * «стапель — это машина» живёт в ядре, и расхождение с ним ловится тестом
 * (`test/bays.test.ts`), а не глазами на скриншоте.
 */

export interface BayJob {
  readonly jobId: string;
  readonly work: string;
  /** Зона, если работа зонная (`repairZone`, `replacePart`), иначе `null`. */
  readonly zone: ZoneId | null;
  readonly daysLeft: number;
  readonly cost: number;
}

export interface BayStand {
  readonly recordId: string;
  readonly mech: string;
  /** Когда машина уйдёт со стапеля: МАКСИМУМ по работам, а не сумма — работы идут разом. */
  readonly daysLeft: number;
  readonly jobs: readonly BayJob[];
}

export function bayStands(state: CampaignState): readonly (BayStand | null)[] {
  type Mutable = { -readonly [K in keyof BayStand]: K extends 'jobs' ? BayJob[] : BayStand[K] };
  const stands = new Map<string, Mutable>();

  for (const e of state.queue) {
    if (e.task.kind !== 'repairJob') continue;
    // Работы наземного цеха мира (шаг 87) стоят на его стапелях, а не на корабле: их показывает карточка мира.
    if (e.task.workshop !== undefined) continue;
    const task = e.task;
    const daysLeft = Math.max(0, e.day - state.day);
    let stand = stands.get(task.recordId);
    if (stand === undefined) {
      const mech = state.company.mechs.find((m) => m.id === task.recordId)?.name ?? task.recordId;
      stand = { recordId: task.recordId, mech, daysLeft: 0, jobs: [] };
      stands.set(task.recordId, stand);
    }
    stand.jobs.push({
      jobId: task.jobId,
      work: task.work,
      zone: task.zone ?? null,
      daysLeft,
      cost: task.cost,
    });
    stand.daysLeft = Math.max(stand.daysLeft, daysLeft);
  }

  const list = [...stands.values()];
  // Ячеек не меньше, чем стапелей, но и не меньше, чем машин в работе: если цех
  // окажется переполнен (смена корабля, старое сохранение), лишняя машина
  // обязана остаться видимой и отменяемой, а не исчезнуть с полосы.
  const cells = Math.max(state.company.bays, list.length);
  return Array.from({ length: cells }, (_, i) => list[i] ?? null);
}
