import type { BuildingKind } from '../../core/campaign/index.js';

/** Ячейка постройки в атласе `buildings` (`tools/pack_ui_atlases.py`). */
export const BUILDING_INDEX: Readonly<Record<BuildingKind, number>> = {
  workshop: 0,
  depot: 1,
  barracks: 2,
  defence: 3,
  spaceport: 4,
  factory: 5,
  drill: 6,
};

/** Ячейка 7 того же атласа — «штаб»: постройкой не является, это значок столицы державы. */
export const CAPITAL_INDEX = 7;
