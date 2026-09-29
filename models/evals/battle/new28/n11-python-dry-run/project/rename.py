import os
import sys


def main(argv):
    folder, prefix = argv[1], argv[2]
    for name in sorted(os.listdir(folder)):
        if name.endswith('.txt'):
            os.rename(os.path.join(folder, name), os.path.join(folder, prefix + name))


if __name__ == '__main__':
    main(sys.argv)
