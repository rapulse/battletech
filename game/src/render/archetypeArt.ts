import type { Ctx } from './tacticalRenderer.js';

/**
 * Фишки-силуэты машин на тактической карте, вид сверху.
 *
 * Восемь сочетаний «силуэт × весовой класс» рисуются каждое своей функцией, а
 * какая функция за какой ключ отвечает, записано ТАБЛИЦЕЙ `ARCHETYPE_DRAWERS`.
 * Ключи выдаёт `scene.ts::archetypeKey`; тест полноты (`test/archetypeArt.test.ts`)
 * перебирает все сочетания и падает, если у нового нет рисовалки. Раньше здесь был
 * `switch`, и штурмовые сочетания молча рисовались тяжёлым силуэтом.
 *
 * Рисовалки получают контекст уже смещённым в центр клетки и повёрнутым по
 * фронту машины; радиус подложки — около 26 px, отличие классов должно быть в
 * силуэте, а не в мелкой детали.
 */

// --- 1. HUMANOID LIGHT (20-35 Tons): Agile, lean torso, slender arms, agile visor ---
export function drawArchetype_HumanoidLight(ctx: Ctx, teamColor: string, teamAccent: string): void {
  // Narrow agile torso
  ctx.fillStyle = teamColor;
  ctx.fillRect(-5, -8, 10, 16);
  ctx.strokeStyle = '#0d1117';
  ctx.lineWidth = 1;
  ctx.strokeRect(-5, -8, 10, 16);

  // Twin jump jet vents on back
  ctx.fillStyle = '#161b22';
  ctx.fillRect(-8, -6, 3, 4);
  ctx.fillRect(-8, 2, 3, 4);
  ctx.fillStyle = '#ff9800';
  ctx.fillRect(-8.5, -5, 1, 2);
  ctx.fillRect(-8.5, 3, 1, 2);

  // Slender forward-reaching arms with wrist pulse lasers
  for (const side of [-1, 1]) {
    const y = side * 11;
    ctx.fillStyle = '#21262d';
    ctx.fillRect(-2, y - 2, 8, 4);
    ctx.strokeStyle = teamAccent;
    ctx.lineWidth = 1;
    ctx.strokeRect(-2, y - 2, 8, 4);

    // Laser emitter tip
    ctx.fillStyle = '#ff5252';
    ctx.fillRect(6, y - 1, 3, 2);
  }

  // Center Angular Cockpit Visor
  ctx.fillStyle = '#39c5bb';
  ctx.beginPath();
  ctx.moveTo(1, -3);
  ctx.lineTo(6, 0);
  ctx.lineTo(1, 3);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1;
  ctx.stroke();
}

// --- 2. HUMANOID MEDIUM (40-55 Tons): Balanced torso, shoulder weapon pod, armored gauntlets ---
export function drawArchetype_HumanoidMedium(ctx: Ctx, teamColor: string, teamAccent: string): void {
  // Solid rectangular chest torso
  ctx.fillStyle = teamColor;
  ctx.fillRect(-6, -11, 12, 22);
  ctx.strokeStyle = '#0d1117';
  ctx.lineWidth = 1;
  ctx.strokeRect(-6, -11, 12, 22);

  // Right Shoulder Autocannon / Missile Box (Asymmetric Tactical Feature)
  ctx.fillStyle = '#161b22';
  ctx.fillRect(-4, 4, 11, 6);
  ctx.strokeStyle = '#0d1117';
  ctx.strokeRect(-4, 4, 11, 6);
  // Missile tubes
  ctx.fillStyle = '#e3b341';
  ctx.fillRect(4, 5, 2, 1.8);
  ctx.fillRect(4, 7.5, 2, 1.8);

  // Left Shoulder Armor Pauldron / Shield Plate
  ctx.fillStyle = teamAccent;
  ctx.fillRect(-5, -12, 10, 4);

  // Forearm Weapon Barrels
  for (const side of [-1, 1]) {
    const y = side * 13;
    ctx.fillStyle = '#21262d';
    ctx.fillRect(-3, y - 2.5, 10, 5);
    ctx.strokeStyle = teamColor;
    ctx.lineWidth = 1;
    ctx.strokeRect(-3, y - 2.5, 10, 5);

    // Gun muzzle
    ctx.fillStyle = '#0d1117';
    ctx.fillRect(7, y - 1.5, 4, 3);
  }

  // Hexagonal Armored Cockpit
  ctx.fillStyle = '#e6edf3';
  ctx.beginPath();
  ctx.moveTo(0, -3.5);
  ctx.lineTo(5, -3.5);
  ctx.lineTo(7, 0);
  ctx.lineTo(5, 3.5);
  ctx.lineTo(0, 3.5);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#0d1117';
  ctx.stroke();

  // Cyan visor slit
  ctx.fillStyle = '#39c5bb';
  ctx.fillRect(2, -2, 3, 4);
}

