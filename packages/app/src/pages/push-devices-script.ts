/**
 * The page side of web push (ADR 0048, decision 4). Permission is asked only on the click of
 * "Enable push on this device", never on load. The id of this browser's registered device is kept
 * in localStorage so the page can tell which listed device is this one. Keys and endpoints never
 * reach the page: the server lists only id, label and times.
 */
const SCRIPT = `(function(){
  var root=document.querySelector('[data-push]');
  if(!root||root.__ssPush){ return; }
  root.__ssPush=true;
  var KEY='ss-push-device';
  function stored(){ try{ return localStorage.getItem(KEY); }catch(_){ return null; } }
  function store(id){ try{ if(id){ localStorage.setItem(KEY,id); } else { localStorage.removeItem(KEY); } }catch(_){} }
  function show(state){
    root.setAttribute('data-push-state',state);
    root.querySelectorAll('[data-push-when]').forEach(function(el){ el.hidden=el.getAttribute('data-push-when')!==state; });
  }
  function say(message){ var el=root.querySelector('[data-push-status]'); if(el){ el.textContent=message; } }
  function supported(){ return 'serviceWorker' in navigator&&'PushManager' in window&&'Notification' in window; }
  function registration(){ return navigator.serviceWorker.ready; }
  function known(id){ return !!id&&!!root.querySelector('[data-push-device="'+id+'"]'); }
  function bytes(base64){
    var pad='='.repeat((4-base64.length%4)%4);
    var raw=atob((base64+pad).replace(/-/g,'+').replace(/_/g,'/'));
    var out=new Uint8Array(raw.length);
    for(var i=0;i<raw.length;i++){ out[i]=raw.charCodeAt(i); }
    return out;
  }
  function api(method,path,body){
    return fetch(path,{method:method,credentials:'same-origin',headers:body?{'content-type':'application/json'}:{},body:body?JSON.stringify(body):undefined});
  }
  function refresh(){
    if(!supported()){ show('unsupported'); return Promise.resolve(); }
    if(Notification.permission==='denied'){ show('denied'); return Promise.resolve(); }
    return registration().then(function(reg){ return reg.pushManager.getSubscription(); }).then(function(sub){
      show(sub&&known(stored())?'enabled':'idle');
    },function(){ show('unsupported'); });
  }
  function enable(btn){
    btn.disabled=true; say('Working…');
    Notification.requestPermission().then(function(permission){
      if(permission!=='granted'){ show(permission==='denied'?'denied':'idle'); say(''); return null; }
      return api('GET','/api/v1/push/public-key').then(function(res){
        if(!res.ok){ throw new Error('key'); }
        return res.json();
      }).then(function(key){
        return registration().then(function(reg){
          return reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:bytes(key.publicKey)});
        });
      }).then(function(sub){
        var json=sub.toJSON();
        var input=root.querySelector('#pushLabel');
        var label=input&&input.value?input.value.trim().slice(0,100):'';
        return api('POST','/api/v1/me/push-subscriptions',{endpoint:json.endpoint,keys:json.keys,label:label||undefined});
      }).then(function(res){
        if(!res.ok){ throw new Error('register'); }
        return res.json();
      }).then(function(device){ store(device.id); location.reload(); });
    }).catch(function(){ say('Could not enable push on this device. Try again.'); })
      .then(function(){ btn.disabled=false; });
  }
  function forgetLocal(){
    if(!supported()){ return Promise.resolve(); }
    return registration().then(function(reg){ return reg.pushManager.getSubscription(); })
      .then(function(sub){ return sub?sub.unsubscribe():null; }).catch(function(){});
  }
  function remove(btn){
    var id=btn.getAttribute('data-push-remove');
    btn.disabled=true; say('Working…');
    var local=id===stored()?forgetLocal():Promise.resolve();
    local.then(function(){ return api('DELETE','/api/v1/me/push-subscriptions/'+encodeURIComponent(id)); }).then(function(res){
      if(!res.ok&&res.status!==404){ throw new Error('remove'); }
      if(id===stored()){ store(null); }
      location.reload();
    }).catch(function(){ btn.disabled=false; say('Could not remove the device. Try again.'); });
  }
  root.addEventListener('click',function(event){
    var el=event.target&&event.target.closest?event.target.closest('[data-push-enable],[data-push-remove]'):null;
    if(!el){ return; }
    event.preventDefault();
    if(el.hasAttribute('data-push-enable')){ enable(el); } else { remove(el); }
  });
  var mine=stored();
  if(mine){
    var row=root.querySelector('[data-push-device="'+mine+'"]');
    if(row){ row.setAttribute('data-push-this','true'); var tag=row.querySelector('[data-push-this-tag]'); if(tag){ tag.hidden=false; } }
  }
  refresh();
})();`;

/** The inline script text. */
export function pushDevicesScript(): string {
  return SCRIPT;
}
