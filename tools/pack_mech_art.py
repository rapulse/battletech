#!/usr/bin/env python3
"""
Портреты мехов с раскрасками фракций (шаг 50).

Заменяет атласы мехов из `pack_ui_atlases.py`. Атлас окупался, пока в списках
шли все 63 картинки разом; с раскрасками он заставил бы качать все машины одной
раскраски ради трёх на экране. Поэтому каждая раскраска каждого рисунка — два
отдельных файла, и браузер забирает только те, что видит:

    game/public/ui/mech/<base>/<paint>-s.webp   квадрат под списки
    game/public/ui/mech/<base>/<paint>-l.webp   крупный показ по щелчку

ОТКУДА БЕРЁТСЯ ЧТО.

- Раскраски и их буквы — `game/data/paints.json`. Здесь ни одной буквы не
  записано: новый клан с раскраской — строка там и исходники с новой буквой.
- Старые 63 рисунка: группа и класс — ручная разметка `_tmp/Meches/mech_data.json`,
  номер ячейки — тем же правилом, что у старого паковщика (порядок классов, внутри
  класса — порядок разметки). Вариант по умолчанию — `IS-source/`, `Clan-source/`:
  это ровно те файлы, что были в игре до шага 50, исходника крупнее у них нет.
- Новые рисунки — `_tmp/Meches/mech_bases.json`.
- Раскраски — `_tmp/Meches/*-single-*/<base>-<буква>.jpeg`.

ПОРЯДОК РИСУНКОВ В КЛАССЕ — часть обещания «машина не меняет портрет»: показ
выбирает рисунок хэшем кода шасси по списку класса. Старые идут в прежнем
порядке, новые дописываются в конец, так пополнение пересдаёт портреты только
внутри одного класса.

Сведение к палитре проекта (`grade`/`tint` старого паковщика) здесь НЕ делается:
на цветах фракций оно замывает красный Штайнера в бурый. Старые варианты по
умолчанию уже прошли его однажды и берутся как есть.

Запуск (Python 3.11 из venv проекта, см. CLAUDE.md):

    ./venv/bin/python tools/pack_mech_art.py            # собрать, пишет манифест
    ./venv/bin/python tools/pack_mech_art.py --sheet    # плюс листы проверки обрезки
    ./venv/bin/python tools/pack_mech_art.py --prune    # плюс убрать лишнее из public
    ./venv/bin/python tools/pack_mech_art.py --force    # пересобрать всё
"""

from __future__ import annotations

import argparse
import html
import json
import os
import re
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
ART = ROOT / "_tmp" / "Meches"
PAINTS = ROOT / "game" / "data" / "paints.json"
OLD_LABELS = ART / "mech_data.json"
NEW_BASES = ART / "mech_bases.json"
DEFAULT_SRC = {"is": ART / "IS-source", "clan": ART / "Clan-source"}
# Папки раскрашенных исходников. Папки `*-new` — эскизы пользователя, в игру не идут.
SOURCE_DIRS = ("is-single-h", "is-single-n", "clan-single-h", "clan-single-n")
PUBLIC = ROOT / "game" / "public" / "ui"
DST = PUBLIC / "mech"
MANIFEST = ROOT / "game" / "src" / "ui" / "components" / "mechArt.json"
SHEETS = ROOT / "tools" / "out"
# Каталог портретов для художника: открывается прямо из папки, пересобирается
# каждым прогоном паковщика, поэтому всегда показывает то, что лежит в игре.
CATALOG = ROOT / "_tmp" / "meches.html"
CHASSIS_CATALOG = ROOT / "game" / "data" / "chassis_catalog.json"
RU_DICT = ROOT / "game" / "src" / "ui" / "i18n" / "ru.json"

BAND_ORDER = ("light", "medium", "heavy", "assault")

# Квадрат под списки. Самый крупный показ — 112 px в мехлабе, 256 даёт запас
# на экранах двойной плотности (~25 КБ на файл).
THUMB = 256
THUMB_QUALITY = 86

# Крупный показ. Потолок, а не цель: вверх не растягивается (у старых вариантов
# по умолчанию натуральные 588 px).
FULL_W = 900
FULL_QUALITY = 88

