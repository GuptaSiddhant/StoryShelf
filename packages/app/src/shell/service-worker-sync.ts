/**
 * The worker's sync and message API (ADR 0048, decision 3), as a script fragment. It asks
 * `GET /api/v1/offline` about the kept projects, downloads only the content hashes the device lacks,
 * refuses what would pass the cap, drops projects the answer leaves out and deletes hashes no kept
 * project refers to. Nothing is ever evicted silently. A refused update leaves the kept copy and its
 * sync time alone. `navigator.storage.persist()` is Window-only, so the page asks for persistence
 * before it sends `keep`.
 */
export const SYNC_SCRIPT = `
var chain=Promise.resolve();
function exclusive(job){
  var run=chain.then(function(){ return job(); });
  chain=run.catch(function(){});
  return run;
}
function fetchAnswer(slugs){
  var query=slugs.map(encodeURIComponent).join(',');
  return fetch('/api/v1/offline?projects='+query,{
    credentials:'same-origin',redirect:'manual',headers:{accept:'application/json'}
  }).then(function(res){
    if(res.status===401||res.status===403){ return {signedOut:true}; }
    if(!res.ok){ throw new Error('offline sync answered '+res.status); }
    return res.json();
  });
}
function sha256Hex(buffer){
  return crypto.subtle.digest('SHA-256',buffer).then(function(digest){
    return Array.prototype.map.call(new Uint8Array(digest),function(byte){
      return (byte<16?'0':'')+byte.toString(16);
    }).join('');
  });
}
function download(project,path,hash){
  var url='/projects/'+encodeURIComponent(project.slug)+'/storybook/build/'+
    encodeURIComponent(project.buildId)+'/'+path.split('/').map(encodeURIComponent).join('/');
  return fetch(url,{credentials:'same-origin',redirect:'error'}).then(function(res){
    if(!res.ok){ throw new Error('download answered '+res.status); }
    return res.arrayBuffer();
  }).then(function(buffer){
    return sha256Hex(buffer).then(function(actual){
      if(actual!==hash){ throw new Error('content hash mismatch'); }
      return caches.open(CACHE_NAME).then(function(cache){
        return cache.put(contentKey(hash),new Response(buffer,{
          headers:{'content-type':mimeOf(path)}
        }));
      });
    });
  });
}
function missingHashes(sizes){
  return caches.open(CACHE_NAME).then(function(cache){
    var hashes=Object.keys(sizes);
    return Promise.all(hashes.map(function(hash){ return cache.match(contentKey(hash)); }))
      .then(function(found){ return hashes.filter(function(hash,at){ return !found[at]; }); });
  });
}
function downloadAll(project,files,missing){
  var firstPath={};
  Object.keys(files).forEach(function(path){ if(!firstPath[files[path]]){ firstPath[files[path]]=path; } });
  var queue=missing.slice();
  var failed=false;
  var reason=null;
  function lane(){
    var hash=failed?undefined:queue.pop();
    if(hash===undefined){ return Promise.resolve(); }
    return download(project,firstPath[hash],hash).then(lane,function(error){
      if(!failed){ failed=true; reason=error; }
    });
  }
  return Promise.all([lane(),lane(),lane(),lane(),lane(),lane()]).then(function(){
    if(failed){ throw reason; }
  });
}
function applyProject(state,project){
  var old=state.projects[project.slug];
  var files={};
  var sizes={};
  project.entries.forEach(function(entry){ files[entry.path]=entry.hash; sizes[entry.hash]=entry.size; });
  var others=sizesExcept(state.projects,project.slug);
  var projected=unionBytes(others.concat([sizes]));
  return missingHashes(sizes).then(function(missing){
    var adds=missing.length>0||!old||old.buildId!==project.buildId;
    if(adds&&projected>state.capBytes){
      return {ok:false,error:'cap',size:projected-unionBytes(others),capBytes:state.capBytes};
    }
    return downloadAll(project,files,missing).then(function(){
      state.projects[project.slug]={
        name:project.name,buildId:project.buildId,commit:project.commit,files:files,sizes:sizes,
        syncedAt:new Date().toISOString(),maxOfflineDays:project.maxOfflineDays
      };
      return {ok:true};
    },function(){ return {ok:false,error:'download'}; });
  });
}
function runSync(extra){
  return loadState().then(function(state){
    var ask=Object.keys(state.projects);
    if(extra&&ask.indexOf(extra)<0){ ask.push(extra); }
    if(ask.length===0){ return {ok:true,results:{}}; }
    return fetchAnswer(ask).then(function(answer){
      if(answer.signedOut){ return clearAll().then(function(){ return {ok:false,error:'signed-out'}; }); }
      return settle(state,ask,answer.projects,extra);
    },function(){ return {ok:false,error:'offline'}; });
  });
}
function settle(state,ask,projects,extra){
  var results={};
  var answered={};
  projects.forEach(function(project){ answered[project.slug]=project; });
  ask.forEach(function(slug){
    if(!answered[slug]){ delete state.projects[slug]; results[slug]={ok:false,error:'unavailable'}; }
  });
  var step=Promise.resolve();
  projects.forEach(function(project){
    step=step.then(function(){ return applyProject(state,project); }).then(function(result){
      results[project.slug]=result;
      return saveState(state);
    });
  });
  return step.then(function(){ return saveState(state); }).then(function(){ return collect(state); })
    .then(function(){ return {ok:true,results:results,extra:extra}; });
}
function usage(){
  return loadState().then(function(state){
    var now=Date.now();
    return {
      usedBytes:usedBytes(state),capBytes:state.capBytes,
      projects:Object.keys(state.projects).sort().map(function(slug){
        var project=state.projects[slug];
        return {
          slug:slug,name:project.name,commit:project.commit,buildId:project.buildId,
          size:unionBytes([project.sizes]),syncedAt:project.syncedAt,
          expired:isExpired(project,now)
        };
      })
    };
  });
}
function keepProject(slug){
  return loadState().then(function(state){
    if(!state.projects[slug]&&Object.keys(state.projects).length>=MAX_KEPT){ return {ok:false,error:'limit'}; }
    return exclusive(function(){ return runSync(slug); }).then(function(sync){
      if(!sync.ok){ return sync; }
      return sync.results[slug]||{ok:false,error:'unavailable'};
    });
  });
}
function unkeepProject(slug){
  return exclusive(function(){
    return loadState().then(function(state){
      delete state.projects[slug];
      return saveState(state).then(function(){ return collect(state); });
    }).then(function(){ return {ok:true}; });
  });
}
function setCap(bytes){
  if(typeof bytes!=='number'||!isFinite(bytes)||bytes<=0){ return Promise.resolve({ok:false,error:'invalid'}); }
  return exclusive(function(){
    return loadState().then(function(state){ state.capBytes=Math.floor(bytes); return saveState(state); });
  }).then(function(){ return {ok:true}; });
}
function handleMessage(data){
  var type=data&&data.type;
  var slug=data&&typeof data.slug==='string'&&data.slug!==''&&data.slug.indexOf(',')<0?data.slug:null;
  var action=Promise.resolve({ok:true});
  if(type==='keep'){ action=slug?keepProject(slug):Promise.resolve({ok:false,error:'invalid'}); }
  else if(type==='unkeep'){ action=slug?unkeepProject(slug):Promise.resolve({ok:false,error:'invalid'}); }
  else if(type==='sync'){ action=exclusive(function(){ return runSync(null); }); }
  else if(type==='set-cap'){ action=setCap(data.bytes); }
  else if(type!=='usage'){ action=Promise.resolve({ok:false,error:'unknown'}); }
  return action.then(function(result){
    return usage().then(function(now){ result.usage=now; return result; });
  });
}
`;
