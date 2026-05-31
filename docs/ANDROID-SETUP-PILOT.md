# HamaraSetu — Android pilot setup (step-by-step)

**Goal:** Get the app installed on your new Android phone, smoke-test
it end-to-end, then hand the same install link to the offshore
testing team so they can validate Android in parallel with iOS for
the 1-shop pilot.

**The path we're taking and why:** We're sideloading an `.apk` for
the pilot, not going through Google Play. Reason: a small known
testing group (you + offshore team + soon shopkeeper + delivery
partner) doesn't need the Play Store overhead, and Play Closed
Testing reviews take 1–3 days per upload — too slow during active
bug-fixing. Sideloading is minutes, not days. Play Closed Testing is
covered in Appendix B as the right longer-term path before public
launch.

**The one snag this guide gets past:** Your existing
`production` build profile produces an `.aab` file (Play Store
format), which Android phones cannot install directly. That's why
build 6 succeeded but nobody could test it. We're adding a small
sibling profile — `internal` — that uses the same production
environment and OTA channel, but builds an `.apk`. So Android
sideload testers stay on exactly the same code path as eventual
production iOS users.

---

## Step 1 — Add the `internal` profile to `eas.json`

Open `eas.json` in your repo. Inside the `"build"` block, add a new
profile **after** `"production"`. The final file looks like this
(only the new block is shown — leave everything else as-is):

```json
"production": {
  "distribution": "store",
  "autoIncrement": true,
  "env": {
    ...
  },
  "android": {
    "buildType": "app-bundle"
  },
  "ios": {},
  "channel": "production"
},
"internal": {
  "extends": "production",
  "distribution": "internal",
  "android": {
    "buildType": "apk"
  }
}
```

**What `extends: "production"` does:** the new `internal` profile
inherits every env var, `autoIncrement: true`, and
`channel: "production"` from the production profile. We then
override only the two things that need to change for sideloading:
`distribution` to `"internal"` (EAS hosts a download link for it)
and `android.buildType` to `"apk"`.

Save the file. Commit it (`git add eas.json && git commit -m "Add
internal Android sideload profile"`) — this is a permanent profile
you'll reuse throughout the pilot.

---

## Step 2 — Build the Android APK

In PowerShell, from the repo root:

```
eas build --profile internal --platform android
```

**What to expect:**
- It uploads your project to EAS, then builds in the cloud — takes
  **~10–15 minutes** typically.
- When it asks "Reuse this distribution certificate / keystore?",
  say **yes** (you already have the production keystore from build 6).
- When it finishes, it prints an URL like
  `https://expo.dev/accounts/ammoji/projects/grocery-mvp/builds/<uuid>`.
  That page has an "Install" button and a direct `.apk` download
  link. Both work for sideloading.

**Important — does this build include the new geo features?**
Yes. Because `extends: "production"` keeps `channel: "production"`,
the APK launches on the same OTA channel where PRs 46–49 live.
First launch will pick them up automatically.

**If the build fails:** check the EAS build log for the failure
reason. The most common one for this project (already fixed in
build 6) was a missing `googleServicesFile`. If it's something else,
paste the error and I'll help debug.

---

## Step 3 — Prepare your Android phone for sideloading

You only do this once per phone. The flow varies a little by
manufacturer (Samsung vs Pixel vs OnePlus etc.) but the substance is
the same.

**A. Enable installs from unknown sources.** Modern Android scopes
this per-app, not globally — you grant the permission to *the app
that's doing the installing* (your browser).
1. Settings → Apps → see all apps → Chrome (or whatever browser
   you'll open the install link in).
2. Look for **"Install unknown apps"** or
   **"Allow from this source"** and turn it **on**.

(Older Android: Settings → Security → "Unknown sources" → on.)

**B. Make sure Google Play Services is installed and up to date.**
This is normally already the case on any real Android phone, but
worth confirming because **push notifications need it**. Settings →
Apps → Google Play Services → confirm it's enabled and shows a
recent version. If you're on a Chinese phone without GMS (rare
outside China), push won't work — flag that and we'll deal with it.

**C. Sign in to your Google account on the phone.** Same reason —
FCM needs a Google account.

---

## Step 4 — Install the APK

1. On the phone, open the **EAS build URL** from Step 2 in your
   browser (the easiest way is to email it to yourself or scan the
   QR code shown on the EAS dashboard).
2. Tap the **download `.apk`** link on that page.
3. When the download finishes, tap the notification or open the file
   from Downloads.
4. Android will show **"For your security, your phone is not allowed
   to install unknown apps from this source"** the first time — tap
   **Settings**, grant the permission, back out, and re-tap the APK
   to install.
