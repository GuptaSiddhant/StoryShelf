import { Button, Card, EmptyState, HStack } from "../ui/components.tsx";
import { DocumentLayout, type RenderedContent } from "../ui/document.tsx";

/** What the not-found page shows. */
export interface NotFoundPageState {
  /** What was not found, in the words of the route that answered ("Project not found"). */
  message: string;
  /**
   * Where a visitor who is not signed in can sign in and come back to this page. Absent for a
   * signed-in visitor and on an instance without sign-in.
   */
  signInHref?: string;
}

/**
 * The page every not-found answers with. It is the same page for a route that does not exist and
 * for one the visitor may not know about (a private project), so it can offer a way in to anyone
 * who is not signed in without telling them which of the two they hit (#497).
 */
export function renderNotFoundPage(state: NotFoundPageState): RenderedContent {
  return (
    <DocumentLayout title="Not found" layout="bare">
      <Card>
        <EmptyState
          title="Not found"
          description={state.message}
          action={
            <HStack gap="sm" justify="center" wrap>
              {state.signInHref ? (
                <Button variant="primary" href={state.signInHref}>
                  Sign in
                </Button>
              ) : null}
              <Button variant={state.signInHref ? "secondary" : "primary"} href="/">
                Go to the home page
              </Button>
            </HStack>
          }
        />
      </Card>
    </DocumentLayout>
  );
}
