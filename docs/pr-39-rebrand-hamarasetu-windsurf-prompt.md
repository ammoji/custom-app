# PR 39 — Rebrand to HamaraSetu + Contact Support row (Windsurf prompt)

## Why this PR exists

Two related changes that ride together because they touch the same
strings and the same screens:

1. **Lock the app name as HamaraSetu (हमारा सेतु — "Our Bridge")
   with the tagline "Shop Smart, Shop Local."** The Expo display name,
   user-facing screen strings, iOS / Android permission prompts, the
   voice-onboarding LLM prompt example, and the hosted Privacy +
   Terms titles all still say "Kirana Mart." Locking in the real
   brand removes the last working title before pilot.
2. **Add a Contact Support row to `ProfileScreen`** that opens the
   user's mail app pre-filled to `sudhir.davim@gmail.com`. There is
   no support contact surfaced anywhere in the app today; pilot
   users with no way to reach the team is a Trust-Principle-2
   ("transparency / closing the loop") violation. Pilot users in
   particular will report bugs by email if it's a single tap away.

**Adjacent decision logged in this PR but NOT being executed:**
- The support contact email stays as `sudhir.davim@gmail.com`
  (Sudhir's personal address). The professional address
  `sarastacklabs@gmail.com` exists but switching ownership of
  Firebase / EAS / Apple Developer / Razorpay / Sentry accounts
  to a new identity is a multi-week migration risk and brings
  zero pilot benefit. Defer to post-pilot, pre-public-launch.
- Bundle IDs `com.sudhirdavim.grocerymvp` stay unchanged. Bundle
  ID is invisible to users; the **display name** they see is
  "HamaraSetu" regardless. Switching bundle IDs requires fresh
  App Store + Play Store entries, loses TestFlight history, and
  re-provisions push certs. Defer to post-pilot.
- `eas.json` `submit.production.ios.appleId` stays as
  `sudhir.davim@gmail.com`. Apple Developer account ownership
  doesn't change in this PR.
- Internal identifiers stay: Expo `slug: grocery-mvp`, Firebase
  project ID `grocery-mvp-dev`, Sentry org/project name
  `grocery-mvp`. These are backend / build-tool keys, not
  user-visible.

**Operating entity for legal docs:** Sara Stack Labs.
**Operating city:** Ballabgarh, Faridabad district, Haryana.
**Legal jurisdiction in §13:** "courts at Faridabad, Haryana."

This is a **lightweight, low-risk PR** in terms of code — almost
entirely string changes and one new file. The risk concentration
is the native rebuild requirement (any `app.json` permission
string change is a runtime-fingerprint change — same OTA-vs-build
rule that bit PR 34). See deploy plan at the bottom.

## Read first

- `.windsurf/code-discipline.md`, `.windsurf/test-discipline.md`,
  `.windsurf/deploy-discipline.md` — and specifically the
  **"OTA vs `eas build`"** decision table in deploy-discipline.md.
  Permission string changes require a native rebuild; OTA will
  not apply them.
- `docs/UI_DESIGN_BRIEF.md` — the design brief just updated with
  the locked name + tagline. The brand wording in this PR should
  match it exactly.
- `app.json` — the canonical source of truth for the display name
  and every permission string this PR touches. Lines 3, 16–19,
  54–55, 88 hold the strings; **the slug, bundle IDs, Sentry
  org/project, and Firebase block stay UNCHANGED.** Read the
  whole file once before editing to keep that boundary clear.
- `docs/privacy-policy.md` + `docs/terms-of-service.md` — the
  markdown that gets compiled into the hosted HTML. The brand
  name appears in headers + footers; §13 still contains
  `[CITY TBD before launch]` that this PR fills in.
- `scripts/build-legal-html.ts` (lines 36, 42) — the build
  script that emits `dist/privacy.html` + `dist/terms.html`.
  Page titles include the brand name.
- `src/screens/LoginScreen.tsx` (~line 147 onwards) — the
  current first-render block. This PR adds a small brand
  block (wordmark + tagline) above the existing "Sign in"
  ScreenHeader so the first thing a user sees is the actual
  app identity.
- `src/screens/ProfileScreen.tsx` (~line 340) — the Legal
  section already added in PR 25. The new "Help & Support"
  section sits **above** the Legal section, **below** the
  active-orders / address block.
- `functions/src/voiceOnboardingHelpers.ts` line 47 — the
  Claude LLM prompt includes "Sharma Kirana Mart" as a
  worked example. Rename example to keep the brand consistent
  in the prompt that the AI sees on every Hindi voice
  onboarding call.

## Centralize brand constants (new file)

Create `src/constants/branding.ts`:

```ts
/**
 * PR 39 — Single source of truth for brand strings.
 *
 * Every user-visible "HamaraSetu" / "Shop Smart, Shop Local" /
 * support email / operating entity reference in the client reads
 * from this file. The point: when (not if) we rename again later
 * — Sara Stack Labs as the operating entity goes public, the
 * tagline shifts post-pilot, etc. — it's a one-line change here
 * instead of a 20-file find-and-replace.
 *
 * Server-side strings (Cloud Functions prompts, hosted legal
 * docs) deliberately do NOT import this — they live in their own
 * source files where they're authored. The constants there must
 * be kept in sync manually; the unit test in
 * `tests/constants/branding.test.ts` pins this file's APP_NAME
 * against the literal "HamaraSetu" so an accidental edit triggers
 * CI failure and forces a deliberate update everywhere.
 */
export const APP_NAME = 'HamaraSetu';
export const APP_NAME_DEVANAGARI = 'हमारा सेतु';
export const TAGLINE = 'Shop Smart, Shop Local';
export const SUPPORT_EMAIL = 'sudhir.davim@gmail.com';
export const OPERATING_ENTITY = 'Sara Stack Labs';
export const OPERATING_CITY = 'Ballabgarh';
export const OPERATING_DISTRICT = 'Faridabad';
export const OPERATING_STATE = 'Haryana';
export const LEGAL_JURISDICTION = 'Faridabad, Haryana';
```

Then everywhere a screen displays the name or tagline, import
the constant instead of a string literal.

## Scope of changes

### A. Display name + permission strings (`app.json`)

Replace every user-visible "Kirana Mart" with "HamaraSetu" and
keep the permission strings natural (the OS shows them verbatim
when prompting the user, so they should read like sentences).

- Line 3: `"name": "Kirana Mart"` → `"name": "HamaraSetu"`
- Line 16: `NSLocationWhenInUseUsageDescription` —
  `"Kirana Mart uses your location to find nearby grocery shops."`
  → `"HamaraSetu uses your location to find nearby grocery shops."`
- Line 17: `NSPhotoLibraryUsageDescription` — Kirana Mart →
  HamaraSetu
- Line 18: `NSPhotoLibraryAddUsageDescription` — same
- Line 19: `NSCameraUsageDescription` — same
- Lines 54–55 (`expo-location` plugin): replace `grocery-mvp`
  with `HamaraSetu` in the two permission descriptions
  (currently they read "Allow grocery-mvp to use your
  location..."). This is the one place where the internal slug
  leaked into a user-visible string.
- Line 88 (`expo-audio` plugin `microphonePermission`): Kirana
  Mart → HamaraSetu

**Do NOT touch:** lines 4 (`slug`), 11 + 24 (`bundleIdentifier`
/ `package`), 27 / 45 / 73 (the green hex color — that's part of
PR 40 visual identity work), 63–64 (`@sentry/react-native`
organization / project), 99–104 (Firebase config). All of these
are internal identifiers — changing any of them is a separate,
much bigger PR.

### B. In-app screen strings

- `src/screens/HomeScreen.tsx`:
  - Line 543: `accessibilityLabel="Open a shop on Kirana Mart"`
    → `accessibilityLabel={\`Open a shop on ${APP_NAME}\`}`
  - Line 545: `<Text style={styles.optInText}>🏪  Open a shop
    on Kirana Mart</Text>` → use `${APP_NAME}` template.
- `src/screens/roles/BecomeDeliveryPartnerScreen.tsx`:
  - Line 153: `<Text style={styles.heading}>Earn flexibly with
    Kirana Mart</Text>` → `Earn flexibly with HamaraSetu` via
    `${APP_NAME}` template.
- `src/screens/LoginScreen.tsx`:
  - Add a new brand block **above** the existing
    `<ScreenHeader title="Sign in" ... />`. Visual treatment:
    centered, with `APP_NAME` in `typography.h1` (or one size
    larger if a custom style is needed) and `TAGLINE` directly
    below in `typography.caption` with `color: colors.textSecondary`.
    Margin: `spacing.xl` top, `spacing.lg` bottom. No box, no
    background — just two stacked text lines. This is the user's
    first visual contact with the app.
  - Keep the existing flow underneath unchanged. The brand block
    sits in the SafeAreaView, above the ScreenHeader.

- `src/utils/openLegal.ts`:
  - Line 7 comment: `to Kirana Mart on close` → `to HamaraSetu
    on close`. Comment-only update, no runtime effect, but keeps
    the codebase consistent.

### C. New Contact Support row (`ProfileScreen`)

Add a new "Help & Support" section above the existing "Legal"
section (which has Terms of Service + Privacy Policy rows from
PR 25). One row inside it:

```tsx
<View style={styles.legalSection}>
  <Text style={styles.legalSectionHeader}>Help & Support</Text>
  <Pressable
    style={styles.legalRow}
    onPress={openSupportEmail}
    accessibilityRole="link"
    accessibilityLabel="Contact HamaraSetu support by email"
  >
    <Text style={styles.legalRowText}>Contact support</Text>
    <Text style={styles.chevron}>›</Text>
  </Pressable>
</View>
```

`openSupportEmail` is a new helper — either inline at the top
of ProfileScreen.tsx or, more reusable, in
`src/utils/openSupport.ts`:

```ts
import { Linking, Platform } from 'react-native';
import { APP_NAME, SUPPORT_EMAIL } from '../constants/branding';

export async function openSupportEmail() {
  const subject = encodeURIComponent(`${APP_NAME} support`);
  const body = encodeURIComponent(
    `\n\n---\nPlatform: ${Platform.OS}\nApp: ${APP_NAME}\n` +
    `(Please describe what you were doing and what you expected.)`,
  );
  const url = `mailto:${SUPPORT_EMAIL}?subject=${subject}&body=${body}`;
  try {
    const supported = await Linking.canOpenURL(url);
    if (!supported) return;
    await Linking.openURL(url);
  } catch {
    // Silent fail — no mail app installed. Future PR can fall
    // back to a copy-to-clipboard toast; not pilot-blocking.
  }
}
```

Reuse the existing `legalSection` + `legalSectionHeader` +
`legalRow` styles from PR 25 so the new section visually matches
the Legal section directly below it.

### D. Voice onboarding LLM prompt

`functions/src/voiceOnboardingHelpers.ts` line 47 — the worked
example "Sharma Kirana Mart" is fed into the Claude prompt as
"here's what a mixed Hindi-English shop name might look like."
Change to a generic Indian kirana name that doesn't reuse the
old brand:

- `"Sharma Kirana Mart"` → `"Sharma Kirana Store"`
  (or `"Sharma General Store"` — pick one and stick with it.
  The point is it's a plausible neighborhood-shop name and
  does NOT echo our own product name.)

If `tests/functions/voiceOnboardingHelpers.test.ts` asserts the
literal string, update the assertion in lockstep.

### E. Legal documents (`docs/privacy-policy.md` +
`docs/terms-of-service.md`)

- Replace every `Kirana Mart` → `HamaraSetu` in headings, body
  text, and "this policy is provided for the X beta program"
  footer.
- Replace `Sudhir Davim` with `Sara Stack Labs` where the
  document names the operating entity (`docs/privacy-policy.md`
  line 19, `docs/terms-of-service.md` line 19 — re-check by
  searching for "Sudhir Davim" in each file).
- Section 13 (Governing Law / Jurisdiction): replace
  `[CITY TBD before launch]` with `Faridabad, Haryana` (the
  district HQ — Ballabgarh sits under Faridabad's jurisdiction
  for court purposes).
- Contact email (`sudhir.davim@gmail.com`) is **unchanged**. It
  appears in the footer of both docs and stays as-is.

### F. Hosted legal HTML

`scripts/build-legal-html.ts` lines 36, 42 — page titles:

- `'Privacy Policy — Kirana Mart'` → `'Privacy Policy — HamaraSetu'`
- `'Terms of Service — Kirana Mart'` → `'Terms of Service —
  HamaraSetu'`

If `dist/index.html` (the hosting landing page) hardcodes the
brand name anywhere, update there too — grep `Kirana Mart` in
`dist/` to confirm.

### G. Operator-visible test scripts

- `scripts/reset-test-data.ts` line 503: replace `Open a shop
  on Kirana Mart` with `Open a shop on HamaraSetu`. This is a
  console-log instruction the operator sees during reset — not
  user-facing but worth keeping consistent.
- `testing/README.md` line 1: `# Kirana Mart — Testing
  Workbooks` → `# HamaraSetu — Testing Workbooks`.

### What this PR explicitly does NOT touch

(Stated so a follow-up review can grep these to confirm none
slipped in.)

- `eas.json` — `appleId` stays `sudhir.davim@gmail.com`.
- `app.json` bundle IDs, slug, Sentry config, Firebase config,
  EAS project ID, runtime version, owner `ammoji`.
- `assets/images/*` — splash icon, app icon, adaptive icon
  variants. These are PR 40 (visual identity) work.
- `CLAUDE.md`, `docs/SESSION_LOG.md`, `docs/ROADMAP.md` —
  these get a sweep in the **post-merge** doc trail pass, not
  in PR 39 itself. Keeping the PR scope to code + legal +
  testing-doc cleanup avoids merge churn.
- Historical PR prompts in `docs/pr-*-windsurf-prompt.md` —
  preserved as historical artifacts. Do not edit.
- `scripts/.cleanup-logs/*.json` — audit log artifacts.
- The colors in `src/constants/theme.ts` — PR 40 will revisit
  the palette for the warm-accent question. PR 39 keeps the
  current green.

## Tests to add

1. `tests/constants/branding.test.ts` — pins each constant to
   the expected literal:
   ```ts
   expect(APP_NAME).toBe('HamaraSetu');
   expect(TAGLINE).toBe('Shop Smart, Shop Local');
   expect(SUPPORT_EMAIL).toBe('sudhir.davim@gmail.com');
   expect(LEGAL_JURISDICTION).toBe('Faridabad, Haryana');
   ```
   This catches accidental edits to the source of truth.
2. `tests/utils/openSupport.test.ts` — mocks `Linking.canOpenURL`
   + `Linking.openURL`, verifies:
   - The composed URL starts with `mailto:sudhir.davim@gmail.com`
   - Subject contains "HamaraSetu support"
   - Body contains the platform name
   - When `canOpenURL` returns false, `openURL` is not called.
3. Update `tests/functions/voiceOnboardingHelpers.test.ts` if it
   pinned the old example string.
4. Re-run the full unit suite (`npm run test:unit`) — should be
   637+ passing (635 baseline + 2 new + delta).

## Discipline checklist

- [ ] All imports stay put per `.windsurf/code-discipline.md`.
      Auto-strip is especially risky on ProfileScreen which already
      has 40+ imports.
- [ ] All `useState` calls stay above any conditional returns
      (Rules of Hooks). The ProfileScreen edit doesn't add state,
      so this is a watch-don't-violate, not a refactor.
- [ ] No runtime change in payment, auth, or orders flow.
- [ ] Centralize through `src/constants/branding.ts` — no new
      hardcoded "HamaraSetu" literal in any of the .tsx files
      this PR touches. (The brand constant import is the rule.)
- [ ] Server-side voice helper updated by hand — that file
      doesn't import from the client `branding.ts` (Cloud
      Functions sandbox is separate). Test pin enforces sync.
