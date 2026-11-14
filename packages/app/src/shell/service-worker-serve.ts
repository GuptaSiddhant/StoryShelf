/**
 * What the worker answers under `/offline` (ADR 0048, decision 3), as a script fragment: the static
 * offline home page and kept Storybook files, only ever from Cache Storage. A file answer carries
 * its content type, `nosniff` and `no-store`, and never a sandbox header (amendment 2026-11-11). A
 * project is not served once `maxOfflineDays` have passed since its last successful sync.
 */
export const SERVE_SCRIPT = `
function escapeHtml(text){
  return String(text).replace(/[&<>"']/g,function(ch){
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch];
  });
}
var PAGE_HEADERS={
  'content-type':'text/html; charset=utf-8',
  'cache-control':'no-store',
  'x-content-type-options':'nosniff',
  'content-security-policy':"default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'"
};
function homePage(status){
  return loadState().then(function(state){
    var now=Date.now();
    var items=Object.keys(state.projects).sort().map(function(slug){
      var project=state.projects[slug];
      var label=escapeHtml(project.name)+' <small>'+escapeHtml(project.commit.slice(0,7))+
        ', synced '+escapeHtml(project.syncedAt)+'</small>';
      return isExpired(project,now)
        ?'<li>'+label+' &mdash; expired, go online to sync</li>'
        :'<li><a href="/offline/'+encodeURIComponent(slug)+'/">'+label+'</a></li>';
    });
    var body='<!doctype html><html lang="en"><head><meta charset="utf-8">'+
      '<meta name="viewport" content="width=device-width,initial-scale=1">'+
      '<title>Offline</title></head><body><h1>You are offline</h1>'+
      '<p>StoryShelf needs a network connection. Storybooks kept on this device:</p>'+
      (items.length>0?'<ul>'+items.join('')+'</ul>':'<p>None.</p>')+'</body></html>';
    return new Response(body,{status:status,headers:PAGE_HEADERS});
  });
}
function notFound(){
  return new Response('Not found',{status:404,headers:{
    'content-type':'text/plain; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'
  }});
}
function relativePath(rest){
  var decoded;
  try{ decoded=decodeURIComponent(rest); }catch(error){ return null; }
  if(decoded===''||decoded.slice(-1)==='/'){ decoded+='index.html'; }
  var safe=decoded.split('/').every(function(segment){
    return segment!==''&&segment!=='.'&&segment!=='..'&&segment.indexOf('\\\\')<0&&segment.indexOf('\\0')<0;
  });
  return safe?decoded:null;
}
function serveFile(project,path){
  var hash=project.files[path];
  if(!hash){ return Promise.resolve(notFound()); }
  return caches.open(CACHE_NAME).then(function(cache){ return cache.match(contentKey(hash)); })
    .then(function(found){
      if(!found){ return notFound(); }
      return found.arrayBuffer().then(function(bytes){
        return new Response(bytes,{status:200,headers:{
          'content-type':mimeOf(path),'cache-control':'no-store',
          'x-content-type-options':'nosniff','etag':'"'+hash+'"'
        }});
      });
    });
}
function serveOffline(url){
  var rest=url.pathname.slice('/offline'.length);
  if(rest===''||rest==='/'){ return homePage(200); }
  var slash=rest.indexOf('/',1);
  if(slash<0){ return Promise.resolve(Response.redirect(url.origin+url.pathname+'/'+url.search,308)); }
  var slug;
  try{ slug=decodeURIComponent(rest.slice(1,slash)); }catch(error){ return Promise.resolve(notFound()); }
  var path=relativePath(rest.slice(slash+1));
  if(path===null){ return Promise.resolve(notFound()); }
  return loadState().then(function(state){
    var project=Object.prototype.hasOwnProperty.call(state.projects,slug)?state.projects[slug]:null;
    if(!project||isExpired(project,Date.now())){ return notFound(); }
    return serveFile(project,path);
  });
}
`;
