# PR 25 — Privacy Policy + ToS hosted + linked in-app (Windsurf prompt)

## Why this PR exists

Apple App Store Review and Google Play both require a **publicly
reachable Privacy Policy URL** before a build can be submitted. The
Privacy Policy text already exists as a markdown draft at
`docs/privacy-policy.md` (written May 16, 2026), but it is **not
hosted anywhere a reviewer can hit with a URL**, and **no in-app
link points to it from the screens where Indian consumer-protection
guidance expects it** (Login, Sign-up, Profile, payment confirmation).

There is also no Terms of Service document at all yet. The Razorpay
flow technically allows checkout without a ToS today, but a real
launch (and any future RBI / consumer-court question) needs one.

**Scope of PR 25:**

1. Author a Terms of Service markdown at `docs/terms-of-service.md`
   that mirrors the Privacy Policy's structure and tone.
2. Convert both markdown files into static HTML and publish them via
   **Firebase Hosting** (already configured in `firebase.json` —
   `"hosting": { "public": "dist", ... }`).
3. Surface the two URLs in-app:
   - `LoginScreen` — a footer line on the "Enter your phone number"
     phase: "By continuing, you agree to our Terms and Privacy Policy."
     with the two phrases tappable, opening the URLs in an in-app
     browser (`expo-web-browser`).
   - `ProfileScreen` — a new "Legal" section above "Account" with
     two `Pressable` rows: "Terms of Service" and "Privacy Policy".
4. Store the URLs centrally so a future re-host (move to a custom
   domain, e.g. `kiranamart.in/privacy`) is a one-line change.

This is the **lightest-weight launch unblock** in Phase A. No server
changes. No native rebuild. Pure client + a one-shot
`firebase deploy --only hosting`.

## Read first

- `.windsurf/code-discipline.md`, `.windsurf/test-discipline.md`,
  `.windsurf/deploy-discipline.md`.
- `docs/privacy-policy.md` — the existing draft. Read in full so the
  ToS you author mirrors its structure (numbered sections, plain
  English, contact-us footer with `sudhir.davim@gmail.com`).
- `firebase.json` — note the `"hosting"` block already points at
  `dist/` and rewrites `**` → `/index.html`. PR 25 needs to override
  the catch-all rewrite for `/privacy` and `/terms` (or simpler:
  serve `dist/privacy.html` and `dist/terms.html` and let the
  rewrite catch only unknown paths).
- `src/screens/LoginScreen.tsx` (~line 146 onward) — the
  `phase === 'enter_phone'` block. New footer goes below the "Send
  OTP" button, above the closing `</View>`.
- `src/screens/ProfileScreen.tsx` (~line 340 — the "Account" section
  header) — the new "Legal" section sits immediately above it.
- `package.json` deps — `expo-web-browser` is NOT currently in
  deps. PR 25 adds it. Used to open the hosted URL in an in-app
  browser tab so the user never leaves the app context. (Falls back
  to `Linking.openURL` on web.)
- `app.json` `extra` block (~line 82) — the URLs are stashed here
  next to the existing `firebase` and `sentry` extras, then read in
  the screens via `expo-constants` (same pattern as
  `src/services/sentry.ts`).

## Critical lessons from PRs 12–24 (do not repeat)

1. **No source-file edits while the prompt is being drafted.** PR 25
   is doc + tiny client wiring — no risk of multi-edit truncation if
   each screen change is one small, well-scoped `replace`.
2. **Never strip imports between edits in the same PR.** Two screens
   are touched (`LoginScreen`, `ProfileScreen`); each gets one new
   import (`WebBrowser` + `Constants`-based URL helper). Keep them
   in place across edits.
3. **All `useState` calls in screens sit ABOVE conditional early
   returns.** PR 25 adds NO new state — only static views + tap
   handlers. Confirm hooks order is unchanged after edits.
4. **Server-first deploy** still applies even though it's hosting,
   not functions. Order: `firebase deploy --only hosting` (URLs go
   live) → THEN `eas update --branch production` (client OTA that
   references those URLs). If the OTA goes first, a tester tapping
   "Privacy Policy" before hosting is deployed gets a 404.
5. **Zero new `DO NOT REMOVE` markers expected.** 14-PR streak.

