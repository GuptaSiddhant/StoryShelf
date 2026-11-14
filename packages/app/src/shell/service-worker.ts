/**
 * The app's one service worker (ADR 0048, decision 2). For now it only passes every request to the
 * network and, when a navigation fails, answers with an inline offline placeholder. It caches
 * nothing: app HTML, `/api/v1` answers, session state and CSRF tokens never reach Cache Storage.
 */
export function serviceWorkerScript(): string {
  return `
  (function(){
    var offlineHtml='<!doctype html><html lang="en"><head><meta charset="utf-8">'+
      '<meta name="viewport" content="width=device-width,initial-scale=1">'+
      '<title>Offline</title></head><body><h1>You are offline</h1>'+
      '<p>StoryShelf needs a network connection. Try again when you are back online.</p></body></html>';
    self.addEventListener('install',function(){ self.skipWaiting(); });
    self.addEventListener('activate',function(event){ event.waitUntil(self.clients.claim()); });
    self.addEventListener('fetch',function(event){
      var request=event.request;
      var pass=fetch(request);
      if(request.mode!=='navigate'){ event.respondWith(pass); return; }
      event.respondWith(pass.catch(function(){
        return new Response(offlineHtml,{
          status:503,
          headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store'}
        });
      }));
    });
  })();
  `.trim();
}
