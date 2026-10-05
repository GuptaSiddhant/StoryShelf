/**
 * Reusable server-rendered UI primitives (hono/jsx, no client framework).
 *
 * Facade over the widget-family modules: `buttons.tsx` (Button, Tabs),
 * `feedback.tsx` (Badge, statusTone, Alert, EmptyState, Stat), `forms.tsx`
 * (Field, TextareaField, SelectField), `layout.tsx` (Card, PageHeader),
 * `stacks.tsx` (HStack, VStack), plus `icons/icon.tsx` (Icon), `avatar.tsx`,
 * `compare-stage.tsx`, `progress.tsx`, `code-block.tsx`, `filter-input.tsx`, `time.tsx`, `kbd.tsx`, `segmented.tsx`, `table.tsx`, `thumbnail.tsx`, `dropdown.tsx`.
 * Import from here; the family modules are
 * an organizational detail.
 */
export { Button, Tabs } from "./buttons.tsx";
export { Alert, Badge, EmptyState, Meta, Stat, statusTone } from "./feedback.tsx";
export { CheckField, Field, SelectField, TextareaField } from "./forms.tsx";
export { Card, CardSection, PageHeader, SectionTitle } from "./layout.tsx";
export { HStack, VStack } from "./stacks.tsx";
export { Avatar, AvatarGroup } from "./avatar.tsx";
export { Dropdown, DropdownDivider, DropdownItem } from "./dropdown.tsx";
export { Icon } from "./icons/icon.tsx";
export type { IconName } from "./icons/paths.ts";
export { Kbd } from "./kbd.tsx";
export { Segmented, type SegmentedItem } from "./segmented.tsx";
export { Table } from "./table.tsx";
export { Thumbnail } from "./thumbnail.tsx";
export { CompareStage, type CompareStageProps } from "./compare-stage.tsx";
export { Progress } from "./progress.tsx";
export { CodeBlock } from "./code-block.tsx";
export { FilterInput } from "./filter-input.tsx";
export { RelativeTime, formatRelative } from "./time.tsx";
