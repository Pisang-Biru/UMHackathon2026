# Goals Page — Design

**Date:** 2026-04-25
**Owner:** sidebar Goals nav (`app/src/components/sidebar.tsx:39`)

## Summary

Add a Goals page where the operator can create, edit, complete, archive, and (soft) delete free-text business goals. Active goals are appended to the agent system prompt so every agent run is aware of current operator priorities.

## Scope

- Goals are **plain strings** (no title, no metric, no deadline).
- Goals are **business-wide** — every agent for that business reads every active goal. No per-agent assignment.
- Lifecycle: `ACTIVE` → `COMPLETED` or `ARCHIVED`. Status is reversible. Delete is soft.
- Active goals injected into agent system prompt at every prompt-assembly site.

## Data model

Add to `app/prisma/schema.prisma` (public schema, owned by Prisma per `CLAUDE.md`):

```prisma
model Goal {
  id         String     @id @default(cuid())
  businessId String
  business   Business   @relation(fields: [businessId], references: [id], onDelete: Cascade)
  text       String
  status     GoalStatus @default(ACTIVE)
  createdAt  DateTime   @default(now())
  updatedAt  DateTime   @updatedAt
  deletedAt  DateTime?

  @@index([businessId, deletedAt, status, createdAt])
}

enum GoalStatus {
  ACTIVE
  COMPLETED
  ARCHIVED
}
```

`Business` model gets reverse relation:

```prisma
goals Goal[]
```

Migration command (per user instruction): `pnpm db:migrate` (TanStack Start wrapper around Prisma migrate).

Soft delete: rows with `deletedAt != null` are hidden from the list and from prompt injection.

## Server functions

File: `app/src/lib/goals-server-fns.ts` — TanStack Start `createServerFn`, follows `inbox-server-fns.ts` auth pattern.

Each function:
1. Reads session.
2. Verifies caller owns the business referenced by the row / payload.
3. Performs DB op.

Functions:

- `fetchGoals({ businessId })`
  - `where: { businessId, deletedAt: null }`
  - `orderBy: { createdAt: 'desc' }`. Group split + display order is client-side via `goals-logic.ts`.
  - Returns array of `{ id, text, status, createdAt, updatedAt }`.

- `createGoal({ businessId, text })`
  - Trim text, reject empty after trim.
  - `status` defaults `ACTIVE`.

- `updateGoal({ id, text?, status? })`
  - Partial update. Trim text if present. Reject empty trimmed text.
  - `updatedAt` auto-set.

- `deleteGoal({ id })`
  - Soft delete: `deletedAt: new Date()`.

## Pure logic

File: `app/src/lib/goals-logic.ts`. Unit-tested.

- `groupGoals(goals)` → `{ active: Goal[], completed: Goal[], archived: Goal[] }`.
  Within each group: sorted by `createdAt desc`.
- Type exports: `GoalRow`, `GoalGroups`.

## Route

File: `app/src/routes/$businessCode/goals.tsx`.

- Loader: `Promise.all([fetchBusinesses(), fetchSidebarAgents(...), fetchGoals(...)])`. If business code not found, redirect to first business or `/`. Same shape as `sales.tsx`.
- Component: `<BusinessStrip>` + `<Sidebar>` + main column.

Main column layout:

- Header row: page title "Goals", right-aligned `+ Add goal` button (primary).
- Three sections rendered only when non-empty: `Active`, `Completed`, `Archived`. Section header shows count.
- Empty state (zero non-deleted goals): centered copy + primary "Add your first goal" button.

Goal row:

- Text (full text, wraps; max-width container).
- Status pill (subtle).
- Action menu trigger (`⋯`): `Edit`, `Mark Completed` / `Reactivate` / `Archive` / `Unarchive` (depending on current status), `Delete`.

State management: `useQuery` keyed `['goals', businessId]`, hydrated from loader; mutations invalidate.

## Modal

File: `app/src/components/goals/goal-modal.tsx`. Uses existing dialog primitives in `app/src/components/ui/`.

Props:

```ts
{
  mode: 'create' | 'edit'
  initial?: { id: string; text: string }
  businessId: string
  open: boolean
  onClose: () => void
  onSaved: () => void
}
```

Body: single `<textarea>` (autofocus, ~4 rows, soft 500-char counter).
Footer: `Cancel` + `Save`. Save disabled when text is empty/whitespace, or (edit mode) unchanged from `initial.text`.

Keyboard:
- `Esc` → close.
- `Cmd/Ctrl + Enter` → save.

Submit calls `createGoal` or `updateGoal`, invalidates `['goals', businessId]`, closes on success. On error: inline error banner, modal stays open.

## Delete confirm

Separate small `<AlertDialog>`: "Delete this goal? You can't undo this from the UI." → on confirm, calls `deleteGoal` (soft) and invalidates query.

(Even though delete is soft on the backend, UI presents it as terminal — there is no Trash view in this iteration.)

## Sidebar wiring

`app/src/components/sidebar.tsx:39`: change

```ts
{ icon: Target, label: 'Goals' },
```

to

```ts
{ icon: Target, label: 'Goals', route: 'goals' },
```

so the nav button navigates to `/$businessCode/goals`.

## Agent prompt injection

File: `app/src/lib/goals-prompt.ts`:

```ts
export async function getActiveGoalsText(businessId: string): Promise<string> {
  const goals = await db.goal.findMany({
    where: { businessId, status: 'ACTIVE', deletedAt: null },
    orderBy: { createdAt: 'desc' },
    select: { text: true },
  })
  if (goals.length === 0) return ''
  const lines = goals.map((g, i) => `${i + 1}. ${g.text}`).join('\n')
  return `\n\n## Business goals\n${lines}`
}
```

Integration: implementation plan must locate every agent prompt-assembly site and append the return value to the existing system prompt.

If prompt assembly is Python-side (`agents/app/agents/**`), expose a FastAPI endpoint `GET /goals/active?business_id=...` returning `string[]` and call from the Python prompt builder. The plan step will determine the correct integration point after grepping prompt construction in both `app/` and `agents/`.

## Error handling

| Case | Handling |
|------|----------|
| Empty / whitespace text | Server fn throws; modal shows inline error |
| Unauthorized business | Server fn throws 403; route loader redirects to `/` |
| Network failure on save | Toast "Failed to save goal"; modal stays open |
| Status toggle failure | Optimistic UI rolls back; toast "Failed to update goal" |
| Delete failure | Optimistic UI rolls back; toast "Failed to delete goal" |

## Testing

- `goals-logic.test.ts` — `groupGoals` split + per-group ordering.
- `goals-server-fns.test.ts` — auth check rejects foreign business; create rejects empty; soft delete hides from `fetchGoals`; update preserves `createdAt`.
- No route-level UI tests (matches repo norm).

## Out of scope

- Per-agent goal assignment.
- Structured goal targets / metrics / deadlines.
- Trash view / restore from soft delete.
- Goal history / audit log.
- Drag-to-reorder.
