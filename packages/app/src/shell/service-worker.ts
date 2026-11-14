import { DEVICE_SCRIPT } from "./service-worker-device.ts";
import { PUSH_SCRIPT } from "./service-worker-push.ts";
import { SERVE_SCRIPT } from "./service-worker-serve.ts";
import { SYNC_SCRIPT } from "./service-worker-sync.ts";

/** Tag of the periodic background sync the page registers where the browser offers it. */
export const PERIODIC_SYNC_TAG = "storyshelf-offline-sync";

/**
 * The listeners: everything outside `/offline` passes straight to the network, and a failed
 * navigation answers with the offline home page. `message` is the page's small API (keep, unkeep,
 * sync, usage, set-cap). `fromStorybook` only skips clients whose URL looks like a Storybook; it is
 * a convenience, not a guard. In `trusted` mode uploaded code runs on the app origin and can reach
 * Cache Storage and IndexedDB directly, so the cache is not a boundary between projects (ADR 0048,
 * amendment 2026-11-11). Offline Storybooks are therefore off outside `trusted` mode, and the sync
 * endpoint says so.
 */
const LISTENERS_SCRIPT = `
function fromStorybook(client){
  if(!client||!client.url){ return false; }
  var path=new URL(client.url).pathname;
  return path.indexOf('/offline/')===0||path.indexOf('/storybook/')>=0||path.indexOf('/_')===0;
}
self.addEventListener('install',function(){ self.skipWaiting(); });
self.addEventListener('activate',function(event){ event.waitUntil(self.clients.claim()); });
self.addEventListener('periodicsync',function(event){
  if(event.tag==='${PERIODIC_SYNC_TAG}'){ event.waitUntil(exclusive(function(){ return runSync(null); }).catch(function(){})); }
});
self.addEventListener('message',function(event){
  if(fromStorybook(event.source)){ return; }
  var port=event.ports&&event.ports[0];
  function reply(value){ if(port){ port.postMessage(value); } else if(event.source){ event.source.postMessage(value); } }
  event.waitUntil(handleMessage(event.data).then(reply,function(){ reply({ok:false,error:'failed'}); }));
});
self.addEventListener('fetch',function(event){
  var request=event.request;
  var url=new URL(request.url);
  if(url.origin===self.location.origin&&(url.pathname==='/offline'||url.pathname.indexOf('/offline/')===0)){
    if(request.method!=='GET'&&request.method!=='HEAD'){
      event.respondWith(new Response('Method not allowed',{status:405,headers:{allow:'GET, HEAD'}}));
      return;
    }
    event.respondWith(serveOffline(url));
    return;
  }
  if(request.method==='POST'&&url.origin===self.location.origin&&url.pathname==='/auth/logout'){
    event.respondWith(signOut(request));
    return;
  }
  var pass=fetch(request);
  if(request.mode!=='navigate'){ event.respondWith(pass); return; }
  event.respondWith(pass.catch(function(){ return homePage(503); }));
});
`;

/**
 * The app's one service worker (ADR 0048, decision 2). Three jobs only: serve opted-in Storybooks
 * at `/offline/<slug>/` from Cache Storage, show the offline home page, and show push
 * notifications (`service-worker-push.ts`). App HTML, `/api/v1` answers, session state and CSRF tokens are never cached.
 */
export function serviceWorkerScript(): string {
  return `(function(){${DEVICE_SCRIPT}${SYNC_SCRIPT}${SERVE_SCRIPT}${PUSH_SCRIPT}${LISTENERS_SCRIPT}})();`;
}