## Scope (in)

### Part 1 — Author Terms of Service

Create `docs/terms-of-service.md`. Match the structure of
`docs/privacy-policy.md` exactly (heading levels, "Effective date /
Last updated" block, numbered sections, contact-us footer with
`sudhir.davim@gmail.com`). Sections to cover at minimum:

1. Who we are (mirrors PP §1).
2. Acceptance of terms — clicking "Send OTP" constitutes acceptance.
3. Account responsibilities — phone number, OTP confidentiality,
   one shop per owner (call this out — it's enforced server-side).
4. Permitted use — customers buy from shops; shopkeepers operate
   honestly; delivery partners deliver in good faith.
5. Prohibited use — no fraud, no impersonation, no scraping.
6. Orders, payments, refunds — point to Razorpay handling, mention
   the 2-minute self-cancel window, link to PP §payment.
7. Pricing and availability — prices set by shop owners; out-of-stock
   items may be substituted per customer preference (PR 21).
8. Delivery — independent delivery partners; ETAs are estimates;
   delays do not give rise to penalty claims against Kirana Mart.
9. Content and ratings — customers' ratings/reviews are licensed to
   Kirana Mart on a perpetual non-exclusive basis (so we can show
   them on shop cards).
10. Liability disclaimer — Kirana Mart is a marketplace, not a
    seller; shops are responsible for product quality; we provide
    best-effort dispute mediation.
11. Termination — we can suspend accounts for violation; users can
    delete their account by emailing the support address.
12. Changes to these terms — we'll notify via in-app push +
    next-launch banner when material changes ship.
13. Governing law — Indian law; jurisdiction in the city of the
    operating entity (placeholder: `[CITY TBD before launch]`).
14. Contact us — `sudhir.davim@gmail.com`.

Tone: plain English, paragraph form. No legalese marketing copy. The
draft is the actual content that will go live — Sudhir will spot-edit
before publish but the structure should be ready.

### Part 2 — Build static HTML for hosting

Create `dist/privacy.html` and `dist/terms.html`. Plain
mobile-friendly HTML, no JS framework, no external CSS dependency.

A minimal `dist/_legal-template.html` is acceptable as a generator
input, but the deployed files must be standalone HTML the reviewer
can hit with a URL. Recommended approach:

- A tiny one-shot Node script `scripts/build-legal-html.ts` (similar
  pattern to `scripts/generate-branding.ts`) that:
  - Reads `docs/privacy-policy.md` + `docs/terms-of-service.md`
  - Runs them through a minimal markdown-to-HTML converter (e.g.
    `marked` — add as dev dep — or hand-rolled if the doc structure
    is simple enough)
  - Wraps each in a `<!DOCTYPE html>` shell with viewport meta +
    inline CSS (system font stack, max-width 720px, padding,
    light/dark via `prefers-color-scheme`)
  - Writes to `dist/privacy.html` and `dist/terms.html`.
- Add a script alias to `package.json`:
  `"build-legal": "tsx scripts/build-legal-html.ts"`.
- The script is **idempotent** — run it whenever the markdown
  source changes; commit the dist/ outputs.

Add a "Last updated: <date> · View this policy on web at
<URL>" footer to each HTML page so customers landing on the URL
know they're reading the live version.

### Part 3 — Configure Firebase Hosting

`firebase.json` already has a `hosting` block. Add explicit rewrites
so `/privacy` and `/terms` serve the two HTML files (and don't get
swallowed by the SPA-style `**` rewrite to `/index.html`):

```json
"hosting": {
  "public": "dist",
  "ignore": [
    "firebase.json",
    "**/.*",
    "**/node_modules/**"
  ],
  "rewrites": [
    { "source": "/privacy", "destination": "/privacy.html" },
    { "source": "/terms", "destination": "/terms.html" },
    { "source": "**", "destination": "/index.html" }
  ]
}
```

Order matters in Firebase Hosting rewrites — the first match wins.
Keep the catch-all `**` last.

The published URLs (on the current project) will be:

- `https://grocery-mvp-dev.web.app/privacy`
- `https://grocery-mvp-dev.web.app/terms`

After the prod-Firebase split (PR 28) this becomes:

- `https://grocery-mvp-prod.web.app/privacy` (or whichever custom
  domain we put in front of it)

### Part 4 — Centralize the URLs

In `app.json`, extend the `extra` block:

```json
"extra": {
  "eas": { ... },
  "firebase": { ... },
  "sentry": { ... },
  "legal": {
    "privacyUrl": "https://grocery-mvp-dev.web.app/privacy",
    "termsUrl": "https://grocery-mvp-dev.web.app/terms"
  }
}
```

Create `src/constants/legal.ts`:

```ts
import Constants from 'expo-constants';

type LegalConfig = { privacyUrl: string; termsUrl: string };

const fallback: LegalConfig = {
  privacyUrl: 'https://grocery-mvp-dev.web.app/privacy',
  termsUrl: 'https://grocery-mvp-dev.web.app/terms',
};

export function getLegalUrls(): LegalConfig {
  const extra =
    (Constants.expoConfig?.extra as { legal?: LegalConfig } | undefined)
      ?.legal;
  return {
    privacyUrl: extra?.privacyUrl ?? fallback.privacyUrl,
    termsUrl: extra?.termsUrl ?? fallback.termsUrl,
  };
}
```

Same pattern as `src/services/sentry.ts`'s DSN read — `expo-constants`
is Metro-bundler-agnostic and survives release builds where
`process.env.EXPO_PUBLIC_*` has dropped values in the past.

### Part 5 — Add `expo-web-browser` dep and helper

```bash
npx expo install expo-web-browser
```

Create `src/utils/openLegal.ts`:

```ts
import * as WebBrowser from 'expo-web-browser';
import { Linking, Platform } from 'react-native';
import { getLegalUrls } from '../constants/legal';

export async function openPrivacy(): Promise<void> {
  const { privacyUrl } = getLegalUrls();
  return openInBrowser(privacyUrl);
}

export async function openTerms(): Promise<void> {
  const { termsUrl } = getLegalUrls();
  return openInBrowser(termsUrl);
}

async function openInBrowser(url: string): Promise<void> {
  if (Platform.OS === 'web') {
    // expo-web-browser on web pops up a useless about:blank tab.
    // Use Linking.openURL which becomes window.open() with target
    // _blank — the same UX as any external link on a web app.
    await Linking.openURL(url);
    return;
  }
  // openBrowserAsync renders the system in-app browser tab (SFSafari /
  // Chrome Custom Tabs) without bouncing to the OS browser. User
  // returns to Kirana Mart on close — no app re-launch, no auth state
  // loss.
  await WebBrowser.openBrowserAsync(url);
}
```

### Part 6 — Wire LoginScreen footer

In `src/screens/LoginScreen.tsx`, find the `phase === 'enter_phone'`
block (~line 152). Below the `Button title="Send OTP" ...` (around
line 173–177), add a footer:

```tsx
<View style={styles.legalFooter}>
  <Text style={styles.legalText}>
    By continuing, you agree to our{' '}
    <Text style={styles.legalLink} onPress={openTerms}>
      Terms of Service
    </Text>
    {' '}and{' '}
    <Text style={styles.legalLink} onPress={openPrivacy}>
      Privacy Policy
    </Text>
    .
  </Text>
</View>
```

Add the import at the top:

```tsx
import { openPrivacy, openTerms } from '../utils/openLegal';
```

Extend the existing `styles` block with:

```ts
legalFooter: {
  marginTop: spacing.lg,
  alignItems: 'center',
  paddingHorizontal: spacing.md,
},
legalText: {
  ...typography.caption,
  color: colors.textSecondary,
  textAlign: 'center',
  lineHeight: 20,
},
legalLink: {
  ...typography.caption,
  color: colors.primary,
  fontWeight: '600',
  textDecorationLine: 'underline',
},
```

Do NOT add it to the `phase === 'enter_otp'` view — the user has
already accepted (by tapping Send OTP). Keep that screen clean.

### Part 7 — Wire ProfileScreen "Legal" section

In `src/screens/ProfileScreen.tsx`, immediately above the existing
"Account" section title (~line 340), add:

```tsx
<Text style={[styles.sectionTitle, { marginTop: spacing.xl }]}>
  Legal
</Text>
<Pressable
  style={styles.legalRow}
  onPress={openTerms}
  accessibilityRole="link"
  accessibilityLabel="View Terms of Service"
>
  <Text style={styles.legalRowText}>Terms of Service</Text>
  <Text style={styles.chevron}>›</Text>
</Pressable>
<Pressable
  style={styles.legalRow}
  onPress={openPrivacy}
  accessibilityRole="link"
  accessibilityLabel="View Privacy Policy"
>
  <Text style={styles.legalRowText}>Privacy Policy</Text>
  <Text style={styles.chevron}>›</Text>
</Pressable>
```

Add the import at the top:

```tsx
import { openPrivacy, openTerms } from '../utils/openLegal';
```

Extend `styles`:

```ts
legalRow: {
  flexDirection: 'row',
  alignItems: 'center',
  justifyContent: 'space-between',
  paddingVertical: spacing.md,
  paddingHorizontal: spacing.md,
  borderBottomWidth: 1,
  borderBottomColor: colors.border,
},
legalRowText: {
  ...typography.body,
  color: colors.text,
},
```

`chevron` already exists in the stylesheet (used by address rows) —
reuse it.

### Part 8 — Tests

Create `tests/utils/openLegal.test.ts`:

```ts
/**
 * PR 25 — Pure-function tests for the URL accessor + browser opener
 * routing logic. Mocks expo-web-browser and react-native's Linking
 * so the test doesn't try to actually open anything.
 */
import { Platform } from 'react-native';

jest.mock('expo-web-browser', () => ({
  openBrowserAsync: jest.fn(async () => ({ type: 'opened' })),
}));
jest.mock('expo-constants', () => ({
  expoConfig: {
    extra: {
      legal: {
        privacyUrl: 'https://test.example.com/privacy',
        termsUrl: 'https://test.example.com/terms',
      },
    },
  },
}));

const WebBrowser = require('expo-web-browser');
const Linking = require('react-native').Linking;

describe('PR 25 — openLegal', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Linking.openURL = jest.fn(async () => {});
  });

  test('openPrivacy reads the URL from expo-constants extra.legal', async () => {
    const { openPrivacy } = await import('../../src/utils/openLegal');
    Platform.OS = 'ios';
    await openPrivacy();
    expect(WebBrowser.openBrowserAsync).toHaveBeenCalledWith(
      'https://test.example.com/privacy',
    );
  });

  test('openTerms reads the URL from expo-constants extra.legal', async () => {
    const { openTerms } = await import('../../src/utils/openLegal');
    Platform.OS = 'ios';
    await openTerms();
    expect(WebBrowser.openBrowserAsync).toHaveBeenCalledWith(
      'https://test.example.com/terms',
    );
  });

  test('on web, uses Linking.openURL instead of WebBrowser', async () => {
    jest.resetModules();
    const { openPrivacy } = await import('../../src/utils/openLegal');
    Platform.OS = 'web';
    await openPrivacy();
    expect(Linking.openURL).toHaveBeenCalledWith(
      'https://test.example.com/privacy',
    );
    expect(WebBrowser.openBrowserAsync).not.toHaveBeenCalled();
  });
});
```

Plus a tiny constant-test for the fallback (no expo-constants
config):

```ts
test('falls back to grocery-mvp-dev URLs when extra.legal is missing', async () => {
  jest.resetModules();
  jest.doMock('expo-constants', () => ({ expoConfig: {} }));
  const { getLegalUrls } = await import('../../src/constants/legal');
  const urls = getLegalUrls();
  expect(urls.privacyUrl).toMatch(/grocery-mvp-dev\.web\.app\/privacy$/);
  expect(urls.termsUrl).toMatch(/grocery-mvp-dev\.web\.app\/terms$/);
});
```

### Part 9 — PRELAUNCH_CHECKLIST update

In `PRELAUNCH_CHECKLIST.md`, find the unchecked Privacy-Policy /
ToS items under "📝 Compliance & Distribution" and flip them to
checked with `[Shipped — PR 25]` annotations. Add a PR 25 section
at the bottom documenting:

- HTML hosted at the `grocery-mvp-dev.web.app/{privacy,terms}` URLs.
- `app.json` `extra.legal` + `src/constants/legal.ts` indirection
  means moving to a custom domain (post-PR-28 prod split) is a
  two-line change.
- Follow-up: replace `[CITY TBD before launch]` in the ToS with the
  real operating-entity city before the App Store submission.

## Scope (out)

- **Custom domain (e.g. `kiranamart.in`).** Domain procurement +
  DNS is its own workstream. PR 25 ships on the default
  `*.web.app` URL; the indirection in `src/constants/legal.ts`
  lets a future PR swap the URL in one place.
- **Translated versions (Hindi, Tamil, etc.).** Out of scope until
  multi-language UI is on the roadmap (Section 4 deferral).
- **In-app rendered policy view.** Some apps render the policy
  inside a `WebView`. We use the in-app browser tab instead —
  simpler, no `react-native-webview` dep, identical UX for the
  reader, and they can copy/paste / share the URL if they want
  to read on another device.
- **Cookie banner / GDPR consent UI.** India-only beta; not in
  scope. If we expand to EU users a future PR adds the consent
  flow.
- **Privacy Policy / ToS version-bump notification.** Mentioned in
  the ToS §12, but the actual push notification + acceptance flow
  is out of scope. When a material change ships, that PR will
  handle the prompt.

## Acceptance checklist

- [ ] `docs/terms-of-service.md` exists and mirrors the structure
  of `docs/privacy-policy.md`. All 14 sections present. Contact
  email is `sudhir.davim@gmail.com`.
- [ ] `dist/privacy.html` + `dist/terms.html` exist as static
  mobile-friendly HTML pages.
- [ ] `scripts/build-legal-html.ts` exists; `npm run build-legal`
  rebuilds both HTML files from the markdown sources.
- [ ] `firebase.json` `hosting.rewrites` has `/privacy` and `/terms`
  rewrites BEFORE the `**` catch-all.
- [ ] `app.json` `extra.legal` block exists with `privacyUrl` and
  `termsUrl`.
- [ ] `src/constants/legal.ts` reads from `expo-constants` with a
  hard-coded fallback.
- [ ] `expo-web-browser` is a dep (`npx expo install expo-web-browser`).
- [ ] `src/utils/openLegal.ts` exports `openPrivacy()` + `openTerms()`,
  uses `WebBrowser.openBrowserAsync` on native and `Linking.openURL`
  on web.
- [ ] `LoginScreen.tsx` shows the legal footer on the `enter_phone`
  phase only.
- [ ] `ProfileScreen.tsx` shows a "Legal" section with two tappable
  rows above "Account".
- [ ] `tests/utils/openLegal.test.ts` exists; 4 tests pass.
- [ ] `npx tsc --noEmit`: 0 errors.
- [ ] `npm test` overall: green.
- [ ] PRELAUNCH_CHECKLIST: Privacy/ToS items flipped + PR 25 section
  appended.
- [ ] **Zero new `DO NOT REMOVE` markers added** (15-PR streak).

## Deliberate-break check (per `.windsurf/test-discipline.md`)

Before declaring done, temporarily change the fallback URL in
`src/constants/legal.ts` to `https://example.invalid/privacy`. Run
the "falls back to grocery-mvp-dev URLs when extra.legal is missing"
test — it must fail with a clear assertion error pointing at the
fallback. Revert the change. This confirms the test actually pins
the fallback contract.

## Smoke tests (manual, after staged deploy)

1. **Hosted URLs reachable** — open
   `https://grocery-mvp-dev.web.app/privacy` and
   `https://grocery-mvp-dev.web.app/terms` in a normal browser.
   Both load. The content matches `docs/privacy-policy.md` and
   `docs/terms-of-service.md`. Mobile-friendly (no horizontal
   scroll on a phone-width viewport).
2. **In-app login footer renders + works** — open the app, sign
   out, hit Login. On the "Enter your phone number" screen, the
   footer reads "By continuing, you agree to our Terms of Service
   and Privacy Policy." Tap each link — opens the in-app browser
   (SFSafari on iOS, Chrome Custom Tab on Android), not the OS
   browser. Close brings you back to the login screen.
3. **In-app login footer absent on OTP screen** — enter a phone,
   tap Send OTP. On the "Enter the OTP" screen, the legal footer
   is NOT visible. Clean OTP entry area.
4. **Profile screen "Legal" section** — sign in, go to Profile.
   Above the "Account" section there's a "Legal" header with
   two rows. Tapping each opens the in-app browser. Chevrons
   render. Spacing matches the address-row style.
5. **Web build works** — `npm run web`, navigate to /login. The
   legal links open `window.open()` style new tabs (not in-app
   browser, since we're already in a browser).
6. **Sentry quiet** — `WebBrowser.openBrowserAsync` cancellation
   should not throw to Sentry. Open the browser, swipe to close
   without reading. No Sentry event.
7. **Reviewer-walkthrough rehearsal** — pretend to be Apple App
   Review. You have ONLY the App Store listing URL we'll submit
   (which will point to the Firebase Hosting privacy URL). Hit it.
   Read the policy. Verify the contact email is real and clickable.
   You should be able to convince yourself, in 60 seconds, that
   this is a legitimate policy from a real operator.

## Deploy plan

Hosting-first (the URLs must be live before the OTA references them):

```powershell
$env:NODE_OPTIONS = "--use-system-ca"

# 1. Local audit + tests.
npm test

# 2. Rebuild the legal HTML from markdown.
npm run build-legal

# 3. Hosting deploy FIRST so the URLs are live.
firebase deploy --only hosting
# Verify by curl-ing both URLs:
#   curl -I https://grocery-mvp-dev.web.app/privacy
#   curl -I https://grocery-mvp-dev.web.app/terms
# Both should return 200 OK with content-type text/html.

# 4. Commit + push.
git add docs/privacy-policy.md
git add docs/terms-of-service.md
git add dist/privacy.html dist/terms.html
git add scripts/build-legal-html.ts
git add firebase.json app.json
git add src/constants/legal.ts src/utils/openLegal.ts
git add src/screens/LoginScreen.tsx src/screens/ProfileScreen.tsx
git add tests/utils/openLegal.test.ts
git add package.json package-lock.json
git add PRELAUNCH_CHECKLIST.md
git add docs/pr-25-privacy-policy-hosting-windsurf-prompt.md
git commit -m "PR 25: Privacy Policy + ToS hosted on Firebase Hosting + linked in-app"
git push origin main

# 5. Client OTA to production.
eas update --branch production --message "PR 25 - privacy policy + ToS"
```

No Cloud Functions deploy needed.

Note: `expo-web-browser` is a JS-pure native module on iOS/Android
(it wraps `SFSafariViewController` and Chrome Custom Tabs, which are
part of the system APIs — no additional native bridge code). So
adding the dep does NOT require a fresh native build. Verify by
checking the iOS / Android folders aren't generated — `npx expo
install` only edits `package.json` and Expo's autolinking picks it
up on the next bundle.

## Estimated time

~1.5–2 hours Windsurf work:

- Part 1 (ToS markdown): 20 min — most of it is writing the actual
  content; the structure mirrors PP.
- Part 2 (build-legal-html script + dist HTML): 15 min.
- Part 3 (firebase.json rewrite): 5 min.
- Part 4 (constants/legal): 5 min.
- Part 5 (utils/openLegal + dep install): 10 min.
- Part 6 (LoginScreen footer): 10 min.
- Part 7 (ProfileScreen Legal section): 10 min.
- Part 8 (tests, 4 cases): 15 min.
- Part 9 (PRELAUNCH_CHECKLIST update): 5 min.
- Smoke + deliberate-break: 15 min.

## Why this PR matters

App Store Review will reject a build without a working Privacy
Policy URL on first scan; you'll lose ~24 hours per submission
round-trip. Google Play is laxer at intake but will fail the
Data Safety section if there's no policy to reference.

More importantly, having both URLs in-app is the **trust gate**
for any real customer — not just App Review. The "by continuing,
you agree to..." line on the login screen is exactly the kind
of small signal that turns a wary first-time user into one who
actually taps Send OTP.

PR 25 is the lightest-weight thing on the entire roadmap and the
one with the largest binary effect: until it ships, **the app
cannot be submitted for public review at all.**
