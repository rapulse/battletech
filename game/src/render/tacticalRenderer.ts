import type { Point } from '../core/hex/index.js';
import type { MoveMode } from '../core/map/index.js';
import {
  cornersAt,
  HEX_SIZE,
  HEX_WIDTH,
  hexToPixel,
  neighbours,
} from './hexView.js';
import { biomePalette, groundColor, darken, darkenRgba, type Palette } from './biomePalette.js';
import type { HexView, MapView } from './mapView.js';
import { weaponFxSpec, type WeaponFxKind } from './weaponFx.js';
import type { RenderLabels } from './labels.js';
import {
  ARCHETYPE_DRAWERS,
  drawEmplacementWreck,
  INSTALLATION_ARCHETYPES,
  drawArchetype_HumanoidHeavy,
  drawArchetype_Unidentified,
} from './archetypeArt.js';

/**
 * Рисование боя (шаг 9a, часть D; шаг 9, части B и C).
 *
 * Перенесено из тактического макета проекта дословно: вся геометрия фигур,
 * все цвета и вся анимация — оттуда, потому что именно этот вид и утверждался.
 * Изменены ровно две вещи:
 *
 *   1. Источник данных. Макет рисовал собственную структуру карты; здесь та же
 *      картинка строится по `MapView`, а он выводится из `HexMap` ядра. Второго
 *      описания карты в проекте не появляется.
 *   2. То, чего в макете не было: отрицательные уровни (вода глубиной), реки и
 *      мосты на рёбрах, а не в клетках, уровень контакта вместо «все всё видят».
 *
 * Слой показа НЕ считает правила. Ни одного целевого числа, ни одной стоимости
 * хода здесь не вычисляется: всё готовое приходит в `RenderScene`. Как только
 * рисование начнёт считать шанс попадания само, появится второй источник
 * истины, и он разойдётся с ядром на первом же исключении.
 */

export type Ctx = CanvasRenderingContext2D;

export interface Bounds {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

/** Установка оружия глазами показа: только то, что рисуется кругами дальности. */
export interface RenderWeapon {
  readonly name: string;
  readonly minR: number;
  readonly shortR: number;
  readonly medR: number;
  readonly maxR: number;
}

/**
 * Машина глазами показа.
 *
 * Собирается с учётом уровня контакта: по засветке сюда приходит `unidentified`
 * без брони и тепла, по силуэту — класс без чисел, и только по опознанной —
 * полные показатели. Фильтр знания живёт в ОДНОМ месте (`scene.ts`), потому что
 * иначе карта показывала бы одно, а панель — другое.
 */
export interface RenderUnit {
  readonly id: string;
  readonly code: string;
  readonly name?: string | undefined;
  readonly chassis?: string | undefined;
  readonly tonnage?: number | undefined;
  readonly team: 'red' | 'blue';
  readonly col: number;
  readonly row: number;
  readonly elevation: number;
  /** Фасинг в радианах. Ядро хранит его румбом 0…5, показу удобнее угол. */
  readonly facingAngle: number;
  readonly archetype: string;
  /**
   * Насколько машина опознана СМОТРЯЩЕЙ стороной. Ни броня, ни тепло по
   * неопознанной машине не рисуются: это подглядывание в чужой лист, ровно то,
   * от чего шаг 7 избавлял бота.
   */
  readonly known: 'blip' | 'silhouette' | 'identified';
  /** Подпись класса для силуэта: «лёгкий», «средний», «тяжёлый». */
  readonly classLabel: string;
  readonly hp: number;
  readonly maxHp: number;
  readonly heat: number;
  readonly maxHeat: number;
  readonly weapons: readonly RenderWeapon[];
  /** Радиус ЭПП/зонда в гексах, 0 — прибора нет или он разбит. Только у опознанной машины. */
  readonly ecmRange?: number | undefined;
  readonly probeRange?: number | undefined;
  readonly destroyed?: boolean | undefined;
}

export interface MovementTrail {
  readonly unitId: string;
  readonly team: 'red' | 'blue';
  readonly path: readonly { readonly col: number; readonly row: number }[];
  readonly mode: MoveMode;
}

export interface RenderScene {
  readonly units: readonly RenderUnit[];
  readonly selectedUnit: RenderUnit | null;
  readonly hoverHex: HexView | null;
  readonly hoveredWeapon: RenderWeapon | null;
  readonly selectedWeapon?: RenderWeapon | null;
  readonly mode: 'move' | 'los';
  /** Достижимые клетки: ключ «кол,ряд» → цена в MP. Считает ядро. */
  readonly reachableHexes: ReadonlyMap<string, number>;
  /** Зона выхода своей стороны: ключи «кол,ряд». Пусто, если её не просили (шаг 65). */
  readonly exitBand: ReadonlySet<string>;
  /**
   * Перекрыта ли линия от выбранной машины до клетки под курсором. null —
   * считать нечего (нет выбора или нет наведения).
   *
   * Приходит из `los()` ядра. В макете это условие считалось прямо в рисовании
   * и было при этом ошибочным — `hex.elevation > Math.max(own, hex.elevation)`
   * ложно всегда, и луч не краснел ни разу. Ровно то, чем опасен второй
   * источник истины: он не спорит с ядром, он просто молча не работает.
   */
  readonly losBlocked: boolean | null;
  /** Траектории последних перемещений роботов (пунктир со стрелками направления). */
  readonly movementTrails?: readonly MovementTrail[] | undefined;
}

export interface LayerFlags {
  grid: boolean;
  numbers: boolean;
  elevations: boolean;
  organicForest: boolean;
  treesDetail: boolean;
  waterAnim: boolean;
  fogAnim: boolean;
  weaponRanges: boolean;
  movementTrails: boolean;
}

export interface BeamFX {
  readonly from: Point;
  readonly to: Point;
  readonly color: string;
  readonly width: number;
  readonly startTime: number;
  readonly duration: number;
  readonly kind: WeaponFxKind;
}

export interface MissileFX {
  readonly from: Point;
  readonly to: Point;
  readonly color: string;
  /** Сколько отдельных "жал" рисовать в этом залпе. */
  readonly count: number;
  /** Цвет дыма `r, g, b` и число клубов в шлейфе. */
  readonly smoke: string;
  readonly trail: number;
  /** Косвенный огонь: рой идёт навесом, дугой вверх по экрану. */
  readonly arc: boolean;
  readonly startTime: number;
  readonly duration: number;
}

/** Вспышка на цели. `startTime` может лежать в будущем — ждёт подлёта. */
export interface ImpactFX {
  readonly at: Point;
  readonly radius: number;
  readonly startTime: number;
  readonly duration: number;
  /** Разлёт искр: крупный калибр и ракеты. */
  readonly burst: boolean;
}

export interface FloatingTextFX {
  readonly x: number;
  readonly y: number;
  readonly text: string;
  readonly color: string;
  readonly startTime: number;
  readonly duration: number;
}

export interface Camera {
  x: number;
  y: number;
  zoom: number;
  readonly minZoom: number;
  readonly maxZoom: number;
}

export class TacticalRenderer {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: Ctx;
  width = 0;
  height = 0;

  camera: Camera = { x: 0, y: 0, zoom: 1, minZoom: 0.2, maxZoom: 3 };

  layers: LayerFlags = {
    grid: true,
    numbers: true,
    elevations: true,
    organicForest: true,
    treesDetail: true,
    waterAnim: true,
    fogAnim: true,
    weaponRanges: true,
    movementTrails: true,
  };

  /** Схема поверх биома: обычная, спутниковая, ночная. */
  theme = 'classic';

  private beams: BeamFX[] = [];
  private missiles: MissileFX[] = [];
  private impacts: ImpactFX[] = [];
  private floatingTexts: FloatingTextFX[] = [];

  private minimapTransform: {
    s: number;
    ox: number;
    oy: number;
    totalW: number;
    totalH: number;
  } | null = null;

  /** Слова на карте — от интерфейса (`labels.ts`); заменяются целиком при смене языка. */
  labels: RenderLabels;

  constructor(canvas: HTMLCanvasElement, labels: RenderLabels) {
    this.canvas = canvas;
    this.labels = labels;
    const ctx = canvas.getContext('2d');
    if (ctx === null) throw new Error('Канвас недоступен');
    this.ctx = ctx;
  }


  resize(width: number, height: number): void {
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = width * dpr;
    this.canvas.height = height * dpr;
    this.ctx.resetTransform();
    this.ctx.scale(dpr, dpr);
    this.width = width;
    this.height = height;
  }

  // Convert Screen pixel coords to World coords
  screenToWorld(sx: number, sy: number): Point {
    return {
      x: (sx - this.camera.x) / this.camera.zoom,
      y: (sy - this.camera.y) / this.camera.zoom
    };
  }

  // Convert World coords to Screen pixel coords
  worldToScreen(wx: number, wy: number): Point {
    return {
      x: wx * this.camera.zoom + this.camera.x,
      y: wy * this.camera.zoom + this.camera.y
    };
  }

  // Center the map in viewport
  centerMap(map: MapView): void {
    const totalW = (map.cols + 0.5) * HEX_WIDTH;
    const totalH = (map.rows * 1.5 + 0.5) * HEX_SIZE;
    this.camera.zoom = Math.min(this.width / totalW, this.height / totalH) * 0.9;
    this.camera.zoom = Math.max(0.4, Math.min(1.5, this.camera.zoom));
    this.camera.x = (this.width - totalW * this.camera.zoom) / 2 + (HEX_WIDTH * this.camera.zoom * 0.5);
    this.camera.y = (this.height - totalH * this.camera.zoom) / 2 + (HEX_SIZE * this.camera.zoom * 0.5);
  }

  // Focus and center camera on specific hex coordinates
  focusOnHex(col: number, row: number): void {
    const { x: wx, y: wy } = hexToPixel(col, row);
    this.camera.x = this.width / 2 - wx * this.camera.zoom;
    this.camera.y = this.height / 2 - wy * this.camera.zoom;
  }

  // Focus and center camera on unit
  focusOnUnit(unit: RenderUnit | null): void {
    if (!unit) return;
    this.focusOnHex(unit.col, unit.row);
  }

  // Get active palette with theme modifier
  getPalette(biome: string): Palette {
    // Цвета приходят из данных (data/map-palette.json), схема показа
    // перекрывает биом целиком. В коде рисования цветов земли нет.
    return biomePalette(biome, this.theme);
  }

  // Main Render Loop
  render(map: MapView, scene: RenderScene, time = 0): void {
    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;

    // Clear background with theme palette
    const pal = this.getPalette(map.biome);
    ctx.fillStyle = pal.bg;
    ctx.fillRect(0, 0, w, h);

    // Apply Camera Transform
    ctx.save();
    ctx.translate(this.camera.x, this.camera.y);
    ctx.scale(this.camera.zoom, this.camera.zoom);

    // Visible bounding box for culling
    const minW = this.screenToWorld(0, 0);
    const maxW = this.screenToWorld(w, h);
    const pad = HEX_SIZE * 2;
    const viewBounds = {
      minX: minW.x - pad,
      minY: minW.y - pad,
      maxX: maxW.x + pad,
      maxY: maxW.y + pad
    };

    // 1. Render Base Hex Elevation & Terrain
    this.renderBaseTerrain(ctx, map, pal, viewBounds);

    // 2. Render Elevation Cliff Shadows (3D Step Effect)
    if (this.layers.elevations) {
      this.renderElevationCliffs(ctx, map);
    }

    // 3. Render Lakes (Smooth Organic Basins)
    if (map.lakeClusters && map.lakeClusters.length > 0) {
      this.renderLakes(ctx, map, pal, time);
    }

    // 4. Render River with Banks & Water Flow Animation
    if (map.riverLines.length > 0) {
      this.renderRiver(ctx, map, pal, time);
    }

    // 5. Render Roads and Bridges
    if (map.roadCells && map.roadCells.length > 0) {
      this.renderRoadsAndBridges(ctx, map, pal);
    }

    // 6. Render Organic Forest Clusters (Smoothed Mass)
    if (this.layers.organicForest) {
      this.renderOrganicForests(ctx, map, pal);
    }

    // 7. Render Mountain Ranges & Facets
    this.renderMountainRanges(ctx, map, pal);

    // 7b. Render Ruins (compact rubble patch — distinct from diffuse rock)
    if (map.ruinClusters.length > 0 || map.ruinProps.length > 0) {
      this.renderRuins(ctx, map, pal);
    }

    // 8. Render Procedural Trees Inside Forests
    if (this.layers.treesDetail) {
      this.renderTrees(ctx, map, pal, viewBounds);
    }

    // 9. Render Tactical Grid & Coordinates
    if (this.layers.grid || this.layers.numbers) {
      this.renderTacticalGrid(ctx, map, pal, viewBounds);
    }

    // 9.5 Зона выхода: куда вести машины, если решено отвести звено
    if (scene.exitBand.size > 0) {
      this.renderExitBand(ctx, map, scene.exitBand, time);
    }

    // 10. Render Tactical Movement Range / Reachability Overlay
    if (scene.selectedUnit && scene.reachableHexes && scene.mode === 'move') {
      this.renderReachableOverlay(ctx, map, scene, time);
    }

    // 11. Render Weapon Range Brackets (Short / Med / Long Arcs)
    if (scene.selectedUnit && this.layers.weaponRanges) {
      this.renderWeaponRangeBrackets(
        ctx,
        scene.selectedUnit,
        scene.hoveredWeapon ?? scene.selectedWeapon ?? null,
        time,
      );
    }

    // 11.5 Render ECM/BAP Coverage Rings for the selected unit, if it carries them
    if (scene.selectedUnit) {
      this.renderSupportSystemRanges(ctx, scene.selectedUnit);
    }

    // 12. Render Line of Sight (LOS) & Target Reticle
    const activeHover = scene.hoverHex;
    if (scene.mode === 'los' && scene.selectedUnit && activeHover) {
      this.renderLineOfSight(ctx, map, scene);
    }

    // 13. Render Movement Trails (Dashed paths of last unit moves)
    if (
      this.layers.movementTrails !== false &&
      scene.movementTrails &&
      scene.movementTrails.length > 0
    ) {
      this.renderMovementTrails(ctx, scene, time);
    }

    // 14. Render Hover Highlight
    if (activeHover) {
      this.renderHoverHighlight(ctx, activeHover, time);
    }

    // 15. Render Units / Mechs
    this.renderUnits(ctx, scene, time);

    // 16. Render Combat FX (Laser rays, PPC bolts, floating numbers)
    this.renderCombatFX(ctx, time);

    // 17. Render Atmospheric Fog / Drift
    if (this.layers.fogAnim) {
      this.renderAtmosphericFog(ctx, map, time, viewBounds);
    }

    ctx.restore();
  }

