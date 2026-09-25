# A resizable pseudo-terminal for the screen tests: runs a command in a pty,
# copies its output to stdout, and takes orders on stdin:
#   W <len>\n<bytes>   type these bytes
#   R <cols> <rows>\n  resize (after passing on everything printed so far,
#                      then a marker, so a replay resizes at the same point)
import os, pty, sys, fcntl, termios, struct, select, signal

cols, rows, argv = int(sys.argv[1]), int(sys.argv[2]), sys.argv[3:]
pid, fd = pty.fork()
if pid == 0:
    os.execvp(argv[0], argv)

def setsize(c, r):
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', r, c, 0, 0))

setsize(cols, rows)
out = sys.stdout.buffer
inp = sys.stdin.buffer.raw
buf = b''

def copy_output(timeout):
    r, _, _ = select.select([fd], [], [], timeout)
    if not r:
        return False
    try:
        d = os.read(fd, 65536)
    except OSError:
        d = b''
    if not d:
        raise SystemExit(0)
    out.write(d); out.flush()
    return True

try:
    while True:
        r, _, _ = select.select([fd, inp], [], [], 0.5)
        if fd in r:
            copy_output(0)
        if inp in r:
            d = os.read(inp.fileno(), 65536)
            if not d:
                break
            buf += d
            while b'\n' in buf:
                head, rest = buf.split(b'\n', 1)
                parts = head.split(b' ')
                if parts[0] == b'W':
                    n = int(parts[1])
                    if len(rest) < n:
                        break
                    os.write(fd, rest[:n]); buf = rest[n:]
                elif parts[0] == b'R':
                    buf = rest
                    # What is already printed goes out first (only what is
                    # waiting now: a streaming app never goes quiet).
                    for _ in range(64):
                        if not copy_output(0):
                            break
                    c, rr = int(parts[1]), int(parts[2])
                    out.write(b'\x00\x01RESIZE %d %d\x01\x00' % (c, rr)); out.flush()
                    setsize(c, rr)
                    try: os.kill(pid, signal.SIGWINCH)
                    except ProcessLookupError: pass
                else:
                    buf = rest
finally:
    try: os.killpg(os.getpgid(pid), signal.SIGKILL)
    except Exception: pass
