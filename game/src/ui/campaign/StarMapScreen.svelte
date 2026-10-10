<script lang="ts">
  import { onMount } from 'svelte';
  import { FACTIONS, GALAXY } from '../../core/campaign/galaxy/index.js';
  import { PLAYER_ACTOR_ID } from '../../core/campaign/war/actors.js';
  // Цвета канваса берутся из палитры проекта, а не пишутся здесь: правило §11
  // game_core.md — `data/palette.json` единственный источник цвета для канваса.
  import palette from '../../../data/palette.json';
  import { campaign, type ClaimTerm } from '../state/campaign.svelte.js';
  import { cbills, days as daysText, signedCbills, t } from '../i18n/index.js';
  import { WAR } from '../../core/campaign/war/schema.js';
  import { factionFullName } from '../i18n/names.js';
  import FactionEmblem from '../components/FactionEmblem.svelte';
  import PlanetDisc from '../components/PlanetDisc.svelte';
  import WikiHelp from '../wiki/WikiHelp.svelte';

  /**
   * Звёздная карта: каталог на 2000 систем, прыжки и досье планеты.
   *
   * Канвас, а не DOM, и это не вкусовщина: две тысячи узлов элементами разметки
   * — две тысячи объектов вёрстки, которые браузер пересчитывает на каждом
   * сдвиге карты. Здесь один канвас и цикл по массивам каталога
   * (`GalaxyCatalog` — структура массивов, а не массив структур).
   *
   * Ни одного числа маршрута экран не считает: прыжки, сутки и цену даёт
   * `findRoute`, знание о системе — `systemKnowledge`. Своя формула «сколько
   * это будет стоить» разошлась бы с той, по которой команда спишет деньги.
   */

  let canvas = $state<HTMLCanvasElement | null>(null);
  let ctx: CanvasRenderingContext2D | null = null;

  let zoom = $state(0.9);
  let panX = $state(0);
  let panY = $state(0);
  let dragging = false;
  let dragStartX = 0;
  let dragStartY = 0;
  /** Сдвинули ли карту с зажатой кнопкой: щелчок после протяжки не должен выбирать систему. */
  let dragged = false;
  let hovered = $state<number | null>(null);
  let hoverPos = $state({ x: 0, y: 0 });

  const selectedId = $derived(campaign.selectedSystemId ?? campaign.state.systemId);
  const selected = $derived(campaign.knowledgeOf(selectedId));

  /**
   * Снабжение выбранного мира: за сколько дней привезут заказанный узел и во
   * сколько обойдётся доставка (шаг 45).
   *
   * Выводится из класса рынка, а тот виден без разведки (решение 2026-09-01),
   * — поэтому маршрут «за скоростным реактором туда, где его привезут за
   * неделю» прокладывается заранее и ни разу не платя за `Survey`.
   */
  const supply = $derived(campaign.supplyOf(selectedId));

  /**
   * Экономика владельца и самого мира (шаг 21a, часть D).
   *
   * Полоса достатка видна всегда, точные числа вклада — за разведкой
   * (`worldEconomy` возвращает `null` до неё). Экран ничего не считает: обе
   * величины приходят из ядра.
   */
  const ownerWealth = $derived(campaign.prosperityBandOf(selected.owner));
  /** Насколько мир отстроен сверх канона (плюс) или сведён войной (минус) — шаг 23. */
  const development = $derived(campaign.developmentOf(selectedId));
  const worldEconomy = $derived(campaign.worldEconomy(selectedId));
  /**
   * Напряжённость участка (шаг 21b): с кем у этой системы фронт и насколько
   * горячий. Полосой и без разведки — где стоят армии, наёмник знает из сводок
   * MRBC, а не из штабных карт.
   */
  const tensions = $derived(campaign.tensionAt(selectedId));
  /** Слой фронта: где горит. Считает ядро, экран только красит (шаг 22d). */
  const heat = $derived(campaign.heatBySystem);
  const workScaleHeat = $derived(campaign.workScaleBySystem);
  /**
   * Слой пиратской угрозы (шаг 41) — вторая тепловая карта. Считает та же
   * функция, что и биржа (`contracts/pirates.ts`): карта, рисующая не то, что
   * считает мир, хуже отсутствия карты.
   */
  const pirateHeat = $derived(campaign.pirateHeatBySystem);
  /** Слой качества рынка: где брать нормальное оружие и узлы, а не хлам с поля. */
  const marketHeat = $derived(campaign.marketHeatBySystem);
  /**
   * ПЕРЕКЛЮЧАТЕЛЬ СЛОЁВ вместо одного флажка.
   *
   * Два ореола разом на две тысячи точек читаются хуже, чем один: красное и
   * янтарное смешиваются, и обе карты пропадают. Поэтому слои взаимоисключающие;
   * режим «оба слоя» убран решением пользователя 2026-09-08 — именно как каша,
   * ради которой слои и разводились.
   */
  let layer = $state<'front' | 'pirates' | 'scale' | 'market' | 'realm' | 'none'>('front');
  const showHeat = $derived(layer === 'front');
  const showPirates = $derived(layer === 'pirates');
  /** Слой масштаба работы (шаг 44c): где берут больше копья. */
  const showScale = $derived(layer === 'scale');
  const showMarket = $derived(layer === 'market');
  /** Слой державы (шаг 72a): свои миры, столица, данники, вассалы, граница. */
  const showRealm = $derived(layer === 'realm');
  const realmMap = $derived(campaign.realmMap);
  /**
   * Цвет роли — из палитры (`data/palette.json`): золото — своё, бирюза —
   * данники роты, синий — вассалы, приглушённый — граница.
   */
  const REALM_COLOR = {
    capital: palette.ui.gold,
    own: palette.ui.gold,
    tributary: palette.ui.accent,
    vassal: palette.ui.borderActive,
    border: palette.ui.textDim,
  } as const;

  /**
   * ШКАЛА СЛОЯ ФРОНТА (правка 2026-09-08).
   *
   * **Почему слой был еле виден.** Яркость считалась прямо от напряжённости,
   * как будто та лежит в 0..1. На деле `tensionOf` даёт 0.03…0.44 (замер по
   * восьми сотням систем на сотый и на триста шестьдесят пятый день), поэтому
   * самая горячая граница Сферы рисовалась вполсилы, а обычная — почти
   * прозрачной: получались мутные пятна вместо линии фронта.
   *
   * Нормируется НЕ только по максимуму на карте: у пустой Сферы он был бы
   * крошечным, и мирная граница засветилась бы как настоящая война. Берётся
   * большее из замеренного «полного фронта» и текущего максимума — так яркость
   * сравнима между декадами и не врёт ни в одну сторону.
   */
  const HEAT_FULL = 0.45;
  const heatScale = $derived(Math.max(HEAT_FULL, ...(heat.size > 0 ? [...heat.values()] : [0])));
  const pirateRisk = $derived(campaign.pirateRiskAt(selectedId));
  const cleared = $derived(campaign.clearedAt(selectedId));
  const hottest = $derived(tensions[0]);
  /** До какой ступени доходит работа на выбранной планете (шаг 44c). */
  const workScale = $derived(campaign.scaleOutlookAt(selectedId));
  const here = $derived(campaign.state.systemId);
  const route = $derived(campaign.routeTo(selectedId));

  const P = palette.ui;

  /**
   * Цвет системы — по ТЕКУЩЕМУ владельцу, а не по канону 3053 года (шаг 21b).
   *
   * До этого шага слой владения рисовался из `GALAXY.ownerId`, и это было
   * верно ровно до тех пор, пока фронт не двигался: `ownerId` — это канон, а
   * дельта — то, чем мир от него отличается. Занятый Куритой мир остался бы на
   * карте дэвионским, хотя в досье и на бирже он уже куритянский, — та самая
   * поломка, которую видно только глазами.
   *
   * Дельты берутся снимком на перерисовку, а не спрашиваются на каждую из двух
   * тысяч систем: `campaign.owners` — один массив, `ownerOf` — поиск по
   * разрежённой карте.
   */
  const owners = $derived(campaign.owners);

  function colorOf(i: number): string {
    return FACTIONS.get(owners[i] ?? GALAXY.ownerId(i))?.color ?? P.textDim;
  }

  function toScreen(i: number): { x: number; y: number } {
    return {
      x: panX + (GALAXY.x[i] as number) * zoom,
      y: panY - (GALAXY.y[i] as number) * zoom,
    };
  }

  function centerOn(systemId: string, z = zoom): void {
    if (canvas === null) return;
    const i = GALAXY.require(systemId);
    zoom = z;
    panX = canvas.width / 2 - (GALAXY.x[i] as number) * zoom;
    panY = canvas.height / 2 + (GALAXY.y[i] as number) * zoom;
    draw();
  }

  function draw(): void {
    if (ctx === null || canvas === null) return;
    const w = canvas.width;
    const h = canvas.height;

    ctx.fillStyle = '#070a0f';
    ctx.fillRect(0, 0, w, h);

    // Координатная сетка: без неё панорамирование не читается движением.
    ctx.strokeStyle = 'rgba(48, 54, 61, 0.22)';
    ctx.lineWidth = 1;
    const step = 50 * zoom;
    for (let x = panX % step; x < w; x += step) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
    for (let y = panY % step; y < h; y += step) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    const hereIdx = GALAXY.require(here);
    const selIdx = GALAXY.require(selectedId);

    // Радиус одного прыжка от места стоянки. Показывает ПРАВИЛО (30 св. лет),
    // а не украшение: дальше одного прыжка ходит только маршрут.
    const jumpPx = GALAXY.jumpRangeLy * zoom;
    const hereAt = toScreen(hereIdx);
    ctx.strokeStyle = 'rgba(57, 197, 187, 0.35)';
    ctx.fillStyle = 'rgba(57, 197, 187, 0.04)';
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.arc(hereAt.x, hereAt.y, jumpPx, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.setLineDash([]);

    // Маршрут ногами: каждая нога — отдельный прыжок, и их видно столько,
    // сколько раз кораблю заряжать парус.
    if (route !== null && route.path.length > 1) {
      const g = ctx;
      g.strokeStyle = P.accent;
      g.lineWidth = 2;
      g.beginPath();
      route.path.forEach((idx, n) => {
        const p = toScreen(idx);
        if (n === 0) g.moveTo(p.x, p.y);
        else g.lineTo(p.x, p.y);
      });
      g.stroke();

      ctx.fillStyle = P.gold;
      for (const idx of route.path.slice(1, -1)) {
        const p = toScreen(idx);
        ctx.beginPath();
        ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Сами системы. Цикл по массивам каталога, отсечение за экраном — без него
    // две тысячи дуг рисуются каждый кадр протяжки.
    // Подписи у заметных систем появляются только на приближении. При обзоре
    // всей Сферы их полторы сотни, они наезжают друг на друга и превращают
    // карту в кашу — проверено глазами на первом же прогоне.
    const labels = zoom >= 1.8;
    for (let i = 0; i < GALAXY.count; i++) {
      const p = toScreen(i);
      if (p.x < -20 || p.x > w + 20 || p.y < -20 || p.y > h + 20) continue;

      const isHere = i === hereIdx;
      const isSel = i === selIdx;

      /*
        СЛОЙ ФРОНТА. Тикер войны сделал горячую границу местом, куда за работой
        надо лететь, — а найти её на карте было нечем: система красилась только
        цветом владельца, и напряжённость открывалась лишь щелчком по досье.
        Две тысячи систем не прокликать, и самое важное, что дал шаг 21b, игрок
        увидеть не мог.

        Красится ореолом ПОД точкой, а не самой точкой: цвет владельца — то,
        по чему карта читается в первую очередь, и подменять его нельзя.
      */
      const hot = showHeat ? (heat.get(i) ?? 0) : 0;
      if (hot > 0) {
        // Доля от полного фронта, а не сырая напряжённость: см. `heatScale`.
        const k = Math.min(1, hot / heatScale);
        const rr = 5 + 9 * k;

        // Ореол — мягким градиентом от ядра к пустоте. Плоский круг с общей
        // прозрачностью давал ту самую «муть»: край такой же плотный, как
        // середина, и полсотни кругов рядом сливались в пятно.
        const glow = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, rr);
        glow.addColorStop(0, `rgba(248, 81, 73, ${(0.35 + 0.45 * k).toFixed(3)})`);
        glow.addColorStop(0.55, `rgba(248, 81, 73, ${(0.14 + 0.26 * k).toFixed(3)})`);
        glow.addColorStop(1, 'rgba(248, 81, 73, 0)');
        ctx.globalAlpha = 1;
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(p.x, p.y, rr, 0, Math.PI * 2);
        ctx.fill();

        // Кольцо — то, что читается на звёздном поле по-настоящему: резкая
        // окружность видна там, где заливка тонет. Толщина и яркость растут с
        // напряжённостью, так что линия фронта собирается из колец сама.
        ctx.globalAlpha = 0.45 + 0.55 * k;
        ctx.strokeStyle = '#ff6b63';
        ctx.lineWidth = 0.8 + 1.2 * k;
        ctx.beginPath();
        ctx.arc(p.x, p.y, rr * 0.72, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      /*
        СЛОЙ ПИРАТСКОЙ УГРОЗЫ (шаг 41). Янтарный против красного у фронта — не
        украшение: это ДВА РАЗНЫХ РОДА РАБОТЫ, и путать их нельзя. Красное —
        регулярные части Домов, тяжело и дорого; янтарное — вольница, посильная
        зелёному копью. Ровно между этими двумя картами игрок и выбирает, куда
        лететь.
      */
      /*
        СЛОЙ МАСШТАБА РАБОТЫ (шаг 44c). Третья карта того же рода, что фронт и
        вольница, и по той же причине: масштаб — свойство мира, а биржа видна
        только на месте. Бирюзовый против красного и янтарного — это ТРЕТИЙ род
        сведений: не «с кем воюют» и не «кто грабит», а «какого размера здесь
        работа». Подсвечиваются только миры от усиленного отряда и выше: копьё
        есть везде, и закрашивать им всю Сферу нечего.
      */
      const scaleHot = showScale ? (workScaleHeat.get(i) ?? 0) : 0;
      if (scaleHot > 0) {
        const rr = 4.5 + 8 * scaleHot;
        const glow = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, rr);
        glow.addColorStop(0, `rgba(88, 214, 205, ${(0.28 + 0.42 * scaleHot).toFixed(3)})`);
        glow.addColorStop(0.55, `rgba(88, 214, 205, ${(0.1 + 0.24 * scaleHot).toFixed(3)})`);
        glow.addColorStop(1, 'rgba(88, 214, 205, 0)');
        ctx.globalAlpha = 1;
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(p.x, p.y, rr, 0, Math.PI * 2);
        ctx.fill();

        ctx.globalAlpha = 0.45 + 0.55 * scaleHot;
        ctx.strokeStyle = '#58d6cd';
        ctx.lineWidth = 0.8 + 1.2 * scaleHot;
        ctx.beginPath();
        ctx.arc(p.x, p.y, rr * 0.72, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      /*
        СЛОЙ КАЧЕСТВА РЫНКА. Зелёный против бирюзового, янтарного и красного —
        четвёртый род сведений, и по той же причине, что у остальных трёх: где
        купить не «Восстановленное», а нормальное оружие и узлы, не прокликать
        вручную по две тысячи систем.
      */
      const marketHot = showMarket ? (marketHeat.get(i) ?? 0) : 0;
      if (marketHot > 0) {
        const rr = 4.5 + 8 * marketHot;
        const glow = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, rr);
        glow.addColorStop(0, `rgba(63, 185, 80, ${(0.28 + 0.42 * marketHot).toFixed(3)})`);
        glow.addColorStop(0.55, `rgba(63, 185, 80, ${(0.1 + 0.24 * marketHot).toFixed(3)})`);
        glow.addColorStop(1, 'rgba(63, 185, 80, 0)');
        ctx.globalAlpha = 1;
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(p.x, p.y, rr, 0, Math.PI * 2);
        ctx.fill();

        ctx.globalAlpha = 0.45 + 0.55 * marketHot;
        ctx.strokeStyle = '#3fb950';
        ctx.lineWidth = 0.8 + 1.2 * marketHot;
        ctx.beginPath();
        ctx.arc(p.x, p.y, rr * 0.72, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      const raid = showPirates ? (pirateHeat.get(i) ?? 0) : 0;
      if (raid > 0.15) {
        // Рисуется той же парой «ореол + кольцо», что и фронт: одна манера на
        // обе тепловые карты, разница только в цвете. Плоская заливка, стоявшая
        // здесь раньше, на полутора тысячах очагов сливалась в янтарную кашу.
        const k = Math.min(1, raid);
        const rr = 4.5 + 8 * k;

        const glow = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, rr);
        glow.addColorStop(0, `rgba(210, 153, 34, ${(0.28 + 0.4 * k).toFixed(3)})`);
        glow.addColorStop(0.55, `rgba(210, 153, 34, ${(0.1 + 0.22 * k).toFixed(3)})`);
        glow.addColorStop(1, 'rgba(210, 153, 34, 0)');
        ctx.globalAlpha = 1;
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(p.x, p.y, rr, 0, Math.PI * 2);
        ctx.fill();

        ctx.globalAlpha = 0.4 + 0.5 * k;
        ctx.strokeStyle = '#e3b341';
        ctx.lineWidth = 0.8 + 1 * k;
        ctx.beginPath();
        ctx.arc(p.x, p.y, rr * 0.72, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      /*
        СЛОЙ ДЕРЖАВЫ (шаг 72a). Не тепловая карта, а принадлежность: кольцо
        цвета роли вокруг точки. Столица — двойным кольцом. Граница — тонким
        пунктиром: это не своё, а те, с кем держава может говорить.
      */
      const role = showRealm ? realmMap.get(i) : undefined;
      if (role !== undefined) {
        ctx.globalAlpha = role === 'border' ? 0.6 : 0.95;
        ctx.strokeStyle = REALM_COLOR[role];
        ctx.lineWidth = role === 'border' ? 1 : 1.8;
        if (role === 'border') ctx.setLineDash([2, 2]);
        ctx.beginPath();
        ctx.arc(p.x, p.y, 7, 0, Math.PI * 2);
        ctx.stroke();
        if (role === 'capital') {
          ctx.beginPath();
          ctx.arc(p.x, p.y, 10.5, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
      }
      const major =
        GALAXY.hasFlag(i, 'hpg') || GALAXY.hasFlag(i, 'mechFactory') || GALAXY.hasFlag(i, 'blackMarket');
      const color = colorOf(i);
      const r = isHere || isSel ? 4.5 : major ? 3 : 1.6;

      ctx.globalAlpha = isSel ? 0.9 : major ? 0.45 : 0.25;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r * 2, 0, Math.PI * 2);
      ctx.fill();

      ctx.globalAlpha = 1;
      ctx.fillStyle = isHere ? P.accent : isSel ? P.borderActive : major ? P.text : color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fill();

      if (isSel) {
        ctx.strokeStyle = P.borderActive;
        ctx.lineWidth = 1.5;
        ctx.strokeRect(p.x - 9, p.y - 9, 18, 18);
      }

      if (isHere || isSel || (major && labels)) {
        ctx.fillStyle = isSel ? P.borderActive : isHere ? P.accent : P.textDim;
        ctx.font = `${isHere || isSel ? 'bold ' : ''}11px "IBM Plex Mono", monospace`;
        ctx.textAlign = 'left';
        ctx.fillText(GALAXY.name(i), p.x + 7, p.y + 3.5);
      }
    }
    ctx.globalAlpha = 1;
  }

  /** Ближайшая система к точке экрана. `null` — мимо всех. */
  function pick(mx: number, my: number, radius = 14): number | null {
    let best: number | null = null;
    let bestD = radius;
    for (let i = 0; i < GALAXY.count; i++) {
      const p = toScreen(i);
      if (Math.abs(p.x - mx) > radius || Math.abs(p.y - my) > radius) continue;
      const d = Math.hypot(p.x - mx, p.y - my);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }

  function onDown(e: MouseEvent): void {
    dragging = true;
    dragged = false;
    dragStartX = e.clientX - panX;
    dragStartY = e.clientY - panY;
  }

  function onMove(e: MouseEvent): void {
    if (canvas === null) return;
    if (dragging) {
      const nx = e.clientX - dragStartX;
      const ny = e.clientY - dragStartY;
      if (Math.abs(nx - panX) > 2 || Math.abs(ny - panY) > 2) dragged = true;
      panX = nx;
      panY = ny;
      draw();
      return;
    }
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    hovered = pick(mx, my);
    hoverPos = { x: mx, y: my };
  }

  function onUp(e: MouseEvent): void {
    if (canvas === null) return;
    const wasDragged = dragged;
    dragging = false;
    if (wasDragged) return;
    const rect = canvas.getBoundingClientRect();
    const found = pick(e.clientX - rect.left, e.clientY - rect.top, 16);
    if (found !== null) {
      campaign.selectedSystemId = GALAXY.id(found);
      draw();
    }
  }

  function onWheel(e: WheelEvent): void {
    e.preventDefault();
    if (canvas === null) return;
    // Масштаб тянется К КУРСОРУ, а не к центру: иначе на третьем повороте
    // колеса нужная система уезжает за край.
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const next = Math.min(6, Math.max(0.2, zoom * (e.deltaY > 0 ? 0.85 : 1.18)));
    panX = mx - ((mx - panX) / zoom) * next;
    panY = my - ((my - panY) / zoom) * next;
    zoom = next;
    draw();
  }

  onMount(() => {
    if (canvas === null) return;
    ctx = canvas.getContext('2d');
    const parent = canvas.parentElement;
    const resize = (): void => {
      if (canvas === null || parent === null) return;
      canvas.width = parent.clientWidth;
      canvas.height = parent.clientHeight;
      draw();
    };
    resize();
    // Просьба «показать на карте» с экрана державы (шаг 72a) — одноразовая.
    const request = campaign.mapRequest;
    if (request !== null) {
      campaign.mapRequest = null;
      layer = 'realm';
      centerOn(request, 1.8);
    } else {
      centerOn(here, 1.2);
    }

    const observer = new ResizeObserver(resize);
    if (parent !== null) observer.observe(parent);
    return () => observer.disconnect();
  });

  // Перерисовка, когда состояние кампании сдвинулось: прилетели, разведали,
  // выбрали другую систему.
  $effect(() => {
    void campaign.day;
    void selectedId;
    void here;
    // Слой владения меняется тактом фронта (шаг 21b), а не только действиями
    // роты: без этой зависимости карта перерисовывалась бы только при перелёте,
    // и захваченный мир менял бы цвет с опозданием на несколько ходов.
    void owners;
    void heat;
    void showHeat;
    void pirateHeat;
    void showPirates;
    void showScale;
    void workScaleHeat;
    void showMarket;
    void marketHeat;
    void showRealm;
    void realmMap;
    draw();
  });

  /** Объекты системы: их наличие — свойство каталога, а не профиля, и видно всегда. */
  const FLAGS = [
    { id: 'hpg', key: 'starmap.hpg' },
    { id: 'blackMarket', key: 'starmap.blackMarket' },
    { id: 'mechFactory', key: 'starmap.mechFactory' },
  ] as const;

  /**
   * Полоса напряжённости — слово, а не число, тем же приёмом, что полоса
   * гарнизона и полоса достатка. Пороги здесь, а не в данных, намеренно: это
   * подписи к уже посчитанной величине, а не правило мира.
   */
  /**
   * Полоса пиратской угрозы (шаг 41). Словом, а не только числом: «85 %» само по
   * себе не говорит, лететь туда зелёному копью или бежать.
   */
  function pirateBand(value: number): 'patrolled' | 'quiet' | 'restless' | 'lawless' {
    if (value >= 0.6) return 'lawless';
    if (value >= 0.25) return 'restless';
    return value > 0 ? 'quiet' : 'patrolled';
  }

  function tensionBand(value: number): 'calm' | 'tense' | 'hot' | 'blazing' {
    if (value >= 0.6) return 'blazing';
    if (value >= 0.35) return 'hot';
    return value >= 0.15 ? 'tense' : 'calm';
  }

  const travelCmd = $derived({ kind: 'travel', systemId: selectedId } as const);
  const surveyCmd = $derived({ kind: 'survey' } as const);

  /**
   * Три пути к миру (шаг 38) и их условия (шаг 72). Условия видны для любой
   * системы — по ним игрок и выбирает, куда лететь; кнопка — только там, где
   * рота стоит, и включает её `why()`, то есть сама команда.
   */
  const claims = $derived(selected.owner === PLAYER_ACTOR_ID ? [] : campaign.claimTerms(selected.id));
  /**
   * Блок «Владение миром» свёрнут по умолчанию (решение пользователя
   * 2026-09-23): условия трёх путей нужны, когда ищут мир, а в остальное время
   * мешают читать досье. Открытый путь виден и в свёрнутом — значком.
   */
  let domainOpen = $state(false);

  function termValue(term: ClaimTerm, value: number): string {
    if (term.unit === 'frac') return value.toFixed(2);
    if (term.unit === 'pct') return `${Math.round(value * 100)} %`;
    if (term.unit === 'money') return cbills(value);
    return String(Math.floor(value));
  }
</script>

<div class="starmap">
  <main class="panel panel-scroll map-panel">
    <div class="panel-header">
      <span>{t('starmap.title')}</span>
      <span class="controls">
        <button
          class="btn btn-sm"
          class:active={layer === 'front'}
          title={t('starmap.heatHint')}
          onclick={() => {
            layer = layer === 'front' ? 'none' : 'front';
            draw();
          }}
        >
          {t('starmap.heat')} <span class="heat-dot"></span>
        </button>
        <button
          class="btn btn-sm"
          class:active={layer === 'pirates'}
          title={t('starmap.pirateHint')}
          onclick={() => {
            layer = layer === 'pirates' ? 'none' : 'pirates';
            draw();
          }}
        >
          {t('starmap.pirates')} <span class="pirate-dot"></span>
        </button>
        <button
          class="btn btn-sm"
          class:active={layer === 'scale'}
          title={t('starmap.scaleLayerHint')}
          onclick={() => {
            layer = layer === 'scale' ? 'none' : 'scale';
            draw();
          }}
        >
          {t('starmap.scaleLayer')} <span class="scale-dot"></span>
        </button>
        <button
          class="btn btn-sm"
          class:active={layer === 'market'}
          title={t('starmap.marketLayerHint')}
          onclick={() => {
            layer = layer === 'market' ? 'none' : 'market';
            draw();
          }}
        >
          {t('starmap.marketLayer')} <span class="market-dot"></span>
        </button>
        {#if campaign.hasRealm}
          <button
            class="btn btn-sm"
            class:active={layer === 'realm'}
            data-layer="realm"
            title={t('starmap.realmLayerHint')}
            onclick={() => {
              layer = layer === 'realm' ? 'none' : 'realm';
              draw();
            }}
          >
            {t('starmap.realmLayer')} <span class="realm-dot"></span>
          </button>
        {/if}
        <button class="btn btn-sm" onclick={() => centerOn(here, 1.2)}>{t('starmap.centerHere')}</button>
        <button class="btn btn-sm" onclick={() => centerOn(selectedId, 1.6)}>{t('starmap.centerPicked')}</button>
        <button
          class="btn btn-sm"
          onclick={() => {
            zoom = 0.35;
            if (canvas !== null) {
              panX = canvas.width / 2;
              panY = canvas.height / 2;
            }
            draw();
          }}
        >
          {t('starmap.whole')}
        </button>
      </span>
    </div>

    <div class="canvas-wrap">
      <canvas
        bind:this={canvas}
        onmousedown={onDown}
        onmousemove={onMove}
        onmouseup={onUp}
        onmouseleave={() => {
          dragging = false;
          hovered = null;
        }}
        onwheel={onWheel}
      ></canvas>

      {#if hovered !== null}
        {@const owner = campaign.knowledgeOf(GALAXY.id(hovered))}
        <div class="tip" style:left="{hoverPos.x + 14}px" style:top="{hoverPos.y - 8}px">
          <span class="tip-name glow-cyan">{owner.name}</span>
          <span style:color={FACTIONS.get(owner.owner)?.color}>
            {factionFullName(owner.owner, FACTIONS.get(owner.owner)?.name ?? owner.owner)}
          </span>
          <span class="dim tiny">
            {t(`market.class.${owner.marketClass}`)} · {t(`biome.${owner.biome}`)}
          </span>
        </div>
      {/if}

      <div class="legend">
        <span><i class="dot here"></i> {t('starmap.legendHere')}</span>
        <span><i class="dot ring"></i> {t('starmap.legendJump', { ly: GALAXY.jumpRangeLy })}</span>
        <span><i class="dot major"></i> {t('starmap.legendMajor')}</span>
        {#if showHeat}
          <span><i class="dot hot"></i> {t('starmap.legendHot')}</span>
        {/if}
        {#if showPirates}
          <span><i class="dot raid"></i> {t('starmap.legendRaid')}</span>
        {/if}
        {#if showScale}
          <span><i class="dot big"></i> {t('starmap.legendScale')}</span>
        {/if}
        {#if showMarket}
          <span><i class="dot market"></i> {t('starmap.legendMarket')}</span>
        {/if}
        {#if showRealm}
          {#each ['capital', 'own', 'tributary', 'vassal', 'border'] as const as role (role)}
            <span><i class="ring-mark" class:dashed={role === 'border'} style:border-color={REALM_COLOR[role]}></i> {t(`starmap.legendRealm.${role}`)}</span>
          {/each}
        {/if}
      </div>
    </div>
  </main>

  <aside class="panel panel-scroll dossier">
    <div class="panel-header">
      <span>{t('starmap.dossier')}</span>
      {#if selected.surveyed}
        <span class="badge badge-ok">{t('starmap.surveyed')}</span>
      {:else}
        <span class="badge badge-dim">{t('starmap.notSurveyed')}</span>
      {/if}
    </div>

    <div class="scroll-area body">
      <div class="head">
        <span class="p-name glow-cyan">{selected.name}</span>
        <span class="owner">
          <FactionEmblem factionId={selected.owner} size={24} />
          <span style:color={FACTIONS.get(selected.owner)?.color}>
            {factionFullName(selected.owner, FACTIONS.get(selected.owner)?.name ?? selected.owner)}
          </span>
        </span>
      </div>

      <PlanetDisc biome={selected.biome} />

      {#if selected.owner === PLAYER_ACTOR_ID}
        <div class="block domain-block">
          <div class="sec-title sec-title-help">
            <button class="fold" onclick={() => (domainOpen = !domainOpen)}>
              {domainOpen ? '▾' : '▸'} {t('starmap.domain.title')}
              <span class="badge badge-ok">{t('starmap.domain.ownedBadge')}</span>
            </button>
            <WikiHelp doc="domain.md" section="1. Как получить мир" align="right" label="?" />
          </div>
          {#if domainOpen}
            <p class="ok small">{t('starmap.domain.ownedDesc')}</p>
          {/if}
          <button class="btn btn-sm btn-wide" onclick={() => (campaign.screen = 'realm')}>
            {t('starmap.domain.openRealm')}
          </button>
        </div>
      {:else}
        <div class="block domain-block">
          <div class="sec-title sec-title-help">
            <button class="fold" onclick={() => (domainOpen = !domainOpen)}>
              {domainOpen ? '▾' : '▸'} {t('starmap.domain.title')}
              {#if claims.some((claim) => claim.terms.every((term) => term.ok))}
                <span class="badge badge-ok">{t('starmap.domain.openBadge')}</span>
              {/if}
            </button>
            <WikiHelp doc="domain.md" section="1. Как получить мир" align="right" label="?" />
          </div>
          {#if domainOpen && selected.id !== here}
            <p class="dim tiny">{t('starmap.domain.presenceRequired')}</p>
          {/if}
          {#if domainOpen}
            {@const outlook = campaign.claimOutlook(selected.id)}
            <div class="claim-term" class:ok={outlook.net >= 0} class:danger={outlook.net < 0}>
              <span>{t('starmap.domain.outlook')}</span><span>{signedCbills(outlook.net)}</span>
            </div>
            <div class="claim-term" class:ok={outlook.grantNet >= 0} class:danger={outlook.grantNet < 0}>
              <span>{t('starmap.domain.outlookGrant')}</span><span>{signedCbills(outlook.grantNet)}</span>
            </div>
            <div class="claim-term" class:ok={outlook.forceNet >= 0} class:danger={outlook.forceNet < 0}>
              <span>{t('starmap.domain.outlookForce')}</span><span>{signedCbills(outlook.forceNet)}</span>
            </div>
            {#if outlook.net < 0}<p class="danger tiny">{t('starmap.domain.outlookLoss')}</p>{/if}
          {/if}
          {#each domainOpen ? claims : [] as claim (claim.path)}
            {@const why = selected.id === here ? campaign.why(claim.command) : null}
            <div class="claim" class:open={claim.terms.every((term) => term.ok)}>
              <div class="claim-head">
                <span class="strong small">{t(`starmap.domain.path.${claim.path}`)}</span>
                <span class="dim tiny">
                  {t(`starmap.domain.pathHint.${claim.path}`, {
                    days: daysText(WAR.diplomacy.tributeDecades * WAR.front.tickDays),
                    share: Math.round(WAR.diplomacy.grantTributeShare * 100),
                  })}
                </span>
              </div>
              {#each claim.terms as term (term.key)}
                <div class="claim-term" class:ok={term.ok} class:danger={!term.ok}>
                  <span>{term.ok ? '✓' : '✗'} {t(`starmap.domain.term.${term.key}`)}</span>
                  {#if term.unit !== 'flag'}
                    <span>{termValue(term, term.have)} / {termValue(term, term.need)}</span>
                  {/if}
                </div>
              {/each}
              {#if selected.id === here}
                <button
                  class="btn btn-sm btn-wide domain-btn"
                  class:btn-primary={why === null}
                  disabled={why !== null}
                  title={why ?? ''}
                  onclick={() => campaign.run(claim.command)}
                >
                  {claim.price === undefined
                    ? t(`starmap.domain.btn.${claim.path}`)
                    : t('starmap.domain.btn.buyFor', { sum: cbills(claim.price) })}
                </button>
                {#if why !== null}<span class="dim tiny">{why}</span>{/if}
              {/if}
            </div>
          {/each}
        </div>
      {/if}

      <div class="block">
        <div class="sec-title">{t('starmap.profile')}</div>
        <div class="grid2">
          <div class="kv">
            <span class="kv-k">{t('starmap.biome')}</span>
            <span class="kv-v cyan">{t(`biome.${selected.biome}`)}</span>
          </div>
          <div class="kv">
            <span class="kv-k">{t('starmap.marketClass')}</span>
            <span class="kv-v gold">{t(`market.class.${selected.marketClass}`)}</span>
          </div>
          <!--
            СНАБЖЕНИЕ (шаг 45). Класс рынка задаёт срок доставки и наценку
            заказа, но вывести «столица — семь дней» из слова «столица» игрок
            обязан не был бы, а держать таблицу в голове — тем более. После
            шага 45 узлы заказываются по спецификации откуда угодно, кроме
            периферии, и перелёт стал решением РОВНО об этих двух числах:
            быстрее и дешевле. Значит они и обязаны стоять на карте — по той же
            причине, по какой ниже стоит масштаб работы.
          -->
          <div class="kv">
            <span class="kv-k">{t('starmap.supply')}</span>
            <span class="kv-v" class:gold={supply.days > 0 && supply.days <= 12} class:warn={supply.days === 0}>
              {supply.days === 0
                ? t('starmap.supplyNone')
                : t('starmap.supplyValue', {
                    days: daysText(supply.days),
                    factor: supply.factor.toFixed(2),
                  })}
            </span>
          </div>
          <!--
            Развитие мира (шаг 23, часть A) — БЕЗ разведки, как класс рынка и
            полоса гарнизона: то, что мир отстроен или сведён войной, видно с
            орбиты и из сводок, а не из переписи населения. Точные числа
            профиля (они уже включают развитие) по-прежнему за разведкой.
          -->
          <div class="kv">
            <span class="kv-k">{t('starmap.development')}</span>
            <span class="kv-v" class:gold={development > 0} class:warn={development < 0}>
              {development > 0
                ? t('starmap.developmentBuilt', { steps: development })
                : development < 0
                  ? t('starmap.developmentDecayed', { steps: development })
                  : t('starmap.developmentNone')}
            </span>
          </div>
          <div class="kv">
            <span class="kv-k">{t('starmap.garrison')}</span>
            <span class="kv-v">{t(`starmap.band.${selected.garrisonBand}`)}</span>
          </div>
          <!--
            МАСШТАБ РАБОТЫ (шаг 44c). Гарнизон и напряжённость участка решают,
            какого размера подряды здесь бывают, и оба видны на карте — но
            вывести из них ступень игрок сам не обязан. Без этой строки крупную
            работу пришлось бы искать перебором двух тысяч систем перелётами.
          -->
          <div class="kv">
            <span class="kv-k">{t('starmap.workScale')}</span>
            <span
              class="kv-v"
              class:gold={workScale === 'company' || workScale === 'battalion'}
              title={t('starmap.workScaleHint')}
            >
              {t(`scale.${workScale}`)}
            </span>
          </div>
          <!--
            Достаток владельца (шаг 21a) — ПОЛОСОЙ и без разведки: чья это
            территория и насколько она богата, наёмник читает из сводок MRBC, а
            не из казначейских книг. Точные числа — ниже, за разведкой.
          -->
          <div class="kv">
            <span class="kv-k">{t('starmap.prosperity')}</span>
            <span class="kv-v" class:gold={ownerWealth === 'strong'} class:warn={ownerWealth === 'ruined'}>
              {t(`starmap.prosperityBand.${ownerWealth}`)}
            </span>
          </div>
          <!--
            Напряжённость занимает строку ЦЕЛИКОМ: у неё два слагаемых — насколько
            горячо и с кем, — и в половинную ячейку `.kv-v` (она обрезает по
            многоточию) второе не влезает. Видно на первом же скриншоте: «Тыл:
            фронта у этой…».
          -->
          <div class="kv wide">
            <span class="kv-k">{t('starmap.tension')}</span>
            {#if hottest === undefined}
              <span class="kv-v dim">{t('starmap.tensionQuiet')}</span>
            {:else}
              <span
                class="kv-v"
                class:warn={hottest.tension >= 0.5}
                class:gold={hottest.tension >= 0.25 && hottest.tension < 0.5}
                title={t('starmap.tensionHint')}
              >
                {t(`starmap.tensionBand.${tensionBand(hottest.tension)}`)}
                <span class="dim">· {factionFullName(hottest.against, FACTIONS.get(hottest.against)?.name ?? hottest.against)}</span>
              </span>
            {/if}
          </div>
          <div class="kv">
            <span class="kv-k">{t('starmap.pirateThreat')}</span>
            <span
              class="kv-v"
              class:warn={pirateRisk >= 0.6}
              class:gold={pirateRisk >= 0.25 && pirateRisk < 0.6}
              class:dim={pirateRisk < 0.25}
              title={t('starmap.pirateThreatHint')}
            >
              {Math.round(pirateRisk * 100)}%
              <span class="dim">· {t(`starmap.pirateBand.${pirateBand(pirateRisk)}`)}</span>
            </span>
          </div>
          {#if cleared > 0}
            <div class="kv">
              <span class="kv-k">{t('starmap.cleared')}</span>
              <span class="kv-v gold" title={t('starmap.clearedHint')}>
                {Math.round(cleared * 100)}%
              </span>
            </div>
          {/if}
          <div class="kv">
            <span class="kv-k">{t('starmap.star')}</span>
            <span class="kv-v">{GALAXY.starOf(GALAXY.require(selected.id))}</span>
          </div>
        </div>

        <!--
          Точные числа профиля — только после разведки (решение 2026-09-01):
          иначе либо сюрприз без планирования, либо планирование без риска.
        -->
        {#if selected.profile !== null}
          <div class="grid2">
            <div class="kv">
              <span class="kv-k">{t('starmap.population')}</span>
              <span class="kv-v">{selected.profile.populationM.toFixed(1)} {t('starmap.millions')}</span>
            </div>
            <div class="kv">
              <span class="kv-k">{t('starmap.industry')}</span>
              <span class="kv-v">
                {selected.profile.industryCivil} / {selected.profile.industryMilitary}
              </span>
            </div>
            <div class="kv">
              <span class="kv-k">{t('starmap.temperature')}</span>
              <span class="kv-v">{selected.profile.temperatureC} °C</span>
            </div>
            <div class="kv">
              <span class="kv-k">{t('starmap.gravity')}</span>
              <span class="kv-v">{selected.profile.gravityG.toFixed(2)} g</span>
            </div>
            <div class="kv">
              <span class="kv-k">{t('starmap.atmosphere')}</span>
              <span class="kv-v">{t(`starmap.air.${selected.profile.atmosphere}`)}</span>
            </div>
            <div class="kv">
              <span class="kv-k">{t('starmap.spaceport')}</span>
              <span class="kv-v">{selected.profile.spaceport}</span>
            </div>
            {#if worldEconomy !== null}
              <div class="kv">
                <span class="kv-k">{t('starmap.worldIncome')}</span>
                <span class="kv-v gold">
                  {cbills(worldEconomy.income)} <span class="dim small">{t('starmap.perDecade')}</span>
                </span>
              </div>
              {#if worldEconomy.ruined > 0}
                <div class="kv">
                  <span class="kv-k">{t('starmap.ruined')}</span>
                  <span class="kv-v warn">{Math.round(worldEconomy.ruined * 100)} %</span>
                </div>
              {/if}
            {/if}
          </div>
          <p class="dim small">{t('starmap.prosperityHint')}</p>
        {:else}
          <p class="dim small">{t('starmap.surveyHint')}</p>
        {/if}

        <div class="flags">
          {#each FLAGS as f (f.id)}
            {@const on = GALAXY.hasFlag(GALAXY.require(selected.id), f.id)}
            <span class="flag" class:on>{t(f.key)}</span>
          {/each}
        </div>
      </div>

      <div class="block">
        <div class="sec-title">{t('starmap.jump')}</div>
        {#if selected.id === here}
          <p class="ok small">{t('starmap.youAreHere')}</p>
          {@const why = campaign.why(surveyCmd)}
          <div class="row-kv">
            <span>{t('starmap.survey')}</span>
            <span class="gold">{cbills(campaign.surveyPlan.cost)}</span>
          </div>
          <button class="btn btn-wide" disabled={why !== null} onclick={() => campaign.run(surveyCmd)}>
            {campaign.surveyedHere
              ? t('starmap.alreadySurveyed')
              : `${t('starmap.surveyDo')} · ${daysText(campaign.surveyPlan.days)}`}
          </button>
          {#if why !== null && !campaign.surveyedHere}<p class="danger small">{why}</p>{/if}
        {:else if route === null}
          <p class="danger small">{t('reject.noRoute')}</p>
        {:else}
          <div class="row-kv">
            <span>{t('starmap.jumps')}</span>
            <span class="cyan">{route.jumps}</span>
          </div>
          <div class="row-kv">
            <span>{t('starmap.transit')}</span>
            <span>{daysText(route.days)}</span>
          </div>
          <div class="row-kv">
            <span>{t('starmap.cost')}</span>
            <span class="gold">{cbills(route.cost)}</span>
          </div>
          {@const why = campaign.why(travelCmd)}
          <button
            class="btn btn-primary btn-wide jump"
            disabled={why !== null}
            onclick={() => campaign.run(travelCmd)}
          >
            {t('starmap.travel')}
          </button>
          {#if why !== null}<p class="danger small">{why}</p>{/if}
          <p class="dim tiny">{t('starmap.travelHint')}</p>
        {/if}
      </div>
    </div>
  </aside>
</div>

<style>
  .kv.wide {
    grid-column: 1 / -1;
  }
  .starmap {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 370px;
    gap: 10px;
    height: 100%;
    padding: 10px;
    overflow: hidden;
  }
  .map-panel,
  .dossier {
    overflow: hidden;
  }
  .dot.hot {
    background: #f85149;
    box-shadow: 0 0 5px rgba(248, 81, 73, 0.9);
  }
  .heat-dot {
    display: inline-block;
    width: 7px;
    height: 7px;
    margin-left: 4px;
    border-radius: 50%;
    background: #f85149;
    box-shadow: 0 0 5px rgba(248, 81, 73, 0.9);
    vertical-align: middle;
  }
  /* Янтарь против красного: вольница против регулярных частей (шаг 41). */
  .dot.big {
    background: #58d6cd;
    box-shadow: 0 0 5px rgba(88, 214, 205, 0.8);
  }

  .dot.raid {
    background: #d29922;
    box-shadow: 0 0 5px rgba(210, 153, 34, 0.9);
  }
  .scale-dot {
    display: inline-block;
    width: 7px;
    height: 7px;
    margin-left: 4px;
    border-radius: 50%;
    background: #58d6cd;
    box-shadow: 0 0 5px rgba(88, 214, 205, 0.9);
    vertical-align: middle;
  }

  .pirate-dot {
    display: inline-block;
    width: 7px;
    height: 7px;
    margin-left: 4px;
    border-radius: 50%;
    background: #d29922;
    box-shadow: 0 0 5px rgba(210, 153, 34, 0.9);
    vertical-align: middle;
  }
  .dot.market {
    background: #3fb950;
    box-shadow: 0 0 5px rgba(63, 185, 80, 0.9);
  }
  .market-dot {
    display: inline-block;
    width: 7px;
    height: 7px;
    margin-left: 4px;
    border-radius: 50%;
    background: #3fb950;
    box-shadow: 0 0 5px rgba(63, 185, 80, 0.9);
    vertical-align: middle;
  }
  .realm-dot {
    display: inline-block;
    width: 7px;
    height: 7px;
    margin-left: 4px;
    border-radius: 50%;
    border: 1.5px solid var(--color-gold);
    vertical-align: middle;
  }
  .ring-mark {
    display: inline-block;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    border: 1.5px solid;
    vertical-align: middle;
  }
  .ring-mark.dashed {
    border-style: dashed;
  }
  .btn.active {
    border-color: var(--color-accent);
    color: var(--color-accent);
  }
  .controls {
    display: flex;
    gap: 5px;
  }
  .canvas-wrap {
    position: relative;
    flex: 1;
    min-height: 0;
    overflow: hidden;
    cursor: crosshair;
  }
  canvas {
    display: block;
    width: 100%;
    height: 100%;
  }
  .tip {
    position: absolute;
    pointer-events: none;
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 5px 9px;
    background: rgba(13, 17, 23, 0.95);
    border: 1px solid var(--color-border-active);
    font-size: 11px;
    z-index: 5;
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.6);
  }
  .tip-name {
    font-weight: 700;
    font-size: 12.5px;
  }
  .tiny {
    font-size: 9.5px;
  }
  .legend {
    position: absolute;
    left: 10px;
    bottom: 10px;
    display: flex;
    flex-direction: column;
    gap: 3px;
    padding: 6px 9px;
    background: rgba(13, 17, 23, 0.85);
    border: 1px solid var(--color-border);
    font-size: 10px;
    color: var(--color-text-dim);
    pointer-events: none;
  }
  .legend span {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
  }
  .dot.here {
    background: var(--color-accent);
  }
  .dot.major {
    background: var(--color-text);
  }
  .dot.ring {
    background: none;
    border: 1px dashed var(--color-accent);
  }

  .body {
    display: flex;
    flex-direction: column;
    gap: 11px;
    padding: 12px;
  }
  .head {
    display: flex;
    flex-direction: column;
    gap: 5px;
  }
  .p-name {
    font-family: var(--font-display);
    font-size: 19px;
    font-weight: 800;
    letter-spacing: 0.6px;
  }
  .owner {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 11.5px;
    font-weight: 700;
  }
  .block {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 9px 11px;
    background: var(--color-panel-sub);
    border: 1px solid var(--color-border);
    border-radius: 2px;
  }
  .grid2 {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 5px;
  }
  .flags {
    display: flex;
    flex-direction: column;
    gap: 3px;
    margin-top: 4px;
  }
  .flag {
    padding: 4px 7px;
    font-size: 10px;
    background: rgba(13, 17, 23, 0.5);
    border: 1px solid var(--color-border);
    color: var(--color-text-dim);
    border-radius: 2px;
  }
  .flag.on {
    border-color: var(--color-accent);
    color: var(--color-accent);
    background: rgba(57, 197, 187, 0.1);
  }
  .jump {
    margin-top: 4px;
    padding: 11px;
  }
  .small {
    font-size: 10.5px;
  }
  p {
    margin: 0;
    line-height: 1.5;
  }
  .sec-title-help {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .sec-title-help :global(.wiki-help-wrapper) {
    text-transform: none;
    letter-spacing: normal;
  }
  .fold {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 0;
    background: none;
    border: none;
    color: inherit;
    font: inherit;
    letter-spacing: inherit;
    text-transform: inherit;
    cursor: pointer;
  }
  .fold:hover {
    color: var(--color-text);
  }
  .domain-block {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .claim {
    display: flex;
    flex-direction: column;
    gap: 3px;
    padding: 6px 8px;
    border: 1px solid var(--color-border);
    border-radius: 2px;
  }
  .claim.open {
    border-color: var(--color-ok);
  }
  .claim-head {
    display: flex;
    flex-direction: column;
    gap: 1px;
    margin-bottom: 2px;
  }
  .claim-term {
    display: flex;
    justify-content: space-between;
    gap: 8px;
    font-size: 11px;
  }
  .domain-btn {
    margin-top: 4px;
  }
</style>
