def greeting(user):
    return f"Hello, {user['name']} <{user['email']}>"


def deactivate(user):
    user['active'] = False
    return user
