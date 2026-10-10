import { MILESTONES, type ChapterDef, type MilestoneCondition } from '../../data/index.js';
import { stateConditionMet } from '../conditions.js';
import type { CampaignState } from '../state.js';

/**
 * Главы кампании (шаг 70) — примерный план пути игрока.
 *
 * Прогресс НЕ хранится: чистая функция от состояния, каждый раз заново. Отсюда
 * и «одни цифры на всех экранах», и то, что прогресс идёт назад вместе с
 * состоянием: продан последний мир — глава «Планета» снова текущая. Главы и
 * условия вех — данные (`data/milestones.json`); ядро отдаёт id и флаги,
 * словами их называет экран.
 */

export interface MilestoneProgress {
  readonly id: string;
  readonly done: boolean;
  /** Веха того, чего в этой версии игры нет: не выполняется никогда. */
  readonly beyondVersion: boolean;
}

export interface ChapterProgress {
  readonly id: string;
  readonly milestones: readonly MilestoneProgress[];
  /** Выполнены все вехи. */
  readonly done: boolean;
  /** Глава целиком за пределами версии — показывается закрытой. */
  readonly beyondVersion: boolean;
}

export interface CampaignProgress {
  readonly chapters: readonly ChapterProgress[];
  /**
   * Индекс текущей главы — первой непройденной. Вехи дальних глав, выполненные
   * раньше срока, отмечены у себя, но главу не перескакивают.
   */
  readonly current: number;
}

function milestoneDone(c: MilestoneCondition, state: CampaignState): boolean {
  return c.type === 'beyondVersion' ? false : stateConditionMet(c, state);
}

function chapterProgress(chapter: ChapterDef, state: CampaignState): ChapterProgress {
  const milestones = chapter.milestones.map((m) => ({
    id: m.id,
    done: milestoneDone(m.condition, state),
    beyondVersion: m.condition.type === 'beyondVersion',
  }));
  return {
    id: chapter.id,
    milestones,
    done: milestones.every((m) => m.done),
    beyondVersion: milestones.every((m) => m.beyondVersion),
  };
}

/** Прогресс наёмника по главам — из состояния, без побочных эффектов. */
export function campaignProgress(state: CampaignState): CampaignProgress {
  const chapters = MILESTONES.campaigns.merc.chapters.map((c) => chapterProgress(c, state));
  const current = chapters.findIndex((c) => !c.done);
  return { chapters, current: current === -1 ? chapters.length - 1 : current };
}
