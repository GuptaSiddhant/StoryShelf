#!/usr/bin/env python3
"""Time commands and sample the peak total RSS of their whole process tree.

usage: measure.py <label> <out.jsonl> <runs> <mode>
  mode = pkgs   : each workspace package's `lint` script (cwd = package dir)
  mode = files  : root `lint:files`
  mode = turbo  : `nubx turbo lint --force` for the repo
  mode = hook   : the pre-commit hook on a staged change (see HOOK_FILES)
"""
import json, os, subprocess, sys, time, glob

REPO = os.environ.get("MEASURE_REPO", "/home/user/StoryShelf")
ENV = dict(os.environ)
ENV["PATH"] = f"{REPO}/node_modules/.bin:{os.path.expanduser('~/.nub/bin')}:" + ENV["PATH"]


def tree_rss_kb(root_pid):
    """Sum VmRSS (kB) of root_pid and all its descendants."""
    kids, rss = {}, {}
    for d in os.listdir("/proc"):
        if not d.isdigit():
            continue
        try:
            with open(f"/proc/{d}/stat") as f:
                stat = f.read()
            ppid = int(stat.rsplit(")", 1)[1].split()[1])
            kids.setdefault(ppid, []).append(int(d))
            with open(f"/proc/{d}/status") as f:
                for line in f:
                    if line.startswith("VmRSS:"):
                        rss[int(d)] = int(line.split()[1])
                        break
        except (OSError, ValueError, IndexError):
            continue
    total, stack = 0, [root_pid]
    while stack:
        p = stack.pop()
        total += rss.get(p, 0)
        stack.extend(kids.get(p, []))
    return total


def run(cmd, cwd, log_path=None):
    t0 = time.monotonic()
    out = open(log_path, "wb") if log_path else subprocess.DEVNULL
    p = subprocess.Popen(["sh", "-c", cmd], cwd=cwd, env=ENV, stdout=out, stderr=subprocess.STDOUT)
    peak = 0
    while p.poll() is None:
        peak = max(peak, tree_rss_kb(p.pid))
        time.sleep(0.03)
    wall = time.monotonic() - t0
    if log_path:
        out.close()
    return wall, peak / 1024.0, p.returncode


def packages():
    for pj in sorted(glob.glob(f"{REPO}/packages/*/package.json") + glob.glob(f"{REPO}/apps/*/package.json")):
        d = os.path.dirname(pj)
        s = json.load(open(pj)).get("scripts", {})
        if "lint" in s:
            yield os.path.relpath(d, REPO), s["lint"]


def main():
    label, out_path, runs, mode = sys.argv[1], sys.argv[2], int(sys.argv[3]), sys.argv[4]
    logs = os.path.join(os.path.dirname(out_path), f"{label}-logs")
    os.makedirs(logs, exist_ok=True)
    jobs = []
    if mode == "pkgs":
        jobs = [(rel, cmd, f"{REPO}/{rel}") for rel, cmd in packages()]
    elif mode == "files":
        jobs = [("lint:files", "node ./scripts/check-files.mjs", REPO)]
    elif mode == "vpcheck":
        jobs = [("vp-check", "vp check --continue-on-error", REPO)]
    elif mode == "vplint":
        jobs = [("vp-run-lint", "vp run -F '!website' --no-cache lint", REPO)]
    elif mode == "turbo":
        jobs = [("turbo-lint-force", "nubx turbo lint --force --filter='!website'", REPO)]
    for name, cmd, cwd in jobs:
        for i in range(1, runs + 1):
            log = f"{logs}/{name.replace('/', '_').replace(':', '_')}-{i}.log"
            wall, rss, code = run(cmd, cwd, log)
            rec = dict(label=label, name=name, run=i, wall=round(wall, 2), rss_mb=round(rss), exit=code,
                       load=open("/proc/loadavg").read().split()[0])
            with open(out_path, "a") as f:
                f.write(json.dumps(rec) + "\n")
            print(rec, flush=True)


main()
