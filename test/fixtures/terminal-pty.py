"""Bounded POSIX CLI checks with genuinely distinct controlling/no-ctty sessions."""
import errno
import fcntl
import http.server
import json
import os
import pathlib
import pty
import re
import select
import signal
import shutil
import struct
import subprocess
import sys
import tempfile
import termios
import threading
import time


ROOT = pathlib.Path(sys.argv[1])
NODE = sys.argv[2]
BINARY = str(pathlib.Path(sys.argv[3]).resolve()) if len(sys.argv) > 3 else None
ANSI = re.compile(r"\x1b\[[0-?]*[ -/]*[@-~]")
ENV = {**os.environ, "TERM": "xterm-256color", "NODE_NO_WARNINGS": "1", "CI": "false", "NODE_OPTIONS": "--max-old-space-size=256"}
RESULTS = []


class Session:
    def __init__(self, args, config, controlling=True, terminal_stdin=False, input_file=None, fixture=None, runtime=NODE):
        self.master, self.slave = pty.openpty()
        fcntl.ioctl(self.slave, termios.TIOCSWINSZ, struct.pack("HHHH", 14, 80, 0, 0))
        self.before = termios.tcgetattr(self.slave)
        self.output = b""

        def setup():
            # An inherited PTY fd is not itself a controlling terminal.
            os.setsid()
            if controlling:
                fcntl.ioctl(1, termios.TIOCSCTTY, 0)
            else:
                try:
                    fd = os.open("/dev/tty", os.O_RDONLY | os.O_NOCTTY)
                except OSError:
                    pass
                else:
                    os.close(fd)
                    raise RuntimeError("no-ctty fixture unexpectedly has /dev/tty")

        if runtime == BINARY:
            command = [runtime, *args, "--config", str(config)]
        else:
            command = [runtime] if pathlib.Path(runtime).name == "bun" else [runtime, "--max-old-space-size=128", "--import", "tsx"]
            command += [fixture] if fixture else ["src/main.ts", *args, "--config", str(config)]
        self.proc = subprocess.Popen(
            command, cwd=ROOT, env=ENV, preexec_fn=setup,
            stdin=self.slave if terminal_stdin else input_file if input_file else subprocess.PIPE,
            stdout=self.slave, stderr=self.slave,
        )

    def drain(self, timeout=0.05):
        if select.select([self.master], [], [], timeout)[0]:
            try:
                self.output += os.read(self.master, 65536)
            except OSError as error:
                if error.errno != errno.EIO:
                    raise
            assert len(self.output) < 1_000_000, "PTY output exceeded budget"

    def frame(self):
        return ANSI.sub("", self.output.rsplit(b"\x1b[2J", 1)[-1].decode("utf-8", "replace"))

    def wait(self, predicate, seconds=5):
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline:
            self.drain()
            if predicate(self.frame()):
                return self.frame()
            if self.proc.poll() is not None:
                break
        raise AssertionError(self.output[-6000:].decode("utf-8", "replace"))

    def write(self, data):
        self.proc.stdin.write(data)
        self.proc.stdin.flush()

    def consumed(self):
        # Synchronize split UTF-8 writes with actual pipe consumption, not a sleep.
        deadline = time.monotonic() + 3
        while time.monotonic() < deadline:
            unread = struct.unpack("I", fcntl.ioctl(self.proc.stdin.fileno(), termios.FIONREAD, struct.pack("I", 0)))[0]
            if unread == 0:
                return
            self.drain(0.01)
        raise AssertionError("document pipe was not consumed")

    def eof(self):
        self.proc.stdin.close()

    def key(self, key):
        os.write(self.master, key.encode())

    def navigate(self, key, marker):
        start = len(self.output)
        self.key(key)
        self.wait(lambda frame: b"\x1b[2J" in self.output[start:] and marker in frame)

    def resize(self, columns):
        fcntl.ioctl(self.slave, termios.TIOCSWINSZ, struct.pack("HHHH", 14, columns, 0, 0))
        os.kill(self.proc.pid, signal.SIGWINCH)

    def worker(self):
        path = pathlib.Path("/proc/%d/task/%d/children" % (self.proc.pid, self.proc.pid))
        if path.exists():
            for value in path.read_text().split():
                command = pathlib.Path("/proc/%s/cmdline" % value)
                if command.exists() and b"--internal-render-worker" in command.read_bytes():
                    return int(value)
        return None

    def finish(self, status=0):
        actual = self.proc.wait(timeout=3)
        assert actual == status, (actual, self.output[-6000:])
        self.drain(0)
        assert termios.tcgetattr(self.slave) == self.before, "terminal flags were not restored"
        assert b"Raw mode is not supported" not in self.output

    def close(self):
        if self.proc.poll() is None:
            self.proc.kill()
            self.proc.wait(timeout=3)
        if self.proc.stdin and not self.proc.stdin.closed:
            self.proc.stdin.close()
        os.close(self.master)
        os.close(self.slave)


