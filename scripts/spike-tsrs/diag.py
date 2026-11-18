import json,os,subprocess,sys,glob,re
REPO="/home/user/StoryShelf";label=sys.argv[1];out=f"{sys.argv[2]}/{label}-diag";os.makedirs(out,exist_ok=True)
env=dict(os.environ);env["PATH"]=f"{REPO}/node_modules/.bin:{os.path.expanduser('~/.nub/bin')}:"+env["PATH"]
for pj in sorted(glob.glob(f"{REPO}/packages/*/package.json")+glob.glob(f"{REPO}/apps/*/package.json")):
    d=os.path.dirname(pj);s=json.load(open(pj)).get("scripts",{})
    if "lint" not in s: continue
    cmd=re.sub(r"\boxlint\b","oxlint -f json",s["lint"])
    r=subprocess.run(["sh","-c",cmd],cwd=d,env=env,capture_output=True,text=True)
    open(f"{out}/{os.path.relpath(d,REPO).replace('/','_')}.json","w").write(r.stdout)
    open(f"{out}/{os.path.relpath(d,REPO).replace('/','_')}.err","w").write(r.stderr)
    print(os.path.relpath(d,REPO),r.returncode,len(r.stdout))
