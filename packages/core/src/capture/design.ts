/** Design-source extraction from Storybook story parameters (`design` addon + `storyshelf.figma`). */
import { parseFigmaUrl } from "../utils/figma-url.ts";

/** Story parameters relevant to design linking, as serialized in the Storybook index. */
export interface DesignParameters {
  design?: unknown;
  storyshelf?: { figma?: unknown };
}

/** Outcome of extraction: a valid Figma URL, a rejected raw value, or nothing declared. */
export interface DesignExtraction {
  url?: string;
  /** Raw value that was declared but is not a usable Figma URL (logged by the caller). */
  invalid?: string;
}

/**
 * Resolve a story's design URL. `storyshelf.figma` (plain string) wins over the
 * `design` addon shape (`string | {url} | {type,url} | {type,url}[]`, first URL wins).
 */
export function extractDesignUrl(parameters?: DesignParameters): DesignExtraction {
  const explicit = parameters?.storyshelf?.figma;
  const raw = typeof explicit === "string" ? explicit : firstDesignUrl(parameters?.design);
  if (raw === undefined) return {};
  const parsed = parseFigmaUrl(raw);
  return parsed ? { url: parsed.url } : { invalid: raw };
}

/** First URL of the `design` addon value, whatever shape it takes. */
function firstDesignUrl(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    for (const item of value as unknown[]) {
      const url = firstDesignUrl(item);
      if (url !== undefined) return url;
    }
    return undefined;
  }
  const url = (value as { url?: unknown } | null | undefined)?.url;
  return typeof url === "string" ? url : undefined;
}

/** Log (once per story) design values that were declared but are not usable Figma URLs. */
export function logInvalidDesigns(
  logger: { warn(obj: object, msg: string): void } | undefined,
  stories: readonly { id: string; designInvalid?: string }[],
): void {
  for (const story of stories) {
    if (story.designInvalid !== undefined) {
      logger?.warn(
        { storyId: story.id, design: story.designInvalid },
        "ignored invalid design url",
      );
    }
  }
}
