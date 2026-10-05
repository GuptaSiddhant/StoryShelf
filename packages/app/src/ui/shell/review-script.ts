/**
 * Review workspace behavior: comparison modes, zoom, synchronized scrolling,
 * list filters, keyboard review, and the shortcuts dialog. Runs inside the
 * shell's once-only closure (`inits`, `shell` are in scope).
 */
export function reviewScript(): string {
  return [stateHelpers(), stageSetup(), clickControls(), keyboardShortcuts()].join("\n");
}

/** Mode/zoom state on the stage root, remembered across snapshots. */
function stateHelpers(): string {
  return `
    var MODES=['split','swipe','onion','diff','flip'];
    var ZOOMS=['fit','100','200'];
    function remember(key,value){ try{ localStorage.setItem(key,value); }catch(_){} }
    function recall(key){ try{ return localStorage.getItem(key); }catch(_){ return null; } }
    function press(group,value){
      if(!group) return;
      group.querySelectorAll('[data-view-value]').forEach(function(b){
        b.setAttribute('aria-pressed', b.getAttribute('data-view-value')===value ? 'true' : 'false');
      });
    }
    function setMode(stage,mode,persist){
      stage.setAttribute('data-view',mode);
      press(stage.querySelector('[data-compare-mode]'),mode);
      if(persist) remember('ss_compare_mode',mode);
    }
    function setZoom(stage,zoom,persist){
      stage.setAttribute('data-zoom',zoom);
      press(stage.querySelector('[data-compare-zoom]'),zoom);
      if(persist) remember('ss_compare_zoom',zoom);
    }
    function flip(stage){
      stage.setAttribute('data-flip', stage.getAttribute('data-flip')==='baseline' ? 'current' : 'baseline');
    }
    function nextZoom(stage){
      var cur=stage.getAttribute('data-zoom')||'fit';
      setZoom(stage,ZOOMS[(ZOOMS.indexOf(cur)+1)%ZOOMS.length],true);
    }`;
}

/** Per-render wiring of a freshly swapped-in comparison stage. */
function stageSetup(): string {
  return `
    function syncScroll(stage){
      var panes=Array.from(stage.querySelectorAll('.stage__pane'));
      var lock=false;
      panes.forEach(function(pane){
        pane.addEventListener('scroll',function(){
          if(lock) return;
          lock=true;
          panes.forEach(function(other){
            if(other!==pane){ other.scrollTop=pane.scrollTop; other.scrollLeft=pane.scrollLeft; }
          });
          requestAnimationFrame(function(){ lock=false; });
        });
      });
    }
    function bindRange(stage,selector,prop,scale){
      var input=stage.querySelector(selector);
      if(!input) return;
      input.addEventListener('input',function(){ stage.style.setProperty(prop,String(input.value*scale)+(scale===1?'%':'')); });
    }
    function initStage(stage){
      if(stage.getAttribute('data-ready')) return;
      stage.setAttribute('data-ready','1');
      var mode=recall('ss_compare_mode');
      if(MODES.indexOf(mode)>-1) setMode(stage,mode,false);
      var zoom=recall('ss_compare_zoom');
      if(ZOOMS.indexOf(zoom)>-1) setZoom(stage,zoom,false);
      bindRange(stage,'[data-compare-swipe]','--swipe',1);
      bindRange(stage,'[data-compare-onion]','--onion',0.01);
      var grid=stage.querySelector('.stage__grid');
      if(grid){ grid.addEventListener('click',function(){ if(stage.getAttribute('data-view')==='flip'){ flip(stage); } }); }
      syncScroll(stage);
    }
    inits.push(function(){ document.querySelectorAll('[data-compare]').forEach(initStage); });`;
}

/** Delegated clicks: mode/zoom/filter segments and the shortcuts button. */
function clickControls(): string {
  return `
    function openShortcuts(){
      var dialog=document.querySelector('dialog[data-shortcuts]');
      if(dialog&&typeof dialog.showModal==='function'&&!dialog.open){ dialog.showModal(); }
    }
    function chooseSegment(btn){
      var value=btn.getAttribute('data-view-value');
      var stage=btn.closest('[data-compare]');
      if(stage&&btn.closest('[data-compare-mode]')){ setMode(stage,value,true); }
      else if(stage&&btn.closest('[data-compare-zoom]')){ setZoom(stage,value,true); }
      else if(btn.closest('[data-filter-switch]')){
        var list=document.querySelector('[data-diff-nav]');
        if(list){ list.setAttribute('data-filter',value); }
        press(btn.closest('[data-filter-switch]'),value);
      }
    }
    document.addEventListener('click',function(e){
      var t=e.target instanceof Element ? e.target : null;
      if(!t) return;
      var btn=t.closest('[data-view-value]');
      if(btn){ chooseSegment(btn); }
      if(t.closest('[data-shortcuts-open]')){ openShortcuts(); }
    });`;
}

/** Global review shortcuts; ignored while typing or with modifier keys held. */
function keyboardShortcuts(): string {
  return `
    function typing(target){
      return target instanceof HTMLElement &&
        (target.tagName==='INPUT'||target.tagName==='TEXTAREA'||target.tagName==='SELECT'||target.isContentEditable);
    }
    function press1(selector){
      var el=document.querySelector(selector);
      if(el&&!el.disabled){ el.click(); return true; }
      return false;
    }
    function handleKey(key,stage){
      if(key==='j'||key==='ArrowRight') return press1('[data-snap-next]');
      if(key==='k'||key==='ArrowLeft') return press1('[data-snap-prev]');
      if(key==='a'||key==='A') return press1('[data-approve]');
      if(key==='r'||key==='R') return press1('[data-reject]');
      if(key>='1'&&key<='5'){ setMode(stage,MODES[Number(key)-1],true); return true; }
      if(key==='f'){ nextZoom(stage); return true; }
      if(key==='t'){
        if(stage.getAttribute('data-view')==='flip'){ flip(stage); } else { setMode(stage,'flip',true); }
        return true;
      }
      if(key==='?'){ openShortcuts(); return true; }
      return false;
    }
    document.addEventListener('keydown',function(e){
      if(e.metaKey||e.ctrlKey||e.altKey||typing(e.target)) return;
      var stage=document.querySelector('[data-compare]');
      if(!stage||document.querySelector('dialog[open]')) return;
      if(handleKey(e.key,stage)){ e.preventDefault(); }
    });`;
}
