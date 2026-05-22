# PR 18 — Quick Switch test accounts (Windsurf prompt)

## Why this PR exists

Solo / multi-role testing currently requires a full sign-out → enter
phone → wait for OTP screen → enter `123456` → wait for verify → land
on Home cycle for every role switch. ~45 seconds per switch. Multiply
by 5 testers × 10 switches per session and that's a real productivity
tax during the family-testing phase.

This PR adds an **admin-gated "Switch test account" button** on the
HomeScreen that opens a modal listing pre-configured test phones.
Tapping an entry triggers the same authentication flow automatically:
sign out → auto-fill phone → auto-send OTP → auto-fill `123456` →
auto-verify → land on Home as the target user. End-to-end ~5 seconds.

**No backdoor, no security compromise.** Firebase Auth still gates
everything; we just auto-fill the form. The test phones already
bypass real SMS via Firebase Console's "Phone numbers for testing"
config — this PR just removes the manual typing.

**Production safety:** the button is gated on whether the currently
signed-in user's phone number matches one of the entries in
`TEST_ACCOUNTS`. This means:
- Admin can switch freely between all 5 test accounts and back,
  because every test phone (including admin's) is in the list.
- Real customers (whose phone is NOT in the test list) never see
  the button — automatic gating without any per-role permission
  checks.
- Anonymous bootstrap users (no phone yet) never see it either.
- If the feature ever leaks into a production-customer build, the
  worst case is the button is hidden for everyone because no
  real-customer phone matches the dev-project's test list.

**Pure client OTA**, no schema, no server, no rollout risk.
~1.5 hours.

## Read first

- `.windsurf/code-discipline.md`, `.windsurf/test-discipline.md`,
  `.windsurf/deploy-discipline.md`.
- `src/services/authService.ts` — uses `startPhoneAuth`,
  `confirmOtp`, `signOut`. The Quick Switch flow chains these
  exactly as the manual LoginScreen does.
- `src/screens/LoginScreen.tsx` — reference for the auth flow
  sequencing (the Quick Switch does the same steps but
  programmatically).
- `src/store/useAuthStore.ts` — `isAdmin`, `setUser`. The flow
  pushes the refreshed user into the store after sign-in.
- `src/screens/HomeScreen.tsx` — the screen this PR modifies.
  Existing hoisted state block from PR 14/15/17 — add this PR
  to the Rules-of-Hooks comment lineage.

## Critical lessons from PRs 12–17 (do not repeat)

1. **All `useState` calls in HomeScreen sit ABOVE conditional early
   returns.** This PR adds modal state — must hoist with the existing
   block.
2. **Zero new `DO NOT REMOVE` markers expected.** 7 PRs in a row
   clean. Keep the streak.
3. **No new native module imports.** Pure JS + existing dependencies.

## Scope (in)

### Part 1 — Test accounts constants file

New file `src/constants/testAccounts.ts`:

```ts
/**
 * Pre-configured test phone numbers for the admin-gated Quick Switch
 * feature on HomeScreen (PR 18).
 *
 * These MUST match entries in:
 *   Firebase Console → grocery-mvp-dev → Authentication →
 *   Settings → Phone numbers for testing
 *
 * Each entry's `otp` field must be EXACTLY what's configured in the
 * console for that phone. If you add a new test phone there, add a
 * matching entry here. If a phone is removed from the console, the
 * Quick Switch entry will fail with "Invalid OTP" at runtime.
 *
 * Labels are display-only — pick whatever helps you identify the
 * account during testing. Convention: include the role in the label
 * so you don't accidentally sign into the wrong account.
 *
 * NOTE on the admin entry: the admin user is created normally via
 * Firebase Console (set-admin script). To use Quick Switch as
 * admin, include the admin's phone here too — but remember signing
 * in as admin requires the admin claim, which Firebase already has
 * attached to that uid. Quick Switch doesn't grant claims; it just
 * authenticates.
 */
export type TestAccount = {
  label: string;
  phone: string; // 10-digit, no +91 prefix
  otp: string;   // matches Firebase Console config
};

export const TEST_ACCOUNTS: TestAccount[] = [
  // EDIT THIS LIST as you add/remove test phones in Firebase Console.
  // The current entries match the dev project as of PR 18 ship date.
  { label: 'Admin (you)',              phone: '9999999991', otp: '123456' },
  { label: 'Customer A',               phone: '9999999992', otp: '123456' },
  { label: 'Customer B',               phone: '9999999993', otp: '123456' },
  { label: 'Shop Owner — Mahesh Kirana', phone: '9999999994', otp: '123456' },
  { label: 'Delivery Partner',         phone: '3145415346',  otp: '123456' },
  // Add more as needed.
];
```

Adjust the actual phone numbers + labels to match the dev project's
Firebase Console config. The structure is the contract.

### Part 2 — QuickSwitchModal component

New file `src/components/dev/QuickSwitchModal.tsx`:

```tsx
import React, { useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Button from '../common/Button';
import { TEST_ACCOUNTS, type TestAccount } from '../../constants/testAccounts';
import { colors, radii, spacing, typography } from '../../constants/theme';
import { authService } from '../../services/authService';
import { useAuthStore } from '../../store/useAuthStore';

type Props = {
  visible: boolean;
  onClose: () => void;
};

export default function QuickSwitchModal({ visible, onClose }: Props) {
  const [busy, setBusy] = useState<string | null>(null); // phone of in-flight switch
  const [error, setError] = useState<string | null>(null);

  const onSelect = async (account: TestAccount) => {
    setBusy(account.phone);
    setError(null);
    try {
      // 1. Sign out current user. Clears persisted auth + cart per
      //    signOutAndClearLocalState wiring.
      await authService.signOut();

      // 2. Start phone auth for the target — same call LoginScreen
      //    uses. Returns a ConfirmationResult.
      const confirmation = await authService.startPhoneAuth(`+91${account.phone}`);

      // 3. Submit the canned OTP. Same call LoginScreen's Verify
      //    button triggers.
      const user = await authService.confirmOtp(confirmation, account.otp);

      // 4. Push the refreshed user into useAuthStore so HomeScreen
      //    re-renders with the new role claims immediately.
      if (user) useAuthStore.getState().setUser(user);

      onClose();
    } catch (err: any) {
      console.error('[QuickSwitchModal] switch failed:', err);
      setError(
        err?.message ??
          'Switch failed. Check that the phone is configured in Firebase Console test list.',
      );
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <View style={styles.card}>
          <Text style={styles.title}>Switch test account</Text>
          <Text style={styles.subtitle}>
            Admin-only shortcut. Signs out, then signs in as the
            selected test phone using its pre-configured OTP.
          </Text>

          <ScrollView style={styles.list}>
            {TEST_ACCOUNTS.map(account => (
              <Pressable
                key={account.phone}
                onPress={() => onSelect(account)}
                disabled={busy !== null}
                style={[
                  styles.item,
                  busy === account.phone && styles.itemBusy,
                ]}
                accessibilityRole="button"
                accessibilityLabel={`Switch to ${account.label}`}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.itemLabel}>{account.label}</Text>
                  <Text style={styles.itemPhone}>+91 {account.phone}</Text>
                </View>
                {busy === account.phone && (
                  <ActivityIndicator color={colors.primary} />
                )}
              </Pressable>
            ))}
          </ScrollView>

          {error && <Text style={styles.error}>{error}</Text>}

          <View style={styles.footer}>
            <Button
              title="Cancel"
              variant="secondary"
              onPress={onClose}
              disabled={busy !== null}
              fullWidth
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    padding: spacing.lg,
    maxHeight: '80%',
  },
  title: { ...typography.h2, marginBottom: spacing.xs },
  subtitle: {
    ...typography.caption,
    color: colors.textSecondary,
    marginBottom: spacing.md,
  },
  list: { maxHeight: 400, marginBottom: spacing.md },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  itemBusy: { opacity: 0.6 },
  itemLabel: { ...typography.bodyBold, marginBottom: 2 },
  itemPhone: { ...typography.caption, color: colors.textSecondary },
  error: {
    ...typography.caption,
    color: colors.danger,
    marginBottom: spacing.sm,
  },
  footer: { marginTop: spacing.sm },
});
```

### Part 3 — HomeScreen integration

Modify `src/screens/HomeScreen.tsx`:

**Add modal state at the TOP, with the existing hoisted block:**

```tsx
// PR 18 — Quick Switch modal state. Hoisted to top per Rules-of-Hooks
// discipline (PR 12 ETA modal hotfix lineage, reinforced in PR 13,
// PR 14, PR 15, PR 17).
const [quickSwitchVisible, setQuickSwitchVisible] = useState(false);
```

**Add the visibility check at the top with the other hooks:**

```tsx
// PR 18 — Quick Switch button is visible whenever the current user
// is signed in as one of the configured test accounts. This is
// deliberately NOT gated on isAdmin, because switching FROM admin
// TO another role would lose the admin claim and hide the button
// (stranding the user). Test-list membership survives every switch
// (every test phone is in TEST_ACCOUNTS), so you can move freely
// between all roles. Real customers' phones aren't in the list,
// so they never see the button.
import { TEST_ACCOUNTS } from '../constants/testAccounts';

const currentPhone = useAuthStore(s => s.phoneNumber);
const isTestAccount = currentPhone
  ? TEST_ACCOUNTS.some(a => `+91${a.phone}` === currentPhone)
  : false;
```

**Add the trigger button** in the existing admin/role-tiles section
on Home (visible whenever the user is on a test account):

```tsx
{isTestAccount && (
  <View style={styles.devSection}>
    <Pressable
      onPress={() => setQuickSwitchVisible(true)}
      style={styles.quickSwitchButton}
      accessibilityRole="button"
      accessibilityLabel="Switch to test account"
    >
      <Text style={styles.quickSwitchText}>
        🔀 Switch test account
      </Text>
    </Pressable>
  </View>
)}
```

Styles:

```ts
devSection: {
  paddingHorizontal: spacing.lg,
  marginTop: spacing.md,
},
quickSwitchButton: {
  paddingVertical: spacing.sm,
  paddingHorizontal: spacing.md,
  backgroundColor: colors.surface,
  borderRadius: radii.md,
  borderWidth: 1,
  borderColor: colors.border,
  borderStyle: 'dashed',
  alignSelf: 'flex-start',
},
quickSwitchText: {
  ...typography.caption,
  color: colors.textSecondary,
  fontWeight: '600',
},
```

The dashed border + muted color signals "developer tool, not a
normal user feature" — visual distinction from the real role tiles.

**Render the modal** at the bottom of HomeScreen's JSX:

```tsx
<QuickSwitchModal
  visible={quickSwitchVisible}
  onClose={() => setQuickSwitchVisible(false)}
/>
```

### Part 4 — Tests

No new tests strictly required — this is UI plumbing on top of
already-tested `authService` methods (`signOut`, `startPhoneAuth`,
`confirmOtp` are exercised by existing tests via different surfaces).

If Windsurf wants to add a unit test for `TEST_ACCOUNTS` structure
validation (e.g. "all entries have valid 10-digit phones"), fine,
but skip if it feels like target-hitting.

## Scope (out)

- **Long-press / hidden gesture gating.** Considered but admin claim
  is cleaner — discoverable for the right people, invisible to wrong
  ones.
- **Custom token minting via admin SDK.** Avoided — adds a server
  callable + security review surface. The OTP shortcut is enough.
- **Editing test accounts from the UI.** Editing `testAccounts.ts`
  and shipping an OTA is the workflow. Don't build an in-app editor.
- **Sound/haptic feedback on switch.** Skip.
- **Multi-step "stay signed in as multiple users in parallel"
  feature.** Firebase Auth doesn't support that natively. Out of
  scope.
- **Hiding the button completely in production builds.** Admin
  gating is sufficient — no real customer has admin claim.

## Acceptance checklist

- [ ] `src/constants/testAccounts.ts` created with `TestAccount`
  type + `TEST_ACCOUNTS` array. Phones + labels reflect actual
  dev-project Firebase Console config.
- [ ] `src/components/dev/QuickSwitchModal.tsx` created per spec.
- [ ] `src/screens/HomeScreen.tsx`:
  - [ ] New `quickSwitchVisible` state hoisted to the top.
    Rules-of-Hooks comment block updated to include PR 18.
  - [ ] "Switch test account" button visible whenever
    `useAuthStore(s => s.phoneNumber)` matches an entry in
    `TEST_ACCOUNTS` (not gated on admin role — survives switching
    to non-admin test accounts). Dashed-border styling
    distinguishes it from real role tiles.
  - [ ] Modal renders at the bottom of the JSX tree.
- [ ] Tapping a test account: signs out current user, signs in as
  target, lands on Home in ~5 seconds.
- [ ] Multiple rapid taps don't break (busy state prevents
  re-entry; other entries grey out during in-flight switch).
