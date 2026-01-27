"use client";

import { useAuthActions } from "@convex-dev/auth/react";

/**
 * Sign Out Button
 *
 * NOTE: This component requires ConvexAuthNextjsProvider to be configured.
 * Currently, AuthProvider uses plain ConvexProvider (auth not yet configured).
 * Do not use this component until AUTH_GOOGLE_ID and AUTH_GOOGLE_SECRET are set
 * in Convex environment variables and AuthProvider is switched to use
 * ConvexAuthNextjsProvider.
 */
export function SignOutButton() {
  const { signOut } = useAuthActions();

  return (
    <button
      type="button"
      onClick={() => void signOut()}
      className="rounded-lg border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
    >
      Sign Out
    </button>
  );
}
