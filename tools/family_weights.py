"""Веса семейств вооружения по биому из турнира `pnpm familystat` (шаг 71b).

Читает CSV прогонов 1 на 1 и 2 на 2 по трём группам биомов и обеим техбазам
(`tools/out/fs{1,2}-{closed,mixed,open}-{is,clan}.csv`), считает у каждого
семейства среднюю долю урона против всех остальных — форматы поровну — и
печатает JSON для `construction.json → roles.familyByBiome`.

Вес семейства — exp((доля − лучшая доля) / T), T — пункты доли урона
(по умолчанию 5): лучшее получает 1, отставшее на T — 0.37. Пол — `--floor`
(0.15): каждое семейство выходит хоть изредка — решение пользователя
2026-09-25: «игра должна использовать весь спектр вооружения, отдавая
преимущество какому-то только тогда, когда это выгодно». Участник `default` (нынешний генератор) в таблицу не идёт.

Запуск: venv/bin/python tools/family_weights.py [--t 5] [--floor 0.15]
"""
import argparse
import csv
import json
import math
from collections import defaultdict
from pathlib import Path

OUT = Path(__file__).parent / 'out'
GROUPS = ['closed', 'mixed', 'open']
TECHS = ['is', 'clan']
CLASSES = ['light', 'medium', 'heavy', 'assault']


def shares(path: Path) -> dict:
    d = defaultdict(list)
    with path.open() as f:
        for r in csv.DictReader(f):
            a, b = float(r['dealtA']), float(r['dealtB'])
            s = a / (a + b) if a + b else 0.5
            d[(r['class'], r['a'])].append(s)
            d[(r['class'], r['b'])].append(1 - s)
    return {k: sum(v) / len(v) for k, v in d.items()}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('--t', type=float, default=5.0)
    ap.add_argument('--floor', type=float, default=0.15)
    a = ap.parse_args()
    t = a.t / 100
    table: dict = {}
    for g in GROUPS:
        table[g] = {}
        for tech in TECHS:
            one = shares(OUT / f'fs1-{g}-{tech}.csv')
            two = shares(OUT / f'fs2-{g}-{tech}.csv')
            table[g][tech] = {}
            for cls in CLASSES:
                fams = sorted({f for (c, f) in one if c == cls and f != 'default'})
                score = {f: (one[(cls, f)] + two[(cls, f)]) / 2 for f in fams}
                best = max(score.values())
                table[g][tech][cls] = {f: round(max(a.floor, math.exp((s - best) / t)), 2) for f, s in score.items()}
    print(json.dumps(table, ensure_ascii=False))


if __name__ == '__main__':
    main()
