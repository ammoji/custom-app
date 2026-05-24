/**
 * Local wrapper around `@react-native-firebase/app`'s config plugin.
 *
 * Why this exists: as of `@react-native-firebase/app@24.x`, the
 * package's compiled plugin (`plugin/build/index.js`) is emitted in
 * TypeScript-ESM-interop form — it exports `{ default: <fn>, ... }`
 * rather than a bare function. Expo CLI (and EAS) handle this fine
 * at runtime because they auto-unwrap `.default`. But the
 * `vscode-expo` static manifest validator does NOT unwrap, can't
 * statically prove the export is a function, and falls through to a
 * syntax-parse attempt that chokes on the package's `.d.ts` files
 * containing `typeof` declarations — surfacing as:
 *
 *     Package "@react-native-firebase/app" does not contain a valid
 *     config plugin. Unexpected token 'typeof'.
 *
 * This is a pure IDE false positive — the actual native build works
 * — but it's noisy in the Problems panel on every keystroke. This
 * wrapper re-exports the unwrapped function so both the runtime AND
 * the static validator see a clean function export.
 *
 * Same pattern is used for `withRnFirebaseAuth.js`. If we add more
 * `@react-native-firebase/*` modules, give each one its own wrapper
 * — it's cheaper than fighting the validator.
 *
 * Pinning note: this contract relies on `@react-native-firebase/app`
 * exposing a `.default` function from its plugin entry. If that
 * shape changes in a future major (e.g. they ship a CJS bare-fn
 * export), this wrapper will throw at prebuild time and we replace
 * it with `module.exports = require('@react-native-firebase/app/app.plugin');`.
 */
const rnfbApp = require('@react-native-firebase/app/app.plugin.js');

const plugin = rnfbApp && rnfbApp.default
  ? rnfbApp.default
  : rnfbApp;

if (typeof plugin !== 'function') {
  throw new Error(
    '[plugins/withRnFirebaseApp] Expected @react-native-firebase/app ' +
      "config plugin to export a function (or { default: function }), got " +
      typeof plugin +
      '. Update this wrapper to match the new export shape.',
  );
}

module.exports = plugin;
