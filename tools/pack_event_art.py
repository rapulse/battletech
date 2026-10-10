#!/usr/bin/env python3
"""
Подготовка иллюстраций событий мира (вех эпохи) из `_tmp/events/` и поворотов державы из `_tmp/graphics/`
(после шага 93: война, мир, восстание, взятый и потерянный мир — `ui/realm/realmMoment.ts`).

Каждое событие пишется отдельным файлом формата WebP в `game/public/ui/events/<id>.webp`.
Формат кадра карточки (`EventCard.svelte`) — 16:7 (при максимальной ширине модалки 560 px
с отступами по 16 px, размер показа 528×231 px). Пишется 1440×630 — с запасом на ×2.

Запуск:
    ./venv/bin/python tools/pack_event_art.py
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from PIL import Image, ImageEnhance

ROOT = Path(__file__).resolve().parent.parent
TMP = ROOT / "_tmp"
DST_DIR = ROOT / "game" / "public" / "ui" / "events"
PALETTE_JSON = ROOT / "game" / "data" / "palette.json"

# Исходник каждого события — по имени файла: имена у генератора случайные,
# а порядок по времени изменения сбивается от любого пересохранения.
# Путь — от `_tmp/`.
SOURCES = {
    "refusal-war": "events/Gemini_Generated_Image_j3fozaj3fozaj3fo.jpeg",
    "whitting-conference": "events/Gemini_Generated_Image_v18pyyv18pyyv18p.jpeg",
    "operation-bulldog": "events/Gemini_Generated_Image_3y560g3y560g3y56.jpeg",
    "nova-cat-league": "events/Gemini_Generated_Image_c2aaeyc2aaeyc2aa.jpeg",
    "fedcom-civil-war": "events/Gemini_Generated_Image_lfwni4lfwni4lfwn.jpeg",
    "tukayyid-truce-end": "events/Gemini_Generated_Image_enmqw7enmqw7enmq.jpeg",
    "realm-war-declared": "graphics/realm-war-declared.jpeg",
    "realm-peace": "graphics/realm-peace.jpeg",
    "realm-revolt": "graphics/realm-revolt.jpeg",
    "realm-world-taken": "graphics/realm-world-taken.jpeg",
    "realm-world-lost": "graphics/realm-world-lost.jpeg",
}

TARGET_W = 1440
TARGET_H = 630  # ровно 16:7 при 1440 ширины
WEBP_QUALITY = 90

# Мягкое сведение к палитре проекта: чуть подрезать насыщенность,
# подмешать графитово-синий #0d1117 интерфейса в глубокие тени.
SATURATION = 0.92
SHADOW_MIX = 0.12


def ground_color() -> tuple[int, int, int]:
    palette = json.loads(PALETTE_JSON.read_text(encoding="utf-8"))
    raw = palette["ui"]["bg"].lstrip("#")
    return tuple(int(raw[i : i + 2], 16) for i in (0, 2, 4))  # type: ignore[return-value]


def grade(image: Image.Image, ground: tuple[int, int, int]) -> Image.Image:
    """Мягкое сведение к фону интерфейса."""
    image = ImageEnhance.Color(image).enhance(SATURATION)
    ground_layer = Image.new("RGB", image.size, ground)
    mask = image.convert("L").point(lambda v: int((255 - v) * SHADOW_MIX))
    return Image.composite(ground_layer, image, mask)


def crop_to_aspect(im: Image.Image, target_ratio: float = 16.0 / 7.0) -> Image.Image:
    """Центрированная обрезка под соотношение 16:7."""
    w, h = im.size
    current_ratio = w / h
    if current_ratio < target_ratio:
        # Картинка выше нужного — обрезаем сверху и снизу
        new_h = int(round(w / target_ratio))
        top = (h - new_h) // 2
        return im.crop((0, top, w, top + new_h))
    elif current_ratio > target_ratio:
        # Картинка шире нужного — обрезаем по бокам
        new_w = int(round(h * target_ratio))
        left = (w - new_w) // 2
        return im.crop((left, 0, left + new_w, h))
    return im


def main() -> None:
    parser = argparse.ArgumentParser(description="Обработка и упаковка арта событий")
    parser.add_argument("--dry-run", action="store_true", help="Только показать файлы без записи")
    args = parser.parse_args()

    missing = [name for name in SOURCES.values() if not (TMP / name).is_file()]
    if missing:
        raise SystemExit(f"Нет исходников в {TMP}: {', '.join(missing)}")
    if not args.dry_run:
        DST_DIR.mkdir(parents=True, exist_ok=True)
    ground = ground_color()

    processed = []
    for event_id, name in SOURCES.items():
        src_path = TMP / name
        dst_path = DST_DIR / f"{event_id}.webp"
        with Image.open(src_path) as im:
            im = im.convert("RGB")
            cropped = crop_to_aspect(im, 16.0 / 7.0)
            resized = cropped.resize((TARGET_W, TARGET_H), Image.Resampling.LANCZOS)
            graded = grade(resized, ground)

            if not args.dry_run:
                graded.save(dst_path, "WEBP", quality=WEBP_QUALITY, method=6)
                size_kb = dst_path.stat().st_size / 1024
                print(f"[OK] {src_path.name} -> {dst_path.name} ({TARGET_W}x{TARGET_H}, {size_kb:.1f} KB)")
            else:
                print(f"[DRY-RUN] {src_path.name} -> {dst_path.name}")
        processed.append(event_id)

    print(f"\nУспешно обработано событий: {len(processed)}")


if __name__ == "__main__":
    main()
