import json,glob,os,sys,collections
R=sys.argv[1]
def load(label):
    out=collections.defaultdict(set); counts=collections.Counter()
    for f in sorted(glob.glob(f"{R}/{label}-diag/*.json")):
        pkg=os.path.basename(f)[:-5]; txt=open(f).read().strip()
        dec=json.JSONDecoder(); i=0
        while i<len(txt):
            while i<len(txt) and txt[i].isspace(): i+=1
            if i>=len(txt): break
            try: obj,j=dec.raw_decode(txt,i)
            except ValueError: print("unparsable",f); break
            i=j
            for d in obj.get("diagnostics",[]):
                lab=(d.get("labels") or [{}])[0].get("span",{})
                key=(pkg,d.get("filename"),d.get("code"),lab.get("line"),lab.get("column"),d.get("message"),d.get("severity"))
                out[pkg].add(key); counts[(pkg,d.get("severity"))]+=1
    return out,counts
A,ca=load("A");B,cb=load("B");C,cc=load("C")
def tot(c): 
    t=collections.Counter()
    for (p,s),n in c.items(): t[s]+=n
    return dict(t)
print("totals A",tot(ca),"B",tot(cb),"C",tot(cc))
def diff(X,Y,nx,ny):
    only_x=[];only_y=[]
    for p in sorted(set(X)|set(Y)):
        only_x+=sorted(X[p]-Y[p]);only_y+=sorted(Y[p]-X[p])
    print(f"\n== only in {nx}: {len(only_x)}; only in {ny}: {len(only_y)}")
    for nm,l in ((nx,only_x),(ny,only_y)):
        c=collections.Counter((k[2],k[6]) for k in l)
        print(f"  only {nm} by rule:",dict(c))
    return only_x,only_y
diff(A,B,"A","B");ox,oy=diff(B,C,"B(tsgolint)","C(tsrs)")
for nm,l in (("B-only",ox),("C-only",oy)):
    print("\n"+nm)
    for k in l[:40]: print("  ",k[0],k[1],k[2],f"{k[3]}:{k[4]}",k[6],"|",(k[5] or "")[:110])
