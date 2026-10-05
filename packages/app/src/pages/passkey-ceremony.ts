/**
 * Page-local WebAuthn ceremony scripts (vanilla JS, no dependencies).
 *
 * `login.tsx` (authenticate) and `profile.tsx` (register) inline these via
 * `dangerouslySetInnerHTML`. Both feature-detect first: without
 * `PublicKeyCredential` or a secure context the button disables and a note
 * explains passkeys need HTTPS or localhost.
 */

const B64_HELPERS = `
    function b64dec(s){s=s.replace(/-/g,'+').replace(/_/g,'/');while(s.length%4){s+='=';}var bin=atob(s);var b=new Uint8Array(bin.length);for(var i=0;i<bin.length;i++){b[i]=bin.charCodeAt(i);}return b;}
    function b64enc(buf){var bin='';var b=new Uint8Array(buf);for(var i=0;i<b.length;i++){bin+=String.fromCharCode(b[i]);}return btoa(bin).replace(/\\+/g,'-').replace(/\\//g,'_').replace(/=+$/,'');}
`.trim();

const SUPPORT_CHECK = `
    if(!window.PublicKeyCredential||!window.isSecureContext){
      btn.disabled=true;
      say('Passkeys need HTTPS or localhost.');
      return;
    }
`.trim();

/** Registration ceremony for the profile page (E7 flow, shared helpers). */
export function passkeyRegisterScript(): string {
  return `
  (function(){
    var btn=document.querySelector('[data-passkey-register]');
    if(!btn){return;}
    function say(msg){var el=document.querySelector('[data-passkey-status]');if(el){el.textContent=msg;}}
${B64_HELPERS}
${SUPPORT_CHECK}
    btn.addEventListener('click',function(){
      btn.disabled=true;
      say('Waiting for your authenticator…');
      var nameInput=document.querySelector('input[name="keyName"]');
      var name=nameInput&&nameInput.value.trim()?nameInput.value.trim():undefined;
      fetch('/api/auth/passkey/generate-register-options',{credentials:'same-origin',headers:{'accept':'application/json'}})
        .then(function(r){if(!r.ok){throw new Error('options '+r.status);}return r.json();})
        .then(function(o){
          var pk={challenge:b64dec(o.challenge),rp:o.rp,user:{id:b64dec(o.user.id),name:o.user.name,displayName:o.user.displayName||o.user.name},pubKeyCredParams:o.pubKeyCredParams};
          if(o.timeout){pk.timeout=o.timeout;}
          if(o.excludeCredentials){pk.excludeCredentials=o.excludeCredentials.map(function(c){return{id:b64dec(c.id),type:c.type,transports:c.transports};});}
          if(o.authenticatorSelection){pk.authenticatorSelection=o.authenticatorSelection;}
          if(o.attestation){pk.attestation=o.attestation;}
          return navigator.credentials.create({publicKey:pk});
        })
        .then(function(cred){
          var payload={id:cred.id,rawId:b64enc(cred.rawId),type:cred.type,response:{clientDataJSON:b64enc(cred.response.clientDataJSON),attestationObject:b64enc(cred.response.attestationObject)}};
          if(cred.response.getTransports){payload.response.transports=cred.response.getTransports();}
          if(name){payload.name=name;}
          return fetch('/api/auth/passkey/verify-registration',{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify({response:payload,name:name})});
        })
        .then(function(r){if(!r.ok){throw new Error('verify '+r.status);}window.location.reload();})
        .catch(function(){say('Registration failed — try again.');btn.disabled=false;});
    });
  })();
  `.trim();
}

/** Authentication ceremony for the login page (E8 flow). */
export function passkeyLoginScript(): string {
  return `
  (function(){
    var btn=document.querySelector('[data-passkey-login]');
    if(!btn){return;}
    function say(msg){var el=document.querySelector('[data-passkey-login-status]');if(el){el.textContent=msg;}}
${B64_HELPERS}
${SUPPORT_CHECK}
    btn.addEventListener('click',function(){
      btn.disabled=true;
      say('Waiting for your authenticator…');
      fetch('/api/auth/passkey/generate-authenticate-options',{credentials:'same-origin',headers:{'accept':'application/json'}})
        .then(function(r){if(!r.ok){throw new Error('options '+r.status);}return r.json();})
        .then(function(o){
          var pk={challenge:b64dec(o.challenge)};
          if(o.timeout){pk.timeout=o.timeout;}
          if(o.rpId){pk.rpId=o.rpId;}
          if(o.allowCredentials){pk.allowCredentials=o.allowCredentials.map(function(c){return{id:b64dec(c.id),type:c.type,transports:c.transports};});}
          if(o.userVerification){pk.userVerification=o.userVerification;}
          return navigator.credentials.get({publicKey:pk});
        })
        .then(function(cred){
          var authenticatorResponse={authenticatorData:b64enc(cred.response.authenticatorData),clientDataJSON:b64enc(cred.response.clientDataJSON),signature:b64enc(cred.response.signature)};
          if(cred.response.userHandle){authenticatorResponse.userHandle=b64enc(cred.response.userHandle);}
          var payload={id:cred.id,rawId:b64enc(cred.rawId),type:cred.type,response:authenticatorResponse};
          return fetch('/api/auth/passkey/verify-authentication',{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify({response:payload})});
        })
        .then(function(r){if(!r.ok){throw new Error('verify '+r.status);}window.location.href='/';})
        .catch(function(){say('Passkey sign-in failed — try again.');btn.disabled=false;});
    });
  })();
  `.trim();
}
