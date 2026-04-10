/// <reference types="vite/client" />

declare module '*.png' {
  const content: string;
  export default content;
}

declare module '*.jpg' {
  const content: string;
  export default content;
}

declare module '*.jpeg' {
  const content: string;
  export default content;
}

declare module '*.gif' {
  const content: string;
  export default content;
}

declare module '*.svg' {
  const content: string;
  export default content;
}

interface ImportMeta {
  env: {
    VITE_SENTRY_DSN: string;
    VITE_SENTRY_ENVIRONMENT: string;
    VITE_SENTRY_TRACES_SAMPLE_RATE: string;
    VITE_SENTRY_REPLAYS_SESSION_SAMPLE_RATE: string;
    VITE_SENTRY_REPLAYS_ON_ERROR_SAMPLE_RATE: string;
    npm_package_version: string;
    [key: string]: string | undefined;
  };
}
