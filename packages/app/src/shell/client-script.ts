import { iconSpriteHref } from "../ui/icons/sprite.ts";
import { reviewScript } from "./review-script.ts";

/*
 * The page-end script is re-executed whenever HTMX swaps `body` (review
 * navigation does). So it is split in two: listeners are bound ONCE on
 * `document` and look elements up lazily; `inits` are re-run per render for
 * anything that needs wiring to freshly swapped elements.
 */

/** Attach the CSRF token to every HTMX request. */
function csrfPart(): string {
  return `
    document.addEventListener('htmx:configRequest',function(e){
      var meta=document.querySelector('meta[name="csrf-token"]');
      if(meta){ e.detail.headers['x-csrf-token']=meta.getAttribute('content'); }
    });`;
}

/**
 * System page: report the origin the admin opened it with, so a deployment learns its public URL
 * without a redeploy (ADR 0007, decision 6). The server keeps the first report and answers 201 only
 * when it stored a new one, which is when the page reloads to show it.
 */
function originPart(): string {
  return `
    function reportOrigin(){
      var el=document.querySelector('[data-report-origin]');
      if(!el || el.getAttribute('data-reported')) return;
      el.setAttribute('data-reported','1');
      var meta=document.querySelector('meta[name="csrf-token"]');
      fetch(el.getAttribute('data-report-origin'),{
        method:'POST',
        credentials:'same-origin',
        headers:{'content-type':'application/json','x-csrf-token':meta ? meta.getAttribute('content') : ''},
        body:JSON.stringify({origin:location.origin})
      }).then(function(r){ if(r.status===201) location.reload(); }).catch(function(){});
    }
    inits.push(reportOrigin);`;
}

/** Theme menu: apply, persist, and mark the current choice. */
function themePart(): string {
  return `
    function markTheme(){
      var cur=document.documentElement.getAttribute('data-theme')||'system';
      document.querySelectorAll('[data-theme-set]').forEach(function(item){
        item.setAttribute('aria-current', item.getAttribute('data-theme-set')===cur ? 'true' : 'false');
      });
    }
    inits.push(markTheme);
    document.addEventListener('click',function(e){
      var item=e.target instanceof Element ? e.target.closest('[data-theme-set]') : null;
      if(!item) return;
      var next=item.getAttribute('data-theme-set');
      shell.applyTheme(next);
      shell.writeCookie(shell.themeCookie,next);
      markTheme();
    });`;
}

/** Sidebar group folding, remembered per browser; without storage every group stays open. */
function foldPart(): string {
  return `
    var foldKey='storyshelf_nav_folded';
    function readFolded(){
      try{ var v=JSON.parse(localStorage.getItem(foldKey)||'[]'); return Array.isArray(v)?v:[]; }
      catch(_){ return []; }
    }
    function showFolded(id,folded){
      var group=document.querySelector('[data-nav-group="'+id+'"]');
      var head=document.querySelector('[data-nav-fold="'+id+'"]');
      if(group){ if(folded){ group.setAttribute('data-folded',''); } else { group.removeAttribute('data-folded'); } }
      if(head){ head.setAttribute('aria-expanded',folded?'false':'true'); }
    }
    function toggleGroup(id){
      var group=document.querySelector('[data-nav-group="'+id+'"]');
      if(!group) return;
      var folded=!group.hasAttribute('data-folded');
      showFolded(id,folded);
      var list=readFolded().filter(function(x){ return x!==id; });
      if(folded) list.push(id);
      try{ localStorage.setItem(foldKey,JSON.stringify(list)); }catch(_){}
    }
    inits.push(function(){ readFolded().forEach(function(id){ showFolded(id,true); }); });
  `;
}