- [ ] `firestore.rules` / `firestore.indexes.json` unchanged.
- [ ] No new Firebase Functions secrets needed.

## Deploy plan (read carefully — native rebuild required)

This PR changes iOS / Android **permission description strings**
in `app.json` (Section A above). Per
`.windsurf/deploy-discipline.md` **"OTA vs `eas build`"** section,
any change to `ios.infoPlist` / `android.permissions` /
`plugins[]` triggers a runtime-fingerprint change. **An OTA update
will not apply.** A native rebuild is required.

Sequence Sudhir should run from his machine:

1. `npm run test:unit` — green, 637+ passing.
2. `npm run build-legal` — regenerates `dist/privacy.html` +
   `dist/terms.html`.
3. `firebase deploy --only hosting` — pushes new hosted legal
   pages. Verify in browser:
   `https://grocery-mvp-dev.web.app/privacy` and `/terms` show
   the new name + jurisdiction.
4. `git add -A && git commit -m "PR 39: rebrand to HamaraSetu +
   contact support row"` and push.
5. **EAS production native build**:
   - Confirm `SENTRY_AUTH_TOKEN` is set as an EAS secret first
     (so PR 26 source-map upload finally takes effect on this
     build — the previous build silently skipped it).
     `eas secret:list | findstr SENTRY_AUTH_TOKEN` should show
     it. If empty, run
     `eas secret:create --scope project --name SENTRY_AUTH_TOKEN
     --value <token> --type string --visibility secret
     --environment production` first.
   - `eas build --profile production --platform ios` (and the
     same for android when ready). Will auto-increment build
     number from 15 → 16.
