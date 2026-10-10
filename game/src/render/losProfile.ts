import { offsetToHex } from '../core/hex/index.js';
import { los, terrainInfo, TerrainType, type HexMap } from '../core/map/index.js';
import { zoneTableName } from '../core/rules/index.js';
import { hexDistance, hexLine } from './hexView.js';
import { groundColor, darken, type Palette } from './biomePalette.js';
import type { MapView } from './mapView.js';
import { key as viewKey } from './mapView.js';
import type { RenderUnit } from './tacticalRenderer.js';
import type { RenderLabels } from './labels.js';

/**
 * Боковой профиль рельефа линии огня (2.5D срез).
 *
 * Показывает, ПОЧЕМУ выстрел перекрыт: холм, лес или чистая линия. Перенесено
 * из макета, но с одной принципиальной правкой: вердикт («перекрыто», «укрытие
 * такое-то») берётся у ядра из `los()`, а не считается здесь заново.
 *
 * В макете срез сам решал, блокирует ли холм, — и это был бы второй источник
 * истины: панель говорила бы «перекрыто», а выстрел проходил бы. Здесь рисунок
 * ОБЪЯСНЯЕТ решение ядра, а не выносит своё.
 */
export interface LosProfileVerdict {
  readonly blocked: boolean;
  readonly range: number;
  readonly coverMod: number;
  readonly targetCover: number;
  readonly partialCover: boolean;
  readonly levelAdvantage: number;
  /** Таблица зон, которую этот выстрел будет использовать: `zoneTableName()` из ядра. */
  readonly zoneTable: 'Above' | 'Below' | 'Main';
  readonly badge: string;
  readonly badgeKind: 'clear' | 'cover' | 'blocked';
}

