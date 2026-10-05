/**
 * Review-page behavior: diff view modes and keyboard review.
 * (Reworked with the review workspace; moved out of the shell as-is.)
 */
export function reviewScript(): string {
  return `
    // Diff view-mode segmented control (split / single pane, no endpoint change)
    function initViewSwitch(root){
      var sw=root.querySelector('[data-view-switch]');
      var grid=root.querySelector('[data-view]');
      if(!sw||!grid) return;
      var btns=Array.from(sw.querySelectorAll('[data-view-value]'));
      sw.addEventListener('click',function(e){
        var btn=e.target instanceof HTMLElement ? e.target.closest('[data-view-value]') : null;
        if(!btn) return;
        var view=btn.getAttribute('data-view-value')||'split';
        grid.setAttribute('data-view',view);
        btns.forEach(function(b){ b.setAttribute('aria-pressed', b===btn ? 'true' : 'false'); });
      });
    }
    initViewSwitch(document);
    document.body.addEventListener('htmx:afterSwap',function(){ initViewSwitch(document); });
    // Diff keyboard shortcuts
    document.addEventListener('keydown',function(e){
      if(e.target instanceof HTMLElement && (e.target.tagName==='INPUT'||e.target.tagName==='TEXTAREA'||e.target.isContentEditable)) return;
      var diffRoot=document.querySelector('[data-diff-nav]');
      if(!diffRoot) return;
      if(e.key==='ArrowLeft' || e.key==='ArrowRight'){
        var links=Array.from(diffRoot.querySelectorAll('[data-snapshot-link]'));
        if(links.length===0) return;
        var active=document.activeElement;
        var idx=links.indexOf(active);
        if(idx===-1){
          var current=diffRoot.getAttribute('data-current');
          idx=links.findIndex(function(a){ return a.getAttribute('data-snapshot-id')===current; });
        }
        var nextIdx=e.key==='ArrowRight' ? Math.min(links.length-1, idx+1) : Math.max(0, idx-1);
        if(links[nextIdx]){ e.preventDefault(); links[nextIdx].focus(); links[nextIdx].click(); }
        return;
      }
      if(e.key==='a'||e.key==='A'||e.key==='r'||e.key==='R'){
        var btn=document.querySelector(e.key==='a'||e.key==='A' ? '[data-approve]' : '[data-reject]');
        if(btn){ e.preventDefault(); btn.click(); }
      }
    });
  `;
}
