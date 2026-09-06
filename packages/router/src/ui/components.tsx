/**
 * Reusable server-rendered UI primitives (hono/jsx, no client framework).
 *
 * Facade over the widget-family modules: `buttons.tsx` (Button, Tabs),
 * `feedback.tsx` (Badge, statusTone, Alert, EmptyState, Stat), `forms.tsx`
 * (Field, TextareaField, SelectField), `layout.tsx` (Card, PageHeader).
 * Import from here; the family modules are an organizational detail.
 */
export { Button, Tabs } from "./buttons.tsx";
export { Alert, Badge, EmptyState, Stat, statusTone } from "./feedback.tsx";
export { Field, SelectField, TextareaField } from "./forms.tsx";
export { Card, PageHeader } from "./layout.tsx";
