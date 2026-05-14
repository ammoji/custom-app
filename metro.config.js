const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Zustand v5 ESM build uses import.meta which Hermes on web cannot parse.
// Disabling package exports forces Metro to fall back to legacy field resolution.
config.resolver.unstable_enablePackageExports = false;

// Without this, Metro falls back to the 'module' field (ESM) for some packages
// (react-native-web, firebase shims). Babel doesn't transform node_modules ESM
// re-exports cleanly, so named imports like `Alert` and `getFunctions` end up
// as undefined bindings. Forcing 'main' (CJS) first fixes that.
config.resolver.resolverMainFields = ['react-native', 'browser', 'main'];

module.exports = config;
