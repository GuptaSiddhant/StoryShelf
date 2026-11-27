import { DocumentLayout, type RenderedContent } from "../shell/document.tsx";
import { Button, Card, EmptyState, HStack } from "../ui/components.tsx";

/** What the forbidden page shows. */
export interface ForbiddenPageState {
  /**
   * What the refusal said, when it said more than the bare status ("Forbidden"). Absent falls back
   * to the plain sentence about access.
   */
  message?: string;
}

const DEFAULT_DESCRIPTION = "You do not have permission to open this page.";

/**
 * The page a browser sees for a 403: the app's own shell, the way the not-found page is. A
 * signed-in visitor who lacks the role gets it; it links home, not to sign-in (a visitor who is
 * signed out is sent to sign in before a gate can refuse them).
 */
export function renderForbiddenPage(state: ForbiddenPageState = {}): RenderedContent {
  return (
    <DocumentLayout title="Forbidden">
      <Card>
        <EmptyState
          title="Forbidden"
          headingLevel={1}
          description={state.message ?? DEFAULT_DESCRIPTION}
          action={
            <HStack gap="sm" justify="center" wrap>
              <Button variant="primary" href="/">
                Go to the home page
              </Button>
            </HStack>
          }
        />
      </Card>
    </DocumentLayout>
  );
}
