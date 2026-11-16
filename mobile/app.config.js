const fs = require('fs');
const path = require('path');

/**
 * Adds to app.json what depends on this machine:
 *  - the Firebase file Android needs for push, when it has been put in this folder;
 *  - the Expo project id from EXPO_PUBLIC_PROJECT_ID, if `eas init` has not written one
 *    into app.json.
 * Without either, the app builds and runs as before; it just cannot receive push.
 */
module.exports = ({ config }) => {
  const googleServices = path.join(__dirname, 'google-services.json');
  const projectId = config.extra?.eas?.projectId ?? process.env.EXPO_PUBLIC_PROJECT_ID;
  return {
    ...config,
    android: {
      ...config.android,
      ...(fs.existsSync(googleServices) ? { googleServicesFile: './google-services.json' } : {}),
    },
    extra: {
      ...config.extra,
      ...(projectId ? { eas: { ...config.extra?.eas, projectId } } : {}),
    },
  };
};
