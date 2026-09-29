import os
import sys


def main(argv):
    args = [a for a in argv[1:] if a != '--dry-run']
    dry = '--dry-run' in argv[1:]
    folder, prefix = args[0], args[1]
    for name in sorted(os.listdir(folder)):
        if name.endswith('.txt'):
            if dry:
                print(f'{name} -> {prefix}{name}')
            else:
                os.rename(os.path.join(folder, name), os.path.join(folder, prefix + name))


if __name__ == '__main__':
    main(sys.argv)
