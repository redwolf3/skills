#!/usr/bin/env python3
"""Coordination helper for ai-review-loop local mode (stdlib only).

Files live in <main-worktree>/.scratch/peer-review/<branch-slug>/ :
  peer-review-feedback-<id>-<count>-<epoch>.md             (reviewer writes)
  peer-review-feedback-<id>-<count>-<epoch>-response.md    (developer writes)
A file is complete when its last non-blank line is exactly <eom>.

Subcommands: dir | init | next | pending | wait-response | wait-head | done | status  (see --help).
"""
import argparse
import hashlib
import re
import subprocess
import sys
import time
from pathlib import Path

EOM = "<eom>"
DONE = "session-done"
NAME = re.compile(
    r"^peer-review-feedback-(?P<id>[a-z0-9][a-z0-9-]*)-(?P<count>\d{2})-(?P<epoch>\d{10})"
    r"(?P<resp>-response)?\.md$"
)
ID_OK = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")


def git(*args):
    r = subprocess.run(["git", *args], capture_output=True, text=True)
    return r.stdout.strip() if r.returncode == 0 else ""


def resolve_dir(a):
    if a.dir:
        return Path(a.dir)
    branch = a.branch or git("rev-parse", "--abbrev-ref", "HEAD")
    if not branch or branch == "HEAD":
        sys.exit("error: cannot determine branch; pass --branch or --dir")
    common = git("rev-parse", "--path-format=absolute", "--git-common-dir")
    root = Path(common).parent if common else Path.cwd()
    # readable prefix + digest of the exact name, so "a/b" and "a__b" never share a folder
    slug = re.sub(r"[^A-Za-z0-9._-]+", "__", branch) + "-" + hashlib.sha1(branch.encode()).hexdigest()[:8]
    return root / ".scratch" / "peer-review" / slug


class Entry:
    def __init__(self, path, m):
        self.path = path
        self.id = m["id"]
        self.count = int(m["count"])
        self.epoch = int(m["epoch"])

    @property
    def response(self):
        return self.path.with_name(self.path.stem + "-response.md")

    @property
    def key(self):
        return (self.epoch, self.id, self.count)


def feedbacks(d):
    out = []
    if d.is_dir():
        for p in d.iterdir():
            m = NAME.match(p.name)
            if m and not m["resp"]:
                out.append(Entry(p, m))
    return sorted(out, key=lambda e: e.key)


def complete(p):
    try:
        lines = [l.strip() for l in p.read_text(encoding="utf-8").splitlines() if l.strip()]
    except (OSError, UnicodeDecodeError):  # unreadable or mid-character write: not final yet
        return False
    return bool(lines) and lines[-1] == EOM


def state(e):
    if not complete(e.path):
        return "writing"
    if not e.response.exists():
        return "pending"
    return "answered" if complete(e.response) else "in-progress"


def header(p):
    """Leading metadata block only (up to the first blank line); first occurrence wins."""
    h = {}
    try:
        text = p.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        return h
    for line in text.splitlines():
        if not line.strip():
            if h:
                break
            continue
        m = re.match(r"^(Verdict|Reviewed-commit):\s*(\S+)", line, re.I)
        if m:
            h.setdefault(m[1].lower(), m[2].lower())
    return h


def poll(fn, wait, timeout, interval):
    deadline = time.monotonic() + timeout if timeout > 0 else None
    while True:
        r = fn()
        if r is not None or not wait:
            return r
        if deadline is not None and time.monotonic() >= deadline:
            return None
        time.sleep(interval)


def cmd_dir(a):
    print(resolve_dir(a))


def cmd_next(a):
    if not ID_OK.match(a.id):
        sys.exit("error: --id must match [a-z0-9]+(-[a-z0-9]+)* (tool-model-persona-session)")
    d = resolve_dir(a)
    d.mkdir(parents=True, exist_ok=True)
    count = max([e.count for e in feedbacks(d) if e.id == a.id], default=0) + 1
    if count > 99:
        sys.exit("error: count overflow")
    p = d / f"peer-review-feedback-{a.id}-{count:02d}-{int(time.time())}.md"
    with open(p, "x"):  # claim the name; empty file = "writing"
        pass
    print(p)


def resolve_head(a):
    branch = getattr(a, "branch", None) or git("rev-parse", "--abbrev-ref", "HEAD")
    return git("rev-parse", branch) if branch and branch != "HEAD" else ""


def branch_head(a):
    sha = resolve_head(a)
    if not sha:
        sys.exit("error: cannot resolve branch head; pass --branch")
    return sha


def cmd_init(a):
    d = resolve_dir(a)
    d.mkdir(parents=True, exist_ok=True)
    old = [p for p in d.iterdir() if p.is_file() and (NAME.match(p.name) or p.name == DONE)]
    if old:
        arch = d / f"archive-{int(time.time())}"
        arch.mkdir(exist_ok=True)
        for p in old:
            p.rename(arch / p.name)
    print(f"{d}\tarchived={len(old)}")


def cmd_done(a):
    d = resolve_dir(a)
    d.mkdir(parents=True, exist_ok=True)
    (d / DONE).write_text("session finished\n", encoding="utf-8")
    print(d / DONE)


def cmd_wait_head(a):
    d = resolve_dir(a)

    def changed():
        if (d / DONE).exists():
            return "done"
        sha = branch_head(a)
        return sha if not (sha.startswith(a.since) or a.since.startswith(sha)) else None

    r = poll(changed, True, a.timeout, a.interval)
    if r is None:
        sys.exit(2)
    if r == "done":
        sys.exit(3)
    print(r)


