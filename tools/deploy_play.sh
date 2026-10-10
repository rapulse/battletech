#!/usr/bin/env bash
set -e

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PLAY_DIR="${REPO_DIR}/../battletech-play"

if [ ! -d "$PLAY_DIR" ]; then
  echo "Папка $PLAY_DIR не найдена!"
  exit 1
fi

echo "==> 1. Сборка игры..."
pnpm --dir "${REPO_DIR}/game" build

echo "==> 2. Копирование файлов в battletech-play..."
rsync -av --delete --exclude '.git' "${REPO_DIR}/game/dist/" "${PLAY_DIR}/"
touch "${PLAY_DIR}/.nojekyll"

echo "==> 3. Фиксация изменений в Git..."
git -C "$PLAY_DIR" add -A

if git -C "$PLAY_DIR" diff --cached --quiet; then
  echo "Нет новых изменений для коммита."
else
  COMMIT_MSG="Обновление игры $(date '+%Y-%m-%d %H:%M')"
  git -C "$PLAY_DIR" commit -m "$COMMIT_MSG"
  echo "Закоммичено: $COMMIT_MSG"
fi

if git -C "$PLAY_DIR" remote get-url origin >/dev/null 2>&1; then
  echo "==> 4. Отправка на GitHub..."
  git -C "$PLAY_DIR" push origin main
  echo "Успешно отправлено на GitHub!"
else
  echo "Внимание: удалённый репозиторий origin ещё не привязан."
  echo "Привяжите его командой: git -C ../battletech-play remote add origin https://github.com/rapulse/battletech-play.git"
fi