export function drawLosProfile(
  canvas: HTMLCanvasElement,
  map: HexMap,
  view: MapView,
  pal: Palette,
  from: { col: number; row: number } | null,
  to: { col: number; row: number } | null,
  labels: RenderLabels,
  units?: readonly RenderUnit[],
): LosProfileVerdict | null {
  const ctx = canvas.getContext('2d');
  if (ctx === null) return null;

  // Поддержка HiDPI / Retina: четкие линии без размытия
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  const cssW = 600;
  const cssH = 118;
  if (canvas.width !== Math.round(cssW * dpr) || canvas.height !== Math.round(cssH * dpr)) {
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
  }
  ctx.resetTransform();
  ctx.scale(dpr, dpr);

  ctx.fillStyle = '#090c10';
  ctx.fillRect(0, 0, cssW, cssH);

  if (from === null || to === null || (from.col === to.col && from.row === to.row)) {
    // Сетка уровней L0..L3
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.lineWidth = 1;
    ctx.font = '8px "Share Tech Mono", monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    for (let level = 0; level <= 3; level++) {
      const y = cssH - 22 - level * 18;
      ctx.beginPath();
      ctx.moveTo(10, y + 0.5);
      ctx.lineTo(cssW - 10, y + 0.5);
      ctx.stroke();
      ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
      ctx.fillText(`L${level}`, 4, y - 1);
    }

    ctx.fillStyle = '#8b949e';
    ctx.font = '11px "Share Tech Mono", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(labels.losPrompt, cssW * 0.5, cssH * 0.45);

    return {
      blocked: false,
      range: 0,
      coverMod: 0,
      targetCover: 0,
      partialCover: false,
      levelAdvantage: 0,
      zoneTable: 'Main',
      badge: labels.losMode,
      badgeKind: 'clear',
    };
  }

  const cells = hexLine(from.col, from.row, to.col, to.row);
  if (cells.length < 2) return null;

  // Вердикт — от ядра. Тот же вызов, что сделают правила при выстреле.
  const sight = los(map, offsetToHex(from.col, from.row), offsetToHex(to.col, to.row), {
    fromEye: 1,
    toEye: 1,
  });

  const levels = cells.map(
    (c) => view.hexes.get(viewKey(c.col, c.row))?.elevation ?? 0,
  );
  const minLevel = Math.min(...levels, 0);
  const maxLevel = Math.max(...levels, 2);
  const span = Math.max(3, maxLevel - minLevel + 2);

  const stepW = (cssW - 40) / cells.length;
  const startX = 20;
  const floor = cssH - 22;
  const unit = Math.max(12, (cssH - 46) / span);
  const groundY = (level: number): number => Math.round(floor - (level - minLevel) * unit);

  // Сетка уровней. Четкое позиционирование по пиксельной сетке.
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
  ctx.lineWidth = 1;
  ctx.font = '8px "Share Tech Mono", monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'bottom';
  for (let level = minLevel; level <= maxLevel; level++) {
    const y = groundY(level);
    ctx.beginPath();
    ctx.moveTo(10, y + 0.5);
    ctx.lineTo(cssW - 10, y + 0.5);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.fillText(`L${level}`, 4, y - 1);
  }

  const shooterY = groundY(levels[0] ?? 0) - unit * 0.8;
  const targetY = groundY(levels[levels.length - 1] ?? 0) - unit * 0.6;

  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i]!;
    const hex = view.hexes.get(viewKey(cell.col, cell.row));
    const level = levels[i]!;
    const x = Math.round(startX + i * stepW);
    const colW = Math.max(2, Math.round(stepW - 2));
    const gy = groundY(level);

    ctx.fillStyle = hex?.isWater === true ? pal.waterDeep : groundColor(pal, level);
    ctx.fillRect(x, gy, colW, floor - gy + 16);
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, gy + 0.5, colW, floor - gy + 16);

    ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(hex?.coord ?? '--', x + colW * 0.5, cssH - 18);

    // Лес: рисуем объемные и красивые деревья с учетом биома и плотности
    const objHeight = hex === undefined ? 0 : terrainInfo(terrainIndex(hex.terrain)).objHeight;
    if (objHeight > 0 && (hex?.terrain === 'lightWoods' || hex?.terrain === 'heavyWoods')) {
      const heavy = hex.terrain === 'heavyWoods';
      const treeH = Math.max(16, Math.round(objHeight * unit * (heavy ? 1.05 : 0.72)));
      const cx = x + colW * 0.5;
      const isPine = view.biome === 'tundra' || (view.biome !== 'jungle' && (cell.col + cell.row) % 2 === 0);

      if (heavy) {
        // Плотный лес: фоновое дерево + основное дерево для ощущения объема
        drawProfileTree(ctx, pal, cx - colW * 0.22, gy, Math.round(treeH * 0.8), true, isPine);
        drawProfileTree(ctx, pal, cx + colW * 0.12, gy, treeH, true, isPine);
      } else {
        // Легкий лес: изящное одиночное дерево
        drawProfileTree(ctx, pal, cx, gy, treeH, false, isPine);
      }
    }

    // Робот на промежуточном гексе линии огня
    if (i > 0 && i < cells.length - 1) {
      const mech = units?.find((u) => u.col === cell.col && u.row === cell.row);
      if (mech !== undefined) {
        if (mech.destroyed) {
          const mechH = Math.max(18, Math.round(unit * 1.0));
          const cx = x + colW * 0.5;
          drawProfileWreck(ctx, cx, gy, mechH, labels.wreckTag(mech.code.split(' ')[0] ?? mech.code));
        } else {
          const mechH = Math.max(34, Math.round(unit * 2.0));
          const cx = x + colW * 0.5;
          drawProfileMech(ctx, cx, gy, mechH, mech.team === 'blue', mech.code);
        }
      }
    }
  }

  // Стрелок и цель.
  const x0 = Math.round(startX + stepW * 0.5);
  const xN = Math.round(startX + (cells.length - 1) * stepW + stepW * 0.5);
  dot(ctx, x0, shooterY, '#2f81f7');
  dot(ctx, xN, targetY, '#f85149');

  // Луч. Цвет — по вердикту ЯДРА, не по собственной оценке холмов.
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(x0, shooterY);
  ctx.lineTo(xN, targetY);
  if (sight.blocked) {
    ctx.strokeStyle = '#f85149';
    ctx.lineWidth = 2.5;
    ctx.setLineDash([6, 4]);
    ctx.stroke();
    const mx = (x0 + xN) * 0.5;
    const my = (shooterY + targetY) * 0.5;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(mx, my, 7, 0, Math.PI * 2);
    ctx.fillStyle = '#f85149';
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 9px "Orbitron", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('✕', mx, my + 0.5);
  } else if (sight.coverMod > 0 || sight.targetCover > 0) {
    ctx.strokeStyle = '#e3b341';
    ctx.lineWidth = 2;
    ctx.setLineDash([8, 4]);
    ctx.stroke();
  } else {
    ctx.strokeStyle = '#3fb950';
    ctx.lineWidth = 2.5;
    ctx.shadowColor = '#3fb950';
    ctx.shadowBlur = 8;
    ctx.stroke();
  }
  ctx.restore();

  const badge = sight.blocked
    ? labels.losBlocked
    : sight.coverMod + sight.targetCover > 0
      ? labels.losCover(sight.coverMod + sight.targetCover)
      : labels.losClear;

  const range = hexDistance(from.col, from.row, to.col, to.row);
  return {
    blocked: sight.blocked,
    range,
    coverMod: sight.coverMod,
    targetCover: sight.targetCover,
    partialCover: sight.partialCover,
    levelAdvantage: sight.levelAdvantage,
    // Оружие здесь не выбрано — режим показывает линию, а не выстрел, поэтому
    // навес ракет не учитывается: таблица показана для настильного огня.
    zoneTable: zoneTableName({
      levelAdvantage: sight.levelAdvantage,
      partialCover: sight.partialCover,
      distance: range,
    }),
    badge,
    badgeKind: sight.blocked ? 'blocked' : sight.coverMod + sight.targetCover > 0 ? 'cover' : 'clear',
  };
}

