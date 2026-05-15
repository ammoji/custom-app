// Dynamic Expo config. Reads ./app.json as the base and overrides
// ios.googleServicesFile when running on EAS Build, where the plist
// is supplied via a "file" environment variable instead of git.
//
// Locally the env var is unset, so we fall back to the relative path
// — your local GoogleService-Info.plist at the project root works as-is.
//
// On EAS Build, set the var via:
//   eas env:create \
//     --name GOOGLE_SERVICES_INFO_PLIST \
//     --type file \
//     --value ./GoogleService-Info.plist \
//     --visibility secret \
//     --environment development \
//     --environment preview \
//     --environment production
//
// At build time, EAS materializes the file at a temp path and exports
// GOOGLE_SERVICES_INFO_PLIST=<that path>. The expo-config-plugin then
// copies it into the iOS bundle.

const base = require('./app.json');

module.exports = () => {
  const expo = base.expo;
  return {
    ...expo,
    ios: {
      ...expo.ios,
      googleServicesFile:
        process.env.GOOGLE_SERVICES_INFO_PLIST ?? expo.ios.googleServicesFile,
    },
    android: {
      ...expo.android,
      googleServicesFile:
        process.env.GOOGLE_SERVICES_JSON ?? expo.android.googleServicesFile,
    },
  };
};