/** The mobile drawer: focus moves in on open, the page behind is inert, focus returns on close. */
function drawerPart(): string {
  return `
    function syncCollapse(){
      var c=document.querySelector('[data-sidebar-collapse]');
      if(c){ c.setAttribute('aria-expanded',document.documentElement.getAttribute('data-sidebar')==='rail'?'false':'true'); }
    }
    inits.push(syncCollapse);
    function setDrawer(open){
      var sidebar=document.getElementById('sidebar');
      if(!sidebar) return;
      var wasOpen=sidebar.classList.contains('sidebar--open');
      sidebar.classList.toggle('sidebar--open',open);
      // The page behind an open drawer is not reachable by Tab or a screen reader.
      var main=document.querySelector('[data-shell-main]');
      if(main){ if(open){ main.setAttribute('inert',''); } else { main.removeAttribute('inert'); } }
      if(open&&!wasOpen){
        var first=sidebar.querySelector('a[href]');
        if(first) try{ first.focus(); }catch(_){}
      }
      var backdrop=document.querySelector('[data-sidebar-backdrop]');
      if(backdrop){ backdrop.hidden=!open; }
      var btn=document.querySelector('[data-sidebar-toggle]');
      if(btn){ btn.setAttribute('aria-expanded',open?'true':'false'); }
    }`;
}

/** Desktop rail collapse (persisted) and the mobile drawer. */
function sidebarPart(): string {
  return `
    document.addEventListener('click',function(e){
      var t=e.target instanceof Element ? e.target : null;
      if(!t) return;
      if(t.closest('[data-sidebar-toggle]')){
        var sidebar=document.getElementById('sidebar');
        setDrawer(!(sidebar&&sidebar.classList.contains('sidebar--open')));
        if(!(sidebar&&sidebar.classList.contains('sidebar--open'))){
          var tg=t.closest('[data-sidebar-toggle]');
          if(tg) tg.focus();
        }
      } else if(t.closest('[data-sidebar-backdrop]')){
        setDrawer(false);
        var tb=document.querySelector('[data-sidebar-toggle]');
        if(tb) tb.focus();
      } else if(t.closest('[data-nav-fold]')){
        toggleGroup(t.closest('[data-nav-fold]').getAttribute('data-nav-fold'));
      } else if(t.closest('[data-sidebar-collapse]')){
        var next=document.documentElement.getAttribute('data-sidebar')==='rail' ? 'full' : 'rail';
        shell.applySidebar(next);
        shell.writeCookie(shell.sidebarCookie,next);
        syncCollapse();
      }
    });
    document.addEventListener('keydown',function(e){
      var sidebar=document.getElementById('sidebar');
      if(e.key==='Escape'&&sidebar&&sidebar.classList.contains('sidebar--open')){
        setDrawer(false);
        var btn=document.querySelector('[data-sidebar-toggle]');
        if(btn) btn.focus();
      }
    });`;
}

/** Native <details> dropdowns: close on outside click, Escape, or choosing an item. */
function dropdownPart(): string {
  return `
    document.addEventListener('click',function(e){
      var target=e.target instanceof Element ? e.target : null;
      var owner=target ? target.closest('details[data-dropdown]') : null;
      document.querySelectorAll('details[data-dropdown][open]').forEach(function(d){
        if(d!==owner) d.removeAttribute('open');
      });
      if(owner&&target&&target.closest('[role="menuitem"]')){ owner.removeAttribute('open'); }
    });
    document.addEventListener('keydown',function(e){
      if(e.key!=='Escape') return;
      var open=document.querySelector('details[data-dropdown][open]');
      if(!open) return;
      open.removeAttribute('open');
      var summary=open.querySelector('summary');
      if(summary) summary.focus();
    });`;
}

/** Build and show one toast element (text only, never HTML). */
function toastRenderPart(): string {
  return `
    var toastIcons={success:'check-circle',danger:'x-circle',warning:'alert-triangle',info:'info'};
    function toastIcon(tone){
      var ns='http://www.w3.org/2000/svg';
      var svg=document.createElementNS(ns,'svg');
      var attrs={viewBox:'0 0 24 24',width:'18',height:'18','aria-hidden':'true',fill:'none',
        stroke:'currentColor','stroke-width':'2','stroke-linecap':'round','stroke-linejoin':'round'};
      Object.keys(attrs).forEach(function(name){ svg.setAttribute(name,attrs[name]); });
      var use=document.createElementNS(ns,'use');
      use.setAttribute('href','${iconSpriteHref}#i-'+toastIcons[tone]);
      svg.appendChild(use);
      return svg;
    }
    function toast(detail){
      var region=document.querySelector('[data-toast-region]');
      if(!region||!detail||!detail.message) return;
      var tone=toastIcons[detail.tone] ? detail.tone : 'info';
      var el=document.createElement('div');
      el.className='toast';
      el.setAttribute('data-tone',tone);
      el.setAttribute('role',tone==='danger'?'alert':'status');
      var text=document.createElement('span');
      text.textContent=String(detail.message);
      el.appendChild(toastIcon(tone));
      el.appendChild(text);
      region.appendChild(el);
      setTimeout(function(){ el.remove(); },tone==='danger'?8000:4000);
    }`;
}

