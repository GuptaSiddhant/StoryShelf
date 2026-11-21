---
"@storyshelf/storage": minor
---

Breaking: @storyshelf/storage-s3, -gcs and -azure are now @storyshelf/storage/s3, /gcs and /azure

The three cloud storage adapters are one package, `@storyshelf/storage`, with the subpaths `/s3`, `/gcs`, `/azure` and `/local` (a re-export of `@storyshelf/core/storage/local`). Factories, options and stored objects are unchanged. Each cloud SDK is now an optional peer that only its own subpath loads (`@aws-sdk/client-s3` and `@aws-sdk/lib-storage`, `@google-cloud/storage`, `@azure/storage-blob` and `@azure/identity`), so install the one you use. Nothing old is kept: `@storyshelf/storage-s3`, `@storyshelf/storage-gcs` and `@storyshelf/storage-azure` are not published again, so change your dependency and imports (see the upgrading guide). `server init` scaffolds `@storyshelf/storage` and the SDK. Schema: none.
