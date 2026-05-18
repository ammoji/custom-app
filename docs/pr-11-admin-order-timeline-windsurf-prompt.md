# PR 11 — Admin order timeline view (Windsurf prompt)

## Why this PR exists

Admin dashboard today shows only the *current* status of each order
plus a small delivery-substate flow strip added in PR 7. During family
testing, the request came in: "We should be able to show complete
flow of all open orders so Admin can track the full flow of order
with timing."

The data is already there. Every order doc has a `statusHistory`
field that gets a new entry on every status transition (added in PR
2, used by the delivery flow in PR 7, used by audit log writes in PR
8). What's missing is the UI to render that history.

This PR is pure read-only UI on `AdminOrdersScreen.tsx`. Zero schema
changes, zero callable changes, zero rule changes. Builds confidence
that the data infrastructure works end-to-end before we make
behavioural changes in PR 12 (shopkeeper ETA workflow).

JS-only client change. OTA-able. ~2–3 hours Windsurf.

## Read first

- `.windsurf/code-discipline.md`, `.windsurf/test-discipline.md`.
- `src/types/index.ts` — find the `Order` type. Note the
  `statusHistory` field shape. Each entry has `{status, at, by, reason?}`
  (verify exact field names by reading).
- `src/screens/admin/AdminOrdersScreen.tsx` — the screen this PR
  modifies. Already has a `deliveryFlow` substate block (PR 7).
  Builds on that pattern.
- `src/utils/format.ts` — `formatOrderTime` is what we use for
  timestamps. Reuse it.
- `functions/src/index.ts` — search for `statusHistory: FieldValue.arrayUnion`
  to see all the places entries get written. This gives you the full
  set of statuses + actor types that can appear (admin, shopOwner,
  customer, system, delivery).

## Scope (in)

### Part 1 — Render statusHistory as a vertical timeline

In `AdminOrdersScreen.tsx`, replace or extend the existing
`deliveryFlow` block with a full timeline that shows every entry in
`item.statusHistory`, ordered ascending by timestamp.

UI shape, per timeline entry:

```
●─ pending · 6:42 PM
│   by customer:7Xkj...
●─ accepted · 6:43 PM
│   by shopOwner:JK2L...
●─ preparing · 6:45 PM
│   by shopOwner:JK2L...
●─ out_for_delivery · 6:58 PM
│   by shopOwner:JK2L... · "claimed by Ramesh"
●─ delivered · 7:14 PM
│   by delivery:9Mxs...
```

Implementation notes:

- Use a vertical strip of dots connected by lines on the left, label
  on the right. React Native primitives only (View + Text).
- Status labels use the same human-readable mapping as the existing
  `OrderStatusChip` component (reuse it if practical; if not, mirror
  the same label strings).
- Timestamps via `formatOrderTime(entry.at)`.
- Actor display: `by ${entry.by}` truncated to `by ${role}:${uid.slice(0,4)}...`.
  E.g. `shopOwner:JK2L...`. Keeps the cell compact and doesn't leak
  full uids in screenshots.
- Reason (if present): on a separate line below, italic, slightly
  smaller. E.g. `"refunded due to wrong item"`.

### Part 2 — Hide timeline behind a disclosure by default

A long timeline (5–8 entries) eats vertical space on every card. Follow
the same disclosure pattern PR 7 used for the manual-override
section:

```tsx
const [timelineExpandedId, setTimelineExpandedId] = useState<string | null>(null);
const timelineOpen = timelineExpandedId === item.id;

// ...

<Pressable
  onPress={() => setTimelineExpandedId(timelineOpen ? null : item.id)}
  style={styles.disclosureRow}
>
  <Text style={styles.disclosureText}>
    {timelineOpen ? '▾' : '▸'} Full timeline ({item.statusHistory?.length ?? 0} steps)
  </Text>
</Pressable>

{timelineOpen && <Timeline entries={item.statusHistory ?? []} />}
```

Only one card's timeline open at a time (same pattern as PR 7's
override disclosure). The disclosure label always shows the step
count so admin gets a hint without expanding.

### Part 3 — Compact "current state" indicator at top of card

Even with the timeline collapsed, the card should show a one-line
summary like:

```
Order #abc123 · Out for delivery (claimed by Ramesh, picked up 7:02 PM)
```

