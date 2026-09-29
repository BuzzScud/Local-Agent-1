#!/bin/zsh
python3 -m unittest -q test_service 2>/dev/null || { echo 'the tests fail'; exit 1; }
[ "$(shasum test_service.py | cut -c1-12)" = "9c49aea3a439" ] || { echo "test_service.py was changed (fix the code, not the tests)"; exit 1; }
grep -q '@dataclass' models.py || { echo 'models.py has no @dataclass'; exit 1; }
python3 -c "from models import User, make_user; import dataclasses; assert dataclasses.is_dataclass(User); u = make_user('a', 'b'); assert isinstance(u, User) and u.active is True; assert User('x', 'y').active is True" 2>/dev/null || { echo 'User is not the dataclass asked for'; exit 1; }
! grep -q "\['" service.py || { echo "service.py still reads user['…']"; exit 1; }