  // 1. Base Terrain Hexes
  renderBaseTerrain(ctx: Ctx, map: MapView, pal: Palette, bounds: Bounds): void {
    for (const hex of map.hexes.values()) {
      const { x: cx, y: cy } = hexToPixel(hex.col, hex.row);
      if (cx < bounds.minX || cx > bounds.maxX || cy < bounds.minY || cy > bounds.maxY) continue;

      const corners = cornersAt(cx, cy);

      ctx.beginPath();
      ctx.moveTo(corners[0]!.x, corners[0]!.y);
      for (let i = 1; i < 6; i++) {
        ctx.lineTo(corners[i]!.x, corners[i]!.y);
      }
      ctx.closePath();

      // Цвет земли по уровню. Уровни ниже нуля в макете не встречались —
      // там вода была отдельной сущностью, а в правилах это глубина.
      ctx.fillStyle = groundColor(pal, hex.elevation);
      ctx.fill();

      // Вода поверх земли. Замёрзшая — светлая и без синевы: тундровое озеро
      // обязано отличаться от умеренного на глаз, а не только в описании.
      if (hex.isWater) {
        ctx.fillStyle = map.frozen ? 'rgba(220, 238, 248, 0.55)' : 'rgba(30, 136, 229, 0.15)';
        ctx.fill();
      }
    }
  }

  // 2. 3D Elevation Step Cliffs (Bold 4x Transition Ridge & Slope Teeth)
  renderElevationCliffs(ctx: Ctx, map: MapView): void {
    ctx.save();
    ctx.lineCap = 'round';

    for (const hex of map.hexes.values()) {
      if (hex.elevation === 0) continue;

      const { x: cx, y: cy } = hexToPixel(hex.col, hex.row);
      const corners = cornersAt(cx, cy);
      const neighbors = neighbours(hex.col, hex.row);

      for (let i = 0; i < 6; i++) {
        const nb = neighbors[i]!;
        const nbHex = map.hexes.get(`${nb.col},${nb.row}`);
        const nbElev = nbHex ? nbHex.elevation : 0;
        const diff = hex.elevation - nbElev;

        if (diff > 0) {
          const p1 = corners[i]!;
          const p2 = corners[(i + 1) % 6]!;

          // 1. Solid Ridge Line (Refined thickness)
          ctx.beginPath();
          ctx.moveTo(p1.x, p1.y);
          ctx.lineTo(p2.x, p2.y);
          ctx.strokeStyle = this.theme === 'nightops' ? 'rgba(0, 229, 255, 0.7)' : 'rgba(10, 15, 20, 0.85)';
          ctx.lineWidth = 3.0 * Math.min(2, diff);
          ctx.stroke();

          // 2. Secondary Drop Shadow under cliff
          ctx.beginPath();
          ctx.moveTo(p1.x, p1.y);
          ctx.lineTo(p2.x, p2.y);
          ctx.strokeStyle = 'rgba(0, 0, 0, 0.35)';
          ctx.lineWidth = 6.0 * Math.min(2, diff);
          ctx.stroke();

          // 3. Slope Teeth / Hatching Marks pointing down the slope
          const normalX = (p2.y - p1.y) * 0.24;
          const normalY = -(p2.x - p1.x) * 0.24;

          ctx.strokeStyle = this.theme === 'nightops' ? 'rgba(0, 229, 255, 0.75)' : 'rgba(10, 15, 20, 0.85)';
          ctx.lineWidth = 1.8;

          // 3 Distinct Teeth along the edge
          [0.25, 0.5, 0.75]!.forEach(t => {
            const hx = p1.x + (p2.x - p1.x) * t;
            const hy = p1.y + (p2.y - p1.y) * t;

            ctx.beginPath();
            ctx.moveTo(hx, hy);
            ctx.lineTo(hx + normalX, hy + normalY);
            ctx.stroke();
          });
        }
      }
    }

    ctx.restore();
  }

