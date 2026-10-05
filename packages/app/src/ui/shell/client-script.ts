import { iconSpriteHref } from "../icons/sprite.ts";
import { reviewScript } from "./review-script.ts";

/** Attach the CSRF token to every HTMX request. */
function csrfPart(): string {
  return `
    var csrfMeta=document.querySelector('meta[name="csrf-token"]');
    if(csrfMeta){
      document.body.addEventListener('htmx:configRequest',function(e){
        e.detail.headers['x-csrf-token']=csrfMeta.getAttribute('content');
      });
    }`;
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
    markTheme();
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
    var sidebar=document.getElementById('sidebar');
    var menuBtn=document.querySelector('[data-sidebar-toggle]');
    var backdrop=document.querySelector('[data-sidebar-backdrop]');
    function setDrawer(open){
      if(!sidebar) return;
      sidebar.classList.toggle('sidebar--open',open);
      if(backdrop){ backdrop.hidden=!open; }
      if(menuBtn){ menuBtn.setAttribute('aria-expanded',open?'true':'false'); }
    }
    if(menuBtn){ menuBtn.addEventListener('click',function(){ setDrawer(!sidebar.classList.contains('sidebar--open')); }); }
    if(backdrop){ backdrop.addEventListener('click',function(){ setDrawer(false); }); }
    var collapse=document.querySelector('[data-sidebar-collapse]');
    if(collapse){
      collapse.addEventListener('click',function(){
        var next=document.documentElement.getAttribute('data-sidebar')==='rail' ? 'full' : 'rail';
        shell.applySidebar(next);
        shell.writeCookie(shell.sidebarCookie,next);
      });
    }
    document.addEventListener('keydown',function(e){
      if(e.key==='Escape'&&sidebar&&sidebar.classList.contains('sidebar--open')){
        setDrawer(false);
        if(menuBtn) menuBtn.focus();
      }
    });`;
}

/** Native <details> dropdowns: close on outside click, Escape, or choosing an item. */
function dropdownPart(): string {
  return `
    function closeDropdowns(except){
      document.querySelectorAll('details[data-dropdown][open]').forEach(function(d){
        if(d!==except) d.removeAttribute('open');
      });
    }
    document.addEventListener('click',function(e){
      var target=e.target instanceof Element ? e.target : null;
      var owner=target ? target.closest('details[data-dropdown]') : null;
      closeDropdowns(owner);
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

/** Toasts driven by an HX-Trigger-After-Swap "showToast" event. */
function toastPart(): string {
  return `
    var toastIcons={success:'check-circle',danger:'x-circle',warning:'alert-triangle',info:'info'};
    function toast(detail){
      var region=document.querySelector('[data-toast-region]');
      if(!region||!detail||!detail.message) return;
      var tone=toastIcons[detail.tone] ? detail.tone : 'info';
      var el=document.createElement('div');
      el.className='toast';
      el.setAttribute('data-tone',tone);
      el.setAttribute('role',tone==='danger'?'alert':'status');
      var ns='http://www.w3.org/2000/svg';
      var svg=document.createElementNS(ns,'svg');
      svg.setAttribute('viewBox','0 0 24 24');
      svg.setAttribute('width','18');
      svg.setAttribute('height','18');
      svg.setAttribute('aria-hidden','true');
      svg.setAttribute('fill','none');
      svg.setAttribute('stroke','currentColor');
      svg.setAttribute('stroke-width','2');
      svg.setAttribute('stroke-linecap','round');
      svg.setAttribute('stroke-linejoin','round');
      var use=document.createElementNS(ns,'use');
      use.setAttribute('href','${iconSpriteHref}#i-'+toastIcons[tone]);
      svg.appendChild(use);
      var text=document.createElement('span');
      text.textContent=String(detail.message);
      el.appendChild(svg);
      el.appendChild(text);
      region.appendChild(el);
      setTimeout(function(){ el.remove(); },tone==='danger'?8000:4000);
    }
    document.body.addEventListener('showToast',function(e){ toast(e.detail); });`;
}

/** Keep keyboard focus sensible after HTMX swaps. */
function focusPart(): string {
  return `
    document.body.addEventListener('htmx:afterSwap',function(e){
      var target=e.detail && e.detail.target;
      if(target&&target.querySelector){
        var focusable=target.querySelector('[autofocus], input, select, textarea, button');
        if(focusable) try{ focusable.focus(); }catch(_){}
      }
    });`;
}

/** Page-end script wiring up the shell's interactive behavior. */
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
    var shell=window.__storyshelfShell;
    if(!shell) return;${parts.join("\n")}
  })();
  `.trim();
}