/**
 * Toasts. Sources: an HX-Trigger(-After-Swap) "showToast" event, and a toast
 * queued in sessionStorage by a form with data-toast (review actions reload
 * or redirect, so the message has to survive the navigation).
 */
function toastPart(): string {
  return `${toastRenderPart()}
    var TOAST_KEY='ss_toast';
    function queueToast(detail){ try{ sessionStorage.setItem(TOAST_KEY,JSON.stringify(detail)); }catch(_){} }
    function clearToast(){ try{ sessionStorage.removeItem(TOAST_KEY); }catch(_){} }
    function flushQueued(){
      try{
        var raw=sessionStorage.getItem(TOAST_KEY);
        if(!raw) return;
        sessionStorage.removeItem(TOAST_KEY);
        toast(JSON.parse(raw));
      }catch(_){}
    }
    function flushFlash(){
      var raw=shell.readCookie('storyshelf_flash');
      if(!raw) return;
      document.cookie='storyshelf_flash=; Path=/; Max-Age=0; SameSite=Lax';
      try{ toast(JSON.parse(raw)); }catch(_){}
    }
    function flushToast(){ flushQueued(); flushFlash(); }
    inits.push(flushToast);
    document.addEventListener('htmx:beforeRequest',function(e){
      var form=e.detail && e.detail.elt && e.detail.elt.closest ? e.detail.elt.closest('[data-toast]') : null;
      if(form){ queueToast({message:form.getAttribute('data-toast'),tone:form.getAttribute('data-toast-tone')||'success'}); }
    });
    function failed(){ clearToast(); toast({message:'Something went wrong. Please try again.',tone:'danger'}); }
    document.addEventListener('htmx:responseError',failed);
    document.addEventListener('htmx:sendError',failed);`;
}

/**
 * Forms and body swaps. HTMX does not swap 4xx responses, but this app answers validation
 * failures with the re-rendered page (400/409/422) so field errors show.
 * \`data-confirm\` asks before submitting plain (non-HTMX) forms.
 */
function formPart(): string {
  return `
    document.addEventListener('htmx:beforeSwap',function(e){
      // A body swap only replaces <body>, so classes first used by the new page
      // would be unstyled: adopt the stylesheet the server collected for it.
      var match=/<style id="storyshelf-css">([\\s\\S]*?)<\\/style>/.exec(e.detail.serverResponse||'');
      var sheet=document.getElementById('storyshelf-css');
      if(match&&sheet&&e.detail.target===document.body){ sheet.textContent=match[1]; }
      var status=e.detail.xhr ? e.detail.xhr.status : 0;
      if(status===400||status===409||status===422){
        e.detail.shouldSwap=true;
        e.detail.isError=false;
        clearToast();
      }
    });
    document.addEventListener('submit',function(e){
      var form=e.target instanceof Element ? e.target.closest('form[data-confirm]') : null;
      if(form&&!window.confirm(form.getAttribute('data-confirm')||'Are you sure?')){ e.preventDefault(); }
    });`;
}

/** Copy buttons: `data-copy` holds the text; confirm with a toast. */
function copyPart(): string {
  return `
    document.addEventListener('click',function(e){
      var btn=e.target instanceof Element ? e.target.closest('[data-copy]') : null;
      if(!btn||!navigator.clipboard) return;
      navigator.clipboard.writeText(btn.getAttribute('data-copy')||'').then(function(){
        toast({message:'Copied to clipboard',tone:'success'});
      },function(){
        toast({message:'Could not copy',tone:'danger'});
      });
    });`;
}

