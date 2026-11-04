/**
 * Runs in `<head>` before first paint so the saved theme and sidebar state
 * apply without a flash. Exposes cookie helpers to the client script.
 */
export function bootScript(): string {
  return `
  (function(){
    var themeCookie='storyshelf_theme';
    var sidebarCookie='storyshelf_sidebar';
    function readCookie(name){
      var parts=document.cookie.split('; ');
      for(var i=0;i<parts.length;i++){
        var at=parts[i].indexOf('=');
        if(at>0&&parts[i].slice(0,at)===name){ return decodeURIComponent(parts[i].slice(at+1)); }
      }
      return null;
    }
    function writeCookie(name,value){
      document.cookie=name+'='+encodeURIComponent(value)+'; Path=/; Max-Age=31536000; SameSite=Lax';
    }
    function applyTheme(value){
      var ok=value==='light'||value==='dark'||value==='system';
      document.documentElement.setAttribute('data-theme',ok?value:'system');
    }
    function applySidebar(value){
      if(value==='rail'){ document.documentElement.setAttribute('data-sidebar','rail'); }
      else { document.documentElement.removeAttribute('data-sidebar'); }
    }
    var theme=readCookie(themeCookie);
    if(theme){ applyTheme(theme); }
    applySidebar(readCookie(sidebarCookie));
    window.__storyshelfShell={
      readCookie:readCookie,writeCookie:writeCookie,applyTheme:applyTheme,applySidebar:applySidebar,
      themeCookie:themeCookie,sidebarCookie:sidebarCookie
    };
  })();
  `.trim();
}
