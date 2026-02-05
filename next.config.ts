import type { NextConfig } from "next";

// ============================================================================
// Content Security Policy (CSP) Configuration
// ============================================================================
// CSP directives compatible with Google Maps JavaScript API
// See: https://developers.google.com/maps/documentation/javascript/content-security-policy

const isProduction = process.env.NODE_ENV === "production";

function safeOrigin(value: string | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function toWebSocketOrigin(origin: string): string | null {
  try {
    const url = new URL(origin);
    if (url.protocol === "http:") url.protocol = "ws:";
    if (url.protocol === "https:") url.protocol = "wss:";
    return url.origin;
  } catch {
    return null;
  }
}

const convexOrigin = safeOrigin(process.env.NEXT_PUBLIC_CONVEX_URL);
const convexWsOrigin = convexOrigin ? toWebSocketOrigin(convexOrigin) : null;

const ContentSecurityPolicy: Record<string, string[]> = {
  "default-src": ["'self'"],
  "script-src": [
    "'self'",
    "'unsafe-inline'", // Required for Google Maps JS initialization
    "'unsafe-eval'", // Required for Google Maps JS (uses eval for some features)
    "https://maps.googleapis.com",
    "https://maps.gstatic.com",
  ],
  "style-src": [
    "'self'",
    "'unsafe-inline'", // Required for Google Maps JS (inline styles)
    "https://fonts.googleapis.com",
  ],
  "img-src": [
    "'self'",
    "data:",
    "blob:",
    "https://maps.googleapis.com",
    "https://maps.gstatic.com",
    "https://*.ggpht.com", // Google user content (Street View, etc.)
    "https://*.convex.cloud", // Convex storage for user uploads
    "https://images.unsplash.com", // Unsplash for guide cover images
  ],
  "font-src": ["'self'", "https://fonts.gstatic.com"],
  "connect-src": [
    "'self'",
    "https://maps.googleapis.com",
    "https://places.googleapis.com",
    "https://*.convex.cloud", // Convex backend
    "https://*.convex.site", // Convex sites (auth/actions)
    "wss://*.convex.cloud", // Convex WebSocket connections
    // Allow Sentry for error tracking (if configured)
    "https://*.sentry.io",
    "https://*.ingest.sentry.io",
  ],
  "worker-src": ["'self'", "blob:"], // For service workers
  "frame-src": ["https://maps.googleapis.com"], // Google Maps embeds if needed
  "frame-ancestors": ["'none'"], // Prevent clickjacking
  "base-uri": ["'self'"],
  "form-action": ["'self'"],
  "object-src": ["'none'"], // Disallow plugins (Flash, etc.)
};

if (convexOrigin) {
  ContentSecurityPolicy["connect-src"].push(convexOrigin);
}
if (convexWsOrigin) {
  ContentSecurityPolicy["connect-src"].push(convexWsOrigin);
}

// Dev-only: allow websocket connections (HMR, tunnels)
if (!isProduction) {
  ContentSecurityPolicy["connect-src"].push("ws:", "wss:");
}

// Only force HTTPS in production to avoid breaking local dev
if (isProduction) {
  ContentSecurityPolicy["upgrade-insecure-requests"] = [];
}

/**
 * Build CSP string from directives object
 */
function buildCSP(directives: Record<string, string[]>): string {
  return Object.entries(directives)
    .map(([key, values]) => {
      if (values.length === 0) {
        return key; // Directives like upgrade-insecure-requests have no values
      }
      return `${key} ${values.join(" ")}`;
    })
    .join("; ");
}

// ============================================================================
// Security Headers
// ============================================================================

const securityHeaders = [
  // DNS prefetch for performance
  {
    key: "X-DNS-Prefetch-Control",
    value: "on",
  },
  // Enforce HTTPS (only effective over HTTPS)
  ...(isProduction
    ? [
        {
          key: "Strict-Transport-Security",
          value: "max-age=31536000; includeSubDomains; preload",
        },
      ]
    : []),
  // Prevent MIME type sniffing
  {
    key: "X-Content-Type-Options",
    value: "nosniff",
  },
  // Prevent clickjacking
  {
    key: "X-Frame-Options",
    value: "DENY",
  },
  // XSS protection (legacy browsers)
  {
    key: "X-XSS-Protection",
    value: "1; mode=block",
  },
  // Referrer policy
  {
    key: "Referrer-Policy",
    value: "strict-origin-when-cross-origin",
  },
  // Permissions policy (disable unused APIs)
  {
    key: "Permissions-Policy",
    value: [
      "camera=()",
      "microphone=()",
      "geolocation=(self)", // Allow geolocation for location-based features
      "interest-cohort=()", // Opt out of FLoC
      "payment=()", // No Web Payment API
      "usb=()",
      "magnetometer=()",
      "gyroscope=()",
      "accelerometer=()",
    ].join(", "),
  },
  // Content Security Policy
  {
    key: "Content-Security-Policy",
    value: buildCSP(ContentSecurityPolicy),
  },
];

// ============================================================================
// Next.js Configuration
// ============================================================================

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
      {
        protocol: "https",
        hostname: "images.unsplash.com",
      },
    ],
    // Local patterns for photo proxy with query strings
    localPatterns: [
      {
        pathname: "/api/photos/**",
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
        // Apply security headers to all routes
        source: "/:path*",
        headers: securityHeaders,
      },
      {
        // Provider-backed pages must not be cached (compliance requirement)
        // These pages render ephemeral Google Places content
        source: "/place/g/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "no-store, must-revalidate",
          },
          {
            key: "X-Robots-Tag",
            value: "noindex", // Don't index provider-backed pages
          },
        ],
      },
      {
        // Photo proxy - short cache TTL (handled by the route itself)
        source: "/api/photos/:path*",
        headers: [
          {
            key: "X-Robots-Tag",
            value: "noindex",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