# Квадрат на всю ширину, лишняя высота срезается: CROP_TOP сверху, остальное
# снизу. Проверено листами по всем рисункам: при 0.35 у самых высоких машин
# короба и головы упираются в край, при 0.28 сверху запас, снизу уходят ступни
# и пол ангара. Поправка на рисунок — `cropTop` в реестре.
CROP_TOP = 0.28


@dataclass
class Base:
    base: str
    tech: str
    loco: str
    band: str
    crop_top: float = CROP_TOP
    sources: dict[str, Path] = field(default_factory=dict)  # раскраска → файл


def die(msg: str) -> None:
    print(f"ОШИБКА: {msg}", file=sys.stderr)
    sys.exit(1)


def natural(text: str) -> list[object]:
    return [int(p) if p.isdigit() else p for p in re.split(r"(\d+)", text)]


def load_paints() -> dict[str, str]:
    """Буква → id раскраски."""
    paints = json.loads(PAINTS.read_text(encoding="utf-8"))["paints"]
    by_letter: dict[str, str] = {}
    for pid, p in paints.items():
        letter = p["letter"]
        if letter in by_letter:
            die(f"paints.json: буква «{letter}» у {by_letter[letter]} и {pid}")
        by_letter[letter] = pid
    if "default" not in paints:
        die("paints.json: нет раскраски default")
    return by_letter


def load_bases() -> tuple[dict[str, Base], dict[str, int]]:
    labels = json.loads(OLD_LABELS.read_text(encoding="utf-8"))
    bases: dict[str, Base] = {}

    # Номер ячейки — как у старого паковщика: корзина (tech, loco), классы по
    # порядку, внутри класса — порядок разметки.
    buckets: dict[tuple[str, str], dict[str, list[dict]]] = {}
    for c in labels["cells"]:
        buckets.setdefault((c["tech"], c["loco"]), {b: [] for b in BAND_ORDER})[c["band"]].append(c)
    for (tech, loco), by_band in buckets.items():
        ordered = [(b, c) for b in BAND_ORDER for c in by_band[b]]
        for idx, (band, c) in enumerate(ordered):
            name = f"mechs_{tech}_{loco.lower()}-{idx}"
            b = Base(name, tech, loco, band, c.get("cropTop", CROP_TOP))
            default = DEFAULT_SRC[tech] / f"{name}.jpg"
            if not default.exists():
                die(f"нет варианта по умолчанию {default.relative_to(ROOT)}")
            b.sources["default"] = default
            bases[name] = b

    if NEW_BASES.exists():
        for name, e in json.loads(NEW_BASES.read_text(encoding="utf-8"))["bases"].items():
            if name in bases:
                die(f"mech_bases.json: {name} уже есть в mech_data.json")
            if e["band"] not in BAND_ORDER or e["tech"] not in DEFAULT_SRC or e["loco"] not in ("H", "N"):
                die(f"mech_bases.json: {name} — неверные tech/loco/band")
            bases[name] = Base(name, e["tech"], e["loco"], e["band"], e.get("cropTop", CROP_TOP))

    return bases, labels["bands"]


def attach_sources(bases: dict[str, Base], by_letter: dict[str, str]) -> None:
    unknown: list[str] = []
    for path in sorted(p for d in SOURCE_DIRS for p in (ART / d).glob("*.jpeg")):
        name, _, letter = path.stem.rpartition("-")
        if letter not in by_letter:
            die(f"{path.relative_to(ROOT)}: буква «{letter}» не описана в paints.json")
        if name not in bases:
            unknown.append(str(path.relative_to(ROOT)))
            continue
        paint = by_letter[letter]
        prev = bases[name].sources.get(paint)
        # Раскрашенный исходник крупнее старого варианта по умолчанию — берётся он.
        if prev is not None and prev.suffix == ".jpeg":
            die(f"{name}: раскраска {paint} дважды — {prev.relative_to(ROOT)} и {path.relative_to(ROOT)}")
        bases[name].sources[paint] = path
    if unknown:
        die("рисунки без записи в реестре (mech_bases.json):\n  " + "\n  ".join(unknown))


