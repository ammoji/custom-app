/**
 * Local wrapper around `@react-native-firebase/auth`'s config plugin.
 * See `withRnFirebaseApp.js` for the full rationale — same TS-ESM
 * interop quirk, same vscode-expo static-validator false positive,
 * same fix.
 */
const rnfbAuth = require('@react-native-firebase/auth/app.plugin.js');

const plugin = rnfbAuth && rnfbAuth.default
  ? rnfbAuth.default
  : rnfbAuth;

if (typeof plugin !== 'function') {
  throw new Error(
    '[plugins/withRnFirebaseAuth] Expected @react-native-firebase/auth ' +
      "config plugin to export a function (or { default: function }), got " +
      typeof plugin +
      '. Update this wrapper to match the new export shape.',
  );
}

module.exports = plugin;
