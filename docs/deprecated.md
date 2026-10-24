# Deprecated Packages

The machine-readable log lives in [deprecated.json](./deprecated.json). Preview
with `nub run deprecate:dry`, then run `nub run deprecate` with npm and JSR
credentials to deprecate every published version and update the JSON status
entries. JSR has no deprecation API, so the script archives those packages
instead.

`@storyshelf/cli` is already deprecated in favour of `storyshelf`; `@storyshelf/router` was never published.