def square(image: Image.Image, crop_top: float) -> Image.Image:
    w, h = image.size
    if h > w:
        y = round((h - w) * crop_top)
        image = image.crop((0, y, w, y + w))
    elif w > h:
        x = (w - h) // 2
        image = image.crop((x, 0, x + h, h))
    return image


def shrink(image: Image.Image, size: tuple[int, int]) -> Image.Image:
    if image.size == size:
        return image
    small = image.resize(size, Image.LANCZOS)
    # Лёгкая резкость после сильного уменьшения: без неё мелкие панели брони
    # сливаются. Радиус малый — ореолов на краях корпуса быть не должно.
    return small.filter(ImageFilter.UnsharpMask(radius=1.0, percent=60, threshold=2))


def pack_one(b: Base, paint: str, src: Path, stamp: float, force: bool) -> tuple[int, bool]:
    out_dir = DST / b.base
    thumb, full = out_dir / f"{paint}-s.webp", out_dir / f"{paint}-l.webp"
    newest = max(src.stat().st_mtime, stamp)
    if not force and all(p.exists() and p.stat().st_mtime > newest for p in (thumb, full)):
        return thumb.stat().st_size + full.stat().st_size, False

    out_dir.mkdir(parents=True, exist_ok=True)
    with Image.open(src) as image:
        image = image.convert("RGB")
        sq = shrink(square(image, b.crop_top), (THUMB, THUMB))
        sq.save(thumb, "WEBP", quality=THUMB_QUALITY, method=6)
        w = min(FULL_W, image.width)
        shrink(image, (w, round(image.height * w / image.width))).save(
            full, "WEBP", quality=FULL_QUALITY, method=6
        )
    return thumb.stat().st_size + full.stat().st_size, True


def fallback(b: Base, player_paint: str) -> str:
    """Во что откатывается `default`, если его у рисунка нет.

    Считается здесь, а не в показе: показ не гадает, какие файлы лежат на диске.
    """
    if "default" in b.sources:
        return "default"
    if b.tech == "is" and player_paint in b.sources:
        return player_paint
    return sorted(b.sources)[0]


