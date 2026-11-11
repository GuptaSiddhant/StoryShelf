"""SPIKE (#907): medians and spread from .tmp/times.tsv, plus per-package vitest durations."""
import re, statistics, sys, collections, pathlib

tool = sys.argv[1]
rows = [l.rstrip("\n").split("\t") for l in open(".tmp/times.tsv") if l.strip()]
groups = collections.OrderedDict()
for label, secs, code in rows:
    m = re.match(r"(cold|warm)-\d-(.+)$", label)
    key = f"{m.group(1)} {m.group(2)}" if m else re.sub(r"-\d$", "", label)
    groups.setdefault(key, []).append((float(secs), int(code)))
print(f"## {tool}: times (seconds, default concurrency, website excluded)\n")
print("| run | n | median | min | max | non-zero exits |\n|---|---|---|---|---|---|")
for key, v in groups.items():
    s = [x for x, _ in v]
    print(f"| {key} | {len(s)} | {statistics.median(s):.1f} | {min(s):.1f} | {max(s):.1f} | {sum(1 for _, c in v if c)} |")
for pre in ("cold", "warm"):
    stages = [k for k in groups if k.startswith(pre) and not k.endswith("graph")]
    if stages:
        runs = max(len(groups[k]) for k in stages)
        tot = [sum(groups[k][i][0] for k in stages if i < len(groups[k])) for i in range(runs)]
        print(f"\n{pre} stage series total per run: {', '.join(f'{t:.0f}' for t in tot)} (median {statistics.median(tot):.0f})")
print("\n### db-postgres alone\n")
for i in (1, 2, 3):
    p = pathlib.Path(f".tmp/logs/pg-{i}.log")
    t = p.read_text(errors="replace") if p.exists() else ""
    print(f"- run {i}: SIGTRAP lines: {len(re.findall('SIGTRAP', t))}; {'passed' if re.search(r'Test Files .*passed', t) and 'failed' not in ''.join(re.findall(r'Test Files.*', t)) else 'FAILED'}")
print("\n### per-package vitest duration (one cold test run)\n")
log = pathlib.Path(".tmp/logs/pkgtimes-test.log").read_text(errors="replace")
log = re.sub(r"\x1b\[[0-9;]*m", "", log)
cur, out = None, []
for line in log.splitlines():
    m = re.match(r"^(@?[\w/.-]+):test: ", line) or re.match(r"^~?/?([\w/.-]+)\$ vp test", line)
    if m:
        cur = m.group(1)
    d = re.search(r"Duration\s+([\d.]+)s", line)
    if d and cur:
        out.append((cur, float(d.group(1))))
for name, secs in sorted(out, key=lambda x: -x[1]):
    print(f"- {name}: {secs:.1f}s")
for pre in ("cold", "warm"):
    for key in groups:
        pass
