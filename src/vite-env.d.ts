/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

/** Injected at build time — see `buildStamp()` in vite.config.ts. */
declare const __BUILD_COMMIT__: string;
declare const __BUILD_TIME__: string;