// --- 3. HUMANOID HEAVY (60-75 Tons): Broad armored shoulders, twin heavy cannons, skull/shield cowl ---
export function drawArchetype_HumanoidHeavy(ctx: Ctx, teamColor: string, teamAccent: string): void {
  // Broad heavy armored shoulder carapace
  ctx.fillStyle = teamColor;
  ctx.fillRect(-7, -15, 14, 30);
  ctx.strokeStyle = '#0d1117';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(-7, -15, 14, 30);

  // Left Torso Missile Array (4x3 grid)
  ctx.fillStyle = '#161b22';
  ctx.fillRect(-5, -13, 9, 8);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      ctx.fillStyle = '#e3b341';
      ctx.fillRect(-4 + c * 2.6, -12 + r * 2.4, 1.8, 1.8);
    }
  }

  // Right Torso Heavy Cannon Housing
  ctx.fillStyle = '#21262d';
  ctx.fillRect(2, 6, 12, 6);
  ctx.fillStyle = '#090c10';
  ctx.beginPath();
  ctx.arc(14, 9, 2.2, 0, Math.PI * 2);
  ctx.fill();

  // Massive Twin Arm Cannons (PPC / Autocannon Barrels)
  for (const side of [-1, 1]) {
    const y = side * 16;
    ctx.fillStyle = teamAccent;
    ctx.fillRect(-4, y - 3, 14, 6);
    ctx.strokeStyle = '#0d1117';
    ctx.lineWidth = 1;
    ctx.strokeRect(-4, y - 3, 14, 6);

    // Extended heavy barrel
    ctx.fillStyle = '#161b22';
    ctx.fillRect(10, y - 2, 6, 4);
  }

  // Armored Head Cowl / Cockpit (Faceted beveled wedge - H2)
  ctx.fillStyle = '#e6edf3';
  ctx.beginPath();
  ctx.moveTo(-2, -4);
  ctx.lineTo(3.5, -4);
  ctx.lineTo(7, -2);
  ctx.lineTo(7, 2);
  ctx.lineTo(3.5, 4);
  ctx.lineTo(-2, 4);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#0d1117';
  ctx.lineWidth = 1;
  ctx.stroke();

  // Glowing cyan sensor visor
  ctx.fillStyle = '#39c5bb';
  ctx.fillRect(3.5, -2, 2.5, 4);

  // Rear Heat Sinks
  ctx.fillStyle = '#161b22';
  ctx.fillRect(-9, -6, 2.5, 12);
}

