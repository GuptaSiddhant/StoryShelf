/** Translating the capture settings (browsers, mode allowlist) into stored project columns. */
import { modeSlug } from "@storyshelf/core/capture";
import { HTTPException } from "hono/http-exception";

/** The capture-related fields of a project update (API body or settings form). */
export interface CaptureConfigInput {
  browser?: string | undefined;
  browsers?: string[] | null | undefined;
  modesAllowlist?: string[] | null | undefined;
}

/**
 * Translate the array fields into the stored JSON columns and keep the legacy
 * `browser` column equal to the primary engine. Other fields pass through.
 */
export function toProjectPatch(
  body: CaptureConfigInput & Record<string, unknown>,
): Record<string, unknown> {
  const { browsers, modesAllowlist, ...rest } = body;
  const patch: Record<string, unknown> = { ...rest };
  if (browsers !== undefined) {
    const unique = browsers === null ? null : [...new Set(browsers)];
    patch["browsers"] = unique ? JSON.stringify(unique) : null;
    if (unique?.[0]) patch["browser"] = unique[0];
  } else if (rest.browser !== undefined) {
    patch["browsers"] = null;
  }
  if (modesAllowlist !== undefined) {
    patch["modesAllowlist"] = modesAllowlist
      ? JSON.stringify(assertModeNames(modesAllowlist))
      : null;
  }
  return patch;
}

/** 400 for a mode name that cannot form a baseline key; returns the deduped list. */
export function assertModeNames(names: string[]): string[] {
  for (const name of names) {
    try {
      modeSlug(name);
    } catch {
      throw new HTTPException(400, { message: `Invalid mode name "${name}"` });
    }
  }
  return [...new Set(names)];
}
