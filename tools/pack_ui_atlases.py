#!/usr/bin/env python3
"""
Подготовка растровых атласов интерфейса кампании (шаг 17).

Растр в проекте разрешён узко (`wiki/decisions.md`, 2026-09-01, Трек Б): только
стационарные изображения, которые НЕ несут состояния — портреты пилотов, диски
планет по биомам, эмблемы фракций и отрядов, голограммы типов миссий. Всё, что
показывает состояние (машина, зоны брони, иконки оружия), рисуется кодом.

Что делает скрипт и зачем именно это.

1. **Уменьшает.** Сетки от генератора приходят в 300 DPI и весят 13 МБ на семь
   файлов. Поставка — сайт (решение 2026-09-02), и 13 МБ атласов игрок скачает
   до того, как увидит первый экран. Размер каждой сетки подобран под самый
   крупный её показ в интерфейсе, а не «на всякий случай».

2. **Срезает подписи генератора.** У сеток планет и миссий в каждой ячейке
   снизу вплавлена английская подпись («DESERT / ARID WORLD»), а вокруг рисунка
   — рамка. Интерфейс русский и подписывает картинку сам, из словаря
   (`ui/i18n`), поэтому вплавленная подпись — это второй текст, который врёт
   при первой же правке словаря. Рисунок вырезается из ячейки по рамке.

3. **Оставляет зазор между ячейками.** Атлас показывается масштабированным
   фоном, и на дробном пиксельном масштабе браузер прихватывает край соседней
   ячейки — картинка приезжает с полоской чужого рисунка сверху. Зазор в
   `GUTTER` пикселей эту полоску съедает. Геометрия атласа при этом перестаёт
   выводиться из одних лишь `cols`/`rows`, поэтому скрипт пишет рядом манифест
   `src/ui/components/atlases.json`: разметку читает компонент показа, а не
   переписывает её у себя вторыми числами.

4. **Сводит к общей палитре.** От генератора изображений единого стиля добиться
   сложно, поэтому растра мало и он приводится к палитре проекта. Сведение
   МЯГКОЕ, а не заменой каждого пикселя на ближайший из тринадцати цветов:
   жёсткая квантизация превратила бы портрет в четыре пятна. Делается то, что
   на самом деле заставляет картинки сидеть рядом друг с другом, — подрезка
   насыщенности и подмешивание графитово-синей земли `ui.bg` в тени.

Запуск (Python 3.11 из venv проекта, см. CLAUDE.md):

    ./venv/bin/python tools/pack_ui_atlases.py

Читает `main_int_demo/public/*.jpeg`, пишет `game/public/ui/*.jpg`.

АТЛАСЫ МЕХОВ (шаг 48) собираются иначе: один атлас — из ячеек РАЗНЫХ сеток, по
ручной разметке `_tmp/mech_data.json`. Порядок добавления новых картинок,
подкрутка вида и что при этом происходит с портретами уже купленных машин —
`шаг48-план.md` §13. Коротко: положить файл в `_tmp/mech/`, вписать сетку в
`_tmp/mech_label.html`, разметить, скачать JSON, прогнать этот скрипт, прогнать
`pnpm test test/mechArt.test.ts`. Ни одной правки в `game/src` при этом не нужно.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

from PIL import Image, ImageEnhance

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "main_int_demo" / "public"
DST = ROOT / "game" / "public" / "ui"
PALETTE = ROOT / "game" / "data" / "palette.json"
MANIFEST = ROOT / "game" / "src" / "ui" / "components" / "atlases.json"

# --- Атласы мехов (шаг 48) ---------------------------------------------------
# Разметка ячеек лежит вне репозитория вместе с самими сетками: какая ячейка
# какой техбазы, локомоции и разряда, и надо ли её зеркалить. Делается руками в
# `_tmp/mech_label.html`, потому что разряд по картинке не выводится — генератор
# нарисовал все ячейки в одну высоту кадра.
MECH_LABELS = ROOT / "_tmp" / "mech_data.json"
MECH_SRC = ROOT / "_tmp"
# Куда пишется раскладка «корзина → номера ячеек». Отдельным файлом от
# `atlases.json`: там геометрия, одинаковая у всех атласов, а здесь — смысл,
# который есть только у мехов.
MECH_ART = ROOT / "game" / "src" / "ui" / "components" / "mechArt.json"

# Ширина ячейки атласа мехов. Атлас идёт на СПИСКИ: миниатюра в карточке
# мехлаба (38 px), лот на рынке (46 px), полоса над списком (112 px). При 360
# это троекратный запас даже на экранах двойной плотности. Соотношение ячейки —
# 3:4, как у исходных сеток.
#
# Поднято с 240 решением пользователя 2026-09-11 («поднять качество хотя бы
# втрое»): 240 при качестве 76 давало 689 КБ и заметно мылило, 360 при 84 даёт
# 2.4 МБ. Дальше атласу расти незачем — крупный показ ушёл в одиночные файлы
# ниже, а атлас платит за КАЖДУЮ из 63 ячеек сразу, даже если игрок смотрит
# одну.
MECH_CELL_W = 360
MECH_QUALITY = 84

# ОДИНОЧНЫЕ КАРТИНКИ ПОД КРУПНЫЙ ПОКАЗ (2026-09-11). Модалка в мехлабе
# показывает одну машину во весь рост, и атласу такое разрешение не по карману:
# он платит за все 63 ячейки разом. Поэтому каждая ячейка пишется ещё и
# отдельным файлом, а браузер забирает ровно тот, на который щёлкнули.
#
# ЭТО ПОТОЛОК, А НЕ ЦЕЛЬ. Вверх картинка не растягивается никогда: исходная
# сетка 4×2 в 2528×1696 даёт ячейку 632×848, после среза рамки — 588×788, и
# больше в ней пикселей нет. Число стоит выше натурального нарочно — чтобы
# одиночные выходили натуральными, а срезалось только то, что крупнее (если
# однажды придёт сетка большего разрешения или картинки по одному меху).
#
# Около 130 КБ на файл, 8 МБ на диске и ОДИН файл в загрузке. Если диск станет
# жать, резать надо здесь (или перейти на WebP — те же глаза при весе вдвое
# меньше), а не в атласе: атлас качают все и всегда.
MECH_FULL_W = 700
MECH_FULL_QUALITY = 86
MECH_FULL_DIR = "mech"
MECH_COLS = 4

# СКОЛЬКО КАДРА ЗАНИМАЕТ МАШИНА, по разрядам.
#
# ВЫКЛЮЧЕНО РЕШЕНИЕМ ПОЛЬЗОВАТЕЛЯ 2026-09-11: все четыре единицы, картинка
# берётся как есть, один к одному. Механизм оставлен, а не вырезан, вместе с
# причиной — чтобы вернуть его можно было одной строкой, а не восстанавливая
# рассуждение заново.
#
# Зачем он был. Каждая ячейка исходных сеток нормализована по кадру, и
# двадцатитонник нарисован того же роста, что стотонник; разряд по картинке не
# читался. Коэффициент вписывал ячейку в кадр и прижимал к низу (ноги на полу),
# а остаток заполнялся землёй интерфейса: у лёгкого оставалось поле сверху, у
# штурмового нет. Работало (0.76 / 0.85 / 0.93 / 1.0), но ценой того, что
# половина кадра у лёгких уходила в пустоту.
#
# Направление, если возвращать: НЕ приближать тяжёлых, а УМЕНЬШАТЬ лёгких.
# Первая попытка приближала кадр у тяжёлых — и срезала им головы, потому что в
# исходной ячейке мех занимает около 85 % высоты и приближать некуда.
#
# Вес теперь читается не размером в кадре, а тем, что у каждого разряда СВОЙ ПУЛ
# картинок: разряд — весовой класс машины (`weightClassOf`), и лёгкому достаётся
# нарисованный лёгким, а штурмовому — нарисованный штурмовым.
MECH_FILL = {"light": 1.0, "medium": 1.0, "heavy": 1.0, "assault": 1.0}

# Сведение по техбазе: Сфера в оливу и сланец, Кланы в тан и бронзу. Множители
# на канал, СЛАБЫЕ сознательно — задача снять разброс между сетками, а не
# перекрасить арт. Если Кланы станут бирюзовыми, лучше не станет.
MECH_TINT = {"is": (0.96, 1.0, 0.95), "clan": (1.05, 1.0, 0.92)}

# Сколько срезать с каждой стороны исходной ячейки, долей от её размера. У
# генератора вокруг каждой ячейки вплавлена своя тёмная рамка с чамферами, и без
# среза выходит «рамка в рамке»: сначала нарисованная, потом поле от масштаба
# разряда. То же, что делает поле `crop` у остальных атласов, только долей, а не
# пикселями: сетки приходят разного размера.
MECH_INSET = 0.035

MECH_BAND_ORDER = ("light", "medium", "heavy", "assault")

# Зазор между ячейками в пикселях готового атласа. Четырёх хватает на любой
# разумный масштаб показа: полоска соседа шириной больше пикселя не появляется
# даже при трёхкратном уменьшении.
GUTTER = 4


@dataclass(frozen=True)
class Atlas:
    """Одна сетка: имя файла, число колонок и рядов, ширина под самый крупный показ."""

    src: str
    dst: str
    cols: int
    rows: int
    # Ширина ЯЧЕЙКИ в пикселях при самом крупном показе в интерфейсе, ×2 под
    # экраны с удвоенной плотностью. Ширина атласа = cols × cell.
    cell: int
    # Рисунок внутри исходной ячейки: (слева, сверху, справа, снизу) в пикселях
    # исходника. `None` — ячейка занята рисунком целиком. Границы сняты с
    # первой ячейки каждой сетки глазами: у генератора они одинаковы во всех.
    crop: tuple[int, int, int, int] | None = None
    # Откуда взять исходник, если он лежит не в `SRC`. Путь от корня проекта.
    # Заведено вместе с клановыми портретами: сетки приходят от генератора
    # изображений в разное время и в разные папки, а перекладывать их руками
    # ради одного пути — лишний шаг, который однажды забудут сделать.
    src_dir: str | None = None
    # Шаг ячейки исходника (по x, по y) в пикселях, если генератор нарисовал сетку не ровными долями картинки:
    # разделители разной толщины или поле у края (сетки державы, шаг 93). `None` — ширина ÷ cols, высота ÷ rows.
    # `crop` отсчитывается от начала каждой ячейки по этому шагу.
    pitch: tuple[float, float] | None = None


ATLASES = (
    # Эмблемы: 32 px в шапке и 42 px в выборе герба. 128 — с запасом на ×2.
    # Ячейку занимает сам знак, подписей и рамок нет.
    Atlas("emblems_grid.jpeg", "factions.jpg", 4, 4, 128),
    Atlas("mercenary_emblems_grid.jpeg", "mercenaries.jpg", 4, 4, 128),
    Atlas("player_emblems_grid.jpeg", "company.jpg", 4, 4, 128),
    # Портреты пилотов: 54×72 в ангаре, до 96 в казармах. Снимается только
    # тёмная рамка вокруг кадра.
    Atlas("pilots_grid.jpeg", "pilots.jpg", 4, 4, 192, (6, 6, 218, 294)),
    # Клановые портреты (найм 2026-09-10). РЯД АТЛАСА — ЭТО КЛАН: сверху вниз
    # Волк, Нефритовый Сокол, Призрачный Медведь, Дымчатый Ягуар. Порядок несёт
    # смысл и повторяется в `data/pilots.json → faces`, поэтому менять его
    # нельзя, не поправив там же. Ячейка та же, что у сферной сетки: оба атласа
    # показываются одним компонентом и в одних и тех же местах интерфейса.
    Atlas(
        "Gemini_Generated_Image_a7au4ia7au4ia7au.jpeg",
        "pilots_clans.jpg",
        4,
        4,
        192,
        (9, 8, 439, 592),
        src_dir="_tmp/карточка персонажа",
    ),
    # Диск планеты в досье системы — около 330 px шириной. Ниже рисунка в
    # исходнике идёт полоса с английской подписью: она срезается.
    Atlas("planets_grid.jpeg", "planets.jpg", 4, 4, 352, (4, 4, 700, 332)),
    # Голограмма миссии: 110 px в карточке списка, ~410 px в досье контракта.
    # Срезается и подпись снизу, и внешняя рамка планшета.
    Atlas("contracts_grid.jpeg", "missions.jpg", 4, 3, 416, (26, 22, 678, 414)),
    # Значки достижений (шаг 69): 48–64 px на странице роты и в разборе, 128 —
    # запас на ×2. Сетка 5×5 на 2048 px, шаг ячейки 409–410 px, рисунок внутри
    # 396 px в тёмной рамке генератора: срез в 10 px от края ячейки снимает
    # рамку и не задевает рисунок даже у пятой колонки, где шаг набегает на 4 px.
    # Номер ячейки — поле `icon` в `data/achievements.json`.
    Atlas("achievements_grid.jpeg", "achievements.jpg", 5, 5, 128, (10, 10, 398, 398), src_dir="_tmp"),
    # Постройки мира роты (шаги 87–90): 48–64 px в карточке мира на экране державы, 160 —
    # запас на ×2. Сетка 4×2 на 1376×768 px, шаг 344×384 px. Квадратный срез 336×336
    # снимает тонкие чёрные разделители между ячейками.
    # Порядок ячеек: workshop (0), depot (1), barracks (2), defence (3),
    # spaceport (4), factory (5), drill (6), headquarters (7).
    Atlas("buildings_grid.jpeg", "buildings.jpg", 4, 2, 160, (4, 10, 340, 346), src_dir="_tmp"),
    # Значки державы (после шага 93): 16–28 px на кнопках, в дереве миров и у соседей, 56 — запас на ×2.
    # Сетка 5×5 на 1024 px, шаг 204.75: у каждой ячейки своя светлая рамка 8–13 px, срез берёт плитку внутри
    # неё — рамка на 20 px показа превращается в шум. Порядок ячеек (по строкам) — `ui/realm/realmIcons.ts`.
    Atlas(
        "battletech_ui_icons.png",
        "realm_icons.jpg",
        5,
        5,
        56,
        (14, 14, 190, 190),
        src_dir="_tmp/graphics",
        pitch=(204.75, 204.75),
    ),
    # Знаки титулов державы: 40–64 px в Штабе, 128 — запас. Сетка 3×2 на 2528×1696, ячейки 828×838 между
    # чёрными разделителями ~21 px: шаг 849.5×859, квадратный срез по центру ячейки. Порядок — лестница титулов
    # (`WAR.titles`), шестая — закрытый титул.
    Atlas(
        "realm_titles_grid.jpeg",
        "realm_titles.jpg",
        3,
        2,
        128,
        (6, 11, 822, 827),
        src_dir="_tmp/graphics",
        pitch=(849.5, 859),
    ),
    # Планеты целым шаром (после шага 93) — кружок мира на карте державы, в Штабе и в карточке мира (`PlanetDot`),
    # 14–64 px, 128 — запас. Сетка 3×2 на 2528×1696: ячейки ~830×840 между светлыми разделителями ~16 px, шаг
    # 849.5×857. Шар ~725 px с центром около (412, 417) от начала ячейки; срез 700 px — чуть меньше шара: шар
    # заполняет круг показа целиком, край круга совпадает с кольцом на карте. С полем вокруг тёмная сторона шара
    # сливалась с фоном, и на 15–20 px шар выглядел сдвинутым (отладка 2026-10-09).
    # Порядок — биомы боя: континентальный, пустыня, тундра, джунгли, вулкан, безатмосферный.
    Atlas(
        "planets_round_grid.jpeg",
        "planets_round.jpg",
        3,
        2,
        128,
        (62, 67, 762, 767),
        src_dir="_tmp/graphics",
        pitch=(849.5, 857),
    ),
)

# Насколько подрезать насыщенность и сколько земли подмешать в тени. Числа
# подобраны глазами на всех шести сетках сразу: больше — картинки сереют и
# перестают читаться значками, меньше — сетки не сходятся между собой.
SATURATION = 0.88
SHADOW_MIX = 0.16


def ground_color() -> tuple[int, int, int]:
    """Земля интерфейса из палитры проекта. Ни одного цвета мимо `palette.json`."""
    palette = json.loads(PALETTE.read_text(encoding="utf-8"))
    raw = palette["ui"]["bg"].lstrip("#")
    return tuple(int(raw[i : i + 2], 16) for i in (0, 2, 4))  # type: ignore[return-value]


def grade(image: Image.Image, ground: tuple[int, int, int]) -> Image.Image:
    """Мягкое сведение к палитре: подрезать насыщенность, утопить тени в землю."""
    image = ImageEnhance.Color(image).enhance(SATURATION)
    ground_layer = Image.new("RGB", image.size, ground)
    # Маска — сама картинка в градациях серого, инвертированная: чем темнее
    # пиксель, тем больше в него подмешивается земля. Светлое (лица, металл,
    # золото гербов) остаётся нетронутым — иначе пропадает то, ради чего растр
    # вообще взяли.
    mask = image.convert("L").point(lambda v: int((255 - v) * SHADOW_MIX))
    return Image.composite(ground_layer, image, mask)


def tint(image: Image.Image, gains: tuple[float, float, float]) -> Image.Image:
    """Слабый сдвиг баланса по каналам — метка техбазы поверх общего сведения."""
    r, g, b = image.split()
    table = lambda k: [min(255, round(i * k)) for i in range(256)]  # noqa: E731
    return Image.merge("RGB", (r.point(table(gains[0])),
                               g.point(table(gains[1])),
                               b.point(table(gains[2]))))


def build_mech_atlases(ground: tuple[int, int, int], manifest: dict[str, object]) -> None:
    """
    Четыре атласа мехов из размеченных ячеек исходных сеток (шаг 48).

    Отличие от остальных атласов: ОДИН атлас собирается из ячеек РАЗНЫХ сеток.
    Корзина — это тройка «техбаза × локомоция × разряд», и картинки в неё
    попадают откуда угодно: сетки заказывались по техбазе, а вышли смешанными.

    Ячейки укладываются В ПОРЯДКЕ РАЗРЯДОВ (лёгкие → штурмовые), и раскладка
    «разряд → номера ячеек» пишется в `mechArt.json`. Номер ячейки сам по себе
    смысла не несёт: его читает только `MechSilhouette.svelte`, и читает через
    эту раскладку, поэтому перестановка ячеек внутри разряда безопасна.
    """
    if not MECH_LABELS.exists():
        print(f"пропуск атласов мехов   нет разметки: {MECH_LABELS}")
        return

    labels = json.loads(MECH_LABELS.read_text(encoding="utf-8"))
    grids = {g["file"]: g for g in labels["grids"]}
    cell_h = round(MECH_CELL_W * 4 / 3)

    # Корзины: (техбаза, локомоция) → разряд → список ячеек разметки.
    buckets: dict[tuple[str, str], dict[str, list[dict]]] = {}
    for c in labels["cells"]:
        key = (c["tech"], c["loco"])
        buckets.setdefault(key, {b: [] for b in MECH_BAND_ORDER})[c["band"]].append(c)

    art: dict[str, object] = {
        "$comment": (
            "Раскладка атласов мехов: какие ячейки какого разряда. Пишется "
            "tools/pack_ui_atlases.py из ручной разметки _tmp/mech_data.json, "
            "читается ui/components/MechSilhouette.svelte. Руками не править."
        ),
        "$comment2": (
            "bands — верхние границы разрядов в тоннах, всё выше heavy — assault. "
            "Это границы АРТА: сегодня они совпадают с construction.json → "
            "roles.classBands намеренно, но тюнятся отдельно, потому что отвечают "
            "на другой вопрос — как машина выглядит, а не какую роль получает."
        ),
        "$comment3": (
            "fullDir — где лежат одиночные картинки под крупный показ, по одной "
            "на ячейку. Имя файла: <атлас>-<номер ячейки>.jpg. Атлас идёт на "
            "списки, одиночный файл — на модалку: браузер забирает ровно тот, "
            "на который щёлкнули, вместо всех 63 сразу."
        ),
        "bands": labels["bands"],
        "fullDir": f"/ui/{MECH_FULL_DIR}",
        "atlases": {},
    }

    for (tech, loco), by_band in sorted(buckets.items()):
        name = f"mechs_{tech}_{loco.lower()}"
        ordered = [(band, c) for band in MECH_BAND_ORDER for c in by_band[band]]
        count = len(ordered)
        rows = -(-count // MECH_COLS)
        size = (
            MECH_CELL_W * MECH_COLS + GUTTER * (MECH_COLS - 1),
            cell_h * rows + GUTTER * (rows - 1),
        )
        sheet = Image.new("RGB", size, ground)
        band_cells: dict[str, list[int]] = {b: [] for b in MECH_BAND_ORDER}
        singles: list[tuple[int, Image.Image]] = []

        for idx, (band, c) in enumerate(ordered):
            grid = grids[c["file"]]
            src_path = MECH_SRC / c["file"]
            with Image.open(src_path) as image:
                image = image.convert("RGB")
                gw, gh = image.width // grid["cols"], image.height // grid["rows"]
                gcol, grow = c["cell"] % grid["cols"], c["cell"] // grid["cols"]
                ix, iy = round(gw * MECH_INSET), round(gh * MECH_INSET)
                art_cell = image.crop((
                    gcol * gw + ix, grow * gh + iy,
                    (gcol + 1) * gw - ix, (grow + 1) * gh - iy,
                ))

            if c.get("mirror"):
                art_cell = art_cell.transpose(Image.FLIP_LEFT_RIGHT)

            # ОДИНОЧНАЯ КАРТИНКА БЕРЁТ НАТУРАЛЬНУЮ ВЫРЕЗКУ, не уменьшенную.
            # Порядок здесь важен и однажды был перепутан: `singles` получал уже
            # сжатую до ячейки атласа копию, и модалка показывала её растянутой
            # обратно — увеличение из уменьшенного, вдвое мягче исходника.
            singles.append((idx, art_cell))

            # Масштаб по разряду: вписать в кадр с коэффициентом и прижать к
            # низу. Ноги остаются на полу, поле появляется сверху, и именно
            # размер этого поля читается как «машина легче».
            fill = MECH_FILL[band]
            fw, fh = round(MECH_CELL_W * fill), round(cell_h * fill)
            small = art_cell.resize((fw, fh), Image.LANCZOS)

            col, row = idx % MECH_COLS, idx // MECH_COLS
            ox = col * (MECH_CELL_W + GUTTER) + (MECH_CELL_W - fw) // 2
            oy = row * (cell_h + GUTTER) + (cell_h - fh)
            sheet.paste(small, (ox, oy))
            band_cells[band].append(idx)

        dst = DST / f"{name}.jpg"
        graded = tint(grade(sheet, ground), MECH_TINT[tech])
        graded.save(dst, "JPEG", quality=MECH_QUALITY, optimize=True, progressive=True)

        # Тот же кадр отдельным файлом под крупный показ. Сведение и тонировка
        # применяются ПО ОТДЕЛЬНОСТИ к каждой ячейке, а не к полотну атласа:
        # `grade` смотрит на яркость самого пикселя, поэтому результат совпадает
        # с атласным, и модалка не выглядит картинкой из другого набора.
        full_dir = DST / MECH_FULL_DIR
        full_dir.mkdir(parents=True, exist_ok=True)
        full_bytes = 0
        for idx, cell_art in singles:
            # ВВЕРХ НЕ РАСТЯГИВАЕМ НИКОГДА. Потолок задан исходником: сетка 4×2
            # в 2528×1696 даёт ячейку 632×848, после среза вплавленной рамки —
            # 588×788. Просить больше нечего: пикселей там просто нет, а
            # растянутая картинка врёт резкостью. Хочется крупнее — генерировать
            # по одному меху на картинку (промпты `шаг48-план.md` §11).
            want = min(MECH_FULL_W, cell_art.width)
            big = (
                cell_art
                if want == cell_art.width
                else cell_art.resize(
                    (want, round(want * cell_art.height / cell_art.width)), Image.LANCZOS
                )
            )
            one = full_dir / f"{name}-{idx}.jpg"
            tint(grade(big, ground), MECH_TINT[tech]).save(
                one, "JPEG", quality=MECH_FULL_QUALITY, optimize=True, progressive=True
            )
            full_bytes += one.stat().st_size

        manifest[name] = {
            "file": f"/ui/{name}.jpg",
            "cols": MECH_COLS,
            "rows": rows,
            "cell": [MECH_CELL_W, cell_h],
            "gutter": GUTTER,
            "size": list(size),
        }
        # Пустые разряды не пишутся: их отсутствие — это сведение, а не ноль.
        art["atlases"][name] = {b: v for b, v in band_cells.items() if v}

        thin = [b for b, v in band_cells.items() if len(v) < 2]
        print(
            f"{name + '.jpg':<16} {size[0]:>5}×{size[1]:<5} "
            f"{count:>3} ячеек → {dst.stat().st_size / 1024:>6.0f} КБ"
            f" + {full_bytes / 1024:>5.0f} КБ врозь"
            + (f"   мало в: {', '.join(thin)}" if thin else "")
        )

    MECH_ART.write_text(json.dumps(art, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main() -> None:
    ground = ground_color()
    DST.mkdir(parents=True, exist_ok=True)

    manifest: dict[str, object] = {
        "$comment": (
            "Геометрия растровых атласов интерфейса. Пишется "
            "tools/pack_ui_atlases.py, читается ui/components/AtlasImage.svelte. "
            "Руками не править: следующий прогон скрипта перезапишет."
        ),
    }
    total_before = 0
    total_after = 0
    for atlas in ATLASES:
        src = (ROOT / atlas.src_dir if atlas.src_dir else SRC) / atlas.src
        if not src.exists():
            # Сетки-исходники лежат вне репозитория (они в .gitignore) и до
            # прогона могут не существовать вовсе. Пропуск с предупреждением, а
            # не остановка: иначе одна недостающая сетка не даёт пересобрать
            # остальные, а собранные атласы в `public/ui` уже лежат готовыми.
            print(f"пропуск {atlas.dst:<16} нет исходника: {src}")
            continue

        with Image.open(src) as image:
            image = image.convert("RGB")
            step_x, step_y = atlas.pitch or (image.width / atlas.cols, image.height / atlas.rows)
            src_w = image.width // atlas.cols
            src_h = image.height // atlas.rows
            left, top, right, bottom = atlas.crop or (0, 0, src_w, src_h)
            cell_h = round(atlas.cell * (bottom - top) / (right - left))
            size = (
                atlas.cell * atlas.cols + GUTTER * (atlas.cols - 1),
                cell_h * atlas.rows + GUTTER * (atlas.rows - 1),
            )

            resized = Image.new("RGB", size, ground)
            for row in range(atlas.rows):
                for col in range(atlas.cols):
                    x0 = round(col * step_x) if atlas.pitch else col * src_w
                    y0 = round(row * step_y) if atlas.pitch else row * src_h
                    art = image.crop((x0 + left, y0 + top, x0 + right, y0 + bottom))
                    resized.paste(
                        art.resize((atlas.cell, cell_h), Image.LANCZOS),
                        (col * (atlas.cell + GUTTER), row * (cell_h + GUTTER)),
                    )

        out = DST / atlas.dst
        # progressive + optimize: те же байты, но картинка проявляется целиком,
        # а не сверху вниз, — на медленной сети это заметно.
        grade(resized, ground).save(out, "JPEG", quality=84, optimize=True, progressive=True)

        manifest[atlas.dst.removesuffix(".jpg")] = {
            "file": f"/ui/{atlas.dst}",
            "cols": atlas.cols,
            "rows": atlas.rows,
            "cell": [atlas.cell, cell_h],
            "gutter": GUTTER,
            "size": list(size),
        }

        before = src.stat().st_size
        after = out.stat().st_size
        total_before += before
        total_after += after
        print(
            f"{atlas.dst:<16} {size[0]:>5}×{size[1]:<5} "
            f"{before / 1024:>7.0f} КБ → {after / 1024:>6.0f} КБ"
        )

    # Атласы мехов (`build_mech_atlases`, шаг 48) больше не собираются: с шага 50
    # портреты мехов — отдельные WebP с раскрасками, их пишет
    # `tools/pack_mech_art.py`. Функция оставлена ради истории разметки.

    # Манифест ДОПОЛНЯЕТСЯ, а не переписывается с нуля: пропущенные сетки
    # (исходника нет под рукой) обязаны сохранить свою разметку — атлас-то в
    # `public/ui` лежит и показывается. Записи атласов мехов из старого манифеста
    # не переносятся.
    if MANIFEST.exists():
        previous = json.loads(MANIFEST.read_text(encoding="utf-8"))
        previous = {k: v for k, v in previous.items() if not k.startswith("mechs_")}
        previous.update(manifest)
        manifest = previous
    MANIFEST.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    print(f"{'ИТОГО':<16} {'':>11} {total_before / 1024:>7.0f} КБ → {total_after / 1024:>6.0f} КБ")


if __name__ == "__main__":
    main()