// --- 4. NON-HUMANOID LIGHT (20-35 Tons): Pointed nose cockpit, chicken-walker hip sponsons, chin turret ---
export function drawArchetype_NonHumanoidLight(ctx: Ctx, teamColor: string, teamAccent: string): void {
  // Slender reverse-joint hip struts
  ctx.fillStyle = '#21262d';
  ctx.fillRect(-8, -10, 6, 20);

  // Elongated aerodynamic fuselage pod
  ctx.fillStyle = teamColor;
  ctx.beginPath();
  ctx.moveTo(-9, -5);
  ctx.lineTo(8, -4);
  ctx.lineTo(13, 0); // Pointed nose
  ctx.lineTo(8, 4);
  ctx.lineTo(-9, 5);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#0d1117';
  ctx.lineWidth = 1.2;
  ctx.stroke();

  // Top Large Panoramic Cockpit Glass
  ctx.fillStyle = '#39c5bb';
  ctx.beginPath();
  ctx.moveTo(-2, -3);
  ctx.lineTo(7, -2.5);
  ctx.lineTo(11, 0);
  ctx.lineTo(7, 2.5);
  ctx.lineTo(-2, 3);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1;
  ctx.stroke();

  // Chin Centerline Laser Turret
  ctx.fillStyle = teamAccent;
  ctx.fillRect(11, -1.5, 5, 3);

  // Side Stabilizer Laser Winglets
  ctx.fillStyle = '#e3b341';
  ctx.fillRect(0, -9, 3, 2);
  ctx.fillRect(0, 7, 3, 2);
}

// --- 5. NON-HUMANOID MEDIUM (40-55 Tons): Wedge fuselage, flanking gun nacelles, low-profile canopy ---
export function drawArchetype_NonHumanoidMedium(ctx: Ctx, teamColor: string, teamAccent: string): void {
  // Angular sloped wedge body
  ctx.fillStyle = teamColor;
  ctx.beginPath();
  ctx.moveTo(-9, -7);
  ctx.lineTo(5, -6);
  ctx.lineTo(12, -2);
  ctx.lineTo(12, 2);
  ctx.lineTo(5, 6);
  ctx.lineTo(-9, 7);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#0d1117';
  ctx.lineWidth = 1.2;
  ctx.stroke();

  // Flanking Symmetrical Weapon Pylons / Gondolas
  for (const side of [-1, 1]) {
    const y = side * 11;
    ctx.fillStyle = '#21262d';
    ctx.fillRect(-5, y - 3.5, 12, 7);
    ctx.strokeStyle = teamAccent;
    ctx.lineWidth = 1;
    ctx.strokeRect(-5, y - 3.5, 12, 7);

    // Gun Barrels
    ctx.fillStyle = '#ff5252';
    ctx.fillRect(7, y - 1.5, 4, 3);
  }

  // Low-profile sloped cockpit canopy
  ctx.fillStyle = '#39c5bb';
  ctx.beginPath();
  ctx.moveTo(-2, -3.5);
  ctx.lineTo(7, -2);
  ctx.lineTo(10, 0);
  ctx.lineTo(7, 2);
  ctx.lineTo(-2, 3.5);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1;
  ctx.stroke();

  // Rear exhaust thrusters
  ctx.fillStyle = '#ff9800';
  ctx.fillRect(-10, -3, 1.5, 6);
}

// --- 6. NON-HUMANOID HEAVY (60-75 Tons): Mad Cat / Marauder massive missile pods & forward gun pylons ---
export function drawArchetype_NonHumanoidHeavy(ctx: Ctx, teamColor: string, teamAccent: string): void {
  // Twin Massive Shoulder LRM-20 Missile Boxes
  for (const side of [-1, 1]) {
    const y = side * 12.5;
    // Pod box
    ctx.fillStyle = '#21262d';
    ctx.beginPath();
    ctx.roundRect(-8, y - 5.5, 16, 11, 2);
    ctx.fill();
    ctx.strokeStyle = teamColor;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Front missile tube array (3x3 gold rockets)
    ctx.fillStyle = '#e3b341';
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        ctx.fillRect(3.5 + c * 1.5, y - 3.5 + r * 2.6, 1.2, 1.6);
      }
    }
  }

  // Central Forward Fuselage Pod / Cockpit Nose
  ctx.fillStyle = teamColor;
  ctx.beginPath();
  ctx.moveTo(-7, -5);
  ctx.lineTo(6, -4);
  ctx.lineTo(11, 0); // Pointed nose
  ctx.lineTo(6, 4);
  ctx.lineTo(-7, 5);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#0d1117';
  ctx.lineWidth = 1.2;
  ctx.stroke();

  // Cockpit Glazing Canopy (Emerald Green tint)
  ctx.fillStyle = '#39c5bb';
  ctx.beginPath();
  ctx.moveTo(-1, -3);
  ctx.lineTo(6, -2.5);
  ctx.lineTo(9, 0);
  ctx.lineTo(6, 2.5);
  ctx.lineTo(-1, 3);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1;
  ctx.stroke();

  // Outrigger Gun Arms / Forward PPC Pylons
  for (const side of [-1, 1]) {
    const y = side * 19;
    ctx.fillStyle = teamAccent;
    ctx.fillRect(-2, y - 2.5, 14, 5);
    ctx.strokeStyle = '#0d1117';
    ctx.lineWidth = 1;
    ctx.strokeRect(-2, y - 2.5, 14, 5);

    // Long Energy Cannon Barrel
    ctx.fillStyle = '#161b22';
    ctx.fillRect(12, y - 1.5, 5, 3);
  }
}