6. After iOS build finishes:
   `eas submit --profile production --platform ios --latest`
   (or set `"autoSubmit": true` in `eas.json` for next time).
7. TestFlight → install build 16 → smoke-test the acceptance
   list below.

## Acceptance smoke test (on device, build 16)

1. **App icon and home screen badge.** Confirm the iOS / Android
   home screen shows "HamaraSetu" as the app name. (Icon
   artwork stays the old icon — PR 40 will replace it. Only the
   text label changes here.)
2. **LoginScreen first render.** Open the app while signed out.
   Above the "Sign in" header, the brand block reads
   "HamaraSetu" and below it the tagline "Shop Smart, Shop Local."
   Footer at the bottom still shows the Terms / Privacy links
   from PR 25.
3. **Permission prompts.** Trigger:
   - Location prompt (open Home for the first time on a fresh
     install). Reads "HamaraSetu uses your location to find
     nearby grocery shops."
   - Microphone prompt (start RegisterShop, tap the big mic).
     Reads "HamaraSetu uses the microphone for voice-assisted
     shop registration..."
   - Camera prompt (ScanMenu — though only if Razorpay actually
     requests it during checkout; on first install of a fresh
     test build the wording check is enough).
4. **HomeScreen opt-in tile.** When signed in as a customer
   without a shop, the "🏪 Open a shop on HamaraSetu" tile shows
   the new brand. Accessibility label matches.
