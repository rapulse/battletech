set -e
for N in 0 15 40 80 300; do
  sed -i '' "s/\"companies\": [0-9]*,/\"companies\": $N,/" data/rivals.json
  pnpm camp --seeds 1..25 --contracts 20 --fidelity fast > "$1/sweep_$N.csv" 2>/dev/null
  echo "N=$N готово"
done