def write_manifest(bases: dict[str, Base], bands: dict[str, int], player_paint: str) -> None:
    groups: dict[str, dict[str, list[str]]] = {}
    for b in bases.values():  # порядок вставки: старые по номеру, новые в конце
        g = groups.setdefault(f"{b.tech}_{b.loco.lower()}", {band: [] for band in BAND_ORDER})
        g[b.band].append(b.base)
    manifest = {
        "$comment": (
            "Портреты мехов с раскрасками (шаг 50). Пишется tools/pack_mech_art.py, "
            "читается ui/components/mechArt.ts. Руками не править."
        ),
        "$comment2": (
            "groups — группа (техбаза_локомоция) → класс → рисунки. ПОРЯДОК ЗНАЧИМ: "
            "показ выбирает рисунок хэшем кода шасси по списку, новые рисунки "
            "дописываются в конец класса."
        ),
        "$comment3": (
            "bases — какие раскраски у рисунка реально есть и во что откатывается "
            "default. Файлы: <dir>/<base>/<paint>-s.webp (квадрат) и -l.webp (крупный)."
        ),
        "bands": bands,
        "dir": "/ui/mech",
        "groups": {
            k: {band: v for band, v in g.items() if v} for k, g in sorted(groups.items())
        },
        "bases": {
            b.base: {"paints": sorted(b.sources), "fallback": fallback(b, player_paint)}
            for b in bases.values()
        },
    }
    MANIFEST.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def build_sheets(bases: dict[str, Base]) -> None:
    SHEETS.mkdir(parents=True, exist_ok=True)
    cols, t = 9, 180
    by_tech: dict[str, list[Base]] = {}
    for b in bases.values():
        by_tech.setdefault(b.tech, []).append(b)
    for tech, items in by_tech.items():
        rows = -(-len(items) // cols)
        sheet = Image.new("RGB", (cols * (t + 6) + 6, rows * (t + 22) + 6), (20, 24, 32))
        draw = ImageDraw.Draw(sheet)
        for i, b in enumerate(items):
            paint = fallback(b, "merc")
            with Image.open(DST / b.base / f"{paint}-s.webp") as im:
                tile = im.convert("RGB").resize((t, t), Image.LANCZOS)
            x, y = 6 + (i % cols) * (t + 6), 6 + (i // cols) * (t + 22)
            sheet.paste(tile, (x, y))
            draw.text((x + 2, y + t + 4), f"{b.base.replace('mechs_', '')} {b.band}", fill=(200, 210, 220))
        out = SHEETS / f"mech_sheet_{tech}.jpg"
        sheet.save(out, quality=88)
        print(f"лист  {out.relative_to(ROOT)}")


GROUP_TITLES = {
    "is_h": "Сфера · гуманоидные",
    "is_n": "Сфера · негуманоидные",
    "clan_h": "Кланы · гуманоидные",
    "clan_n": "Кланы · негуманоидные",
}
TECH_DIR = {"is": "is-single", "clan": "clan-single"}
# Меньше стольких рисунков в классе — корзина тонкая: один портрет на слишком
# много шасси, и игрок часто видит одинаковые картинки у разных машин.
THIN = 3


def fnv1a(text: str) -> int:
    """Тот же хэш, что `hash` в `game/src/ui/components/mechArt.ts` (FNV-1a, 32 бита)."""
    h = 0x811C9DC5
    for ch in text:
        h ^= ord(ch)
        h = (h * 0x01000193) & 0xFFFFFFFF
    return h


def band_of(tons: int, bands: dict[str, int]) -> str:
    if tons <= bands["light"]:
        return "light"
    if tons <= bands["medium"]:
        return "medium"
    if tons <= bands["heavy"]:
        return "heavy"
    return "assault"


def chassis_usage(bases: dict[str, Base], bands: dict[str, int]) -> dict[str, list[dict]]:
    """Какие шасси каталога показывают какой рисунок.

    Повторяет `pickMechArt` из `mechArt.ts` один в один: пул класса в порядке
    манифеста, сведение пустого класса к ближайшему по весу, хэш кода шасси с
    затравкой по имени корзины. Разойдись копии — каталог показывал бы не те
    шасси; сверка с TypeScript — `_tmp/check_pick.ts`.
    """
    pools: dict[str, dict[str, list[str]]] = {}
    for b in bases.values():
        pools.setdefault(f"{b.tech}_{b.loco.lower()}", {x: [] for x in BAND_ORDER})[b.band].append(b.base)
    usage: dict[str, list[dict]] = {name: [] for name in bases}
    for c in json.loads(CHASSIS_CATALOG.read_text(encoding="utf-8"))["chassis"]:
        group = f"{c['techBase']}_{c['locomotion'].lower()}"
        by_band = pools.get(group)
        if by_band is None:
            continue
        at = BAND_ORDER.index(band_of(c["tonnage"], bands))
        nearest = sorted(range(len(BAND_ORDER)), key=lambda i: (abs(i - at), i))
        band = next((BAND_ORDER[i] for i in nearest if by_band[BAND_ORDER[i]]), None)
        if band is None:
            continue
        pool = by_band[band]
        usage[pool[fnv1a(f"mechs_{group}:{band}:{c['code']}") % len(pool)]].append(c)
    return usage


CATALOG_CSS = """
:root { color-scheme: dark; }
body { margin: 0; padding: 16px 24px 48px; background: #0f141b; color: #c9d4de;
  font: 13px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace; }
h1 { margin: 0 0 4px; font-size: 20px; color: #39c5bb; }
h2 { margin: 28px 0 4px; font-size: 15px; color: #39c5bb; border-bottom: 1px solid #2a3542; padding-bottom: 4px; }
code { color: #e3b341; word-break: break-all; }
.dim { color: #7d8b99; }
.warn { color: #e3b341; }
.howto { margin: 12px 0; padding: 8px 12px; border: 1px solid #2a3542; background: #141b24; }
.howto li { margin: 4px 0; }
table.summary { border-collapse: collapse; margin: 12px 0; }
table.summary th, table.summary td { border: 1px solid #2a3542; padding: 6px 12px; text-align: center; }
table.summary th:first-child { text-align: left; }
table.summary td a { color: #c9d4de; font-size: 16px; font-weight: 700; text-decoration: none; }
table.summary td small { display: block; color: #7d8b99; }
table.summary td.thin { background: #3a2c10; }
table.summary td.thin a { color: #e3b341; }
.tools { position: sticky; top: 0; z-index: 1; display: flex; gap: 16px; align-items: center;
  padding: 8px 0; background: #0f141b; }
.tools input[type=text] { flex: 1; max-width: 520px; padding: 6px 8px; background: #141b24; color: inherit;
  border: 1px solid #2a3542; font: inherit; }
.card { margin: 10px 0; padding: 8px 10px; border: 1px solid #2a3542; background: #141b24; }
.card header { display: flex; gap: 12px; align-items: baseline; margin-bottom: 6px; }
.card .base { font-weight: 700; color: #fff; }
.paints { display: flex; flex-wrap: wrap; gap: 8px; }
figure { margin: 0; width: 150px; }
figure img { display: block; width: 150px; height: 150px; border: 1px solid #2a3542; }
figcaption { font-size: 11px; }
figcaption code, figcaption span { display: block; }
details { margin-top: 6px; }
summary { cursor: pointer; color: #7d8b99; }
.only-default .paints figure:not(:first-child) { display: none; }
[hidden] { display: none !important; }
"""

CATALOG_JS = """
const q = document.getElementById('q');
const od = document.getElementById('only-default');
function apply() {
  const s = q.value.trim().toLowerCase();
  document.querySelectorAll('.card').forEach((c) => { c.hidden = s !== '' && !c.dataset.search.includes(s); });
  document.querySelectorAll('section').forEach((sec) => {
    sec.hidden = s !== '' && [...sec.querySelectorAll('.card')].every((c) => c.hidden);
  });
  document.body.classList.toggle('only-default', od.checked);
}
q.addEventListener('input', apply);
od.addEventListener('change', apply);
"""


def write_catalog(
    bases: dict[str, Base], bands: dict[str, int], by_letter: dict[str, str], total_bytes: int
) -> None:
    """Страница `_tmp/meches.html`: все рисунки, раскраски, исходники и шасси."""
    esc = html.escape
    ru = json.loads(RU_DICT.read_text(encoding="utf-8"))
    paint_names: dict[str, str] = ru.get("paint", {})
    band_names: dict[str, str] = ru.get("weightClass", {})
    letter_of = {pid: letter for letter, pid in by_letter.items()}
    usage = chassis_usage(bases, bands)

    def url(path: Path) -> str:
        return esc(os.path.relpath(path, CATALOG.parent).replace(os.sep, "/"))

    def size_of(path: Path) -> str:
        try:
            with Image.open(path) as im:
                return f"{im.width}×{im.height}"
        except OSError:
            return "?"

    groups: dict[str, dict[str, list[Base]]] = {}
    for b in bases.values():  # порядок манифеста: старые по номеру, новые в конце
        groups.setdefault(f"{b.tech}_{b.loco.lower()}", {x: [] for x in BAND_ORDER})[b.band].append(b)
    order = [g for g in GROUP_TITLES if g in groups] + sorted(g for g in groups if g not in GROUP_TITLES)

    head = "".join(f"<th>{esc(band_names.get(band, band))}</th>" for band in BAND_ORDER)
    rows = []
    for g in order:
        cells = []
        for band in BAND_ORDER:
            items = groups[g][band]
            used = sum(len(usage[b.base]) for b in items)
            thin = ' class="thin"' if len(items) < THIN else ""
            cells.append(f'<td{thin}><a href="#{g}-{band}">{len(items)}</a><small>{used} шасси</small></td>')
        rows.append(f"<tr><th>{esc(GROUP_TITLES.get(g, g))}</th>{''.join(cells)}</tr>")

    sections = []
    for g in order:
        tech, loco = g.split("_")
        folder = f"{TECH_DIR[tech]}-{loco}"
        for band in BAND_ORDER:
            items = groups[g][band]
            cards = []
            for b in items:
                used = usage[b.base]
                names = sorted({c.get("canonName") or c["code"] for c in used})
                figures = []
                for paint in sorted(b.sources, key=lambda p: (p != "default", p)):
                    src = b.sources[paint]
                    thumb = DST / b.base / f"{paint}-s.webp"
                    full = DST / b.base / f"{paint}-l.webp"
                    old = ""
                    if src.suffix == ".jpg":
                        old = (
                            '<span class="warn">старый вариант, лучше заменить: '
                            f"<code>{esc(folder)}/{esc(b.base)}-default.jpeg</code></span>"
                        )
                    figures.append(
                        f'<figure><a href="{url(full)}" target="_blank"><img loading="lazy" '
                        f'src="{url(thumb)}" alt=""></a><figcaption><b>{esc(paint_names.get(paint, paint))}</b> '
                        f'<span class="dim">буква {esc(letter_of.get(paint, "?"))} · {size_of(src)}</span>'
                        f"<code>{esc(src.relative_to(ART).as_posix())}</code>{old}</figcaption></figure>"
                    )
                absent = [
                    f"<li>{esc(paint_names.get(p, p))} — <code>{esc(folder)}/{esc(b.base)}-{esc(letter_of[p])}.jpeg</code></li>"
                    for p in letter_of
                    if p not in b.sources
                ]
                absent_block = (
                    f"<details><summary>Можно добавить раскраску ({len(absent)})</summary><ul>{''.join(absent)}</ul></details>"
                    if absent
                    else ""
                )
                search = " ".join([b.base, *names, *(c["code"] for c in used)]).lower()
                cards.append(
                    f'<article class="card" data-search="{esc(search)}"><header>'
                    f'<span class="base">{esc(b.base)}</span>'
                    f'<span class="dim">{len(used)} шасси · обрезка сверху {b.crop_top:g}</span></header>'
                    f'<div class="paints">{"".join(figures)}</div>'
                    f"<details><summary>Шасси с этим портретом ({len(used)})</summary>"
                    f'<p class="dim">{esc(", ".join(names)) or "—"}</p></details>{absent_block}</article>'
                )
            thin = ' <span class="warn">— мало рисунков</span>' if len(items) < THIN else ""
            hint = (
                f'<p class="dim">Новый робот в этот класс: исходники в <code>_tmp/Meches/{esc(folder)}/</code> и строка '
                f'<code>"&lt;id&gt;": {{"tech": "{tech}", "loco": "{loco.upper()}", "band": "{band}"}}</code> '
                "в <code>_tmp/Meches/mech_bases.json</code></p>"
            )
            sections.append(
                f'<section id="{g}-{band}"><h2>{esc(GROUP_TITLES.get(g, g))} · '
                f"{esc(band_names.get(band, band))}: {len(items)}{thin}</h2>{hint}{''.join(cards)}</section>"
            )

    letters = ", ".join(
        f"<code>{esc(letter)}</code> {esc(paint_names.get(pid, pid))}" for letter, pid in by_letter.items()
    )
    paint_count = sum(len(b.sources) for b in bases.values())
    howto = f"""<details open class="howto"><summary>Как заменить или добавить</summary><ul>
<li><b>Заменить рисунок или раскраску</b> — положить новый исходник под тем же именем (оно под каждой картинкой) и запустить паковщик. Привязка к шасси не меняется.</li>
<li><b>Заменить старый заводской вариант</b> (помечен жёлтым, 588 px) — положить <code>&lt;папка&gt;/&lt;рисунок&gt;-default.jpeg</code>, паковщик сам предпочтёт его старому.</li>
<li><b>Добавить нового робота</b> — исходники <code>&lt;id&gt;-&lt;буква&gt;.jpeg</code> в папку группы и строка в <code>_tmp/Meches/mech_bases.json</code> (подсказка — под заголовком каждого класса). Робот встаёт в конец класса: портреты пересдаются только внутри этого класса.</li>
<li><b>Новая фракция со своими цветами</b> — строка в <code>game/data/paints.json</code>, подпись в <code>game/src/ui/i18n/ru.json → paint</code>, исходники с новой буквой.</li>
<li><b>Поправить обрезку квадрата</b> — <code>"cropTop"</code>: у новых роботов в <code>mech_bases.json</code>, у старых — в ячейке <code>mech_data.json</code> (доля лишней высоты сверху, по умолчанию {CROP_TOP:g}).</li>
<li><b>Запуск:</b> <code>./venv/bin/python tools/pack_mech_art.py</code> — эта страница пересобирается сама; листы обрезки — с флагом <code>--sheet</code>.</li>
</ul><p>Буквы раскрасок: {letters}. Щелчок по картинке открывает крупный вариант.</p></details>"""

    page = f"""<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><title>Портреты мехов</title><style>{CATALOG_CSS}</style></head>
<body>
<h1>Портреты мехов</h1>
<p class="dim">Собрано {time.strftime("%Y-%m-%d %H:%M")} паковщиком <code>tools/pack_mech_art.py</code>.
Рисунков {len(bases)}, раскрасок {paint_count}, вес в игре {total_bytes / 1024 / 1024:.1f} МБ.</p>
{howto}
<table class="summary"><tr><th>Роботов в классе / шасси с их портретами</th>{head}</tr>{"".join(rows)}</table>
<div class="tools"><input type="text" id="q" placeholder="Поиск: робот, шасси или код (Warhammer, IS-H70, mechs_is_n-11)">
<label><input type="checkbox" id="only-default"> только заводская раскраска</label></div>
{"".join(sections)}
<script>{CATALOG_JS}</script>
</body></html>
"""
    CATALOG.write_text(page, encoding="utf-8")
    print(f"каталог {CATALOG.relative_to(ROOT)}")


def prune(bases: dict[str, Base]) -> None:
    removed = 0
    for path in sorted(DST.iterdir()):
        if path.is_dir():
            wanted = {f"{p}-{s}.webp" for p in bases[path.name].sources for s in "sl"} if path.name in bases else set()
            for f in path.iterdir():
                if f.name not in wanted:
                    f.unlink()
                    removed += 1
            if not any(path.iterdir()):
                path.rmdir()
        else:  # одиночные JPG шага 48
            path.unlink()
            removed += 1
    for old in PUBLIC.glob("mechs_*.jpg"):  # атласы шага 48
        old.unlink()
        removed += 1
    print(f"убрано файлов: {removed}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--sheet", action="store_true", help="листы проверки обрезки в tools/out")
    ap.add_argument("--prune", action="store_true", help="убрать из public то, чего нет в манифесте")
    ap.add_argument("--force", action="store_true", help="пересобрать всё")
    args = ap.parse_args()

    by_letter = load_paints()
    player_paint = json.loads(PAINTS.read_text(encoding="utf-8"))["player"]
    bases, bands = load_bases()
    attach_sources(bases, by_letter)

    # Дата самого скрипта в свежесть не входит: правка страницы-каталога не должна
    # перекодировать 318 раскрасок. Сменились размеры или качество — `--force`.
    stamp = max(PAINTS.stat().st_mtime, OLD_LABELS.stat().st_mtime,
                NEW_BASES.stat().st_mtime if NEW_BASES.exists() else 0)
    total = built = files = 0
    for b in bases.values():
        for paint, src in sorted(b.sources.items()):
            size, fresh = pack_one(b, paint, src, stamp, args.force)
            total += size
            built += fresh
            files += 2
        print(f"{b.base:18} {b.tech}_{b.loco.lower()} {b.band:8} {' '.join(sorted(b.sources))}")

    write_manifest(bases, bands, player_paint)
    print(f"рисунков {len(bases)}, файлов {files}, пересобрано раскрасок {built}, "
          f"вес {total / 1024 / 1024:.1f} МБ")
    print(f"манифест {MANIFEST.relative_to(ROOT)}")
    write_catalog(bases, bands, by_letter, total)
    if args.sheet:
        build_sheets(bases)
    if args.prune:
        prune(bases)


if __name__ == "__main__":
    main()
