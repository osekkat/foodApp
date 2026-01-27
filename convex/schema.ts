import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * Morocco Food Discovery App - Convex Database Schema
 *
 * Policy-First Architecture:
 * - NEVER persist provider content (name/address/phone/hours/ratings/reviews/photos)
 * - ONLY persist: place_id, placeKey, photo_reference, owned content, community aggregates
 * - All UGC references placeKey (never Convex doc IDs)
 *
 * Place Identity Model:
 * - Provider (Google): placeKey = "g:" + place_id
 * - Curated: placeKey = "c:" + curatedPlace.slug
 */

export default defineSchema({
  // ===========================================
  // Users & Authentication
  // ===========================================

  // Users table (managed by Convex Auth)
  users: defineTable({
    email: v.string(),
    name: v.optional(v.string()),
    image: v.optional(v.string()),
    locale: v.optional(v.string()), // "ar" | "fr" | "en"
    createdAt: v.number(),
    lastActiveAt: v.optional(v.number()),
    reviewCount: v.number(), // Denormalized for trust scoring
    helpfulVotesReceived: v.number(), // Denormalized for trust scoring
  }).index("by_email", ["email"]),

  // User reputation for trust tiers
  userReputation: defineTable({
    userId: v.id("users"),
    score: v.number(),
    tier: v.string(), // "new" | "regular" | "trusted"
    updatedAt: v.number(),
  }).index("by_user", ["userId"]),

  // RBAC for admin/moderation/curation tools
  userRoles: defineTable({
    userId: v.id("users"),
    role: v.string(), // "admin" | "moderator" | "editor"
    createdAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_role", ["role"]),

  // Audit log for privileged actions
  auditLogs: defineTable({
    actorUserId: v.id("users"),
    action: v.string(), // e.g. "review.softDelete", "guide.publish"
    targetType: v.string(), // e.g. "review" | "guide" | "curatedPlace"
    targetKey: v.string(), // e.g. reviewId string or placeKey
    metadata: v.optional(v.string()), // JSON string if needed
    createdAt: v.number(),
  }).index("by_actor_recent", ["actorUserId", "createdAt"]),

  // User preferences
  userPreferences: defineTable({
    userId: v.id("users"),
    analyticsOptOut: v.boolean(),
    defaultCity: v.optional(v.string()),
    mapStyle: v.optional(v.string()), // "standard" | "satellite" | "terrain"
    distanceUnit: v.string(), // "km" | "mi"
  }).index("by_user", ["userId"]),

  // ===========================================
  // Places & Policy-Safe Caching
  // ===========================================

  // Categories
  categories: defineTable({
    name: v.string(),
    nameAr: v.optional(v.string()),
    nameFr: v.optional(v.string()),
    slug: v.string(),
    icon: v.optional(v.string()),
  }).index("by_slug", ["slug"]),

  // Places - policy-safe anchor for community content
  // Use placeKey everywhere to support curated-only + future providers
  places: defineTable({
    placeKey: v.string(), // "g:ChIJ..." | "c:..." | "<provider>:..."
    provider: v.optional(v.string()), // e.g. "google"
    providerPlaceId: v.optional(v.string()), // e.g. raw Google place_id
    lat: v.optional(v.number()),
    lng: v.optional(v.number()),
    geoExpiresAt: v.optional(v.number()),

    // Community aggregates (updated on review/list mutations)
    communityRatingAvg: v.optional(v.number()),
    communityRatingCount: v.number(),
    favoritesCount: v.number(),

    createdAt: v.number(),
    lastSeenAt: v.number(),
  })
    .index("by_placeKey", ["placeKey"])
    .index("by_provider_id", ["provider", "providerPlaceId"])
    .index("by_geo_expiry", ["geoExpiresAt"]),

  // Policy-safe ID-only cache: search results -> placeKeys (no provider content)
  searchResultCache: defineTable({
    cacheKey: v.string(), // hash(query+filters+city+lang+mode)
    provider: v.string(), // "google"
    placeKeys: v.array(v.string()), // ID-only ("g:..." or "c:...")
    expiresAt: v.number(),
    createdAt: v.number(),
  })
    .index("by_key", ["cacheKey"])
    .index("by_expiry", ["expiresAt"]),

  // Policy-safe ID-only cache: map tile membership
  mapTileCache: defineTable({
    tileKey: v.string(), // e.g. "s2:12:89ab..."
    zoom: v.number(),
    chunk: v.number(), // 0..N
    provider: v.string(), // "google"
    placeKeys: v.array(v.string()), // ID-only
    expiresAt: v.number(),
    createdAt: v.number(),
  })
    .index("by_tile", ["tileKey", "zoom", "chunk"])
    .index("by_expiry", ["expiresAt"]),

  // ===========================================
  // Curated Content (Owned - Safe to Persist)
  // ===========================================

  // Editorial + community place cards
  curatedPlaces: defineTable({
    title: v.string(), // display name you own
    slug: v.string(),
    city: v.string(),
    neighborhood: v.optional(v.string()),
    placeKey: v.string(), // "c:" + slug
    linkedPlaceKey: v.optional(v.string()), // optional link to provider placeKey
    summary: v.string(),
    mustTry: v.optional(v.array(v.string())),
    priceNote: v.optional(v.string()), // e.g., "30-70 MAD"
    tags: v.optional(v.array(v.string())), // amenities/diet vibes
    coverStorageId: v.optional(v.id("_storage")),
    locale: v.string(), // "ar" | "fr" | "en"
    publishedAt: v.optional(v.number()),
    featured: v.boolean(),
    sortOrder: v.number(),
  })
    .index("by_slug", ["slug"])
    .index("by_city_featured", ["city", "featured", "sortOrder"]),

  // Community taste tags for places
  placeTags: defineTable({
    placeKey: v.string(),
    tag: v.string(), // normalized tag key
    votesUp: v.number(),
    votesDown: v.number(),
    updatedAt: v.number(),
  }).index("by_place", ["placeKey"]),

  // Dish mentions derived from UGC + editorial
  placeDishes: defineTable({
    placeKey: v.string(),
    dish: v.string(), // normalized key, e.g. "tagine"
    mentionsCount: v.number(),
    lastMentionedAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_place", ["placeKey"])
    .index("by_dish", ["dish"]),

  // User personal notes for saved places
  userPlaceNotes: defineTable({
    userId: v.id("users"),
    placeKey: v.string(),
    nickname: v.optional(v.string()),
    note: v.optional(v.string()),
    updatedAt: v.number(),
  }).index("by_user_place", ["userId", "placeKey"]),

  // ===========================================
  // Reviews & UGC
  // ===========================================

  // User reviews (one per user per place)
  reviews: defineTable({
    userId: v.id("users"),
    placeKey: v.string(),
    rating: v.number(),
    text: v.optional(v.string()),
    dishesTried: v.optional(v.array(v.string())),
    pricePaidBucketMad: v.optional(v.string()),
    visitContext: v.optional(v.string()),
    photoIds: v.optional(v.array(v.id("ugcPhotos"))),
    helpfulCount: v.number(), // Denormalized count
    createdAt: v.number(),
    updatedAt: v.optional(v.number()),
    deletedAt: v.optional(v.number()),
  })
    .index("by_place", ["placeKey"])
    .index("by_user", ["userId"])
    .index("by_user_place", ["userId", "placeKey"])
    .index("by_place_recent", ["placeKey", "createdAt"]),

  // Review edit history for moderation/audit
  reviewEdits: defineTable({
    reviewId: v.id("reviews"),
    editorUserId: v.id("users"),
    prevText: v.optional(v.string()),
    nextText: v.optional(v.string()),
    editedAt: v.number(),
  }).index("by_review", ["reviewId", "editedAt"]),

  // Helpful votes on reviews
  reviewHelpful: defineTable({
    reviewId: v.id("reviews"),
    userId: v.id("users"),
    createdAt: v.number(),
  })
    .index("by_review", ["reviewId"])
    .index("by_user_review", ["userId", "reviewId"]),

  // Review reports for moderation
  reviewReports: defineTable({
    reviewId: v.id("reviews"),
    reporterUserId: v.id("users"),
    reason: v.string(),
    createdAt: v.number(),
    resolvedAt: v.optional(v.number()),
  }).index("by_review", ["reviewId"]),

  // UGC photos with moderation support
  ugcPhotos: defineTable({
    uploaderUserId: v.id("users"),
    placeKey: v.string(),
    reviewId: v.optional(v.id("reviews")),
    storageId: v.id("_storage"),
    moderationStatus: v.string(), // "pending" | "approved" | "rejected"
    nsfwScore: v.optional(v.number()),
    width: v.optional(v.number()),
    height: v.optional(v.number()),
    blurhash: v.optional(v.string()),
    perceptualHash: v.optional(v.string()),
    exifStripped: v.boolean(),
    createdAt: v.number(),
  })
    .index("by_review", ["reviewId"])
    .index("by_place", ["placeKey"])
    .index("by_status_recent", ["moderationStatus", "createdAt"]),

  // ===========================================
  // Lists & Favorites
  // ===========================================

  // User lists (favorites is just a default list type)
  lists: defineTable({
    userId: v.id("users"),
    name: v.string(),
    description: v.optional(v.string()),
    coverPhotoReference: v.optional(v.string()),
    type: v.string(), // "favorites" | "custom" | "itinerary"
    visibility: v.string(), // "private" | "public"
    slug: v.optional(v.string()), // For SEO-friendly URLs
    itemCount: v.number(), // Denormalized for display
    createdAt: v.number(),
    updatedAt: v.optional(v.number()),
  })
    .index("by_user", ["userId"])
    .index("by_slug", ["slug"]),

  listItems: defineTable({
    listId: v.id("lists"),
    placeKey: v.string(),
    sortOrder: v.number(), // supports itinerary ordering
    timeSlot: v.optional(v.string()), // "breakfast" | "lunch" | "dinner" | "snack"
    itemNote: v.optional(v.string()), // owned note per stop
    createdAt: v.number(),
  })
    .index("by_list", ["listId"])
    .index("by_place", ["placeKey"])
    .index("by_list_place", ["listId", "placeKey"]),

  // Collaboration for public/itinerary lists
  listCollaborators: defineTable({
    listId: v.id("lists"),
    userId: v.id("users"),
    role: v.string(), // "owner" | "editor" | "viewer"
    createdAt: v.number(),
  })
    .index("by_list", ["listId"])
    .index("by_user", ["userId"])
    .index("by_list_user", ["listId", "userId"]),

  listInvites: defineTable({
    listId: v.id("lists"),
    inviteCode: v.string(),
    role: v.string(), // "editor" | "viewer"
    createdByUserId: v.id("users"),
    createdAt: v.number(),
    expiresAt: v.number(),
  })
    .index("by_code", ["inviteCode"])
    .index("by_list", ["listId"]),

  // ===========================================
  // Editorial Guides
  // ===========================================

  guides: defineTable({
    title: v.string(),
    slug: v.string(),
    description: v.string(),
    coverImageUrl: v.string(),
    city: v.optional(v.string()),
    categorySlug: v.optional(v.string()),
    placeKeys: v.array(v.string()),
    authorId: v.optional(v.id("users")),
    publishedAt: v.optional(v.number()),
    featured: v.boolean(),
    sortOrder: v.number(),
    locale: v.string(), // "ar" | "fr" | "en"
  })
    .index("by_slug", ["slug"])
    .index("by_city", ["city"])
    .index("by_featured", ["featured", "sortOrder"]),

  // ===========================================
  // Cities & Geography
  // ===========================================

  cities: defineTable({
    name: v.string(),
    nameAr: v.string(),
    nameFr: v.string(),
    slug: v.string(),
    lat: v.number(),
    lng: v.number(),
    defaultZoom: v.number(),
    boundingBox: v.object({
      north: v.number(),
      south: v.number(),
      east: v.number(),
      west: v.number(),
    }),
    featured: v.boolean(),
    sortOrder: v.number(),
  })
    .index("by_slug", ["slug"])
    .index("by_featured", ["featured", "sortOrder"]),

  // ===========================================
  // Search History
  // ===========================================

  // Recent searches (per user)
  recentSearches: defineTable({
    userId: v.id("users"),
    query: v.string(),
    filters: v.optional(
      v.object({
        city: v.optional(v.string()),
        category: v.optional(v.string()),
      })
    ),
    resultCount: v.number(),
    searchedAt: v.number(),
  }).index("by_user_recent", ["userId", "searchedAt"]),

  // ===========================================
  // Rate Limiting & System
  // ===========================================

  // Simple rate limiting
  rateLimits: defineTable({
    key: v.string(),
    windowStart: v.number(),
    count: v.number(),
  }).index("by_key", ["key"]),

  // System health tracking
  systemHealth: defineTable({
    service: v.string(), // "google_places" | "google_maps"
    healthy: v.boolean(),
    lastCheckedAt: v.number(),
    lastHealthyAt: v.optional(v.number()),
  }).index("by_service", ["service"]),

  // Feature flags (toggled by budgets/health)
  featureFlags: defineTable({
    key: v.string(), // e.g. "photos_enabled", "open_now_enabled"
    enabled: v.boolean(),
    reason: v.optional(v.string()), // e.g. "budget_exceeded", "degraded_mode"
    updatedAt: v.number(),
  }).index("by_key", ["key"]),
});