5. You may also see a **Play Protect warning** ("Play Protect doesn't
   recognize this app's developer"). This is normal for sideloaded
   apps. Tap **"Install anyway"** (sometimes hidden behind "More
   details"). Play Protect is not blocking the install, just warning.
6. Wait for "App installed" → tap **Open**.

The app launches with the HamaraSetu splash. First launch may take a
few extra seconds while it fetches the OTA bundle from the
production channel.

---

## Step 5 — Smoke-test the basics on your phone (10 min)

These are the must-pass checks before you hand the link to the
testing team. Do them in order — they catch the things Android-
specific that iOS testing wouldn't have caught.

1. **Sign in via phone OTP.** Use your phone number, receive the
   SMS, enter the OTP. If OTP doesn't arrive within ~30 seconds:
   check that your number is in the Firebase Authentication test
   phone list (same setup as iOS), and that Google Play Services is
   working. If still no SMS, the auth fallback path may not have
   been wired for Android — flag it and we'll debug.
2. **Grant notification permission** when prompted. Android 13+
   prompts on first launch. Allow it; we'll test push next.
3. **Browse the shop list.** Confirm shops appear, you see the
   distance on each card (one of the new PR 48 features), and tap
   into one to see the menu.
4. **Place a tiny test order** to a saved address (₹10–₹50 item,
   COD). Confirm the checkout screen shows the
   distance/time estimate and the delivery charge varies as expected
   (new PR 46+47 features). Place the order.
5. **Push notification end-to-end (two-device test — critical).**
   On a separate phone (your iPhone is perfect), sign in as the
   shop owner of the shop you just ordered from. On the iPhone, tap
   "Accept order." Your Android phone should receive a push
   notification within seconds. This is the **highest-risk Android
   check** — push has been the historical pain point. If it doesn't
   land:
   - Confirm Android allowed notifications for the app (Settings →
     Apps → HamaraSetu → Notifications → On).
   - Confirm `users/{your-uid}.fcmTokens` in Firestore has a token
     entry that wasn't there before (a write happened on sign-in).
   - If the token is there but the push didn't arrive, the FCM
     side needs a closer look — paste the doc and I'll diagnose.
6. **Location prompt.** Open Checkout → "Deliver to my current
   location." Android prompts for location. Allow it. Confirm the
   delivery estimate updates with your GPS position. Then go to
   Delivery Dashboard (after switching to the delivery role) and
   confirm it also prompts for location and that pickups sort
   nearest-first.

If all six pass, your phone is set up and the build is good. Stop
here for personal validation — you're ready to onboard the team.

---

## Step 6 — Distribute to the offshore testing team

**Share two things with the team:**

1. **The EAS build URL from Step 2** (or the direct `.apk` download
   link from that page — either works).
2. **The setup instructions** below — paste this verbatim into your
   Slack/email/WhatsApp to the team:

> **HamaraSetu Android setup**
>
> 1. On your Android phone, open this link: `<EAS_BUILD_URL>`
> 2. Tap the "Download APK" link on that page.
> 3. When prompted, allow Chrome (or your browser) to install
>    unknown apps: Settings → Apps → Chrome → Install unknown apps
>    → Allow.
> 4. Open the downloaded `.apk` and tap Install. If Play Protect
>    warns about an unknown developer, tap "More details" →
>    "Install anyway" — this is normal for pilot apps.
> 5. Open the app, allow Notifications when asked, sign in with your
>    test phone number.
> 6. When testing delivery features, allow Location when asked.
> 7. Please test on Android in parallel with iOS and report any
>    differences (UI, push delays, location prompts, anything that
>    behaves differently between the two).
>
> See the "What's New for Testers" doc for the focus areas this
> round (delivery charges by distance, service radius, partner
> ride-distance breakdown, tier-save and service-area save fixes).

**Practical tip:** until Play Closed Testing is set up (Appendix B),
every time you ship a new APK (e.g., after the next native rebuild),
you'll need to send the team the new EAS build URL and they'll
sideload again. **OTA updates** (the kind you've been running with
`eas update`) **do NOT require a re-install** — the existing
sideloaded APK picks them up on next launch. So the only times a
re-install is needed are: native module changes, permission changes,
or `app.json` changes (the "OTA vs eas-build" rule from
`.windsurf/deploy-discipline.md`).

---

## Appendix A — Android-specific things to watch for during testing

These are differences from iOS testing worth knowing in advance so
you don't report them as bugs:

- **Back button behavior.** Android has a physical/gesture Back
  button; iOS does not. The app should handle Back sensibly on every
  screen. If a screen ignores Back or backs out to a wrong place,
  flag it.
- **Permission prompts look different.** Android groups permissions
  (e.g., "Allow only while using the app" vs "Allow all the time"
  for location). The app should work with "while using" — if it
  asks for "all the time," something's misconfigured.
- **Push notification channels.** Android uses notification
  *channels* (categories) the user can toggle individually. The app
  sets these up on first launch; if a tester reports "I get order
  pushes but not new-pickup pushes" (or vice versa), it's a channel
  config issue.
- **Edge-to-edge / safe areas.** Notches, hole-punch cameras, and
  rounded corners vary across Android phones much more than iOS.
  Screen padding may look slightly different on some Androids — UI
  glitches at the very top/bottom of screens are the most common
  Android-only bugs to expect.
- **Razorpay test mode.** Confirm the Razorpay test-mode flow works
  on Android (the SDK is the same, but worth a separate explicit
  check).
- **Storefront photo upload.** The image picker UX differs by
  Android version. Worth testing the shop self-registration KYC
  upload path once on Android specifically.

---

## Appendix B — Google Play Closed Testing (for later, not now)

This is the right path **before public launch**, but not needed for
the pilot. Steps when you're ready:

1. **Finish Play Console developer account approval** ($25 one-time).
   You started this on May 26 — check status at
   `https://play.google.com/console`. Approval takes 1–3 business
   days typically.
2. **Create the app entry** in Play Console with package name
   `com.sudhirdavim.grocerymvp` (matches your `app.json`).
3. **Build an AAB** with the existing production profile:
   ```
   eas build --profile production --platform android
   ```
   (This is the AAB build — same one you've been running. It's the
   right format for Play.)
4. **Upload via EAS submit:**
   ```
   eas submit --profile production --platform android --latest
   ```
   You'll need the Play Console JSON service-account key (similar
   to the Firebase one) — Expo's docs walk through generating it.
5. **Configure Closed Testing track** in Play Console → Testing →
   Closed testing → create a new track → add testers (as a list of
   Gmail addresses or a Google Group).
6. **Promote your uploaded build** to that track and publish.
7. **Wait for Play review** — first submission can take 1–7 days
   (Google's app-review process). Subsequent updates are usually
   reviewed within a few hours.
8. **Send testers the opt-in link** Play Console gives you. They
   join, install via the real Play Store, and updates happen
   automatically through Play — no more sideloading instructions.

This is the path you'll switch to when you're a week or so out from
public launch.

---

## Appendix C — Troubleshooting

**"App not installed" error.** Usually means a previous version with
the same package name is installed but signed with a different
keystore. Uninstall the old version (Settings → Apps → HamaraSetu →
Uninstall), then re-install.

**OTP never arrives.** Confirm Google Play Services is up to date,
the test phone number is whitelisted in Firebase Auth, and the
device has SMS reception. If you have multiple phone numbers in the
test list, try a different one.

**Push notifications don't arrive on Android.** The two-device test
is necessary (a single device switching accounts can't observe push
because the token unregisters on sign-out — known limitation, see
SESSION_LOG May 27 push saga). Confirm:
- Notifications allowed for the app (Settings → Apps → HamaraSetu →
  Notifications → On).
- Battery optimization is **off** for the app (Settings → Apps →
  HamaraSetu → Battery → Unrestricted). Aggressive Android battery
  savers can kill background FCM delivery.
- `users/{uid}.fcmTokens` in Firestore has a non-empty token entry.

**Location not working.** Settings → Apps → HamaraSetu → Permissions
→ Location → "Allow only while using the app" should be selected.
If "Don't allow" is selected the geo features will silently no-op
(by design — won't crash, just won't show distance).

**App crashes on launch.** Pull the Sentry events from the
HamaraSetu Sentry project — Android crashes show up under "Issues"
filtered by `platform: android`. The PR 26 source-map upload should
make the stack traces readable (if the SENTRY_AUTH_TOKEN EAS secret
was set before the build).

**Camera / image upload broken.** Confirm camera permission was
granted. The image picker on Android 13+ uses the new "Photo picker"
which is different from the old gallery flow — worth a sanity check
that your image picker library version supports both.

---

## Quick reference — commands you'll run

```
# One-time: add the internal profile to eas.json (done in Step 1).

# Build a sideload-able APK on the production OTA channel:
eas build --profile internal --platform android

# Push a JS-only update to the same channel (no rebuild needed):
eas update --branch production --message "What changed"

# Later: build the Play Store AAB:
eas build --profile production --platform android

# Later: submit to Play Closed Testing:
eas submit --profile production --platform android --latest
```
