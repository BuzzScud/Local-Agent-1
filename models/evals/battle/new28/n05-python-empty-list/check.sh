#!/bin/zsh
python3 -m unittest -q test_stats 2>/dev/null || { echo "the tests fail"; exit 1; }
[ "$(shasum test_stats.py | cut -c1-12)" = "8acf911e42f0" ] || { echo "test_stats.py was changed (fix the code, not the tests)"; exit 1; }
python3 -c "from stats import average; assert average([2.5, 3.5]) == 3.0, average([2.5, 3.5])" 2>/dev/null || { echo 'average of numbers changed'; exit 1; }
