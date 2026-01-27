import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Image domains for external images (Google Places photos will go through proxy)
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "maps.googleapis.com",
      },
      {
        protocol: "https",
        hostname: "maps.gstatic.com",
      },
    ],
  },

  // React Compiler is now a top-level option in Next.js 16
  // reactCompiler: true, // Enable when ready

  // Environment variables exposed to the browser (public)
  env: {
    NEXT_PUBLIC_APP_NAME: "Morocco Eats",
    NEXT_PUBLIC_APP_VERSION: "0.1.0",
  },

  // Headers for security and caching
  async headers() {
    return [
      {
        // Apply to all routes
        source: "/:path*",
        headers: [
          {
            key: "X-DNS-Prefetch-Control",
            value: "on",
          },
          {
            key: "X-Content-Type-Options",
            value: "nosniff",
          },
          {
            key: "Referrer-Policy",
            value: "origin-when-cross-origin",
          },
        ],
      },
      {
        // Provider-backed pages must not be cached
        source: "/place/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "no-store, must-revalidate",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