- [ ] On switch failure (e.g. phone not in Firebase Console list),
  error message appears in the modal; modal stays open for retry.
- [ ] `npx tsc --noEmit`: 0 errors (root + functions).
- [ ] `npm test`: existing 534+ tests still pass.
- [ ] `npm run audit` passes.
- [ ] **Zero new `DO NOT REMOVE` markers added** (8-PR streak).

## Smoke tests (manual, after OTA)

1. **Visibility gating** — sign in as a phone NOT in the test list
   (any real number that isn't in TEST_ACCOUNTS). **No "Switch test
   account" button visible.** Sign out, sign in as any test phone
   → button appears.
2. **First switch** — sign in as Admin test phone. Tap the button.
   Modal opens with list. Tap a Customer entry. Within ~5 seconds,
   you're signed in as that Customer (Home shows customer UI, no
   admin tiles).
3. **Switch back to admin** — button is STILL visible on Customer
   Home (because Customer's phone is in the test list). Tap it →
   pick Admin entry → 5 seconds later you're admin again, admin
   tiles back. Free round-trip.
4. **Failure handling** — temporarily add a fake entry to
   `testAccounts.ts` with a phone NOT in Firebase Console. Tap it.
   Modal shows "Switch failed: Invalid OTP..." or similar. Modal
   stays open. Tap a valid entry → succeeds.
5. **Concurrent tap protection** — open modal, tap two entries in
   quick succession. Second tap should be a no-op (button disabled
   during busy state).
6. **Cart wipe verified** — sign in as Customer, add items to cart.
   Use Quick Switch (after signing back in as admin) to switch to
   another Customer. New Customer should have empty cart (sign-out
   wiped it).
7. **No hook crashes** — switch between 3 accounts in succession.
   No ErrorBoundary "Something went wrong" screens. Hooks discipline
   holding.

## Deploy plan

Pure client OTA:

```powershell
$env:NODE_OPTIONS = "--use-system-ca"
npm test
eas update --branch production --message "PR 18 — Quick Switch test accounts (admin-only)"
```

Tell testers to force-close + reopen TestFlight. **Most testers
won't see any change** — the button only appears for users with
admin claim, which only you have.

## Estimated time

~1.5 hours Windsurf work:

- Part 1 (constants): 10 min
- Part 2 (modal component): 45 min — most of the visible UI lives here
- Part 3 (HomeScreen integration): 20 min — state + button + modal mount
- Part 4 (optional structure test): 10 min
- Smoke tests: 15 min

## Removing this later

When you're done with the testing phase and want to ship to real
customers:

**Option A — Hide the button** (preferred): change the visibility
gate from `isTestAccount` to `false` (or to a new feature flag that
defaults off). The test accounts file + modal component stay in the
codebase but the UI surface disappears. Easy to re-enable later.
(Alternatively, since real customers' phones aren't in TEST_ACCOUNTS,
the button auto-hides for them in production — you may not even
need to actively remove it. But explicit `false` is safer.)

**Option B — Delete the files**: `git rm` the modal, the constants
file, and the HomeScreen button. Cleaner if you're confident this
won't come back. ~5 min revert.

Either way, plan the removal alongside the production project
setup (per PRELAUNCH_CHECKLIST "Production Firebase project setup"
section). Test accounts only exist in dev project anyway — they
don't ship to prod with shop owner data.

## Why this PR matters

Pure productivity multiplier. Once it's live, the marginal cost of
running an end-to-end smoke test (customer places → shop accepts →
delivery picks up → customer sees delivered) drops from ~5 minutes
of sign-out/sign-in friction to ~30 seconds of actual app
interaction. Tomorrow morning's testing pass becomes dramatically
less tedious for you, AND every future PR's smoke testing benefits.

The feature ships invisible to your family testers (admin gating)
so it doesn't muddy their test plan or test cases. They keep
signing in/out as before; you get the shortcut.