// --- 7. HUMANOID ASSAULT (80-100 Tons): Square slab torso, rear armour slab, twin missile racks, long twin cannons ---
export function drawArchetype_HumanoidAssault(ctx: Ctx, teamColor: string, teamAccent: string): void {
  // Rear armour slab (heat sinks behind the torso) — widest part of the silhouette along the facing axis
  ctx.fillStyle = '#161b22';
  ctx.fillRect(-14, -10, 4, 20);
  ctx.strokeStyle = '#0d1117';
  ctx.lineWidth = 1;
  ctx.strokeRect(-14, -10, 4, 20);

  // Square slab torso, broader than the heavy carapace
  ctx.fillStyle = teamColor;
  ctx.fillRect(-10, -18, 20, 36);
  ctx.strokeStyle = '#0d1117';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(-10, -18, 20, 36);

  // Shoulder armour plates in the accent colour
  ctx.fillStyle = teamAccent;
  ctx.fillRect(-9, -18, 9, 4);
  ctx.fillRect(-9, 14, 9, 4);

  // Twin missile racks (3x3 grids), one per shoulder
  for (const side of [-1, 1]) {
    const y0 = side < 0 ? -13 : 5;
    ctx.fillStyle = '#161b22';
    ctx.fillRect(-7, y0, 10, 8);
    ctx.fillStyle = '#e3b341';
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        ctx.fillRect(-6 + c * 3, y0 + 0.8 + r * 2.4, 2, 1.8);
      }
    }
  }

  // Massive twin arm cannons, longer than the heavy's
  for (const side of [-1, 1]) {
    const y = side * 21;
    ctx.fillStyle = teamAccent;
    ctx.fillRect(-5, y - 3.5, 16, 7);
    ctx.strokeStyle = '#0d1117';
    ctx.lineWidth = 1;
    ctx.strokeRect(-5, y - 3.5, 16, 7);

    ctx.fillStyle = '#161b22';
    ctx.fillRect(11, y - 2.5, 9, 5);
    ctx.fillStyle = '#090c10';
    ctx.fillRect(19, y - 3, 2, 6);
  }

  // Faceted Heavy Bastion Head Cowl (A2 - Octagon block)
  ctx.fillStyle = '#e6edf3';
  ctx.beginPath();
  ctx.moveTo(-2, -5.5);
  ctx.lineTo(4, -5.5);
  ctx.lineTo(8, -3);
  ctx.lineTo(8, 3);
  ctx.lineTo(4, 5.5);
  ctx.lineTo(-2, 5.5);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#0d1117';
  ctx.lineWidth = 1.2;
  ctx.stroke();

  // Wide command visor slit
  ctx.fillStyle = '#39c5bb';
  ctx.fillRect(4.5, -2.5, 3, 5);
}

