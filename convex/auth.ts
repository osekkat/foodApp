import { convexAuth } from "@convex-dev/auth/server";
import Google from "@auth/core/providers/google";

// Convex Auth configuration
// Requires AUTH_GOOGLE_ID + AUTH_GOOGLE_SECRET in Convex env variables.

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [Google],
});
