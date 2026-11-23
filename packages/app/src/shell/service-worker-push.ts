/**
 * The worker's push half (ADR 0048, decision 4): show a notification for each push, open only
 * same-origin pages when one is clicked, and drop this device's push subscription on sign-out.
 */

/** Header the worker adds to the sign-out request with the endpoint it just unsubscribed. */
export const PUSH_ENDPOINT_HEADER = "x-push-endpoint";

/**
 * A push always shows something (browsers revoke permission from a worker that receives pushes and
 * shows nothing), so a payload that cannot be read still shows a generic notification. The link is
 * a path of the app: `clickTarget` resolves it against the worker's own origin and refuses any other
 * origin, whatever the payload held, so a notification can never open a foreign site.
 */
export const PUSH_SCRIPT = `
function clickTarget(data){
  var link=data&&data.url;
  if(link===undefined||link===null||link===''){ return self.location.origin+'/'; }
  if(typeof link!=='string'){ return null; }
  try{
    var url=new URL(link,self.location.origin);
    return url.origin===self.location.origin&&(url.protocol==='https:'||url.protocol==='http:')?url.href:null;
  }catch(_){ return null; }
}
function pushPayload(event){
  try{ return event.data?event.data.json():null; }catch(_){ return null; }
}
self.addEventListener('push',function(event){
  var payload=pushPayload(event)||{};
  var title=typeof payload.title==='string'&&payload.title?payload.title:'StoryShelf';
  var body=typeof payload.body==='string'?payload.body:'';
  event.waitUntil(self.registration.showNotification(title,{body:body,data:{url:payload.url}}));
});
self.addEventListener('notificationclick',function(event){
  event.notification.close();
  var target=clickTarget(event.notification.data);
  if(target===null){ return; }
  event.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(function(list){
    for(var i=0;i<list.length;i++){
      if(list[i].url===target&&typeof list[i].focus==='function'){ return list[i].focus(); }
    }
    return self.clients.openWindow(target);
  }));
});
function signOut(request){
  var manager=self.registration&&self.registration.pushManager;
  if(!manager){ return fetch(request); }
  return manager.getSubscription().then(function(sub){
    if(!sub){ return fetch(request); }
    var endpoint=sub.endpoint;
    return sub.unsubscribe().catch(function(){}).then(function(){
      var headers=new Headers(request.headers);
      headers.set('${PUSH_ENDPOINT_HEADER}',endpoint);
      return fetch(new Request(request,{headers:headers}));
    });
  },function(){ return fetch(request); });
}
`;
