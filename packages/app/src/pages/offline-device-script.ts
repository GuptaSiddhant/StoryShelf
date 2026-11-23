/**
 * The page side of the offline message API (ADR 0048, decision 3), shared by the device page and
 * the Library's "Keep offline" button. Everything goes through the service worker: `keep`,
 * `unkeep`, `sync`, `set-cap` and `usage`. Nothing here touches app HTML or `/api/v1` answers.
 * The page asks for persistent storage before it keeps anything (`persist()` is Window-only).
 */
const SCRIPT = `(function(){
  if(window.__ssOffline){ window.__ssOffline.scan(); return; }
  var CAP_ERRORS={cap:'It would pass the storage cap.',limit:'Too many projects are kept on this device.',
    download:'The download failed. Try again.',offline:'You are offline.','signed-out':'You are signed out.',
    unavailable:'This project is not available offline.','hosting-mode':'Offline Storybooks are unavailable here.'};
  function worker(){
    if(!('serviceWorker' in navigator)){ return Promise.reject(new Error('unsupported')); }
    return navigator.serviceWorker.ready.then(function(reg){ return reg.active; });
  }
  function send(message){
    return worker().then(function(active){
      return new Promise(function(resolve,reject){
        var channel=new MessageChannel();
        channel.port1.onmessage=function(event){ resolve(event.data); };
        setTimeout(function(){ reject(new Error('timeout')); },120000);
        active.postMessage(message,[channel.port2]);
      });
    });
  }
  function bytes(n){
    if(n<1024){ return n+' B'; }
    var units=['KB','MB','GB'];
    var v=n/1024; var u=0;
    while(v>=1024&&u<units.length-1){ v/=1024; u++; }
    return v.toFixed(v>=100?0:1)+' '+units[u];
  }
  function text(root,name,value){
    root.querySelectorAll('['+name+']').forEach(function(el){ el.textContent=value; });
  }
  function paint(usage){
    var kept={};
    usage.projects.forEach(function(p){ kept[p.slug]=p; });
    document.querySelectorAll('[data-offline-keep]').forEach(function(btn){
      var p=kept[btn.getAttribute('data-offline-keep')];
      btn.setAttribute('data-offline-state',p?'kept':'idle');
      var label=btn.querySelector('[data-offline-label]')||btn;
      label.textContent=p?(btn.getAttribute('data-kept-label')||'Kept offline'):(btn.getAttribute('data-idle-label')||'Keep offline');
    });
    document.querySelectorAll('[data-offline-row]').forEach(function(row){
      var p=kept[row.getAttribute('data-offline-row')];
      text(row,'data-offline-size',p?bytes(p.size):'—');
      text(row,'data-offline-synced',p?new Date(p.syncedAt).toLocaleString():'Not kept');
      text(row,'data-offline-status',p?(p.expired?'Expired, go online to sync':'Kept'):'');
    });
    text(document,'data-offline-used',bytes(usage.usedBytes));
    text(document,'data-offline-cap',bytes(usage.capBytes));
    var bar=document.querySelector('[data-offline-meter] [role=progressbar]');
    if(bar){
      bar.setAttribute('aria-valuemax',String(usage.capBytes));
      bar.setAttribute('aria-valuenow',String(Math.min(usage.usedBytes,usage.capBytes)));
    }
    var select=document.querySelector('#offlineCap');
    if(select){ select.value=String(usage.capBytes); }
    var all=document.querySelector('[data-offline-all]');
    if(all){ all.setAttribute('data-offline-state',document.querySelectorAll('[data-offline-keep][data-offline-state=idle]').length?'idle':'kept'); }
  }
  function say(message){
    document.querySelectorAll('[data-offline-status-line]').forEach(function(el){ el.textContent=message; });
  }
  function failed(result){
    say(result&&result.error==='cap'
      ?CAP_ERRORS.cap+' It needs '+bytes(result.size||0)+' of '+bytes(result.capBytes||0)+'.'
      :(CAP_ERRORS[result&&result.error]||'Something went wrong.'));
  }
  function apply(result){
    if(result.usage){ paint(result.usage); }
    if(!result.ok){ failed(result); return false; }
    say('');
    return true;
  }
  function keepOne(slug){
    var persist=navigator.storage&&navigator.storage.persist?navigator.storage.persist().catch(function(){}):Promise.resolve();
    return persist.then(function(){ return send({type:'keep',slug:slug}); });
  }
  function toggle(btn){
    var slug=btn.getAttribute('data-offline-keep');
    var kept=btn.getAttribute('data-offline-state')==='kept';
    btn.disabled=true; say('Working…');
    (kept?send({type:'unkeep',slug:slug}):keepOne(slug)).then(apply,function(){ say('Offline storage is not available in this browser.'); })
      .then(function(){ btn.disabled=false; });
  }
  function keepAll(btn){
    var slugs=[].map.call(document.querySelectorAll('[data-offline-keep]'),function(el){ return el.getAttribute('data-offline-keep'); });
    btn.disabled=true; say('Working…');
    var chain=Promise.resolve(true);
    slugs.forEach(function(slug){ chain=chain.then(function(ok){ return keepOne(slug).then(function(r){ return apply(r)&&ok; }); }); });
    chain.then(function(){ btn.disabled=false; },function(){ btn.disabled=false; say('Offline storage is not available in this browser.'); });
  }
  function refresh(){ return send({type:'usage'}).then(paint,function(){
    document.querySelectorAll('[data-offline-unsupported]').forEach(function(el){ el.hidden=false; });
  }); }
  document.addEventListener('click',function(event){
    var el=event.target&&event.target.closest?event.target.closest('[data-offline-keep],[data-offline-all],[data-offline-sync],[data-offline-clear]'):null;
    if(!el){ return; }
    event.preventDefault();
    if(el.hasAttribute('data-offline-keep')){ toggle(el); }
    else if(el.hasAttribute('data-offline-all')){ keepAll(el); }
    else if(el.hasAttribute('data-offline-sync')){ el.disabled=true; say('Syncing…'); send({type:'sync'}).then(function(r){ apply(r); el.disabled=false; },function(){ el.disabled=false; say('Could not sync.'); }); }
  });
  document.addEventListener('change',function(event){
    var el=event.target;
    if(el&&el.id==='offlineCap'){
      send({type:'set-cap',bytes:Number(el.value)}).then(apply);
    }
  });
  window.__ssOffline={scan:refresh};
  refresh();
})();`;

/** The inline script text. */
export function offlineDeviceScript(): string {
  return SCRIPT;
}
