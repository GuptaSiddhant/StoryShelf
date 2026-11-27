---
"@storyshelf/app": minor
---

Added: site admins can invite a user from the System page and with `storyshelf-server invite`

A site admin gets an "Invite a user" action on the System page, offered too in Add member when no account matches. The one-time link is shown once, for copying. `storyshelf-server invite <email> [--name] [--role]` prints it once for headless installs. Only a site admin can invite; the link is never logged or stored beyond the invite record. The local-accounts invite playbook now describes these.