The existing `deliveryFlow` block already does this for the delivery
substates. Keep it. The new timeline disclosure is additive — the
existing one-line state stays as the at-a-glance view, timeline is
the drill-down.

### Part 4 — Sub-second timestamp ordering

`statusHistory` entries are written with `Date.now()` (millisecond
precision). Two transitions in the same ms (rare but possible — e.g.
the customer cancel + refund flow writes two entries back-to-back)
would have identical timestamps. Render in array order in that case
(arrayUnion preserves insertion order; don't sort by `at` because
that would shuffle ties).

```ts
const entries = item.statusHistory ?? [];
// Do NOT sort by at — preserve arrayUnion insertion order to handle
// same-ms ties correctly.
```

### Part 5 — Tests

Pure UI, no helper logic to unit-test. But add **one** snapshot or
render test in `tests/components/` (or wherever component tests
live in this repo — check the existing test layout) that:

- Renders a card with a 5-entry statusHistory
- Toggles the disclosure
- Asserts the timeline rows appear with the right labels + timestamps

If there's no existing component-test infrastructure, skip this in
favour of a manual smoke test (Part 6). Don't introduce a new test
runner just for this PR.

## Scope (out)

- **Filter / search across timelines** (e.g. "show all orders that
  were cancelled by admin"). Audit log already supports this via PR
  8's `listRecentAuditEntries` callable. Out of scope here.
- **Editing past timeline entries.** Read-only.
- **Showing this on customer or shop-owner dashboards.** Admin-only
  per the user's request. Customer sees their own simplified status;
  shop owner has their own dashboard.
- **Persisting timeline expansion state** across navigation. If admin
  closes and reopens the screen, expansion resets. Acceptable.

## Acceptance checklist

- [ ] `AdminOrdersScreen.tsx` renders a `▸ Full timeline (N steps)`
  disclosure on each order card.
- [ ] Tapping the disclosure expands the timeline; tapping again
  collapses. Only one card open at a time.
- [ ] Timeline entries render in insertion order (not sorted by `at`),
  with status label, timestamp, actor (role + truncated uid), and
  reason if present.
- [ ] Existing PR 7 delivery-substate strip still works for the
  collapsed view.
- [ ] Existing PR 7 manual-override disclosure still works (don't
  collide state with the new timeline disclosure).
- [ ] `npx tsc --noEmit`: 0 errors.
- [ ] `npm run audit` passes.
- [ ] `npm test`: all existing tests pass.
- [ ] Zero new `DO NOT REMOVE` markers.

## Smoke tests (manual, after deploy)

1. **Admin sees a freshly-placed order.** Card shows status chip +
   placed timestamp + `▸ Full timeline (1 steps)` disclosure.
   Expanding shows the single `pending` entry.
2. **Watch an order go through the full lifecycle.** Place → accept
   → prepare → out_for_delivery → claim → pickup → deliver. After
   each transition, admin's card timeline grows by one entry with
   correct actor + timestamp.
3. **Admin-cancel + refund.** The cancel-paid flow writes a `cancelled`
   entry plus a `refund_pending` entry plus a `refunded` entry. All
   three should appear in order in the timeline. Reason field
   ("refund failed: card declined" or similar) renders correctly.
4. **Customer-cancel within 2-min window** (PR 7). Cancel entry
   should show `by customer:XXXX...` (the PR 8.1 cleanup made this
   role first-class). Confirms the audit role widening did flow
   through to the timeline UI without regression.
5. **Long timeline (8+ entries)** stays readable. Card height grows
   smoothly; no clipping, no scroll-within-scroll weirdness.

## Deploy plan

Pure client OTA:

```powershell
npm test
eas update --branch preview --message "PR 11 admin order timeline"

# Smoke on preview
eas update --branch production --message "PR 11 admin order timeline"
```

No functions deploy, no rules deploy. Single OTA from clean tree.

## Estimated time

~2–3 hours:

- Part 1 (timeline component): 60–90 min including iterating on the
  dot/line visual.
- Part 2 (disclosure wiring): 15 min — mirrors PR 7 pattern exactly.
- Part 3 (verify existing summary stays): 10 min.
- Part 4 (insertion-order handling): trivial, mostly a comment.
- Part 5 (optional component test): 30 min if you do it, skip
  otherwise.
- Smoke testing: 20–30 min.
