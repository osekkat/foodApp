/**
 * Next.js Instrumentation
 *
 * This file is loaded on both server and edge runtimes.
 * It initializes Sentry with provider content redaction.
 */

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Server runtime - import server config
    await import("./sentry.server.config");
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    // Edge runtime - import edge config
    await import("./sentry.edge.config");
  }
}

export const onRequestError = async (
  error: Error & { digest?: string },
  request: {
    method: string;
    path: string;
  },
  context: {
    routerKind: "Pages Router" | "App Router";
    routePath: string;
    routeType: "render" | "route" | "action" | "middleware";
  }
) => {
  // Use dynamic import to avoid loading Sentry in client bundle
  const Sentry = await import("@sentry/nextjs");

  // Capture the error with context (provider content already scrubbed by beforeSend)
  Sentry.captureException(error, {
    extra: {
      // Only safe metadata - never provider content
      method: request.method,
      path: request.path,
      routerKind: context.routerKind,
      routePath: context.routePath,
      routeType: context.routeType,
      digest: error.digest,
    },
  });
};
