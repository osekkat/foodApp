import { AuthConfig } from "@convex-dev/auth/server";

export default {
  providers: [
    {
      domain: process.env.CONVEX_SITE_URL,
      applicationID: "convex",
    },
  ],
} satisfies AuthConfig;
