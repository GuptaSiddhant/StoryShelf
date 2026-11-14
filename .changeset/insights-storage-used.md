---
"@storyshelf/app": minor
---

Added: "Storage used" on the Insights tab, the size of a project's published Storybook files (#875)

The card sums the sizes recorded when each build was published, counting a file shared between builds once, and says how many files were uploaded before sizes were recorded and so are not included. It reads one aggregate from the database and never lists storage. Screenshots are not counted yet. The card appears on databases that keep build references (SQLite and Postgres).