function dot(ctx: CanvasRenderingContext2D, x: number, y: number, color: string): void {
  ctx.beginPath();
  ctx.arc(x, y, 6, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

/**
 * Отрисовка детализированного 2D силуэта робота на боковом срезе профиля видимости.
 */
function drawProfileMech(
  ctx: CanvasRenderingContext2D,
  cx: number,
  gy: number,
  h: number,
  isEnemy: boolean,
  code: string,
): void {
  ctx.save();
  const teamColor = isEnemy ? '#f85149' : '#2f81f7';
  const teamAccent = isEnemy ? '#ff7b72' : '#79c0ff';
  const armorBase = isEnemy ? '#2d1b1b' : '#1b2838';

  const w = Math.max(20, Math.round(h * 0.68));
  const topY = gy - h;

  // 1. Ноги меха (сочленённые конечности и суставы)
  ctx.strokeStyle = '#484f58';
  ctx.lineWidth = 3.2;
  // Левая нога
  ctx.beginPath();
  ctx.moveTo(cx - 6, topY + h * 0.55);
  ctx.lineTo(cx - 9, topY + h * 0.78);
  ctx.lineTo(cx - 7, gy);
  ctx.stroke();
  // Правая нога
  ctx.beginPath();
  ctx.moveTo(cx + 6, topY + h * 0.55);
  ctx.lineTo(cx + 9, topY + h * 0.78);
  ctx.lineTo(cx + 7, gy);
  ctx.stroke();

  // Гидравлические поршни колен
  ctx.strokeStyle = teamAccent;
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.arc(cx - 9, topY + h * 0.78, 2.2, 0, Math.PI * 2);
  ctx.arc(cx + 9, topY + h * 0.78, 2.2, 0, Math.PI * 2);
  ctx.stroke();

  // Широкие бронированные стопы
  ctx.fillStyle = '#21262d';
  ctx.fillRect(cx - 12, gy - 3.5, 8, 3.5);
  ctx.fillRect(cx + 4, gy - 3.5, 8, 3.5);

  // 2. Бронированный массивный корпус / торс
  ctx.fillStyle = armorBase;
  ctx.strokeStyle = teamColor;
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  ctx.moveTo(cx - w * 0.46, topY + h * 0.18);
  ctx.lineTo(cx + w * 0.46, topY + h * 0.18);
  ctx.lineTo(cx + w * 0.36, topY + h * 0.58);
  ctx.lineTo(cx - w * 0.36, topY + h * 0.58);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // 3. Плечевые оружейные пилоны / ракетные контейнеры
  ctx.fillStyle = '#161b22';
  ctx.strokeStyle = teamAccent;
  ctx.lineWidth = 1;
  ctx.fillRect(cx - w * 0.58, topY + h * 0.22, 5, h * 0.28);
  ctx.strokeRect(cx - w * 0.58, topY + h * 0.22, 5, h * 0.28);
  ctx.fillRect(cx + w * 0.58 - 5, topY + h * 0.22, 5, h * 0.28);
  ctx.strokeRect(cx + w * 0.58 - 5, topY + h * 0.22, 5, h * 0.28);

  // Ракетные сопла на левом плече
  ctx.fillStyle = '#ff9800';
  ctx.fillRect(cx - w * 0.56, topY + h * 0.24, 2.5, 2);
  ctx.fillRect(cx - w * 0.56, topY + h * 0.30, 2.5, 2);

  // 4. Остекление кокпита (панорамный визор)
  ctx.fillStyle = teamAccent;
  ctx.beginPath();
  ctx.roundRect(cx - 5.5, topY + h * 0.26, 11, 6, 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
  ctx.fillRect(cx - 3.5, topY + h * 0.26 + 1, 3.5, 2);

  // 5. Идентификационная подпись над мехом
  ctx.font = 'bold 9px "Orbitron", sans-serif';
  ctx.fillStyle = teamAccent;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.shadowColor = '#000000';
  ctx.shadowBlur = 4;
  const label = code.split(' ')[0] ?? code;
  ctx.fillText(label, cx, topY - 3);
  ctx.shadowBlur = 0;

  ctx.restore();
}

/**
 * Отрисовка 2D силуэта подбитого остова меха на боковом срезе профиля видимости.
 */
function drawProfileWreck(
  ctx: CanvasRenderingContext2D,
  cx: number,
  gy: number,
  h: number,
  /** Готовая подпись остова (`RenderLabels.wreckTag`). */
  tag: string,
): void {
  const w = Math.round(h * 2.2); // Удлиненный профиль лежащего робота
  const topY = gy - h;

  ctx.save();

  // 1. Тень контакта с землей
  ctx.beginPath();
  ctx.ellipse(cx, gy, w * 0.55, 3.5, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
  ctx.fill();

  const plateMain = '#30363d';
  const plateDark = '#21262d';
  const plateLight = '#484f58';
  const strokeBorder = '#0d1117';

  // --- LEGS (Right side) ---
  // Thigh
  ctx.fillStyle = plateMain;
  ctx.fillRect(cx + 1, gy - 7, 9, 4);
  ctx.strokeStyle = strokeBorder;
  ctx.lineWidth = 1;
  ctx.strokeRect(cx + 1, gy - 7, 9, 4);

  // Shin
  ctx.fillStyle = plateDark;
  ctx.fillRect(cx + 9, gy - 5, 8, 4);
  ctx.strokeRect(cx + 9, gy - 5, 8, 4);

  // Foot pad
  ctx.fillStyle = '#161b22';
  ctx.fillRect(cx + 16, gy - 8, 4, 8);
  ctx.strokeRect(cx + 16, gy - 8, 4, 8);

  // --- MAIN TORSO (Center) ---
  ctx.fillStyle = plateMain;
  ctx.fillRect(cx - 9, topY + 2, 11, h * 0.65);
  ctx.strokeStyle = strokeBorder;
  ctx.lineWidth = 1;
  ctx.strokeRect(cx - 9, topY + 2, 11, h * 0.65);

  // Shoulder plate
  ctx.fillStyle = plateLight;
  ctx.fillRect(cx - 5, topY - 1, 7, 4);
  ctx.strokeRect(cx - 5, topY - 1, 7, 4);

  // --- OUTSTRETCHED CANNON ARM (Along ground) ---
  ctx.fillStyle = plateDark;
  ctx.fillRect(cx - 15, gy - 4, 12, 4);
  ctx.strokeRect(cx - 15, gy - 4, 12, 4);
  // Barrel muzzle
  ctx.fillStyle = '#0d1117';
  ctx.fillRect(cx - 19, gy - 3.5, 4, 2.5);

  // --- HEAD / COCKPIT (Left) ---
  ctx.fillStyle = plateLight;
  ctx.fillRect(cx - 15, topY + 4, 7, 6);
  ctx.strokeRect(cx - 15, topY + 4, 7, 6);

  // Visor
  ctx.fillStyle = '#0d1117';
  ctx.fillRect(cx - 14, topY + 5.5, 3, 3);
  ctx.strokeStyle = '#ef4444';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cx - 13.5, topY + 5.5);
  ctx.lineTo(cx - 11.5, topY + 8);
  ctx.stroke();

  // --- SMOKE PUFFS ---
  ctx.fillStyle = 'rgba(139, 148, 158, 0.45)';
  ctx.beginPath();
  ctx.arc(cx - 3, topY - 3, 3.5, 0, Math.PI * 2);
  ctx.arc(cx + 3, topY - 8, 5, 0, Math.PI * 2);
  ctx.arc(cx + 9, topY - 14, 6.5, 0, Math.PI * 2);
  ctx.fill();

  // --- BADGE ---
  ctx.font = 'bold 8px "Orbitron", sans-serif';
  ctx.fillStyle = '#8b949e';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillText(tag, cx, topY - 8);

  ctx.restore();
}

const NAMES = [
  'plain', 'road', 'rough', 'lightWoods', 'heavyWoods', 'rubble', 'swamp', 'water', 'building',
];

function terrainIndex(name: string): TerrainType {
  const i = NAMES.indexOf(name);
  return (i < 0 ? TerrainType.Plain : i) as TerrainType;
}

/**
 * Отрисовка детализированных объемных деревьев (хвойных и лиственных)
 * для бокового среза профиля видимости.
 */
function drawProfileTree(
  ctx: CanvasRenderingContext2D,
  pal: Palette,
  cx: number,
  gy: number,
  treeH: number,
  heavy: boolean,
  isPine: boolean,
): void {
  const trunkW = 3;
  const crownR = Math.max(7, treeH * 0.44);
  const crownY = gy - treeH + crownR * 0.7;

  // Ствол
  ctx.fillStyle = '#4a3b2c';
  ctx.fillRect(Math.round(cx - trunkW * 0.5), crownY + 2, trunkW, gy - crownY - 2);

  if (isPine) {
    // 1. Хвойная ель: многоярусная сбалансированная крона
    const r = crownR * 1.15;
    // Нижний ярус
    ctx.beginPath();
    ctx.moveTo(cx, crownY - r * 0.5);
    ctx.lineTo(cx - r * 0.95, crownY + r * 0.55);
    ctx.lineTo(cx + r * 0.95, crownY + r * 0.55);
    ctx.closePath();
    ctx.fillStyle = heavy ? darken(pal.treePine, 0.3) : pal.treePine;
    ctx.fill();

    // Верхний ярус
    ctx.beginPath();
    ctx.moveTo(cx, crownY - r * 1.35);
    ctx.lineTo(cx - r * 0.68, crownY - r * 0.05);
    ctx.lineTo(cx + r * 0.68, crownY - r * 0.05);
    ctx.closePath();
    ctx.fillStyle = heavy ? pal.treePine : pal.treePineLight;
    ctx.fill();

    // Блик на макушке
    ctx.beginPath();
    ctx.moveTo(cx, crownY - r * 1.35);
    ctx.lineTo(cx - r * 0.25, crownY - r * 0.65);
    ctx.lineTo(cx, crownY - r * 0.65);
    ctx.closePath();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.fill();
  } else {
    // 2. Лиственное дерево: объемные кроны со сферической светотенью
    const r = crownR;
    // Мягкая тень под кроной
    ctx.beginPath();
    ctx.arc(cx + 0.5, crownY + 1.5, r * 0.95, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
    ctx.fill();

    // Основное тело кроны
    ctx.beginPath();
    ctx.arc(cx, crownY, r, 0, Math.PI * 2);
    ctx.fillStyle = heavy ? darken(pal.treeDeciduous, 0.3) : pal.treeDeciduous;
    ctx.fill();

    // Правый боковой объем
    ctx.beginPath();
    ctx.arc(cx + r * 0.35, crownY + r * 0.15, r * 0.68, 0, Math.PI * 2);
    ctx.fillStyle = heavy ? darken(pal.treeDeciduous, 0.45) : darken(pal.treeDeciduous, 0.18);
    ctx.fill();

    // Левый верхний блик (объемная шапка света)
    ctx.beginPath();
    ctx.arc(cx - r * 0.25, crownY - r * 0.25, r * 0.58, 0, Math.PI * 2);
    ctx.fillStyle = heavy ? pal.treeDeciduous : pal.treeDeciduousLight;
    ctx.fill();

    // Спекулярный точечный свет
    ctx.beginPath();
    ctx.arc(cx - r * 0.3, crownY - r * 0.3, r * 0.28, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.28)';
    ctx.fill();
  }
}
