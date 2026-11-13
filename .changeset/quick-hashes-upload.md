---
"storyshelf": minor
---

Changed: `storyshelf upload` sends only the files the server lacks, by content hash

The CLI hashes the build directory, asks `/dedup` which hashes are missing, uploads those in batches and posts the manifest. An unchanged second upload sends the manifest alone. A server without the hash routes (404 from `/dedup`) gets the zip as before; `--zip` or `STORYSHELF_ZIP=1` always sends the zip.