/** Client-side list filtering for `[data-filter-input]` boxes. */
function filterPart(): string {
  return `
    document.addEventListener('input',function(e){
      var input=e.target instanceof Element ? e.target.closest('[data-filter-input]') : null;
      if(!input) return;
      var scope=input.closest('[data-filter-scope]')||document;
      var query=input.value.trim().toLowerCase();
      var shown=0;
      scope.querySelectorAll('[data-filter-item]').forEach(function(item){
        var match=!query||(item.getAttribute('data-filter-text')||'').toLowerCase().indexOf(query)>-1;
        item.hidden=!match;
        if(match) shown++;
      });
      scope.querySelectorAll('[data-filter-empty]').forEach(function(el){ el.hidden=shown>0; });
    });`;
}

/**
 * Click-to-load story previews: move the inert frame out of its template (nothing runs before). A
 * frame under a signed URL first asks for a fresh root, so a page left open for hours does not mount
 * an expired token; it keeps the rendered one when that request fails. Afterwards the root is renewed
 * every `data-preview-refresh-seconds`; a failed renewal is retried a few times a minute apart, and
 * once the last retry failed the page shows a notice with a button to reload the preview now.
 */
function previewPart(): string {
  return `
    document.addEventListener('click',function(e){
      var reload=e.target instanceof Element ? e.target.closest('[data-preview-reload]') : null;
      if(reload){
        var box=reload.closest('[data-preview-wrap]');
        var target=box ? box.querySelector('[data-preview-embed]') : null;
        if(target) reloadPreview(target);
        return;
      }
      var btn=e.target instanceof Element ? e.target.closest('[data-preview-load]') : null;
      var host=btn ? btn.closest('[data-preview-embed]') : null;
      var tpl=host ? host.querySelector('template[data-preview-template]') : null;
      if(!host||!tpl||host.getAttribute('data-preview-loading')) return;
      host.setAttribute('data-preview-loading','1');
      var idle=host.querySelector('[data-preview-idle]');
      var path=host.getAttribute('data-preview-path');
      var fresh=fetchPreviewBase(host).catch(function(){ return null; });
      fresh.then(function(base){
        var content=document.importNode(tpl.content,true);
        var frame=content.querySelector('iframe');
        if(frame&&base&&path) frame.src=base+path;
        if(idle) idle.hidden=true;
        host.appendChild(content);
        tpl.remove();
        keepPreviewFresh(host);
      });
    });`;
}

/** Fetch a fresh signed root for a preview host and keep it renewed (see {@link previewPart}). */
function previewRefreshPart(): string {
  return `
    function fetchPreviewBase(host){
      var url=host.getAttribute('data-preview-refresh-url');
      if(!url) return Promise.resolve(null);
      return fetch(url,{headers:{accept:'application/json'}}).then(function(r){
        if(!r.ok) throw new Error('preview-token');
        return r.json();
      }).then(function(body){ return body&&body.base ? body.base : null; });
    }
    function keepPreviewFresh(host){
      var url=host.getAttribute('data-preview-refresh-url');
      var path=host.getAttribute('data-preview-path');
      var seconds=Number(host.getAttribute('data-preview-refresh-seconds'));
      if(!url||!path||!(seconds>0)) return;
      var RETRY_MS=60000, MAX_RETRIES=3;
      // A manual reload bumps host.__previewGen; an older automatic renewal still in flight then
      // changes neither the frame nor the notice when it settles.
      function renew(tries,gen){
        var frame=host.querySelector('iframe');
        if(!host.isConnected||!frame) return;
        fetchPreviewBase(host).then(function(base){
          if(gen!==(host.__previewGen||0)) return;
          if(!base) throw new Error('preview-token');
          frame.src=base+path;
          showPreviewFailure(host,false);
        }).catch(function(){
          if(gen!==(host.__previewGen||0)) return;
          if(tries<MAX_RETRIES) setTimeout(function(){ renew(tries+1,gen); },RETRY_MS);
          else showPreviewFailure(host,true);
        });
      }
      var timer=setInterval(function(){
        if(!host.isConnected||!host.querySelector('iframe')){ clearInterval(timer); return; }
        renew(0,host.__previewGen||0);
      },seconds*1000);
    }`;
}

