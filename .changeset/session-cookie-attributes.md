---
"@storyshelf/auth": patch
---

Security hardening: the session cookie's attributes are now set explicitly (`HttpOnly`, `SameSite=Lax`, `Path=/`, and `Secure` when the public URL is https) instead of relying on Better Auth's defaults, and a test signs in over http and https and checks the `Set-Cookie` line, so a library upgrade cannot loosen them. `SameSite=Lax` is what keeps a cross-site form post from sending the session to a cookie-authenticated write. There is no change for existing sessions: the values are the ones the library already used.
