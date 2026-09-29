import sys

from loader import load_bars


def main(path):
    bars, skipped = load_bars(path)
    if not bars:
        print("no bars")
    else:
        print(f"{len(bars)} bars from {bars[0]['time']} to {bars[-1]['time']}")
    if skipped:
        print(f"skipped {skipped} bad rows")


if __name__ == "__main__":
    main(sys.argv[1])