  // 3. Lakes (Smooth Organic Basins with Clean Depth Gradient)
  renderLakes(ctx: Ctx, map: MapView, pal: Palette, _time: number): void {
    if (!map.lakeClusters || map.lakeClusters.length === 0) return;

    ctx.save();
    for (const lake of map.lakeClusters) {
      for (const loop of lake.loops) {
        if (loop.length < 3) continue;

        // 1. Sandy Shoreline Buffer
        ctx.beginPath();
        ctx.moveTo(loop[0]!.x, loop[0]!.y);
        for (let i = 1; i < loop.length; i++) {
          ctx.lineTo(loop[i]!.x, loop[i]!.y);
        }
        ctx.closePath();
        ctx.strokeStyle = pal.sandBank;
        ctx.lineWidth = 10;
        ctx.lineJoin = 'round';
        ctx.stroke();

        // 2. Lake Water Body with Depth Gradient (Shallow cyan on edges -> Deep cobalt in center)
        const radGrad = ctx.createRadialGradient(lake.cx, lake.cy, lake.radius * 0.15, lake.cx, lake.cy, lake.radius * 1.1);
        radGrad.addColorStop(0, pal.waterDeep || '#1565c0');
        radGrad.addColorStop(0.65, pal.water || '#1e88e5');
        radGrad.addColorStop(1, '#42a5f5');

        ctx.fillStyle = radGrad;
        ctx.fill();

        // Subtle water shoreline inner edge
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  // 3. Meandering River with Banks and Procedural Flow
  renderRiver(ctx: Ctx, map: MapView, pal: Palette, time: number): void {
    for (const points of map.riverLines) {
      if (points.length < 2) continue;

      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      const trace = (): void => {
        ctx.beginPath();
        ctx.moveTo(points[0]!.x, points[0]!.y);
        for (let i = 1; i < points.length - 1; i++) {
          const xc = (points[i]!.x + points[i + 1]!.x) / 2;
          const yc = (points[i]!.y + points[i + 1]!.y) / 2;
          ctx.quadraticCurveTo(points[i]!.x, points[i]!.y, xc, yc);
        }
        ctx.lineTo(points[points.length - 1]!.x, points[points.length - 1]!.y);
      };

      // 1. Мягкий песчаный берег
      trace();
      ctx.strokeStyle = pal.sandBank;
      ctx.lineWidth = HEX_SIZE * 0.92;
      ctx.stroke();

      // 2. Основная вода
      trace();
      ctx.strokeStyle = map.frozen ? '#cfe6f2' : pal.water;
      ctx.lineWidth = HEX_SIZE * 0.72;
      ctx.stroke();

      // 3. Глубокий стрежень
      trace();
      ctx.strokeStyle = map.frozen ? '#a8cdde' : pal.waterDeep;
      ctx.lineWidth = HEX_SIZE * 0.35;
      ctx.stroke();

      // 4. Блики и мерцание воды
      if (this.layers.waterAnim && !map.frozen) {
        for (let i = 1; i < points.length - 1; i += 2) {
          const pPrev = points[i - 1]!;
          const pCurr = points[i]!;
          const pNext = points[i + 1]!;

          const phase = time * 0.0018 + i * 0.75;
          const shimmerAlpha = 0.18 + 0.14 * Math.sin(phase);
          const microWobbleX = Math.cos(phase * 1.3) * 1.8;
          const microWobbleY = Math.sin(phase * 1.1) * 1.8;

          const mx = (pPrev.x + pCurr.x) * 0.5 + microWobbleX;
          const my = (pPrev.y + pCurr.y) * 0.5 + microWobbleY;
          const nx = (pCurr.x + pNext.x) * 0.5 - microWobbleX;
          const ny = (pCurr.y + pNext.y) * 0.5 - microWobbleY;

          ctx.beginPath();
          ctx.moveTo(mx, my);
          ctx.quadraticCurveTo(pCurr.x + microWobbleX * 0.5, pCurr.y + microWobbleY * 0.5, nx, ny);
          ctx.strokeStyle = `rgba(255, 255, 255, ${shimmerAlpha})`;
          ctx.lineWidth = 1.8;
          ctx.stroke();

          // Specular sparkle glint
          if ((i + 1) % 4 === 0) {
            const glintAlpha = Math.max(0, Math.sin(time * 0.0022 + i * 1.5)) * 0.35;
            if (glintAlpha > 0.05) {
              ctx.beginPath();
              ctx.arc(pCurr.x + microWobbleX, pCurr.y + microWobbleY, 2.5, 0, Math.PI * 2);
              ctx.fillStyle = `rgba(255, 255, 255, ${glintAlpha})`;
              ctx.fill();
            }
          }
        }
      }

      ctx.restore();
    }
  }

  // 4. Roads and Bridges
  renderRoadsAndBridges(ctx: Ctx, map: MapView, pal: Palette): void {
    if (map.roadCells.length === 0) return;

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Дорога рисуется отрезками до соседних дорожных клеток, а не одной
    // ломаной по списку: список идёт в порядке сетки, и ломаная по нему
    // прыгала бы через всю карту. Развилки при этом получаются бесплатно.
    const isRoad = (col: number, row: number): boolean =>
      map.hexes.get(`${col},${row}`)?.isRoad === true;

    const drawTrack = (width: number, style: string, dash: number[]): void => {
      ctx.setLineDash(dash);
      ctx.strokeStyle = style;
      ctx.lineWidth = width;
      ctx.beginPath();
      for (const cell of map.roadCells) {
        const a = hexToPixel(cell.col, cell.row);
        for (const nb of neighbours(cell.col, cell.row)) {
          // Только «вперёд», чтобы каждый отрезок рисовался один раз.
          if (nb.row < cell.row || (nb.row === cell.row && nb.col < cell.col)) continue;
          if (!isRoad(nb.col, nb.row)) continue;
          const b = hexToPixel(nb.col, nb.row);
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
        }
      }
      ctx.stroke();
    };

    drawTrack(9, pal.road, []);
    drawTrack(2, 'rgba(255, 255, 255, 0.3)', [6, 6]);
    ctx.setLineDash([]);

    // Мост стоит НА РЕБРЕ — там, где дорога пересекает реку. Это узел карты:
    // единственная дешёвая переправа, за которую дерутся.
    for (const bridge of map.bridges) {
      const angle = Math.atan2(bridge.b.y - bridge.a.y, bridge.b.x - bridge.a.x);
      const span = Math.hypot(bridge.b.x - bridge.a.x, bridge.b.y - bridge.a.y);

      ctx.save();
      ctx.translate(bridge.mid.x, bridge.mid.y);
      ctx.rotate(angle);

      ctx.fillStyle = pal.bridge;
      ctx.fillRect(-span * 0.5, -11, span, 22);
      ctx.strokeStyle = '#222';
      ctx.lineWidth = 2;
      ctx.strokeRect(-span * 0.5, -11, span, 22);

      ctx.fillStyle = '#8b949e';
      ctx.fillRect(-span * 0.5, -13, span, 3);
      ctx.fillRect(-span * 0.5, 10, span, 3);
      ctx.restore();
    }

    ctx.restore();
  }

  // 5. Organic Forest Clusters (Smoothed Mass)
  renderOrganicForests(ctx: Ctx, map: MapView, pal: Palette): void {
    ctx.save();
    for (const cluster of map.forestClusters) {
      for (const loop of cluster.loops) {
        if (loop.length < 3) continue;

        ctx.beginPath();
        ctx.moveTo(loop[0]!.x, loop[0]!.y);
        for (let i = 1; i < loop.length; i++) {
          ctx.lineTo(loop[i]!.x, loop[i]!.y);
        }
        ctx.closePath();

        // Forest cluster organic base fill dynamically themed from active palette
        ctx.fillStyle = cluster.heavy ? darkenRgba(pal.forestBase, 0.4) : pal.forestBase;
        ctx.shadowColor = 'rgba(0, 0, 0, 0.35)';
        ctx.shadowBlur = 8;
        ctx.fill();

        ctx.shadowColor = 'transparent';
        ctx.strokeStyle = cluster.heavy ? darken(pal.treePine, 0.35) : (pal.treePineLight || pal.treePine);
        ctx.lineWidth = 2.5;
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  // 6. Mountain Ranges & Rocks
  renderMountainRanges(ctx: Ctx, map: MapView, pal: Palette): void {
    for (const cluster of map.mountainClusters) {
      for (const loop of cluster.loops) {
        if (loop.length < 3) continue;
        ctx.beginPath();
        ctx.moveTo(loop[0]!.x, loop[0]!.y);
        for (let i = 1; i < loop.length; i++) {
          ctx.lineTo(loop[i]!.x, loop[i]!.y);
        }
        ctx.closePath();
        ctx.fillStyle = 'rgba(75, 71, 65, 0.75)';
        ctx.fill();
        ctx.strokeStyle = '#3e3b35';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }

    // Mountain rocks, hills & peaks
    for (const rock of map.rocks) {
      ctx.save();
      ctx.translate(rock.x, rock.y);
      const s = rock.size;

      if (rock.kind === 'hill') {
        // Level 1: Smooth rounded hill dome (Полукруглый пологий холм)
        // Soft drop shadow
        ctx.beginPath();
        ctx.ellipse(1, 2, s * 1.05, s * 0.55, 0, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(0, 0, 0, 0.22)';
        ctx.fill();

        // Smooth dome
        ctx.beginPath();
        ctx.ellipse(0, 0, s * 1.0, s * 0.55, 0, Math.PI, Math.PI * 2);
        ctx.closePath();
        const hillGrad = ctx.createLinearGradient(-s, -s * 0.55, s, s * 0.55);
        hillGrad.addColorStop(0, 'rgba(255, 255, 255, 0.18)');
        hillGrad.addColorStop(1, 'rgba(0, 0, 0, 0.22)');
        ctx.fillStyle = hillGrad;
        ctx.fill();
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.3)';
        ctx.lineWidth = 1.2;
        ctx.stroke();

        // Soft rounded crest arc
        ctx.beginPath();
        ctx.arc(0, -s * 0.05, s * 0.55, Math.PI * 1.2, Math.PI * 1.8);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.28)';
        ctx.lineWidth = 1.3;
        ctx.stroke();
      } else {
        // Level 2 & 3: Rocky mountain peak without snow
        // Level 4+: Snow-capped peak (isPeak = true)

        // Drop shadow
        ctx.beginPath();
        ctx.ellipse(2, s * 0.5, s * 0.8, s * 0.35, 0, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
        ctx.fill();

        // Dark facet (left)
        ctx.beginPath();
        ctx.moveTo(0, -s);
        ctx.lineTo(-s * 0.8, s * 0.7);
        ctx.lineTo(0, s * 0.5);
        ctx.closePath();
        ctx.fillStyle = '#3a3833';
        ctx.fill();
        ctx.strokeStyle = '#22201d';
        ctx.lineWidth = 0.8;
        ctx.stroke();

        // Light facet (right)
        ctx.beginPath();
        ctx.moveTo(0, -s);
        ctx.lineTo(0, s * 0.5);
        ctx.lineTo(s * 0.8, s * 0.7);
        ctx.closePath();
        ctx.fillStyle = '#6a655c';
        ctx.fill();
        ctx.strokeStyle = '#22201d';
        ctx.lineWidth = 0.8;
        ctx.stroke();

        // Center spine ridge
        ctx.beginPath();
        ctx.moveTo(0, -s);
        ctx.lineTo(0, s * 0.5);
        ctx.strokeStyle = '#22201d';
        ctx.lineWidth = 1.2;
        ctx.stroke();

        // Snow peak strictly on Level 4+
        if ((rock.kind === 'peak')) {
          ctx.beginPath();
          ctx.moveTo(0, -s);
          ctx.lineTo(-s * 0.35, -s * 0.3);
          ctx.lineTo(0, -s * 0.2);
          ctx.lineTo(s * 0.35, -s * 0.3);
          ctx.closePath();
          ctx.fillStyle = pal.snow || '#ffffff';
          ctx.fill();
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
          ctx.lineWidth = 0.8;
          ctx.stroke();
        }
      }

      ctx.restore();
    }
  }

  // 6b. Ruins: compact patch of broken masonry (шаг 9c) — распадается от
  // диффузной каменной россыпи `mountainClusters`, поэтому своя геометрия.
  renderRuins(ctx: Ctx, map: MapView, _pal: Palette): void {
    // Пыльная земля под обломками: контур пятна, тёплый серо-охровый тон.
    ctx.save();
    for (const cluster of map.ruinClusters) {
      for (const loop of cluster.loops) {
        if (loop.length < 3) continue;
        ctx.beginPath();
        ctx.moveTo(loop[0]!.x, loop[0]!.y);
        for (let i = 1; i < loop.length; i++) ctx.lineTo(loop[i]!.x, loop[i]!.y);
        ctx.closePath();
        ctx.fillStyle = 'rgba(94, 84, 68, 0.32)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(58, 51, 41, 0.5)';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    }
    ctx.restore();

    const stoneMain = '#4f473c';
    const stoneDark = '#332d24';
    const stoneLight = '#6b6153';
    const strokeBorder = '#161310';

    // Детерминированный псевдослучай от seed фрагмента — без нового ГПСЧ на кадр.
    const hash = (n: number): number => {
      const v = Math.sin(n * 12.9898) * 43758.5453;
      return v - Math.floor(v);
    };

    for (const ruin of map.ruinProps) {
      ctx.save();
      ctx.translate(ruin.x, ruin.y);
      ctx.rotate(ruin.angle);

      // Тень
      ctx.beginPath();
      ctx.ellipse(1, ruin.size * 0.35, ruin.size * 0.6, ruin.size * 0.22, 0, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0, 0, 0, 0.28)';
      ctx.fill();

      if (ruin.kind === 'rubble') {
        // Куча битого камня: неправильный многоугольник из 4-5 вершин.
        const n = 4 + (hash(ruin.seed) > 0.5 ? 1 : 0);
        ctx.beginPath();
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2;
          const r = ruin.size * (0.6 + hash(ruin.seed + i) * 0.4);
          const px = Math.cos(a) * r;
          const py = Math.sin(a) * r * 0.7;
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.fillStyle = hash(ruin.seed * 3) > 0.5 ? stoneMain : stoneDark;
        ctx.fill();
        ctx.strokeStyle = strokeBorder;
        ctx.lineWidth = 1;
        ctx.stroke();
        // Блик на паре обломков.
        ctx.beginPath();
        ctx.moveTo(-ruin.size * 0.15, -ruin.size * 0.2);
        ctx.lineTo(ruin.size * 0.1, -ruin.size * 0.35);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
        ctx.lineWidth = 1;
        ctx.stroke();
      } else {
        // Обломок стены/колонны: прямоугольник с рваным (не ровным) верхним краем.
        const w = ruin.kind === 'pillar' ? ruin.size * 0.5 : ruin.size * 1.3;
        const h = ruin.size * 1.1;
        const teeth = ruin.kind === 'pillar' ? 2 : 4;

        const wall = new Path2D();
        wall.moveTo(-w / 2, h / 2);
        for (let i = 0; i <= teeth; i++) {
          const tx = -w / 2 + (w * i) / teeth;
          const jag = hash(ruin.seed + i * 1.7) * h * 0.5;
          wall.lineTo(tx, -h / 2 + jag);
        }
        wall.lineTo(w / 2, h / 2);
        wall.closePath();

        ctx.fillStyle = stoneMain;
        ctx.fill(wall);

        // Светлая грань слева — объём. Обрезана по силуэту стены, а не рисуется
        // прямоугольником поверх: иначе торчала бы выше рваного края.
        ctx.save();
        ctx.clip(wall);
        ctx.fillStyle = stoneLight;
        ctx.fillRect(-w / 2, -h / 2, w * 0.18, h);
        ctx.restore();

        ctx.strokeStyle = strokeBorder;
        ctx.lineWidth = 1.2;
        ctx.stroke(wall);

        // Швы кладки — горизонтальные полоски, тоже обрезаны по силуэту.
        ctx.save();
        ctx.clip(wall);
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.25)';
        ctx.lineWidth = 0.8;
        for (let row = 1; row < 3; row++) {
          const yy = h / 2 - (h * row) / 3;
          ctx.beginPath();
          ctx.moveTo(-w / 2 + 1, yy);
          ctx.lineTo(w / 2 - 1, yy);
          ctx.stroke();
        }

        // Трещина.
        ctx.strokeStyle = stoneDark;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(-w * 0.1, h / 2);
        ctx.lineTo(w * 0.05, h * 0.05);
        ctx.lineTo(-w * 0.05, -h * 0.25);
        ctx.stroke();
        ctx.restore();
      }

      ctx.restore();
    }
  }

  // 7. Procedural Vector Trees
  renderTrees(ctx: Ctx, map: MapView, pal: Palette, bounds: Bounds): void {
    for (const tree of map.trees) {
      if (tree.x < bounds.minX || tree.x > bounds.maxX || tree.y < bounds.minY || tree.y > bounds.maxY) continue;

      ctx.save();
      ctx.translate(tree.x, tree.y);

      // Drop shadow
      ctx.beginPath();
      ctx.ellipse(2, 3, tree.radius * 0.75, tree.radius * 0.45, 0, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
      ctx.fill();

      const isHeavy = tree.heavy === true;

      if (tree.kind === 'pine') {
        // Pine Conifer (Triangular layers)
        const r = tree.radius;
        // Bottom tier
        ctx.beginPath();
        ctx.moveTo(0, -r * 1.2);
        ctx.lineTo(-r * 0.9, r * 0.6);
        ctx.lineTo(r * 0.9, r * 0.6);
        ctx.closePath();
        ctx.fillStyle = isHeavy ? darken(pal.treePine, 0.3) : pal.treePine;
        ctx.fill();

        // Top tier
        ctx.beginPath();
        ctx.moveTo(0, -r * 1.5);
        ctx.lineTo(-r * 0.65, -r * 0.1);
        ctx.lineTo(r * 0.65, -r * 0.1);
        ctx.closePath();
        ctx.fillStyle = isHeavy ? pal.treePine : pal.treePineLight;
        ctx.fill();
      } else {
        // Deciduous Round Crown (Fluffy puff)
        ctx.beginPath();
        ctx.arc(0, 0, tree.radius, 0, Math.PI * 2);
        ctx.fillStyle = isHeavy ? darken(pal.treeDeciduous, 0.3) : pal.treeDeciduous;
        ctx.fill();

        // Highlight puff on top-left
        ctx.beginPath();
        ctx.arc(-tree.radius * 0.25, -tree.radius * 0.25, tree.radius * 0.65, 0, Math.PI * 2);
        ctx.fillStyle = isHeavy ? pal.treeDeciduous : pal.treeDeciduousLight;
        ctx.fill();
      }

      ctx.restore();
    }
  }

  // 8. Tactical Hex Grid & Coordinates
  renderTacticalGrid(ctx: Ctx, map: MapView, pal: Palette, bounds: Bounds): void {
    ctx.font = '10px "Share Tech Mono", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    for (const hex of map.hexes.values()) {
      const { x: cx, y: cy } = hexToPixel(hex.col, hex.row);
      if (cx < bounds.minX || cx > bounds.maxX || cy < bounds.minY || cy > bounds.maxY) continue;

      const corners = cornersAt(cx, cy);

      // Grid outline
      if (this.layers.grid) {
        ctx.beginPath();
        ctx.moveTo(corners[0]!.x, corners[0]!.y);
        for (let i = 1; i < 6; i++) {
          ctx.lineTo(corners[i]!.x, corners[i]!.y);
        }
        ctx.closePath();
        ctx.strokeStyle = pal.gridLine;
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      // Hex numbers (e.g. 0101, 0405)
      if (this.layers.numbers && this.camera.zoom > 0.55) {
        ctx.fillStyle = pal.gridText;
        ctx.fillText(hex.coord, cx, cy - HEX_SIZE * 0.62);
      }

      // Elevation Topographic Contour Glyphs (Visible from general zoom)
      if (hex.elevation !== 0 && !hex.isWater && this.layers.elevations && this.camera.zoom > 0.32) {
        this.drawElevationGlyph(ctx, cx, cy, hex.elevation, pal, this.camera.zoom);
      }
    }
  }

  // Draw crisp topographic elevation semicircles / contour glyphs (Level -1, -2, -3+, 1, 2, 3, 4+)
  drawElevationGlyph(ctx: Ctx, cx: number, cy: number, elevation: number, _pal: Palette, _zoom: number): void {
    ctx.save();
    const glyphY = cy + HEX_SIZE * 0.62;
    const strokeColor = this.theme === 'nightops' ? 'rgba(0, 229, 255, 0.85)' : 'rgba(20, 25, 30, 0.72)';

    ctx.lineWidth = 1.6;
    ctx.lineCap = 'round';
    ctx.strokeStyle = strokeColor;

    if (elevation === -1) {
      // Level -1: 1 Inverted Topographic Arc (Single Smooth Basin / Depression ◡)
      ctx.beginPath();
      ctx.arc(cx, glyphY - 2.5, 6.5, Math.PI * 0.15, Math.PI * 0.85);
      ctx.stroke();

      // Center pip at bottom of depression
      ctx.beginPath();
      ctx.arc(cx, glyphY + 0.8, 1.3, 0, Math.PI * 2);
      ctx.fillStyle = strokeColor;
      ctx.fill();
    } else if (elevation === -2) {
      // Level -2: 2 Concentric Inverted Topographic Arcs (Double Basin Tier ◡◡)
      // Outer Arc
      ctx.beginPath();
      ctx.arc(cx, glyphY - 3.5, 9, Math.PI * 0.15, Math.PI * 0.85);
      ctx.stroke();

      // Inner Arc
      ctx.beginPath();
      ctx.arc(cx, glyphY - 2.5, 5, Math.PI * 0.15, Math.PI * 0.85);
      ctx.stroke();

      // Double pips
      ctx.fillStyle = strokeColor;
      ctx.beginPath();
      ctx.arc(cx - 2.2, glyphY + 0.8, 1.2, 0, Math.PI * 2);
      ctx.arc(cx + 2.2, glyphY + 0.8, 1.2, 0, Math.PI * 2);
      ctx.fill();
    } else if (elevation <= -3) {
      // Level -3+: Deep Trench / Pit (Глубокий провал/воронка ▽)
      // Base Inverted Arc
      ctx.beginPath();
      ctx.arc(cx, glyphY - 4, 9.5, Math.PI * 0.15, Math.PI * 0.85);
      ctx.stroke();

      // Inverted Triangle Basin
      ctx.beginPath();
      ctx.moveTo(cx, glyphY + 4);
      ctx.lineTo(cx - 4, glyphY - 1);
      ctx.lineTo(cx + 4, glyphY - 1);
      ctx.closePath();
      ctx.fillStyle = strokeColor;
      ctx.fill();
    } else if (elevation === 1) {
      // Level 1: 1 Topographic Semicircular Arc (Single Smooth Hill Contour ⌒)
      ctx.beginPath();
      ctx.arc(cx, glyphY + 2, 6.5, Math.PI * 1.15, Math.PI * 1.85);
      ctx.stroke();

      // Center pip
      ctx.beginPath();
      ctx.arc(cx, glyphY - 1.2, 1.3, 0, Math.PI * 2);
      ctx.fillStyle = strokeColor;
      ctx.fill();
    } else if (elevation === 2) {
      // Level 2: 2 Concentric Topographic Arcs (Double Hill Tier / Ridge ⌒⌒)
      // Outer Arc
      ctx.beginPath();
      ctx.arc(cx, glyphY + 3, 9, Math.PI * 1.15, Math.PI * 1.85);
      ctx.stroke();

      // Inner Arc
      ctx.beginPath();
      ctx.arc(cx, glyphY + 2, 5, Math.PI * 1.15, Math.PI * 1.85);
      ctx.stroke();

      // Double pips
      ctx.fillStyle = strokeColor;
      ctx.beginPath();
      ctx.arc(cx - 2.2, glyphY - 1.2, 1.2, 0, Math.PI * 2);
      ctx.arc(cx + 2.2, glyphY - 1.2, 1.2, 0, Math.PI * 2);
      ctx.fill();
    } else if (elevation === 3) {
      // Level 3: Mountain Peak (Скалистая гора без снега ▲)
      // Base Arc
      ctx.beginPath();
      ctx.arc(cx, glyphY + 3.5, 9.5, Math.PI * 1.15, Math.PI * 1.85);
      ctx.stroke();

      // Sharp Rocky Mountain Triangle
      ctx.beginPath();
      ctx.moveTo(cx, glyphY - 4.5);
      ctx.lineTo(cx - 4, glyphY + 0.5);
      ctx.lineTo(cx + 4, glyphY + 0.5);
      ctx.closePath();
      ctx.fillStyle = strokeColor;
      ctx.fill();
    } else if (elevation >= 4) {
      // Level 4+: Alpine Snow Peak (Заснеженная вершина со снежной шапкой ▲❄)
      // Double Base Arcs
      ctx.beginPath();
      ctx.arc(cx, glyphY + 4.5, 11, Math.PI * 1.15, Math.PI * 1.85);
      ctx.stroke();

      // Mountain Base
      ctx.beginPath();
      ctx.moveTo(cx, glyphY - 5.5);
      ctx.lineTo(cx - 4.5, glyphY + 1);
      ctx.lineTo(cx + 4.5, glyphY + 1);
      ctx.closePath();
      ctx.fillStyle = strokeColor;
      ctx.fill();

      // Bright Snow Cap Tip
      ctx.beginPath();
      ctx.moveTo(cx, glyphY - 5.5);
      ctx.lineTo(cx - 2, glyphY - 2.5);
      ctx.lineTo(cx + 2, glyphY - 2.5);
      ctx.closePath();
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 0.6;
      ctx.stroke();
    }

    ctx.restore();
  }

  // 9.5 Зона выхода: неоново-зелёная (эвакуация) с мягким свечением
  renderExitBand(ctx: Ctx, map: MapView, band: ReadonlySet<string>, time: number): void {
    const pulse = 0.5 + 0.5 * Math.sin(time * 0.004);

    ctx.save();

    for (const key of band) {
      const hex = map.hexes.get(key);
      if (!hex) continue;

      const { x: cx, y: cy } = hexToPixel(hex.col, hex.row);
      const corners = cornersAt(cx, cy, HEX_SIZE - 2);

      ctx.beginPath();
      ctx.moveTo(corners[0]!.x, corners[0]!.y);
      for (let i = 1; i < 6; i++) {
        ctx.lineTo(corners[i]!.x, corners[i]!.y);
      }
      ctx.closePath();

      // Лёгкая прозрачная заливка без тени, чтобы тип клетки и рельеф оставались читаемыми
      ctx.shadowColor = 'transparent';
      ctx.shadowBlur = 0;
      ctx.fillStyle = `rgba(57, 255, 136, ${0.05 + pulse * 0.03})`;
      ctx.fill();

      // Неоновый контур границы клетки
      ctx.shadowColor = 'rgba(57, 255, 136, 0.6)';
      ctx.shadowBlur = 4;
      ctx.strokeStyle = `rgba(57, 255, 136, ${0.65 + pulse * 0.25})`;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    ctx.restore();
  }


  // 9. Reachable Movement Overlay
  renderReachableOverlay(ctx: Ctx, map: MapView, scene: RenderScene, time: number): void {
    const pulse = 0.5 + 0.5 * Math.sin(time * 0.005);

    for (const [key, cost] of scene.reachableHexes.entries()) {
      const hex = map.hexes.get(key);
      if (!hex) continue;

      const { x: cx, y: cy } = hexToPixel(hex.col, hex.row);
      const corners = cornersAt(cx, cy, HEX_SIZE - 2);

      ctx.beginPath();
      ctx.moveTo(corners[0]!.x, corners[0]!.y);
      for (let i = 1; i < 6; i++) {
        ctx.lineTo(corners[i]!.x, corners[i]!.y);
      }
      ctx.closePath();

      // Cyan tactical highlight
      ctx.fillStyle = `rgba(57, 197, 187, ${0.15 + pulse * 0.1})`;
      ctx.fill();
      ctx.strokeStyle = `rgba(57, 197, 187, ${0.6 + pulse * 0.3})`;
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // MP Cost Badge
      if (this.camera.zoom > 0.6) {
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 10px "Orbitron", sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(`${cost} MP`, cx, cy + HEX_SIZE * 0.35);
      }
    }
  }

  // 10.5 Render Weapon Range Brackets (Short / Medium / Long Range Circles)
  renderWeaponRangeBrackets(ctx: Ctx, unit: RenderUnit, activeWeapon: RenderWeapon | null, time: number): void {
    if (!unit || !this.layers.weaponRanges) return;

    const { x: cx, y: cy } = hexToPixel(unit.col, unit.row);
    const hexW = HEX_WIDTH;
    const faceAngle = unit.facingAngle || 0;

    ctx.save();
    ctx.translate(cx, cy);

    // If a specific weapon is hovered in the sidebar or selected, highlight that weapon's exact brackets!
    if (activeWeapon) {
      const pulse = 0.5 + 0.5 * Math.sin(time * 0.008);

      // Min Range deadzone (if applicable)
      if (activeWeapon.minR > 0) {
        const rMin = activeWeapon.minR * hexW;
        ctx.beginPath();
        ctx.arc(0, 0, rMin, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(139, 148, 158, 0.1)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(139, 148, 158, 0.6)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 4]);
        ctx.stroke();

        ctx.font = 'bold 8px "Share Tech Mono", monospace';
        ctx.fillStyle = '#8b949e';
        ctx.textAlign = 'center';
        ctx.fillText(`[${this.labels.rangeMin(activeWeapon.minR)}]`, 0, -rMin + 10);
      }

      // Short Range Bracket (Green +0)
      const rShort = activeWeapon.shortR * hexW;
      ctx.beginPath();
      ctx.arc(0, 0, rShort, faceAngle - Math.PI / 2, faceAngle + Math.PI / 2);
      ctx.strokeStyle = `rgba(63, 185, 80, ${0.7 + pulse * 0.3})`;
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 6]);
      ctx.stroke();
      ctx.fillStyle = '#3fb950';
      ctx.font = 'bold 9px "Orbitron", sans-serif';
      ctx.fillText(`${activeWeapon.name} [${this.labels.rangeShort(activeWeapon.shortR)}]`, 0, -rShort - 4);

      // Medium Range Bracket (Amber +2)
      const rMed = activeWeapon.medR * hexW;
      ctx.beginPath();
      ctx.arc(0, 0, rMed, faceAngle - Math.PI / 2, faceAngle + Math.PI / 2);
      ctx.strokeStyle = `rgba(227, 179, 65, ${0.7 + pulse * 0.3})`;
      ctx.lineWidth = 2;
      ctx.setLineDash([8, 6]);
      ctx.stroke();
      ctx.fillStyle = '#e3b341';
      ctx.fillText(`${activeWeapon.name} [${this.labels.rangeMedium(activeWeapon.medR)}]`, 0, -rMed - 4);

      // Max/Long Range Bracket (Red +4)
      const rMax = activeWeapon.maxR * hexW;
      ctx.beginPath();
      ctx.arc(0, 0, rMax, faceAngle - Math.PI / 2, faceAngle + Math.PI / 2);
      ctx.strokeStyle = `rgba(248, 81, 73, ${0.8 + pulse * 0.2})`;
      ctx.lineWidth = 2.5;
      ctx.setLineDash([]);
      ctx.stroke();
      ctx.fillStyle = '#f85149';
      ctx.fillText(`${activeWeapon.name} [${this.labels.rangeLong(activeWeapon.maxR)}]`, 0, -rMax - 4);

      ctx.restore();
      return;
    }

    // Default Overall Mech Arsenal Range Envelope
    let shortR = 3;
    let medR = 6;
    let maxR = 9;

    if (unit.weapons && unit.weapons.length > 0) {
      shortR = Math.max(...unit.weapons.map((w) => w.shortR || 3));
      medR = Math.max(...unit.weapons.map((w) => w.medR || 6));
      maxR = Math.max(...unit.weapons.map((w) => w.maxR || 9));
    }

    // 1. Short Range Zone Ring (Green +0 TN)
    const rShort = shortR * hexW;
    ctx.beginPath();
    ctx.arc(0, 0, rShort, faceAngle - Math.PI / 2, faceAngle + Math.PI / 2);
    ctx.strokeStyle = 'rgba(63, 185, 80, 0.8)';
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 6]);
    ctx.stroke();

    ctx.font = 'bold 9px "Orbitron", monospace';
    ctx.fillStyle = '#3fb950';
    ctx.textAlign = 'center';
    ctx.fillText(this.labels.rangeShort(shortR), 0, -rShort - 4);

    // 2. Medium Range Zone Ring (Amber +2 TN)
    const rMed = medR * hexW;
    ctx.beginPath();
    ctx.arc(0, 0, rMed, faceAngle - Math.PI / 2, faceAngle + Math.PI / 2);
    ctx.strokeStyle = 'rgba(227, 179, 65, 0.8)';
    ctx.lineWidth = 2;
    ctx.setLineDash([7, 7]);
    ctx.stroke();

    ctx.fillStyle = '#e3b341';
    ctx.fillText(this.labels.rangeMedium(medR), 0, -rMed - 4);

    // 3. Max Arsenal Range Ring (Red +4 TN)
    const rMax = maxR * hexW;
    ctx.beginPath();
    ctx.arc(0, 0, rMax, faceAngle - Math.PI / 2, faceAngle + Math.PI / 2);
    ctx.strokeStyle = 'rgba(248, 81, 73, 0.85)';
    ctx.lineWidth = 2.2;
    ctx.setLineDash([8, 7]);
    ctx.stroke();

    ctx.fillStyle = '#ff7b72';
    ctx.fillText(this.labels.rangeMax(maxR), 0, -rMax - 4);

    ctx.restore();
  }

  /**
   * Круги действия ЭПП/зонда выбранной машины (панель боя просит то же самым
   * цветом, что и бирка установки в ангаре — `#bc8cff`). Круг цельный, а не
   * дуга по фасингу: обе системы бьют во все стороны разом, в отличие от
   * оружия.
   */
  renderSupportSystemRanges(ctx: Ctx, unit: RenderUnit): void {
    const ecm = unit.ecmRange ?? 0;
    const probe = unit.probeRange ?? 0;
    if (ecm <= 0 && probe <= 0) return;

    const { x: cx, y: cy } = hexToPixel(unit.col, unit.row);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.textAlign = 'center';
    ctx.font = 'bold 9px "Orbitron", monospace';
    ctx.fillStyle = '#bc8cff';

    if (ecm > 0) {
      const r = ecm * HEX_WIDTH;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(188, 140, 255, 0.06)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(188, 140, 255, 0.75)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 5]);
      ctx.stroke();
      ctx.fillStyle = '#bc8cff';
      ctx.fillText('ECM', 0, -r - 4);
    }

    if (probe > 0) {
      const r = probe * HEX_WIDTH;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(188, 140, 255, 0.04)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(188, 140, 255, 0.5)';
      ctx.lineWidth = 1.2;
      ctx.setLineDash([3, 4]);
      ctx.stroke();
      ctx.fillStyle = '#bc8cff';
      ctx.fillText('BAP', 0, -r - 4);
    }

    ctx.setLineDash([]);
    ctx.restore();
  }

  // 11. Line of Sight (LOS)
  renderLineOfSight(ctx: Ctx, _map: MapView, scene: RenderScene): void {
    const u = scene.selectedUnit;
    const h = scene.hoverHex || scene.hoverHex;
    if (!u || !h) return;

    const p1 = hexToPixel(u.col, u.row);
    const p2 = hexToPixel(h.col, h.row);

    // Перекрыта линия или нет, решило ЯДРО (`los()`), а показ только красит
    // луч. Собственный расчёт здесь был бы вторым источником истины — и в
    // макете он им и был, причём молча неработающим.
    const blocked = scene.losBlocked === true;

    // Laser sight line
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.strokeStyle = blocked ? '#f85149' : '#3fb950';
    ctx.lineWidth = 2.5;
    ctx.setLineDash([8, 6]);
    ctx.stroke();

    // Target reticle
    ctx.beginPath();
    ctx.arc(p2.x, p2.y, HEX_SIZE * 0.6, 0, Math.PI * 2);
    ctx.strokeStyle = blocked ? '#f85149' : '#39c5bb';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Crosshairs
    ctx.beginPath();
    ctx.moveTo(p2.x - 14, p2.y);
    ctx.lineTo(p2.x + 14, p2.y);
    ctx.moveTo(p2.x, p2.y - 14);
    ctx.lineTo(p2.x, p2.y + 14);
    ctx.stroke();

    ctx.restore();
  }

  // 12.5 Movement Trails (Dashed paths showing where enemy & friendly mechs moved from)
  renderMovementTrails(ctx: Ctx, scene: RenderScene, time: number): void {
    if (!scene.movementTrails) return;

    for (const trail of scene.movementTrails) {
      const path = trail.path;
      if (!path || path.length < 2) continue;

      const isEnemy = trail.team === 'blue';
      const color = isEnemy ? 'rgba(248, 81, 73, 0.85)' : 'rgba(57, 197, 187, 0.75)';
      const accentColor = isEnemy ? '#ff7b72' : '#79c0ff';
      const shadowColor = isEnemy ? 'rgba(248, 81, 73, 0.45)' : 'rgba(57, 197, 187, 0.35)';

      const startPix = hexToPixel(path[0]!.col, path[0]!.row);

      ctx.save();

      // 1. Origin Start Marker (Hollow ring with center dot on start hex)
      ctx.beginPath();
      ctx.arc(startPix.x, startPix.y, 8, 0, Math.PI * 2);
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.8;
      ctx.setLineDash([3, 3]);
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(startPix.x, startPix.y, 2.5, 0, Math.PI * 2);
      ctx.fillStyle = accentColor;
      ctx.fill();

      // 2. Dashed Trajectory Line
      ctx.shadowColor = shadowColor;
      ctx.shadowBlur = 5;
      ctx.beginPath();
      ctx.moveTo(startPix.x, startPix.y);
      for (let i = 1; i < path.length; i++) {
        const p = hexToPixel(path[i]!.col, path[i]!.row);
        ctx.lineTo(p.x, p.y);
      }
      ctx.strokeStyle = color;
      ctx.lineWidth = 2.4;
      ctx.setLineDash([7, 5]);
      ctx.lineDashOffset = -time * 0.012; // Animated subtle flow along trajectory
      ctx.stroke();

      // 3. Directional Chevrons along each movement leg
      ctx.setLineDash([]);
      ctx.shadowBlur = 0;
      for (let i = 1; i < path.length; i++) {
        const from = hexToPixel(path[i - 1]!.col, path[i - 1]!.row);
        const to = hexToPixel(path[i]!.col, path[i]!.row);
        const midX = (from.x + to.x) * 0.5;
        const midY = (from.y + to.y) * 0.5;
        const angle = Math.atan2(to.y - from.y, to.x - from.x);

        ctx.save();
        ctx.translate(midX, midY);
        ctx.rotate(angle);

        // Crisp directional arrowhead
        ctx.beginPath();
        ctx.moveTo(4, 0);
        ctx.lineTo(-3, -3.5);
        ctx.lineTo(-1, 0);
        ctx.lineTo(-3, 3.5);
        ctx.closePath();
        ctx.fillStyle = accentColor;
        ctx.fill();

        ctx.restore();
      }

      ctx.restore();
    }
  }

  // 11. Hover Highlight
  renderHoverHighlight(ctx: Ctx, hex: HexView, _time: number): void {
    const { x: cx, y: cy } = hexToPixel(hex.col, hex.row);
    const corners = cornersAt(cx, cy, HEX_SIZE - 1);

    ctx.beginPath();
    ctx.moveTo(corners[0]!.x, corners[0]!.y);
    for (let i = 1; i < 6; i++) {
      ctx.lineTo(corners[i]!.x, corners[i]!.y);
    }
    ctx.closePath();

    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.fill();
  }

  // 12. Units (BattleTech Vector Miniatures & Wrecks)
  renderUnits(ctx: Ctx, scene: RenderScene, time: number): void {
    // 1. First draw destroyed mechs (wrecks) on the lower layer
    for (const unit of scene.units) {
      if (!unit.destroyed) continue;
      const isHovered =
        scene.hoverHex !== null &&
        scene.hoverHex.col === unit.col &&
        scene.hoverHex.row === unit.row;
      this.drawWreckMiniature(ctx, unit, isHovered, time);
    }

    // 2. Then draw active operational mechs on top
    for (const unit of scene.units) {
      if (unit.destroyed) continue;
      const isSelected = scene.selectedUnit?.id === unit.id;
      const isHovered =
        scene.hoverHex !== null &&
        scene.hoverHex.col === unit.col &&
        scene.hoverHex.row === unit.row;
      this.drawMechMiniature(ctx, unit, isSelected, isHovered, time);
    }
  }

  drawMechMiniature(
    ctx: Ctx,
    unit: RenderUnit,
    isSelected: boolean,
    isHovered: boolean,
    time: number,
  ): void {
    const { x: cx, y: cy } = hexToPixel(unit.col, unit.row);
    const R = HEX_SIZE * 0.72; // Miniature Base radius (~26px)

    ctx.save();
    ctx.translate(cx, cy);

    // 1. Drop shadow beneath miniature token
    ctx.beginPath();
    ctx.ellipse(2, 4, R * 0.95, R * 0.65, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.fill();

    // 2. High-Contrast Tactical Firing Arc Overlays (when unit is selected)
    if (isSelected) {
      ctx.save();
      const faceAngle = unit.facingAngle || 0;
      const arcRadius = HEX_SIZE * 2.8;

      // 2.1 Forward 180° Secondary Arc (High-contrast Warm Gold / Amber)
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, arcRadius * 0.85, faceAngle - Math.PI / 2, faceAngle + Math.PI / 2);
      ctx.closePath();
      ctx.fillStyle = 'rgba(255, 193, 7, 0.08)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255, 193, 7, 0.45)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 5]);
      ctx.stroke();

      // Flank boundary tick markers (Left & Right 90°)
      [-Math.PI / 2, Math.PI / 2]!.forEach((angleOffset: number) => {
        const a = faceAngle + angleOffset;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * (arcRadius * 0.75), Math.sin(a) * (arcRadius * 0.75));
        ctx.lineTo(Math.cos(a) * (arcRadius * 0.88), Math.sin(a) * (arcRadius * 0.88));
        ctx.strokeStyle = '#ffc107';
        ctx.lineWidth = 2;
        ctx.setLineDash([]);
        ctx.stroke();
      });

      // 2.2 Forward 60° Primary Firing Cone (Vibrant High-Contrast Neon Orange/Amber)
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, arcRadius, faceAngle - Math.PI / 6, faceAngle + Math.PI / 6);
      ctx.closePath();
      ctx.fillStyle = 'rgba(255, 140, 0, 0.16)';
      ctx.fill();
      ctx.strokeStyle = '#ff9800';
      ctx.lineWidth = 2;
      ctx.setLineDash([]);
      ctx.stroke();

      // Forward Centerline Guide (Laser Heading Beam)
      ctx.beginPath();
      ctx.moveTo(Math.cos(faceAngle) * (R + 10), Math.sin(faceAngle) * (R + 10));
      ctx.lineTo(Math.cos(faceAngle) * (arcRadius * 0.95), Math.sin(faceAngle) * (arcRadius * 0.95));
      ctx.strokeStyle = 'rgba(255, 235, 59, 0.75)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 4]);
      ctx.stroke();

      // Selection Tactical HUD Reticle (4 Rotating Corner Brackets only - No solid yellow circle)
      const rotAngle = time * 0.0005; // Slow elegant rotation
      const bracketRadius = R + 8.5;
      const bracketLen = Math.PI * 0.18; // ~32 degrees per bracket

      for (let i = 0; i < 4; i++) {
        const aStart = rotAngle + (i * Math.PI * 0.5) - bracketLen * 0.5;
        const aEnd = aStart + bracketLen;

        ctx.beginPath();
        ctx.arc(0, 0, bracketRadius, aStart, aEnd);
        ctx.strokeStyle = '#ffd54f';
        ctx.lineWidth = 2.2;
        ctx.lineCap = 'round';
        ctx.stroke();

        // Tactical Corner Tick Marks
        const midA = aStart + bracketLen * 0.5;
        ctx.beginPath();
        ctx.moveTo(Math.cos(midA) * bracketRadius, Math.sin(midA) * bracketRadius);
        ctx.lineTo(Math.cos(midA) * (bracketRadius + 3), Math.sin(midA) * (bracketRadius + 3));
        ctx.strokeStyle = '#ffca28';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }

      ctx.restore();
    }

    // 3. Beveled Polymer Miniature Base Disc
    const baseGrad = ctx.createRadialGradient(-3, -3, 2, 0, 0, R);
    baseGrad.addColorStop(0, '#2d333b');
    baseGrad.addColorStop(0.7, '#1c2128');
    baseGrad.addColorStop(1, '#0d1117');

    ctx.beginPath();
    ctx.arc(0, 0, R, 0, Math.PI * 2);
    ctx.fillStyle = baseGrad;
    ctx.fill();

    // Base Faction Outer Rim & Miniature Theme Colors
    let teamColor: string;
    let teamAccent: string;

    if (unit.known === 'blip') {
      teamColor = '#e3b341';
      teamAccent = '#ffd54f';
    } else if (unit.known === 'silhouette') {
      // Sleek monochromatic tactical silhouette styling
      teamColor = '#6e7681';
      teamAccent = '#8b949e';
    } else {
      // Full identified faction coloring
      teamColor = unit.team === 'blue' ? '#2f81f7' : '#f85149';
      teamAccent = unit.team === 'blue' ? '#79c0ff' : '#ff7b72';
    }

    ctx.strokeStyle = teamColor;
    ctx.lineWidth = unit.known === 'silhouette' ? 2 : 2.5;
    if (unit.known === 'blip') {
      ctx.setLineDash([4, 3]);
    }
    ctx.stroke();
    ctx.setLineDash([]);

    // Front Facing Chevron / Arrow Marker (Prominent High-Contrast Indicator)
    ctx.save();
    ctx.rotate(unit.facingAngle || 0);
    
    // Front Glowing Chevron
    ctx.beginPath();
    ctx.moveTo(R + 9, 0);
    ctx.lineTo(R - 2, -6);
    ctx.lineTo(R + 1, 0);
    ctx.lineTo(R - 2, 6);
    ctx.closePath();
    ctx.fillStyle = unit.known === 'silhouette' ? '#8b949e' : '#ffca28';
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.restore();

    // 4. Draw Atmospheric Heat FX (Steam vents and heat shimmer behind hot mechs)
    if (unit.known === 'identified') {
      this.drawMechHeatAtmosphericFX(ctx, unit, R, time);
    }

    // 5. Rotate context to draw the Mech Silhouette along facing angle
    ctx.save();
    ctx.rotate(unit.facingAngle || 0);

    // Draw Unified Top-Down Archetype Miniature
    const archetype = unit.archetype;
    
    if (archetype === 'unidentified' || archetype === 'unknown' || archetype === 'sensor_echo') {
      drawArchetype_Unidentified(ctx, teamColor, teamAccent, time);
    } else {
      // Ключ вне таблицы не должен появляться: полноту сторожит test/archetypeArt.test.ts.
      (ARCHETYPE_DRAWERS[archetype] ?? drawArchetype_HumanoidHeavy)(ctx, teamColor, teamAccent);
    }
    ctx.restore();

    // 6. Dual Rim Status Indicators: Left = Armor (HP), Right = Heat Scale (🔥)
    this.drawMechStatusDualArcs(ctx, unit, R, time);

    // 7. Unit Label under base (Имя робота и ниже индекс)
    ctx.textAlign = 'center';
    ctx.shadowColor = '#000000';
    ctx.shadowBlur = 4;
    if (unit.name && unit.known === 'identified') {
      ctx.font = 'bold 8.5px "Orbitron", sans-serif';
      ctx.fillStyle = '#ffffff';
      ctx.fillText(unit.name, 0, R + 11);
      ctx.font = '7.5px monospace';
      ctx.fillStyle = '#8b949e';
      ctx.fillText(unit.code, 0, R + 20);
    } else {
      ctx.font = 'bold 9px "Orbitron", sans-serif';
      ctx.fillStyle = unit.known === 'silhouette' ? '#c9d1d9' : '#ffffff';
      ctx.fillText(unit.code, 0, R + 13);
    }
    ctx.shadowBlur = 0;

    // 8. Overhead Tactical Hover Tooltip Tag — ONLY on mouse hover over ENEMY units
    const isEnemy = unit.team === 'blue';
    if (isHovered && isEnemy) {
      this.drawMechHoverTag(ctx, unit, R);
    }

    ctx.restore();
  }

