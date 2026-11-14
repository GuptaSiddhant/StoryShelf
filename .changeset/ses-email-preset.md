---
"@storyshelf/core": minor
---

Added: an Amazon SES email preset

`sesPreset` and `sesPresetFromEnv` in `@storyshelf/core/integrations` send through Amazon SES over SMTP (`email-smtp.<region>.amazonaws.com`, port 587, STARTTLS) with SES SMTP credentials from the environment (`SES_REGION` or `AWS_REGION`, `SES_SMTP_USER`, `SES_SMTP_PASS`, `SES_FROM`). It reuses the SMTP transport and the optional `nodemailer` peer; there is no AWS SDK. The sending identity must be verified in SES first.

Schema: none
