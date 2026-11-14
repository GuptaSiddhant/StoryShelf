import { MIME_TYPES } from "@storyshelf/core/utils";

/**
 * The worker's device state (ADR 0048, decision 3), as a script fragment. Project choices, the cap
 * and sync times live in one IndexedDB record; file bytes live in Cache Storage under their content
 * hash. The server stores none of it. Only `/offline` paths and the `/__offline/content/` keys ever
 * reach Cache Storage: app HTML and `/api/v1` answers never do.
 */
export const DEVICE_SCRIPT = `
var DB_NAME='storyshelf-offline';
var CACHE_NAME='storyshelf-offline-content-v1';
var DAY_MS=86400000;
var DEFAULT_CAP=500*1024*1024;
var MAX_KEPT=100;
var MIME=${JSON.stringify(MIME_TYPES)};
function mimeOf(path){
  var dot=path.lastIndexOf('.');
  var ext=dot<0?'':path.slice(dot).toLowerCase();
  return Object.prototype.hasOwnProperty.call(MIME,ext)?MIME[ext]:'application/octet-stream';
}
function contentKey(hash){ return self.location.origin+'/__offline/content/'+hash; }
function openDb(){
  return new Promise(function(resolve,reject){
    var request=indexedDB.open(DB_NAME,1);
    request.onupgradeneeded=function(){ request.result.createObjectStore('kv'); };
    request.onsuccess=function(){ resolve(request.result); };
    request.onerror=function(){ reject(request.error); };
  });
}
function idb(mode,use){
  return openDb().then(function(db){
    return new Promise(function(resolve,reject){
      var tx=db.transaction('kv',mode);
      var request=use(tx.objectStore('kv'));
      tx.oncomplete=function(){ db.close(); resolve(request.result); };
      tx.onerror=function(){ db.close(); reject(tx.error); };
      tx.onabort=function(){ db.close(); reject(tx.error); };
    });
  });
}
function emptyState(){ return {projects:{},capBytes:DEFAULT_CAP}; }
function loadState(){
  return idb('readonly',function(store){ return store.get('state'); }).then(function(state){
    return state||emptyState();
  });
}
function saveState(state){
  return idb('readwrite',function(store){ return store.put(state,'state'); });
}
function unionBytes(sizeMaps){
  var seen={};
  var total=0;
  sizeMaps.forEach(function(sizes){
    Object.keys(sizes).forEach(function(hash){
      if(!seen[hash]){ seen[hash]=true; total+=sizes[hash]; }
    });
  });
  return total;
}
function sizesExcept(projects,skip){
  return Object.keys(projects).filter(function(slug){ return slug!==skip; })
    .map(function(slug){ return projects[slug].sizes; });
}
function usedBytes(state){ return unionBytes(sizesExcept(state.projects,null)); }
function isExpired(project,now){
  var at=Date.parse(project.syncedAt);
  return isNaN(at)||now-at>project.maxOfflineDays*DAY_MS;
}
function collect(state){
  var live={};
  Object.keys(state.projects).forEach(function(slug){
    Object.keys(state.projects[slug].sizes).forEach(function(hash){ live[contentKey(hash)]=true; });
  });
  return caches.open(CACHE_NAME).then(function(cache){
    return cache.keys().then(function(keys){
      return Promise.all(keys.filter(function(key){ return !live[key.url]; })
        .map(function(key){ return cache.delete(key); }));
    });
  });
}
function clearAll(){
  return caches.delete(CACHE_NAME).then(function(){ return saveState(emptyState()); });
}
`;
