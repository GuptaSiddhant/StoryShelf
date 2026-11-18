import json,sys,statistics as st,collections
rows=[json.loads(l) for l in open(sys.argv[1])]
g=collections.OrderedDict()
for r in rows: g.setdefault(r["name"],[]).append(r)
tw=0;mx=0
print("| item | wall median s (min–max) | peak RSS median MB | exit |")
print("|---|---|---|---|")
for n,v in g.items():
    w=[x["wall"] for x in v];m=[x["rss_mb"] for x in v]
    print(f"| {n} | {st.median(w):.2f} ({min(w):.2f}–{max(w):.2f}) | {st.median(m):.0f} | {','.join(str(x['exit']) for x in v)} |")
    if n.startswith(("packages","apps")): tw+=st.median(w); mx=max(mx,st.median(m))
print(f"\nsum of per-package median walls: {tw:.1f}s; max per-package peak RSS: {mx:.0f} MB")
