# @storyshelf/affected

Affected capture for StoryShelf: traces the dependency graph of a change to select only the stories it impacts.

## Install

```sh
nub add @storyshelf/affected
```

or

```sh
npm install @storyshelf/affected
```

## Usage

```ts
import { computeAffected } from "@storyshelf/affected";

const result = await computeAffected({ cwd, buildDir, baseSha, headSha });
```

See the [StoryShelf documentation](https://github.com/GuptaSiddhant/StoryShelf#readme) for configuration details.

## License

MIT
