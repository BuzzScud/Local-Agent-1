from dataclasses import dataclass


@dataclass
class User:
    name: str
    email: str
    active: bool = True


def make_user(name, email):
    """A new user, active."""
    return User(name, email)