/** The notice a signed preview shows after its last failed renewal, and its reload button. */
function previewNoticePart(): string {
  return `
    function previewNotes(host){
      var wrap=host.closest('[data-preview-wrap]');
      if(!wrap) return null;
      return {
        notice: wrap.querySelector('[data-preview-notice]'),
        disclosure: wrap.querySelector('[data-preview-disclosure]'),
        button: wrap.querySelector('[data-preview-reload]'),
        again: wrap.querySelector('[data-preview-again]')
      };
    }
    function showPreviewFailure(host,failed){
      var notes=previewNotes(host);
      if(!notes||!notes.notice||!notes.disclosure) return;
      notes.notice.hidden=!failed;
      notes.disclosure.hidden=failed;
      if(!failed&&notes.again) notes.again.hidden=true;
    }
    function reloadPreview(host){
      var notes=previewNotes(host);
      var frame=host.querySelector('iframe');
      var path=host.getAttribute('data-preview-path');
      if(!notes||!notes.button||!notes.notice||!frame||!path) return;
      var label=notes.button.textContent;
      host.__previewGen=(host.__previewGen||0)+1;
      notes.button.disabled=true;
      notes.button.textContent='Reloading\u2026';
      notes.notice.setAttribute('aria-busy','true');
      fetchPreviewBase(host).then(function(base){
        if(!base) throw new Error('preview-token');
        frame.src=base+path;
        showPreviewFailure(host,false);
        frame.focus();
      }).catch(function(){
        if(notes.again) notes.again.hidden=false;
      }).then(function(){
        notes.button.disabled=false;
        notes.button.textContent=label;
        notes.notice.removeAttribute('aria-busy');
      });
    }`;
}

/** Thin top progress bar while an HTMX request (e.g. snapshot navigation) is in flight. */
function loadingPart(): string {
  return `
    var pending=0;
    function setLoading(delta){
      pending=Math.max(0,pending+delta);
      document.documentElement.classList.toggle('ss-loading',pending>0);
    }
    document.addEventListener('htmx:beforeRequest',function(){ setLoading(1); });
    document.addEventListener('htmx:afterRequest',function(){ setLoading(-1); });`;
}

/** Keep keyboard focus sensible after HTMX swaps. */
function focusPart(): string {
  return `
    document.addEventListener('htmx:afterSwap',function(e){
      var target=e.detail && e.detail.target;
      if(target===document.body){
        // A whole-page swap (review verdict, next snapshot, a failed sign-in) drops the focused
        // element: put focus on the page's main heading so keyboard and screen-reader users stay.
        var heading=document.querySelector('[data-focus-heading]') || document.querySelector('main h1');
        if(heading){
          if(!heading.hasAttribute('tabindex')) heading.setAttribute('tabindex','-1');
          try{ heading.focus({preventScroll:true}); }catch(_){}
        }
        return;
      }
      if(target&&target.querySelector&&target!==document.body){
        var focusable=target.querySelector('[autofocus], input, select, textarea, button');
        if(focusable) try{ focusable.focus(); }catch(_){}
      }
    });
    // A text box swapped in with its text filled (the comment box after an @mention is chosen) is
    // focused by htmx, but a browser puts its caret at the start: move it to the end.
    document.addEventListener('htmx:afterSettle',function(){
      var box=document.activeElement;
      if(box&&box.tagName==='TEXTAREA'&&box.hasAttribute('autofocus')&&box.setSelectionRange){
        var end=box.value.length;
        box.setSelectionRange(end,end);
        // Once: later swaps (the next suggestions) must not move the caret while they edit.
        box.removeAttribute('autofocus');
      }
    });`;
}

/** Page-end script wiring up the shell's interactive behavior (idempotent). */
export function clientScript(): string {
  const parts = [
    csrfPart(),
    originPart(),
    themePart(),
    drawerPart(),
    sidebarPart(),
    foldPart(),
    dropdownPart(),
    toastPart(),
    formPart(),
    copyPart(),
    filterPart(),
    previewPart(),
    previewRefreshPart(),
    previewNoticePart(),
    loadingPart(),
    focusPart(),
    reviewScript(),
  ];
  return `
  (function(){
    if(window.__ssInit){ window.__ssInit(); return; }
    var shell=window.__storyshelfShell;
    if(!shell) return;
    var inits=[];${parts.join("\n")}
    window.__ssInit=function(){ inits.forEach(function(fn){ fn(); }); };
    window.__ssInit();
  })();
  `.trim();
}
