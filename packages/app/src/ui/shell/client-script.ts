import { iconSpriteHref } from "../icons/sprite.ts";
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

/** Desktop rail collapse (persisted) and the mobile drawer. */
function sidebarPart(): string {
  return `
    function setDrawer(open){
      var sidebar=document.getElementById('sidebar');
      if(!sidebar) return;
      sidebar.classList.toggle('sidebar--open',open);
      var backdrop=document.querySelector('[data-sidebar-backdrop]');
      if(backdrop){ backdrop.hidden=!open; }
      var btn=document.querySelector('[data-sidebar-toggle]');
      if(btn){ btn.setAttribute('aria-expanded',open?'true':'false'); }
    }
    document.addEventListener('click',function(e){
      var t=e.target instanceof Element ? e.target : null;
      if(!t) return;
      if(t.closest('[data-sidebar-toggle]')){
        var sidebar=document.getElementById('sidebar');
        setDrawer(!(sidebar&&sidebar.classList.contains('sidebar--open')));
      } else if(t.closest('[data-sidebar-backdrop]')){
        setDrawer(false);
      } else if(t.closest('[data-sidebar-collapse]')){
        var next=document.documentElement.getAttribute('data-sidebar')==='rail' ? 'full' : 'rail';
        shell.applySidebar(next);
        shell.writeCookie(shell.sidebarCookie,next);
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
    function flushToast(){
      try{
        var raw=sessionStorage.getItem(TOAST_KEY);
        if(!raw) return;
        sessionStorage.removeItem(TOAST_KEY);
        toast(JSON.parse(raw));
      }catch(_){}
    }
    inits.push(flushToast);
    document.addEventListener('showToast',function(e){ toast(e.detail); });
    document.addEventListener('htmx:beforeRequest',function(e){
      var form=e.detail && e.detail.elt && e.detail.elt.closest ? e.detail.elt.closest('[data-toast]') : null;
      if(form){ queueToast({message:form.getAttribute('data-toast'),tone:form.getAttribute('data-toast-tone')||'success'}); }
    });
    function failed(){ clearToast(); toast({message:'Something went wrong. Please try again.',tone:'danger'}); }
    document.addEventListener('htmx:responseError',failed);
    document.addEventListener('htmx:sendError',failed);`;
}

/** Keep keyboard focus sensible after HTMX swaps. */
function focusPart(): string {
  return `
    document.addEventListener('htmx:afterSwap',function(e){
      var target=e.detail && e.detail.target;
      if(target&&target.querySelector&&target!==document.body){
        var focusable=target.querySelector('[autofocus], input, select, textarea, button');
        if(focusable) try{ focusable.focus(); }catch(_){}
      }
    });`;
}

/** Page-end script wiring up the shell's interactive behavior (idempotent). */
export function clientScript(): string {
  const parts = [
    csrfPart(),
    themePart(),
    sidebarPart(),
    dropdownPart(),
    toastPart(),
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