with tempfile.TemporaryDirectory(prefix="mdview-terminal-") as directory:
    config = pathlib.Path(directory) / "missing.yml"
    file = pathlib.Path(directory) / "source.md"
    document = "# PIPE_TITLE\n\nq j G 界 🙂 LITERAL_DATA\n\n" + "\n\n".join("BODY_%02d" % n for n in range(40)) + "\n\nTAIL_MARKER\n"
    file.write_text(document, encoding="utf-8")

    for args in [[], ["-"]]:
        session = Session(args, config)
        try:
            session.wait(lambda frame: "q quit" in frame)
            encoded = document.encode()
            split = encoded.index("界".encode()) + 1
            session.write(encoded[:split])
            session.consumed()
            session.write(encoded[split:split + 1])
            session.consumed()
            session.write(encoded[split + 1:])
            session.eof()
            session.wait(lambda frame: "PIPE_TITLE" in frame and "q j G 界 🙂 LITERAL_DATA" in frame)
            session.navigate("G", "TAIL_MARKER")
            session.navigate("g", "LITERAL_DATA")
            session.key("q")
            session.finish()
            RESULTS.append({"case": "piped stdin " + repr(args), "splitUnicode": True, "navigation": True, "rawRestored": True})
        finally:
            session.close()

    with file.open("rb") as document_file:
        session = Session(["-"], config, input_file=document_file)
        try:
            session.wait(lambda frame: "LITERAL_DATA" in frame and "q quit" in frame)
            session.key("q")
            session.finish()
            RESULTS.append({"case": "redirected file stdin with controlling tty", "interactive": True})
        finally:
            session.close()

    session = Session(["-"], config, controlling=False)
    try:
        session.write(document.encode())
        session.eof()
        session.wait(lambda frame: "TAIL_MARKER" in frame)
        session.finish()
        assert "q quit" not in session.frame()
        assert session.frame().count("LITERAL_DATA") == 1
        RESULTS.append({"case": "new session without controlling tty", "plainFallback": True})
    finally:
        session.close()

    session = Session(["-"], config)
    try:
        session.write(b"# Producer still open\n")
        session.wait(lambda frame: "q quit" in frame and "Loading stdin" in frame)
        session.key("q")
        # Keep the document writer open until after successful child exit.
        session.finish()
        RESULTS.append({"case": "q before producer EOF", "exitCode": 0})
    finally:
        session.close()

    for terminal_stdin in [True, False]:
        session = Session([str(file), "--no-watch"], config, terminal_stdin=terminal_stdin)
        try:
            if not terminal_stdin:
                session.write(b"IGNORED_PIPE_DATA q j G\n")
            session.wait(lambda frame: "LITERAL_DATA" in frame and "q quit" in frame)
            assert "IGNORED_PIPE_DATA" not in session.frame()
            session.navigate("G", "TAIL_MARKER")
            session.key("q")
            session.finish()
            RESULTS.append({"case": "explicit file with " + ("TTY" if terminal_stdin else "pipe") + " stdin", "interactive": True})
        finally:
            session.close()

    class Handler(http.server.BaseHTTPRequestHandler):
        def do_GET(self):
            body = b"# URL_TITLE\n\nEXPLICIT_URL_BODY\n"
            self.send_response(200)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *_args):
            pass

    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        session = Session(["http://127.0.0.1:%d/doc" % server.server_port], config)
        try:
            session.write(b"IGNORED_PIPE_DATA\n")
            session.wait(lambda frame: "EXPLICIT_URL_BODY" in frame and "q quit" in frame)
            assert "IGNORED_PIPE_DATA" not in session.frame()
            session.key("q")
            session.finish()
            RESULTS.append({"case": "explicit URL with pipe stdin", "interactive": True})
        finally:
            session.close()
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=3)

    session = Session(["-"], config, terminal_stdin=True)
    try:
        session.key("# CANONICAL_TITLE\n\nCANONICAL_BODY\n")
        session.key("\x04")
        session.wait(lambda frame: "CANONICAL_BODY" in frame)
        session.finish()
        assert "q quit" not in session.frame()
        RESULTS.append({"case": "explicit dash with terminal stdin", "canonicalPlain": True})
    finally:
        session.close()

    session = Session([str(file), "--no-watch"], config)
    try:
        session.wait(lambda frame: "LITERAL_DATA" in frame and "q quit" in frame)
        session.key("\x03")
        session.finish()
        RESULTS.append({"case": "Ctrl+C keyboard quit", "exitCode": 0, "rawRestored": True})
    finally:
        session.close()

    session = Session([], config, fixture="test/fixtures/terminal-fd.ts")
    try:
        session.wait(lambda frame: "FD_OWNERSHIP_OK" in frame)
        session.finish()
        RESULTS.append({"case": "Node fd ownership and reuse", "originalClosedOnce": True, "replacementPreserved": True})
    finally:
        session.close()

    if shutil.which("bun"):
        for args in [["-"], [str(file), "--no-watch"]]:
            session = Session(args, config, runtime=shutil.which("bun"))
            try:
                session.write(document.encode() if args == ["-"] else b"IGNORED_PIPE_DATA")
                if args == ["-"]:
                    session.eof()
                session.wait(lambda frame: "TAIL_MARKER" in frame)
                session.finish()
                assert "q quit" not in session.frame()
                assert "IGNORED_PIPE_DATA" not in session.frame()
                assert session.frame().count("LITERAL_DATA") == 1
                RESULTS.append({"case": "Bun nonTTY stdin " + repr(args), "plainFallback": True})
            finally:
                session.close()

        session = Session([str(file), "--no-watch"], config, terminal_stdin=True, runtime=shutil.which("bun"))
        try:
            session.wait(lambda frame: "LITERAL_DATA" in frame and "q quit" in frame)
            session.navigate("G", "TAIL_MARKER")
            session.key("q")
            session.finish()
            RESULTS.append({"case": "Bun borrowed terminal stdin", "interactive": True, "quitExit": 0})
        finally:
            session.close()

    # This heap setting bounds the Node test harness. It is not a product limit.
    expensive = ("| cell " * 500 + "|\n") + ("|---" * 500 + "|\n") + ("| cell " * 500 + "|\n") * 300
    runtimes = [NODE] + ([shutil.which("bun")] if shutil.which("bun") else []) + ([BINARY] if BINARY else [])
    for runtime in runtimes:
        file.write_text("# LAST_GOOD\n\n" + "Safe content " * 20, encoding="utf-8")
        session = Session([str(file), "--refresh", "20ms"], config, terminal_stdin=True, runtime=runtime)
        try:
            session.wait(lambda frame: "# LAST_GOOD" in frame)
            file.write_text("# HOSTILE_TITLE\n\n" + "> " * 2000 + "Hostile body", encoding="utf-8")
            session.wait(lambda frame: "Markdown nesting exceeds" in frame)
            assert "LAST_GOOD" in session.frame() and "HOSTILE_TITLE" not in session.frame()
            session.resize(40)
            session.wait(lambda frame: "Markdown nesting exceeds" in frame and frame.count("Safe content") > 4)
            assert "LAST_GOOD" in session.frame() and "HOSTILE_TITLE" not in session.frame()
            file.write_text("# RECOVERED\n\nHealthy reload", encoding="utf-8")
            session.wait(lambda frame: "# RECOVERED" in frame and "Healthy reload" in frame)
            assert "Markdown nesting exceeds" not in session.frame()
            previous = session.worker()
            assert previous, "persistent worker was not found"
            def cpu_ticks(pid):
                path = pathlib.Path("/proc/%d/stat" % pid)
                return sum(map(int, path.read_text().split()[13:15])) if path.exists() else 0
            before_ticks = cpu_ticks(previous)
            file.write_text(expensive, encoding="utf-8")
            session.wait(lambda frame: cpu_ticks(previous) >= before_ticks + 5)
            busy = previous
            session.resize(60)
            shutdown_start = len(session.output)
            session.key("q")
            session.finish()
            assert not pathlib.Path("/proc/%d" % busy).exists(), "render child survived quit"
            assert b"\x1b[?25h" in session.output[shutdown_start:], "cursor was not restored on shutdown"
            RESULTS.append({"case": "render reload/resize/busy quit " + pathlib.Path(runtime).name, "lastGood": True, "childReaped": True, "rawRestored": True})
        finally:
            session.close()

        file.write_text("# SIGNAL_READY\n\nReady before expensive reload", encoding="utf-8")
        session = Session([str(file), "--refresh", "20ms"], config, terminal_stdin=True, runtime=runtime)
        try:
            session.wait(lambda frame: "# SIGNAL_READY" in frame)
            busy = session.worker()
            assert busy, "persistent worker was not found"
            before_ticks = cpu_ticks(busy)
            file.write_text(expensive, encoding="utf-8")
            session.wait(lambda frame: cpu_ticks(busy) >= before_ticks + 5)
            shutdown_start = len(session.output)
            os.kill(session.proc.pid, signal.SIGTERM)
            session.finish(status=143)
            assert not pathlib.Path("/proc/%d" % busy).exists(), "render child survived SIGTERM"
            assert b"\x1b[?25h" in session.output[shutdown_start:], "cursor was not restored on shutdown"
            RESULTS.append({"case": "SIGTERM during render " + pathlib.Path(runtime).name, "childReaped": True, "rawRestored": True})
        finally:
            session.close()
    file.write_text(document, encoding="utf-8")

    session = Session([], config, terminal_stdin=True)
    try:
        session.wait(lambda frame: "Usage:" in frame)
        session.finish(status=1)
        RESULTS.append({"case": "no source with terminal stdin", "helpExit": 1})
    finally:
        session.close()

    session = Session([], config, fixture="test/fixtures/terminal-error.tsx")
    try:
        session.wait(lambda frame: "LIFECYCLE_ERROR: Injected initial mount failure" in frame)
        session.finish(status=1)
        RESULTS.append({"case": "initial Ink mount error", "exitCode": 1, "rawRestored": True})
    finally:
        session.close()

    for args, expected in [([], "PIPE_TITLE"), ([str(file)], "PIPE_TITLE")]:
        result = subprocess.run(
            [NODE, "--max-old-space-size=128", "--import", "tsx", "src/main.ts", *args, "--config", str(config)],
            cwd=ROOT, env=ENV, input=document.encode() if not args else b"IGNORED_PIPE_DATA",
            capture_output=True, timeout=5,
        )
        assert result.returncode == 0, result.stderr
        assert expected.encode() in result.stdout and b"q quit" not in result.stdout
        assert b"IGNORED_PIPE_DATA" not in result.stdout
        assert len(result.stdout) < 1_000_000
        RESULTS.append({"case": "redirected stdout " + repr(args), "plain": True})

print(json.dumps(RESULTS))
