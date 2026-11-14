import { DARK_THEME, LIGHT_THEME, type BrandTheme } from "../ui/theme.ts";

function tokens(theme: BrandTheme): string {
  return [
    `--bg:${theme.surface.base}`,
    `--card:${theme.surface.card}`,
    `--text:${theme.text.primary}`,
    `--text2:${theme.text.secondary}`,
    `--border:${theme.border}`,
    `--accent:${theme.accent}`,
    `--warn:${theme.status.new}`,
  ].join(";");
}

/**
 * The offline home page's styles, inlined: the page is static and its CSP allows only inline
 * styles, so it carries the default theme's tokens (light, and dark by `prefers-color-scheme`).
 */
const HOME_CSS = `:root{${tokens(LIGHT_THEME)}}
@media (prefers-color-scheme:dark){:root{${tokens(DARK_THEME)}}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:16px/1.5 system-ui,sans-serif}
main{max-width:40rem;margin:0 auto;padding:1.5rem 16px}
h1{font-size:1.4rem;margin:.5rem 0}
.lead,.meta,.note,.empty{color:var(--text2)}
.banner{display:inline-block;margin:0;padding:.25rem .75rem;border:1px solid var(--warn);border-radius:999px;color:var(--warn);font-size:.85rem;font-weight:600}
.list{list-style:none;margin:1.5rem 0 0;padding:0;display:grid;gap:.75rem}
.item{background:var(--card);border:1px solid var(--border);border-radius:.5rem}
.item a,.item.expired{display:grid;gap:.15rem;padding:.9rem 1rem;color:inherit;text-decoration:none}
.item a:hover,.item a:focus-visible{outline:2px solid var(--accent)}
.name{font-weight:600}
.meta,.note{font-size:.85rem}
.empty{margin-top:1.5rem;padding:1rem;border:1px dashed var(--border);border-radius:.5rem}
`;

/**
 * What the worker answers under `/offline` (ADR 0048, decision 3), as a script fragment: the static
 * offline home page and kept Storybook files, only ever from Cache Storage. A file answer carries
 * its content type, `nosniff` and `no-store`, and never a sandbox header (amendment 2026-11-11). A
 * project is not served once `maxOfflineDays` have passed since its last successful sync.
 */
export const SERVE_SCRIPT = `
var HOME_CSS=${JSON.stringify(HOME_CSS)};
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
function formatSynced(iso){
  var at=new Date(iso);
  return isNaN(at.getTime())?'unknown':at.toLocaleString();
}
function projectItem(slug,project,now){
  var meta='<span class="meta">'+escapeHtml(project.commit.slice(0,7))+' &middot; synced '+
    escapeHtml(formatSynced(project.syncedAt))+'</span>';
  var name='<span class="name">'+escapeHtml(project.name)+'</span>';
  return isExpired(project,now)
    ?'<li class="item expired">'+name+meta+'<span class="note">Expired. Go online to sync.</span></li>'
    :'<li class="item"><a href="/offline/'+encodeURIComponent(slug)+'/">'+name+meta+'</a></li>';
}
function homePage(status){
  return loadState().then(function(state){
    var now=Date.now();
    var items=Object.keys(state.projects).sort().map(function(slug){
      return projectItem(slug,state.projects[slug],now);
    });
    var list=items.length>0?'<ul class="list">'+items.join('')+'</ul>'
      :'<p class="empty">No Storybooks are kept on this device. Keep one from <em>Profile &rsaquo; This device</em> while online.</p>';
    var body='<!doctype html><html lang="en"><head><meta charset="utf-8">'+
      '<meta name="viewport" content="width=device-width,initial-scale=1">'+
      '<meta name="color-scheme" content="light dark">'+
      '<title>Offline &middot; StoryShelf</title><style>'+HOME_CSS+'</style></head><body><main>'+
      '<p class="banner" role="status">You are offline</p>'+
      '<h1>Storybooks on this device</h1>'+
      '<p class="lead">StoryShelf needs a network connection. These default-branch Storybooks work without one.</p>'+
      list+'</main></body></html>';
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