// --- 8. NON-HUMANOID ASSAULT (80-100 Tons): Broad hull, four-tier gun deck — shoulder pods plus far outrigger cannons ---
export function drawArchetype_NonHumanoidAssault(ctx: Ctx, teamColor: string, teamAccent: string): void {
  // Rear armoured hump
  ctx.fillStyle = '#161b22';
  ctx.fillRect(-14, -7, 4, 14);
  ctx.strokeStyle = '#0d1117';
  ctx.lineWidth = 1;
  ctx.strokeRect(-14, -7, 4, 14);

  // Shoulder missile pods, larger than the heavy's (4x3 tube grid)
  for (const side of [-1, 1]) {
    const y = side * 13.5;
    ctx.fillStyle = '#21262d';
    ctx.beginPath();
    ctx.roundRect(-9, y - 6, 19, 12, 2);
    ctx.fill();
    ctx.strokeStyle = teamColor;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.fillStyle = '#e3b341';
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 4; c++) {
        ctx.fillRect(2.5 + c * 1.9, y - 4 + r * 2.8, 1.4, 1.8);
      }
    }
  }

  // Wide central hull
  ctx.fillStyle = teamColor;
  ctx.beginPath();
  ctx.moveTo(-11, -8);
  ctx.lineTo(7, -7);
  ctx.lineTo(13, 0); // Pointed nose
  ctx.lineTo(7, 7);
  ctx.lineTo(-11, 8);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#0d1117';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Cockpit canopy
  ctx.fillStyle = '#39c5bb';
  ctx.beginPath();
  ctx.moveTo(-1, -3.5);
  ctx.lineTo(7, -3);
  ctx.lineTo(10, 0);
  ctx.lineTo(7, 3);
  ctx.lineTo(-1, 3.5);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1;
  ctx.stroke();

  // Far outrigger heavy cannons
  for (const side of [-1, 1]) {
    const y = side * 22;
    ctx.fillStyle = teamAccent;
    ctx.fillRect(-4, y - 3, 16, 6);
    ctx.strokeStyle = '#0d1117';
    ctx.lineWidth = 1;
    ctx.strokeRect(-4, y - 3, 16, 6);

    ctx.fillStyle = '#161b22';
    ctx.fillRect(12, y - 2, 8, 4);
    ctx.fillStyle = '#090c10';
    ctx.fillRect(19, y - 2.5, 2, 5);
  }
}