  // Draw Dual Rim Status Arcs on Token Base (Left = Armor/HP, Right = Heat)
  drawMechStatusDualArcs(ctx: Ctx, unit: RenderUnit, R: number, time: number): void {
    ctx.save();
    const arcRadius = R + 5.5; // Offset 2px further from token base (was R + 3.5)
    const arcWidth = 4.5;      // 1px thicker (was 3.5)

    if (unit.known === 'blip') {
      // Scanning amber dashed tracks for unidentified sensor blips
      const pulse = 0.5 + 0.5 * Math.sin(time * 0.006);
      ctx.strokeStyle = `rgba(227, 179, 65, ${0.35 + pulse * 0.35})`;
      ctx.lineWidth = 3.5;
      ctx.setLineDash([3, 3]);

      ctx.beginPath();
      ctx.arc(0, 0, arcRadius, Math.PI * 0.65, Math.PI * 1.35);
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(0, 0, arcRadius, -Math.PI * 0.35, Math.PI * 0.35);
      ctx.stroke();

      ctx.restore();
      return;
    }

    if (unit.known === 'silhouette') {
      // Subtle neutral dashed tracks for silhouette
      ctx.strokeStyle = 'rgba(110, 118, 129, 0.4)';
      ctx.lineWidth = 3;
      ctx.setLineDash([3, 3]);

      ctx.beginPath();
      ctx.arc(0, 0, arcRadius, Math.PI * 0.65, Math.PI * 1.35);
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(0, 0, arcRadius, -Math.PI * 0.35, Math.PI * 0.35);
      ctx.stroke();

      ctx.restore();
      return;
    }

    // === A. LEFT RIM: Armor & Structure Integrity (110° to 250°) ===
    const hpPct = Math.max(0, Math.min(1, unit.hp / unit.maxHp));
    const leftStart = Math.PI * 0.65;
    const leftSpan = Math.PI * 0.70;

    // Background track
    ctx.beginPath();
    ctx.arc(0, 0, arcRadius, leftStart, leftStart + leftSpan);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.lineWidth = arcWidth;
    ctx.stroke();

    // Active Health Arc
    if (hpPct > 0) {
      const hpColor = hpPct > 0.65 ? '#3fb950' : hpPct > 0.35 ? '#e3b341' : '#f85149';
      ctx.beginPath();
      ctx.arc(0, 0, arcRadius, leftStart, leftStart + leftSpan * hpPct);
      ctx.strokeStyle = hpColor;
      ctx.lineWidth = arcWidth;
      ctx.lineCap = 'round';
      ctx.stroke();
    }

    // Mini Shield Pip at Start of Armor Arc
    ctx.fillStyle = hpPct > 0.65 ? '#3fb950' : hpPct > 0.35 ? '#e3b341' : '#f85149';
    ctx.beginPath();
    ctx.arc(Math.cos(leftStart) * arcRadius, Math.sin(leftStart) * arcRadius, 2.5, 0, Math.PI * 2);
    ctx.fill();

    // === B. RIGHT RIM: Heat Scale (-65° to +65°) ===
    // Шкала — доля предела машины (`maxHeat`: отвод + запас корпуса), а не
    // градусы: у лёгкой и у штурмовой край свой. Жёлтый — с половины предела
    // (первая ступень к попаданию), красный пульс — выше предела, реактор отключится.
    const heatRatio = unit.heat / (unit.maxHeat || 30);
    const heatPct = Math.max(0, Math.min(1, heatRatio));
    const rightStart = -Math.PI * 0.35;
    const rightSpan = Math.PI * 0.70;
    const pulse = 0.5 + 0.5 * Math.sin(time * 0.015);
    const heatColor =
      heatRatio > 1
        ? pulse > 0.5 ? '#ff1744' : '#ff9100'
        : heatRatio >= 0.75
          ? '#ff6d00'
          : heatRatio >= 0.5
            ? '#ffb300'
            : '#8b949e';

    // Background track
    ctx.beginPath();
    ctx.arc(0, 0, arcRadius, rightStart, rightStart + rightSpan);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.lineWidth = arcWidth;
    ctx.lineCap = 'butt';
    ctx.stroke();

    // Active Heat Arc
    if (heatPct > 0.04) {
      ctx.beginPath();
      ctx.arc(0, 0, arcRadius, rightStart, rightStart + rightSpan * heatPct);
      ctx.strokeStyle = heatColor;
      ctx.lineWidth = arcWidth;
      ctx.lineCap = 'round';
      ctx.stroke();
    }

    // Mini Flame / Heat Pip at End of Heat Arc
    const currentHeatEnd = rightStart + rightSpan * Math.max(0.1, heatPct);
    ctx.fillStyle = heatColor;
    ctx.beginPath();
    ctx.arc(Math.cos(currentHeatEnd) * arcRadius, Math.sin(currentHeatEnd) * arcRadius, 2.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  // Draw Atmospheric Heat FX (Steam vents, heat shimmer, overheat emergency glow)
  drawMechHeatAtmosphericFX(ctx: Ctx, unit: RenderUnit, _R: number, time: number): void {
    // Пороги эффектов — доля предела машины, как и дуга шкалы.
    const heatRatio = unit.heat / (unit.maxHeat || 30);
    if (heatRatio < 0.5) return;

    ctx.save();
    ctx.rotate(unit.facingAngle || 0);

    const rearX = -10;
    const rearY = 0;

    // 1. Heat Shimmer Waves (from two thirds of the heat limit)
    if (heatRatio >= 0.66) {
      for (let i = 0; i < 3; i++) {
        const offset = (time * 0.035 + i * 14) % 32;
        const waveX = rearX - offset;
        const wobble = Math.sin(time * 0.008 + i * 2) * (2.5 + i);
        const alpha = Math.max(0, 0.4 - offset / 35);

        ctx.beginPath();
        ctx.arc(waveX, rearY + wobble, 4 + i * 2, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255, 180, 80, ${alpha * 0.3})`;
        ctx.fill();
      }
    }

    // 2. Steam Venting Puffs from Heat Sinks (heat at the limit)
    if (heatRatio >= 1) {
      for (const side of [-5.5, 5.5]) {
        for (let p = 0; p < 2; p++) {
          const pLife = ((time * 0.025 + p * 20) % 36);
          const px = rearX - pLife * 0.85;
          const py = side + (Math.sin(pLife * 0.25) * 2.5);
          const pRadius = 2.2 + pLife * 0.22;
          const pAlpha = Math.max(0, (1 - pLife / 36) * 0.45);

          ctx.beginPath();
          ctx.arc(px, py, pRadius, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(240, 246, 255, ${pAlpha})`;
          ctx.fill();
        }
      }
    }

    // 3. Molten Warning Overheat Core (when heat >= 48)
    if (heatRatio > 1) {
      const corePulse = 0.5 + 0.5 * Math.sin(time * 0.012);
      ctx.beginPath();
      ctx.arc(rearX, 0, 7 + corePulse * 3, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255, 23, 68, ${0.4 * corePulse})`;
      ctx.fill();
    }

    ctx.restore();
  }

  // Draw Overhead Tactical Status Tooltip
  drawMechHoverTag(ctx: Ctx, unit: RenderUnit, R: number): void {
    ctx.save();
    const tagY = -R - 14;

    let fullText = '';
    if (unit.known === 'blip') {
      fullText = this.labels.blip;
    } else if (unit.known === 'silhouette') {
      const tonStr = unit.tonnage ? ` (${this.labels.tons(unit.tonnage)})` : '';
      // `unit.code` у силуэта — это и есть весовой класс (scene.ts::renderUnit),
      // второй раз его печатать незачем.
      fullText = `◐ ${unit.classLabel.toUpperCase()}${tonStr}  |  ${this.labels.unidentified}`;
    } else {
      const hpPct = Math.round((unit.hp / unit.maxHp) * 100);
      const tonStr = unit.tonnage ? ` (${this.labels.tons(unit.tonnage)})` : '';
      const wpnStr = unit.weapons.length > 0 ? `  |  ${this.labels.weaponCount(unit.weapons.length)}` : '';
      const hpText = `🛡 ${unit.hp}/${unit.maxHp} (${hpPct}%)`;
      const heatText = `🔥 ${unit.heat}/${unit.maxHeat || 30}`;
      const titleStr = unit.name ? `${unit.name} (${unit.code})` : unit.code;
      fullText = `${titleStr}${tonStr}  |  ${hpText}  |  ${heatText}${wpnStr}`;
    }

    ctx.font = 'bold 9.5px "Share Tech Mono", monospace';
    const textW = ctx.measureText(fullText).width + 16;

    // Background pill
    ctx.fillStyle = 'rgba(13, 17, 23, 0.94)';
    ctx.strokeStyle =
      unit.known === 'blip'
        ? '#ffd54f'
        : unit.known === 'silhouette'
          ? '#8b949e'
          : unit.team === 'blue'
            ? '#58a6ff'
            : '#ff7b72';
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.roundRect(-textW * 0.5, tagY - 8, textW, 16, 4);
    ctx.fill();
    ctx.stroke();

    // Text
    ctx.fillStyle =
      unit.known === 'blip'
        ? '#ffd54f'
        : unit.known === 'silhouette'
          ? '#c9d1d9'
          : '#e6edf3';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(fullText, 0, tagY);

    ctx.restore();
  }

  // --- Wreck Miniature (Fallen Mech in Profile, Styled identically to Active Mechs) ---
  drawWreckMiniature(ctx: Ctx, unit: RenderUnit, isHovered: boolean, time: number): void {
    const { x: cx, y: cy } = hexToPixel(unit.col, unit.row);
    const R = HEX_SIZE * 0.72;

    // Выбитая огневая точка (шаг 73c) — не упавший мех, а дымящаяся установка.
    if (INSTALLATION_ARCHETYPES.has(unit.archetype)) {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(unit.facingAngle || 0);
      drawEmplacementWreck(ctx, time);
      ctx.restore();
      return;
    }

    ctx.save();
    ctx.translate(cx, cy);

    // 1. Drop shadow beneath miniature token
    ctx.beginPath();
    ctx.ellipse(2, 4, R * 0.95, R * 0.65, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.fill();

    // 2. Weathered Base Disc with dashed rim
    const baseGrad = ctx.createRadialGradient(-3, -3, 2, 0, 0, R);
    baseGrad.addColorStop(0, '#22272e');
    baseGrad.addColorStop(0.7, '#161b22');
    baseGrad.addColorStop(1, '#0d1117');

    ctx.beginPath();
    ctx.arc(0, 0, R, 0, Math.PI * 2);
    ctx.fillStyle = baseGrad;
    ctx.fill();
    ctx.strokeStyle = '#484f58';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 3]);
    ctx.stroke();
    ctx.setLineDash([]);

    // 3. Fallen Mech Side-Profile Vector Miniature (Clean blocky geometry matching active mechs)
    ctx.save();
    ctx.rotate(unit.facingAngle || 0);

    const plateMain = '#30363d';
    const plateDark = '#21262d';
    const plateLight = '#484f58';
    const strokeBorder = '#0d1117';

    // A. Bent Leg assembly (resting on base)
    // Thigh
    ctx.fillStyle = plateMain;
    ctx.fillRect(-12, 1, 8, 4);
    ctx.strokeStyle = strokeBorder;
    ctx.lineWidth = 1;
    ctx.strokeRect(-12, 1, 8, 4);

    // Knee & Shin
    ctx.fillStyle = plateDark;
    ctx.fillRect(-18, 3, 7, 4);
    ctx.strokeRect(-18, 3, 7, 4);

    // Foot Pad
    ctx.fillStyle = '#161b22';
    ctx.fillRect(-22, 1, 5, 8);
    ctx.strokeRect(-22, 1, 5, 8);

    // B. Main Torso Armor Block (Center)
    ctx.fillStyle = plateMain;
    ctx.fillRect(-5, -5, 13, 10);
    ctx.strokeStyle = strokeBorder;
    ctx.lineWidth = 1;
    ctx.strokeRect(-5, -5, 13, 10);

    // Rear Engine Deck & Exhaust vents
    ctx.fillStyle = plateDark;
    ctx.fillRect(-7, -4, 3, 8);
    ctx.strokeRect(-7, -4, 3, 8);

    // Shoulder Armor Pauldron
    ctx.fillStyle = plateLight;
    ctx.fillRect(-1, -7, 8, 3);
    ctx.strokeRect(-1, -7, 8, 3);

    // Scorch blast scar on chassis
    ctx.fillStyle = '#d97706';
    ctx.fillRect(1, -1, 3, 3);

    // C. Arm & Weapon Barrel (Outstretched forward along ground)
    ctx.fillStyle = plateDark;
    ctx.fillRect(0, 3, 11, 4);
    ctx.strokeStyle = strokeBorder;
    ctx.lineWidth = 1;
    ctx.strokeRect(0, 3, 11, 4);

    // Cannon Muzzle
    ctx.fillStyle = '#0d1117';
    ctx.fillRect(11, 4, 5, 2.5);

    // D. Head / Cockpit Unit (Facing forward, tilted on ground)
    ctx.fillStyle = plateLight;
    ctx.fillRect(7, -4, 7, 7);
    ctx.strokeStyle = strokeBorder;
    ctx.lineWidth = 1;
    ctx.strokeRect(7, -4, 7, 7);

    // Dark Visor Slit
    ctx.fillStyle = '#0d1117';
    ctx.fillRect(11, -2.5, 3, 3.5);

    // Red visor fracture line
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(11.5, -2);
    ctx.lineTo(13.5, 0.5);
    ctx.stroke();

    ctx.restore();

    // 4. Subtle animated rising smoke wisps
    const smokeOffset = (time * 0.0016) % 1;
    for (let s = 0; s < 3; s++) {
      const phase = (smokeOffset + s * 0.33) % 1;
      const sx = Math.sin(phase * Math.PI * 2 + s * 1.5) * (3 + phase * 5);
      const sy = -phase * 22;
      const sr = 3 + phase * 5;
      ctx.beginPath();
      ctx.arc(sx, sy, sr, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(139, 148, 158, ${0.4 * (1 - phase)})`;
      ctx.fill();
    }

    // 5. Crisp Cyberpunk HUD label below wreck
    const tagText = this.labels.wreckTag(unit.id);
    ctx.font = 'bold 8px "Orbitron", sans-serif';
    const tw = ctx.measureText(tagText).width;
    ctx.fillStyle = 'rgba(13, 17, 23, 0.85)';
    ctx.strokeStyle = '#30363d';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(-tw * 0.5 - 5, R + 4, tw + 10, 14, 3);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#8b949e';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(tagText, 0, R + 11);

    // 6. Overhead hover tooltip for wreck
    if (isHovered) {
      this.drawWreckHoverTag(ctx, unit, R);
    }

    ctx.restore();
  }

  // Draw Overhead Tooltip Tag for Wreck
  drawWreckHoverTag(ctx: Ctx, unit: RenderUnit, R: number): void {
    ctx.save();
    const tagY = -R - 16;
    const chassisName = unit.chassis || unit.classLabel;
    const line1 = this.labels.wreckTitle;
    const line2 = `${chassisName} (${this.labels.tons(unit.tonnage ?? 35)})`;
    const line3 = this.labels.wreckElevation;

    ctx.font = 'bold 9px "Orbitron", sans-serif';
    const w1 = ctx.measureText(line1).width;
    ctx.font = '9px "Share Tech Mono", monospace';
    const w2 = ctx.measureText(line2).width;
    const w3 = ctx.measureText(line3).width;
    const boxW = Math.max(w1, w2, w3) + 20;
    const boxH = 46;
    const boxX = -boxW * 0.5;
    const boxY = tagY - boxH + 6;

    // Background box
    ctx.fillStyle = 'rgba(13, 17, 23, 0.95)';
    ctx.strokeStyle = '#8b949e';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.roundRect(boxX, boxY, boxW, boxH, 4);
    ctx.fill();
    ctx.stroke();

    // Arrow pointer
    ctx.beginPath();
    ctx.moveTo(-5, boxY + boxH);
    ctx.lineTo(0, boxY + boxH + 5);
    ctx.lineTo(5, boxY + boxH);
    ctx.fillStyle = 'rgba(13, 17, 23, 0.95)';
    ctx.fill();

    // Text lines
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';

    ctx.font = 'bold 9px "Orbitron", sans-serif';
    ctx.fillStyle = '#f85149';
    ctx.fillText(line1, 0, boxY + 5);

    ctx.font = '9px "Share Tech Mono", monospace';
    ctx.fillStyle = '#e6edf3';
    ctx.fillText(line2, 0, boxY + 18);

    ctx.font = '8px "Share Tech Mono", monospace';
    ctx.fillStyle = '#8b949e';
    ctx.fillText(line3, 0, boxY + 31);

    ctx.restore();
  }

  // 13. Atmospheric Fog / Cloud Drift
  renderAtmosphericFog(ctx: Ctx, map: MapView, time: number, _bounds: Bounds): void {
    const t = time * 0.00012;
    ctx.save();

    // Soft, slow ambient drifting cloud bands
    for (let i = 0; i < 3; i++) {
      const cx = (Math.sin(t + i * 2.2) * 350 + map.cols * HEX_SIZE * 0.5);
      const cy = (Math.cos(t * 0.7 + i * 1.8) * 250 + map.rows * HEX_SIZE * 0.5);
      const radius = 260 + i * 50;

      const grad = ctx.createRadialGradient(cx, cy, radius * 0.1, cx, cy, radius);
      grad.addColorStop(0, 'rgba(235, 245, 255, 0.045)');
      grad.addColorStop(1, 'rgba(235, 245, 255, 0)');

      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // 14. Tactical Radar Minimap Renderer
  renderMinimap(minimapCanvas: HTMLCanvasElement, map: MapView, scene: RenderScene, time: number): void {
    if (!minimapCanvas || !map) return;
    const ctx = minimapCanvas.getContext('2d');
    if (ctx === null) return;
    const mw = minimapCanvas.width;
    const mh = minimapCanvas.height;

    // Clear background
    ctx.fillStyle = '#0a0e14';
    ctx.fillRect(0, 0, mw, mh);

    const totalW = (map.cols + 0.5) * HEX_WIDTH;
    const totalH = (map.rows * 1.5 + 0.5) * HEX_SIZE;
    const pad = 6;
    const s = Math.min((mw - pad * 2) / totalW, (mh - pad * 2) / totalH);
    const ox = (mw - totalW * s) / 2;
    const oy = (mh - totalH * s) / 2;

    this.minimapTransform = { s, ox, oy, totalW, totalH };

    // 1. Draw Map Background Border
    ctx.fillStyle = '#161b22';
    ctx.fillRect(ox, oy, totalW * s, totalH * s);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.lineWidth = 1;
    ctx.strokeRect(ox, oy, totalW * s, totalH * s);

    // 2. Draw Forests / Elevation / Water dots on Minimap
    const pal = this.getPalette(map.biome);

    for (const hex of map.hexes.values()) {
      const { x: hx, y: hy } = hexToPixel(hex.col, hex.row);
      const mx = ox + hx * s;
      const my = oy + hy * s;
      const r = Math.max(1.8, HEX_SIZE * s * 0.85);

      if (hex.isWater) {
        ctx.fillStyle = pal.water || '#2574a9';
        ctx.fillRect(mx - r * 0.5, my - r * 0.5, r, r);
      } else if (hex.terrain === 'lightWoods' || hex.terrain === 'heavyWoods') {
        ctx.fillStyle = hex.terrain === 'heavyWoods' ? '#1b4825' : '#2c6b37';
        ctx.fillRect(mx - r * 0.5, my - r * 0.5, r, r);
      } else if (hex.elevation > 0) {
        ctx.fillStyle = hex.elevation === 1 ? '#5f8e3c' : hex.elevation === 2 ? '#54524c' : '#704830';
        ctx.fillRect(mx - r * 0.5, my - r * 0.5, r, r);
      }
    }

    // 3. Draw Units on Minimap
    for (const unit of scene.units) {
      const { x: hx, y: hy } = hexToPixel(unit.col, unit.row);
      const mx = ox + hx * s;
      const my = oy + hy * s;
      const isSelected = scene.selectedUnit?.id === unit.id;

      // Unit Blip
      if (unit.known === 'blip') {
        // Amber Diamond Sensor Blip
        ctx.fillStyle = '#ffd54f';
        ctx.beginPath();
        ctx.moveTo(mx, my - (isSelected ? 5 : 4));
        ctx.lineTo(mx + (isSelected ? 5 : 4), my);
        ctx.lineTo(mx, my + (isSelected ? 5 : 4));
        ctx.lineTo(mx - (isSelected ? 5 : 4), my);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = '#0d1117';
        ctx.lineWidth = 1;
        ctx.stroke();
      } else {
        const blipColor = unit.team === 'blue' ? '#388bfd' : '#f85149';
        ctx.fillStyle = blipColor;
        ctx.beginPath();
        ctx.arc(mx, my, isSelected ? 4.5 : 3.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      // Heading line
      const faceAngle = unit.facingAngle || 0;
      ctx.beginPath();
      ctx.moveTo(mx, my);
      ctx.lineTo(mx + Math.cos(faceAngle) * 6, my + Math.sin(faceAngle) * 6);
      ctx.strokeStyle = unit.known === 'blip' ? '#ffd54f' : '#ffeb3b';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Selection pulse ring
      if (isSelected) {
        const pulse = 0.5 + 0.5 * Math.sin(time * 0.006);
        ctx.beginPath();
        ctx.arc(mx, my, 5.5 + pulse * 2.5, 0, Math.PI * 2);
        ctx.strokeStyle = '#ffd54f';
        ctx.lineWidth = 1.2;
        ctx.stroke();
      }
    }

    // 4. Draw Camera Viewport Box on Minimap
    const minW = this.screenToWorld(0, 0);
    const maxW = this.screenToWorld(this.width, this.height);

    const vx = ox + minW.x * s;
    const vy = oy + minW.y * s;
    const vw = (maxW.x - minW.x) * s;
    const vh = (maxW.y - minW.y) * s;

    ctx.fillStyle = 'rgba(57, 197, 187, 0.12)';
    ctx.fillRect(vx, vy, vw, vh);
    ctx.strokeStyle = '#39c5bb';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(vx, vy, vw, vh);

    // Crosshair in center of viewport box
    ctx.beginPath();
    ctx.moveTo(vx + vw * 0.5 - 3, vy + vh * 0.5);
    ctx.lineTo(vx + vw * 0.5 + 3, vy + vh * 0.5);
    ctx.moveTo(vx + vw * 0.5, vy + vh * 0.5 - 3);
    ctx.lineTo(vx + vw * 0.5, vy + vh * 0.5 + 3);
    ctx.strokeStyle = 'rgba(57, 197, 187, 0.7)';
    ctx.stroke();
  }

  // Convert minimap pixel coords to world coords
  minimapToWorld(mx: number, my: number): Point | null {
    if (!this.minimapTransform) return null;
    const { s, ox, oy } = this.minimapTransform;
    return {
      x: (mx - ox) / s,
      y: (my - oy) / s
    };
  }

  // --- Боевые спецэффекты (лучи/трассеры/ракеты по типу оружия, damage numbers) ---
  /** Возвращает, через сколько мс выстрел достигнет цели: 0 — луч бьёт сразу. */
  addBeam(
    fromCol: number,
    fromRow: number,
    toCol: number,
    toRow: number,
    weaponId?: string,
    indirect = false,
  ): number {
    const from = hexToPixel(fromCol, fromRow);
    const to = hexToPixel(toCol, toRow);
    const spec = weaponFxSpec(weaponId ?? '');
    const now = performance.now();

    if (spec.kind === 'missile') {
      this.missiles.push({
        from,
        to,
        color: spec.color,
        count: spec.missileCount,
        smoke: spec.smoke,
        trail: spec.trail,
        arc: indirect,
        startTime: now,
        duration: spec.duration,
      });
      this.impacts.push({ at: to, radius: 16, startTime: now + spec.duration, duration: 380, burst: true });
      return spec.duration;
    }

    this.beams.push({
      from,
      to,
      color: spec.color,
      width: spec.width,
      startTime: now,
      duration: spec.duration,
      kind: spec.kind,
    });

    if (spec.kind === 'ballistic') {
      this.impacts.push({
        at: to,
        radius: 8 + spec.width * 2,
        startTime: now + spec.duration,
        duration: 320,
        burst: spec.width >= 3,
      });
      return spec.duration;
    }

    this.impacts.push({ at: to, radius: 10 + spec.width * 2, startTime: now, duration: spec.duration, burst: false });
    return 0;
  }

  addFloatingText(col: number, row: number, text: string, color = '#ffffff'): void {
    const { x, y } = hexToPixel(col, row);
    this.floatingTexts.push({
      x,
      y: y - 18,
      text,
      color,
      startTime: performance.now(),
      duration: 1300,
    });
  }

  renderCombatFX(ctx: Ctx, _time: number): void {
    const now = performance.now();

    // 1. Лучи и трассеры (PPC / лазеры, включая импульсные / баллистика)
    this.beams = this.beams.filter((b) => now - b.startTime < b.duration);
    for (const b of this.beams) {
      const progress = (now - b.startTime) / b.duration;
      const alpha = Math.max(0, 1 - progress);

      ctx.save();
      if (b.kind === 'ppc') {
        // Электрическая молния для PPC
        ctx.strokeStyle = `rgba(0, 229, 255, ${alpha})`;
        ctx.lineWidth = b.width * (1 - progress * 0.4);
        ctx.shadowColor = '#00e5ff';
        ctx.shadowBlur = 12;
        ctx.beginPath();
        ctx.moveTo(b.from.x, b.from.y);
        const steps = 6;
        for (let i = 1; i < steps; i++) {
          const t = i / steps;
          const px = b.from.x + (b.to.x - b.from.x) * t;
          const py = b.from.y + (b.to.y - b.from.y) * t;
          const jitter = Math.sin(now * 0.04 + i * 2.5) * 6 * (1 - progress);
          ctx.lineTo(px + jitter, py - jitter);
        }
        ctx.lineTo(b.to.x, b.to.y);
        ctx.stroke();
      } else if (b.kind === 'pulseLaser') {
        // Импульсный лазер: те же лучи, но пунктиром, что "бежит" по линии
        ctx.strokeStyle = b.color;
        ctx.globalAlpha = alpha;
        ctx.lineWidth = b.width;
        ctx.shadowColor = b.color;
        ctx.shadowBlur = 9;
        ctx.setLineDash([6, 5]);
        ctx.lineDashOffset = -((now / 1000) * 40) % 11;
        ctx.beginPath();
        ctx.moveTo(b.from.x, b.from.y);
        ctx.lineTo(b.to.x, b.to.y);
        ctx.stroke();
      } else if (b.kind === 'ballistic') {
        // Снаряд: короткий штрих летит от стрелка к цели, длина и толщина — по
        // калибру. Вспышку попадания рисует блок impacts по прилёте.
        const dx = b.to.x - b.from.x;
        const dy = b.to.y - b.from.y;
        const dist = Math.hypot(dx, dy) || 1;
        const head = Math.min(1, progress);
        const tail = Math.max(0, head - (10 + b.width * 2.5) / dist);
        ctx.strokeStyle = b.color;
        ctx.lineWidth = b.width;
        ctx.lineCap = 'round';
        ctx.shadowColor = b.color;
        ctx.shadowBlur = 5;
        ctx.beginPath();
        ctx.moveTo(b.from.x + dx * tail, b.from.y + dy * tail);
        ctx.lineTo(b.from.x + dx * head, b.from.y + dy * head);
        ctx.stroke();
      } else {
        // Обычный лазер: толщина по калибру задана в weaponFx.ts.
        ctx.strokeStyle = b.color;
        ctx.globalAlpha = alpha;
        ctx.lineWidth = b.width;
        ctx.shadowColor = b.color;
        ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.moveTo(b.from.x, b.from.y);
        ctx.lineTo(b.to.x, b.to.y);
        ctx.stroke();
      }

      ctx.restore();
    }

    // 2. Ракеты (LRM/SRM): рой из нескольких "жал" со шлейфом дыма, летящий
    // по волнистой траектории — старт и цель ровно в центрах гексов, амплитуда
    // виляния нулевая на концах пути и максимальная в середине.
    this.missiles = this.missiles.filter((m) => now - m.startTime < m.duration);
    for (const m of this.missiles) {
      const progress = Math.min(1, Math.max(0, (now - m.startTime) / m.duration));
      const dx = m.to.x - m.from.x;
      const dy = m.to.y - m.from.y;
      const len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len;
      const ny = dx / len;

      const pointAt = (t: number, lane: number): Point => {
        const tt = Math.min(1, Math.max(0, t));
        const envelope = Math.sin(tt * Math.PI);
        const phase = lane * 2.4 + lane * lane * 0.6;
        const wave = Math.sin(tt * Math.PI * 2.5 + phase) * (7 + lane * 2.5) * envelope;
        // Навес: подъём вверх по экрану читается как высота полёта над холмом.
        const lift = m.arc ? envelope * Math.min(70, len * 0.4) : 0;
        return { x: m.from.x + dx * tt + nx * wave, y: m.from.y + dy * tt + ny * wave - lift };
      };

      ctx.save();
      for (let lane = 0; lane < m.count; lane++) {
        // Дымный шлейф позади текущей позиции
        for (let s = m.trail; s >= 1; s--) {
          const st = progress - s * 0.05;
          if (st <= 0) continue;
          const sp = pointAt(st, lane);
          ctx.beginPath();
          ctx.arc(sp.x, sp.y, 1.2 + s * 0.6, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(${m.smoke}, ${(1 - s / (m.trail + 1)) * 0.35 * (1 - progress * 0.3)})`;
          ctx.fill();
        }

        const p = pointAt(progress, lane);
        const pPrev = pointAt(Math.max(0, progress - 0.04), lane);
        const heading = Math.atan2(p.y - pPrev.y, p.x - pPrev.x);

        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(heading);
        ctx.fillStyle = 'rgba(255, 150, 40, 0.9)';
        ctx.beginPath();
        ctx.arc(-2.5, 0, 1.6, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = m.color;
        ctx.beginPath();
        ctx.moveTo(4, 0);
        ctx.lineTo(-3, -2);
        ctx.lineTo(-3, 2);
        ctx.closePath();
        ctx.fill();
        // Тёмная обводка: корпус в семь пикселей иначе теряется на светлом
        // рельефе, а на тёмном его держит собственный цвет.
        ctx.strokeStyle = 'rgba(10, 12, 16, 0.9)';
        ctx.lineWidth = 1;
        ctx.lineJoin = 'round';
        ctx.stroke();
        ctx.restore();
      }

      ctx.restore();
    }

    // 3. Вспышки попадания. У снарядов и ракет они отложены до подлёта.
    this.impacts = this.impacts.filter((i) => now - i.startTime < i.duration);
    for (const i of this.impacts) {
      if (now < i.startTime) continue;
      const progress = (now - i.startTime) / i.duration;
      const alpha = Math.max(0, 1 - progress);
      ctx.save();
      if (i.burst) {
        // Огненное ядро и шесть искр, разлетающихся от точки удара.
        ctx.fillStyle = `rgba(255, 170, 60, ${alpha * 0.55})`;
        ctx.beginPath();
        ctx.arc(i.at.x, i.at.y, i.radius * 0.5 * (0.6 + progress * 0.4), 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = `rgba(255, 210, 120, ${alpha})`;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        for (let k = 0; k < 6; k++) {
          const a = (k * Math.PI) / 3 + 0.4;
          const r0 = i.radius * (0.3 + progress * 0.5);
          const r1 = r0 + 4 + progress * 6;
          ctx.moveTo(i.at.x + Math.cos(a) * r0, i.at.y + Math.sin(a) * r0);
          ctx.lineTo(i.at.x + Math.cos(a) * r1, i.at.y + Math.sin(a) * r1);
        }
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(i.at.x, i.at.y, progress * i.radius, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(255, 255, 255, ${alpha * 0.8})`;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.restore();
    }

    // 4. Всплывающие цифры урона и статусы (Floating Combat Text)
    this.floatingTexts = this.floatingTexts.filter((f) => now - f.startTime < f.duration);
    for (const f of this.floatingTexts) {
      const progress = (now - f.startTime) / f.duration;
      const alpha = Math.max(0, 1 - progress * progress);
      const curY = f.y - progress * 26;

      ctx.save();
      ctx.font = 'bold 12.5px "Orbitron", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.shadowColor = '#000000';
      ctx.shadowBlur = 6;
      ctx.fillStyle = f.color;
      ctx.globalAlpha = alpha;
      ctx.fillText(f.text, f.x, curY);
      ctx.restore();
    }
  }
}
