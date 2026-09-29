import unittest
from models import make_user
from service import greeting, deactivate


class ServiceTest(unittest.TestCase):
    def test_greeting(self):
        self.assertEqual(greeting(make_user('Ann', 'ann@example.com')), 'Hello, Ann <ann@example.com>')

    def test_deactivate(self):
        u = deactivate(make_user('Bo', 'bo@example.com'))
        self.assertFalse(u.active if hasattr(u, 'active') else u['active'])


if __name__ == '__main__':
    unittest.main()