// --- 9. UNIDENTIFIED CONTACT (Radar Echo / Holographic Glitch / Unknown Chassis) ---
export function drawArchetype_Unidentified(ctx: Ctx, _teamColor: string, _teamAccent: string, time = 0): void {
  const pulse = 0.5 + 0.5 * Math.sin((time || 0) * 0.006);

  // 1. Holographic Glitch Shadow Silhouette (Diamond / Hexagon Stealth Pod)
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(-11, 0);
  ctx.lineTo(-4, -9);
  ctx.lineTo(8, -7);
  ctx.lineTo(13, 0);
  ctx.lineTo(8, 7);
  ctx.lineTo(-4, 9);
  ctx.closePath();
  ctx.fillStyle = 'rgba(22, 27, 34, 0.92)';
  ctx.fill();
  ctx.strokeStyle = '#e3b341'; // Amber Sensor Echo
  ctx.lineWidth = 1.5;
  ctx.setLineDash([3, 3]);
  ctx.stroke();

  // 2. Concentric Sonar / Seismic Echo Waves
  for (let r = 0; r < 2; r++) {
    ctx.beginPath();
    ctx.arc(0, 0, 5 + r * 4.5 + pulse * 2.5, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(227, 179, 65, ${0.45 - r * 0.18})`;
    ctx.lineWidth = 1.2;
    ctx.setLineDash([]);
    ctx.stroke();
  }

  // 3. Center Glowing Sensor Question Mark Glyph [?]
  ctx.font = 'bold 12px "Orbitron", monospace';
  ctx.fillStyle = '#ffd54f';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = '#ffb300';
  ctx.shadowBlur = 8;
  ctx.fillText('?', 0, 1);
  ctx.shadowBlur = 0;

  // 5. Sensor Direction Pointer (Forward Radar Wedge)
  ctx.fillStyle = '#ffd54f';
  ctx.beginPath();
  ctx.moveTo(11, -3.5);
  ctx.lineTo(16, 0);
  ctx.lineTo(11, 3.5);
  ctx.closePath();
  ctx.fill();

  ctx.restore();
}

export type ArchetypeDrawer = (ctx: Ctx, teamColor: string, teamAccent: string) => void;

/** Рисовалка по ключу `scene.ts::archetypeKey`. Контакт без опознания сюда не входит. */
// --- ОГНЕВАЯ ТОЧКА (шаг 73c) ---------------------------------------------------
//
// Значок задан строками SVG-пути (решение пользователя 2026-09-24: «SVG турели и
// дымящейся турели»): Canvas принимает их через `Path2D`, поэтому значок живёт в
// той же таблице рисовалок, что и силуэты машин, и так же проверяется тестом
// полноты. `Path2D` собирается при рисовании, а не при загрузке модуля: в
// тестах под Node его нет, а таблица импортируется и там.

/** Восьмигранное бетонное основание. */
const EMPLACEMENT_BASE = 'M-13,-5 L-5,-13 L5,-13 L13,-5 L13,5 L5,13 L-5,13 L-13,5 Z';
/** Поворотная башня. */
const EMPLACEMENT_DOME = 'M-7,0 A7,7 0 1,0 7,0 A7,7 0 1,0 -7,0 Z';
/** Короб пусковой — смотрит по фронту (+x), как нос у силуэтов машин. */
const EMPLACEMENT_RACK = 'M1,-6 L16,-6 L16,6 L1,6 Z';
/** Смятый короб выбитой установки. */
const EMPLACEMENT_RACK_BROKEN = 'M1,-6 L12,-8 L15,-1 L10,7 L2,5 Z';

function drawEmplacementBody(ctx: Ctx, base: string, dome: string, rack: string, rackPath: string): void {
  ctx.fillStyle = base;
  ctx.fill(new Path2D(EMPLACEMENT_BASE));
  ctx.strokeStyle = '#0d1117';
  ctx.lineWidth = 1.2;
  ctx.stroke(new Path2D(EMPLACEMENT_BASE));
  ctx.fillStyle = rack;
  ctx.fill(new Path2D(rackPath));
  ctx.stroke(new Path2D(rackPath));
  ctx.fillStyle = dome;
  ctx.fill(new Path2D(EMPLACEMENT_DOME));
  ctx.stroke(new Path2D(EMPLACEMENT_DOME));
}

/** Целая огневая точка: основание, башня и короб пусковой с гнёздами ракет. */
export function drawEmplacement(ctx: Ctx, teamColor: string, teamAccent: string): void {
  drawEmplacementBody(ctx, '#30363d', teamColor, teamAccent, EMPLACEMENT_RACK);
  ctx.fillStyle = '#0d1117';
  for (let col = 0; col < 3; col++) {
    for (let row = 0; row < 3; row++) {
      ctx.beginPath();
      ctx.arc(5 + col * 4, -4 + row * 4, 1.1, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

/** Выбитая огневая точка: смятый короб, копоть и дым, который поднимается со временем. */
export function drawEmplacementWreck(ctx: Ctx, time: number): void {
  drawEmplacementBody(ctx, '#21262d', '#30363d', '#161b22', EMPLACEMENT_RACK_BROKEN);
  ctx.fillStyle = '#d97706';
  ctx.fillRect(-2, -2, 4, 4);
  for (let i = 0; i < 4; i++) {
    const phase = ((time / 1400 + i / 4) % 1 + 1) % 1;
    ctx.beginPath();
    ctx.arc(-2 + i * 2 + phase * 4, -phase * 22, 3 + phase * 6, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(120, 125, 135, ${0.45 * (1 - phase)})`;
    ctx.fill();
  }
}

/** Бункер (шаг 73d): приземистый короб с двумя амбразурами по фронту. */
const BUNKER_BODY = 'M-14,-11 L10,-11 L15,-6 L15,6 L10,11 L-14,11 Z';
export function drawBunker(ctx: Ctx, teamColor: string, teamAccent: string): void {
  ctx.fillStyle = '#30363d';
  ctx.fill(new Path2D(BUNKER_BODY));
  ctx.strokeStyle = '#0d1117';
  ctx.lineWidth = 1.2;
  ctx.stroke(new Path2D(BUNKER_BODY));
  ctx.fillStyle = teamColor;
  ctx.fillRect(-9, -7, 14, 14);
  ctx.strokeRect(-9, -7, 14, 14);
  ctx.fillStyle = teamAccent;
  ctx.fillRect(9, -6, 7, 3);
  ctx.fillRect(9, 3, 7, 3);
}

/** Узел связи (шаг 73d): мачта с растяжками и тарелкой — объект-цель без оружия. */
const RELAY_MAST = 'M-2,-14 L2,-14 L2,14 L-2,14 Z';
const RELAY_DISH = 'M4,-8 A9,9 0 0,1 4,8 L1,0 Z';
export function drawRelay(ctx: Ctx, teamColor: string, teamAccent: string): void {
  ctx.strokeStyle = '#8b949e';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(-12, -12);
  ctx.lineTo(0, 0);
  ctx.lineTo(-12, 12);
  ctx.moveTo(12, -12);
  ctx.lineTo(0, 0);
  ctx.lineTo(12, 12);
  ctx.stroke();
  ctx.fillStyle = teamColor;
  ctx.fill(new Path2D(RELAY_MAST));
  ctx.fillStyle = teamAccent;
  ctx.fill(new Path2D(RELAY_DISH));
  ctx.strokeStyle = '#0d1117';
  ctx.lineWidth = 1.2;
  ctx.stroke(new Path2D(RELAY_DISH));
}

/** Склад (шаг 73d): ангар с воротами — объект-цель без оружия. */
const DEPOT_BODY = 'M-15,-10 L15,-10 L15,10 L-15,10 Z';
export function drawDepot(ctx: Ctx, teamColor: string, teamAccent: string): void {
  ctx.fillStyle = teamColor;
  ctx.fill(new Path2D(DEPOT_BODY));
  ctx.strokeStyle = '#0d1117';
  ctx.lineWidth = 1.2;
  ctx.stroke(new Path2D(DEPOT_BODY));
  ctx.strokeStyle = teamAccent;
  ctx.beginPath();
  for (const x of [-9, -3, 3, 9]) {
    ctx.moveTo(x, -10);
    ctx.lineTo(x, 10);
  }
  ctx.stroke();
  ctx.fillStyle = '#161b22';
  ctx.fillRect(11, -5, 4, 10);
}

/** Ключ фишки огневой точки (`scene.ts::archetypeOf`). */
export const EMPLACEMENT_ARCHETYPE = 'emplacement';
/** Ключи фишек конструкций укрепления (шаг 73d), по имени конструкции. */
export const STRUCTURE_ARCHETYPES: Readonly<Record<string, string>> = {
  bunker: 'emplacement_bunker',
  relay: 'emplacement_relay',
  depot: 'emplacement_depot',
};
/** Все фишки установок: выбитые рисуются дымящимися обломками, а не упавшим мехом. */
export const INSTALLATION_ARCHETYPES: ReadonlySet<string> = new Set([
  EMPLACEMENT_ARCHETYPE,
  ...Object.values(STRUCTURE_ARCHETYPES),
]);

export const ARCHETYPE_DRAWERS: Readonly<Record<string, ArchetypeDrawer>> = {
  humanoid_light: drawArchetype_HumanoidLight,
  humanoid_medium: drawArchetype_HumanoidMedium,
  humanoid_heavy: drawArchetype_HumanoidHeavy,
  humanoid_assault: drawArchetype_HumanoidAssault,
  non_humanoid_light: drawArchetype_NonHumanoidLight,
  non_humanoid_medium: drawArchetype_NonHumanoidMedium,
  non_humanoid_heavy: drawArchetype_NonHumanoidHeavy,
  non_humanoid_assault: drawArchetype_NonHumanoidAssault,
  [EMPLACEMENT_ARCHETYPE]: drawEmplacement,
  emplacement_bunker: drawBunker,
  emplacement_relay: drawRelay,
  emplacement_depot: drawDepot,
};