def find_pending(d, stale_after):
    for e in feedbacks(d):
        st = state(e)
        if st == "answered":
            continue
        if st == "writing":
            if time.time() - e.path.stat().st_mtime < stale_after:
                return None  # older feedback still being written blocks newer
            print(f"warning: skipping stale unfinished {e.path.name}", file=sys.stderr)
            continue
        return st, e.path
    return None


def cmd_pending(a):
    d = resolve_dir(a)
    r = poll(lambda: find_pending(d, a.stale_after), a.wait, a.timeout, a.interval)
    if r is None:
        sys.exit(2 if a.wait else 1)
    print(f"{r[0]}\t{r[1]}")


def cmd_wait_response(a):
    fb = Path(a.feedback)
    m = NAME.match(fb.name)
    if not m or m["resp"]:
        sys.exit("error: --feedback must be a feedback file (not a response)")
    resp = fb.with_name(fb.stem + "-response.md")
    d = fb.resolve().parent  # the session folder is wherever the feedback lives

    def ready():
        if (d / DONE).exists():
            return "done"
        return resp if complete(resp) else None

    r = poll(ready, True, a.timeout, a.interval)
    if r is None:
        sys.exit(2)
    if r == "done":
        sys.exit(3)
    print(r)


def cmd_status(a):
    d = resolve_dir(a)
    head = (a.head or resolve_head(a)).lower()
    if not head:
        print("error: cannot determine the current head; pass --head <sha> or --branch", file=sys.stderr)
        print("GATE not-ready")
        sys.exit(1)
    latest = {}
    for e in feedbacks(d):
        cur = latest.get(e.id)
        if cur is None or (e.count, e.epoch) > (cur.count, cur.epoch):
            latest[e.id] = e
    ids = sorted(set(latest) | set(a.expect.split(",") if a.expect else []))
    ready = bool(ids)
    for i in ids:
        e = latest.get(i)
        if e is None:
            print(f"{i}\tmissing\tblocked")
            ready = False
            continue
        st = state(e)
        h = header(e.path) if st != "writing" else {}
        verdict, commit = h.get("verdict", "-"), h.get("reviewed-commit", "-")
        why = ""
        if st == "writing":
            why = "review-in-progress"
        elif verdict != "no-open-issues":
            why = "cap-reached" if e.count >= a.max_rounds else verdict
        elif not (commit.startswith(head) or head.startswith(commit)):
            why = "cap-reached-stale" if e.count >= a.max_rounds else "stale-commit"
        ok = not why
        ready &= ok
        print(f"{i}\tround={e.count:02d}/{a.max_rounds:02d}\t{st}\tverdict={verdict}\tcommit={commit}\t"
              f"{'ok' if ok else 'blocked:' + why}")
    print("GATE " + ("ready" if ready else "not-ready"))
    sys.exit(0 if ready else 1)


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--dir", help="exchange folder (default: .scratch/peer-review/<branch-slug>)")
    p.add_argument("--branch", help="branch name (default: current branch)")
    common = argparse.ArgumentParser(add_help=False)
    common.add_argument("--dir", default=argparse.SUPPRESS, help=argparse.SUPPRESS)
    common.add_argument("--branch", default=argparse.SUPPRESS, help=argparse.SUPPRESS)
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("dir", parents=[common], help="print the exchange folder").set_defaults(f=cmd_dir)
    s = sub.add_parser("next", parents=[common], help="reviewer: claim the next feedback file name and print its path")
    s.add_argument("--id", required=True)
    s.set_defaults(f=cmd_next)
    s = sub.add_parser("pending", parents=[common], help="developer: oldest complete, unanswered feedback ('<state>\\t<path>')")
    s.add_argument("--wait", action="store_true", help="poll until one exists (exit 2 on timeout)")
    s.add_argument("--timeout", type=int, default=0, help="seconds; 0 = forever")
    s.add_argument("--interval", type=float, default=5)
    s.add_argument("--stale-after", type=int, default=900,
                   help="seconds before an unfinished older file stops blocking newer ones")
    s.set_defaults(f=cmd_pending)
    s = sub.add_parser("wait-response", parents=[common], help="reviewer: block until the response to --feedback is complete")
    s.add_argument("--feedback", required=True)
    s.add_argument("--timeout", type=int, default=0)
    s.add_argument("--interval", type=float, default=5)
    s.set_defaults(f=cmd_wait_response)
    s = sub.add_parser("init", parents=[common], help="developer: start a session; archive any previous session's files and done marker")
    s.set_defaults(f=cmd_init)
    s = sub.add_parser("done", parents=[common], help="developer: mark the session finished so waiting reviewers stop")
    s.set_defaults(f=cmd_done)
    s = sub.add_parser("wait-head", parents=[common], help="reviewer: block until the branch head differs from --since "
                                       "(exit 0 prints new head, 2 timeout, 3 session done)")
    s.add_argument("--since", required=True, help="sha the last review used")
    s.add_argument("--timeout", type=int, default=0)
    s.add_argument("--interval", type=float, default=5)
    s.set_defaults(f=cmd_wait_head)
    s = sub.add_parser("status", parents=[common], help="per-reviewer state and merge-gate readiness (exit 0 = ready)")
    s.add_argument("--head", help="current head sha (default: head of the branch); clean verdicts must be at this commit")
    s.add_argument("--expect", help="comma-separated reviewer ids that must have reported")
    s.add_argument("--max-rounds", type=int, default=5)
    s.set_defaults(f=cmd_status)
    a = p.parse_args()
    a.f(a)


if __name__ == "__main__":
    main()
