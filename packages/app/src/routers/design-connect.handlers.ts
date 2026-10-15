import { DesignCredentialModel } from "@storyshelf/core/models";
import type { UserConnection } from "@storyshelf/core/schema";
import { canConnect, connectionModel } from "../connections.ts";
import { credentialKeys } from "../credential-keys.ts";
import type { DesignConnect } from "../pages/design-links.tsx";
import { getStore } from "../store.ts";

/** The signed-in user whose own connection may serve previews (none when auth is off). */
export function viewerIdOf(): string | undefined {
  const { user, authEnabled } = getStore();
  return authEnabled ? user?.id : undefined;
}

/**
 * Per provider kind, whether to offer "Connect your account": only when the operator
 * enabled OAuth, the viewer is signed in, and the project has no shared credential.
 */
export async function loadConnectStates(
  projectId: string,
  kinds: readonly string[],
  returnTo: string,
): Promise<Map<string, DesignConnect>> {
  const viewerId = viewerIdOf();
  if (!viewerId || !canConnect()) return new Map();
  const { db, config, design } = getStore();
  const credentials = new DesignCredentialModel(db, credentialKeys(config));
  const candidates = design.filter((p) => p.oauth && kinds.includes(p.metadata.kind));
  const states = await Promise.all(
    candidates.map(async (provider) => {
      const kind = provider.metadata.kind;
      const shared = await credentials.info(projectId, kind);
      if (shared) return null;
      return [
        kind,
        connectOffer(kind, await connectionModel().info(viewerId, kind), returnTo),
      ] as const;
    }),
  );
  return new Map(states.filter((entry) => entry !== null));
}

function connectOffer(kind: string, row: UserConnection | null, returnTo: string): DesignConnect {
  const base = `/connections/${kind}`;
  const expired = row?.status === "expired";
  return {
    state: row ? (expired ? "reconnect" : "connected") : "connect",
    startUrl: `${base}/start?return=${encodeURIComponent(returnTo)}`,
    disconnectUrl: `${base}/disconnect`,
    returnTo,
  };
}
