/** Build identity baked in at build time (see vite.config.ts). */
export const APP_VERSION = __APP_VERSION__;
export const APP_COMMIT = __APP_COMMIT__;
export const APP_BUILT_AT = __APP_BUILT_AT__;

/** e.g. "v1.1.0 · b2d2183" */
export const versionLabel = () => `v${APP_VERSION} · ${APP_COMMIT}`;
