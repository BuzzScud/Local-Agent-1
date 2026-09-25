#!/bin/zsh
python3 -m pytest -q 2>&1 | grep -Eq '^[0-9]+ passed' || { echo "pytest fails"; exit 1; }
[ "$(python3 -m pytest -q 2>&1 | grep -Eo '^[0-9]+ passed' | grep -Eo '[0-9]+')" -ge 2 ] || { echo "no new test"; exit 1; }
python3 -c "from mathutil import clamp; assert clamp(5, 0, 3) == 3 and clamp(-1, 0, 3) == 0 and clamp(2, 0, 3) == 2" || { echo "clamp wrong"; exit 1; }