5. **BecomeDeliveryPartner heading.** "Earn flexibly with
   HamaraSetu."
6. **ProfileScreen Contact Support row.** Tap "Contact support."
   Mail app opens with To: `sudhir.davim@gmail.com`, subject
   contains "HamaraSetu support," body has a Platform: line.
   Tap Cancel — return to ProfileScreen cleanly.
7. **Legal links.** From LoginScreen footer AND ProfileScreen
   Legal section: open Terms, open Privacy. Each opens an
   in-app browser tab. The header / title in both shows
   "HamaraSetu" (not Kirana Mart). Scroll to §13 — reads
   "courts at Faridabad, Haryana."
8. **Hosted pages directly.** Visit
   `https://grocery-mvp-dev.web.app/privacy` and `/terms` from
   any browser. New name + jurisdiction + Sara Stack Labs as
   the operating entity.
9. **Voice onboarding sanity.** RegisterShop step 1 → tap big
   mic → speak shop name and address in Hindi → AI fills the
   fields. (Behavior unchanged; the example in the prompt was
   only for the LLM's reference, not user-visible. Smoke just
   confirms voice flow still works after the prompt edit.)
10. **No regressions.** Place a test order end-to-end (customer
    → shop owner accepts → mark ready → delivery partner picks
    up → delivered). Pure brand-rename PR should be zero-impact
    on order flow; verifying it explicitly catches a
    Windsurf auto-import-strip or hooks-order regression.

## Out of scope (next PRs)

- **PR 40 — Visual identity v1.** Logo / wordmark artwork,
  new app icon set, splash with tagline, warm accent color in
  `theme.ts`, Devanagari font bundling. Builds on PR 39's
  `branding.ts` constants.
- **PR 41 — Empty-state + skeleton-loader components.** Per
  the UI design brief Tier 2.
- **Eventual ownership migration** (Apple Developer + Firebase +
  Sentry to `sarastacklabs@gmail.com`, bundle ID change to
  `com.sarastacklabs.hamarasetu`) — defer to post-pilot.

## Definition of done

- Build 16 installs from TestFlight as "HamaraSetu."
- All 10 smoke tests above pass.
- Unit suite green (637+ passing).
- Hosted /privacy and /terms show new brand + jurisdiction.
- No file outside the explicit scope-of-changes list above was
  modified (diff review).
- Doc trail update (CLAUDE.md + SESSION_LOG.md + ROADMAP.md)
  done **after** smoke tests pass, in a follow-up commit by
  Claude, not by Windsurf.
