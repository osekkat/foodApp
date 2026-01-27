# Morocco Food Discovery App

## Product Definition

### Target Users

- Locals looking for reliably good spots (especially in Marrakech/Casablanca/Rabat/Tangier/Fes)
- Tourists who want curated food "guides" and map-first discovery

### Goals (MVP)

- Fast map + search experience for Morocco
- High-trust community signal (reviews/favorites) layered on top of **provider place IDs**
- **Policy-first architecture**: do not persist restricted provider place content; store only allowed IDs + your own content
- Cost-controlled Google API usage from day one

### Success Metrics (first 60-90 days)

- Search-to-place-detail CTR, favorites per user, reviews per place
- P95 search latency, Google API cost per active user
- Avg provider calls per search session (autocomplete -> select -> details)
- Field-mask SKU mix (% Essentials vs Pro vs Enterprise) + cost per SKU
- % of map pans satisfied by place_id-only "tile cache" (IDs only) vs fresh provider search
- % of text searches satisfied by **ID-only search result cache** vs fresh provider search
- % of place pages rendered with no-store + no CDN caching (compliance guardrail)

### Non-Goals (initial)

- Building a proprietary national restaurant database via bulk ingestion/scraping
- Delivery, ordering, or reservations (can integrate later)

### Key Risks

- Google Places ToS / attribution / data retention constraints
- Places API cost blowups from autocomplete + map pan + detail fetches
- UGC abuse (spam/review brigading)
- Accidental ToS violations via CDN/static rendering/localStorage that persist restricted provider content

### Graceful Degradation Strategy

**Service Modes (progressive degradation):**

| Mode | Trigger | Autocomplete/Search | Place Details | Photos | Map Pans |
|------|---------|---------------------|--------------|--------|----------|
| 0 (Normal) | healthy + budget ok | ✅ provider-first | ✅ provider-first | ✅ enabled | ✅ enabled |
| 1 (Cost-Saver) | cost spike OR latency spike | ✅ provider-first (tighter limits) | ✅ (lite fields) | ❌ disabled | ✅ ID-only cache first |
| 2 (Provider-Limited) | provider errors OR breaker open | ❌ (curated + owned search only) | ✅ only for saved/opened places | ❌ | ✅ ID-only cache only |
| 3 (Offline/Owned Only) | offline OR emergency | ❌ | ❌ (owned cards + notes only) | ✅ UGC only | ✅ saved/curated only |

**UI behavior:**
- Mode 1: show subtle "Reduced features to keep things fast" note only if user hits a disabled feature.
- Mode 2+: show non-intrusive banner + explicit "Browse guides/lists/saved places" affordances.

**Implementation:**
```typescript
// Health check runs only when breaker is open or error-rate spikes (avoid constant paid calls)
export const healthCheck = internalAction({
  handler: async (ctx) => {
    try {
      // Lightweight Places API (New) call (ID-only) + mandatory field mask
      const placeId = "ChIJN1t_tDeuEmsRUsoyG83frY4";
      const response = await fetch(`https://places.googleapis.com/v1/places/${placeId}`, {
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": process.env.GOOGLE_PLACES_KEY!,
          "X-Goog-FieldMask": "id",
        },
      });
      const healthy = response.ok;
      await ctx.runMutation(internal.system.setGoogleHealth, { healthy });
      // system mode manager decides Mode 0/1/2 based on health + budgets + error budget burn
    } catch {
      await ctx.runMutation(internal.system.setGoogleHealth, { healthy: false });
      // system mode manager will promote to Mode 2
    }
  },
});
```

**User Communication:**
- Auto-dismiss when service recovers

**Offline Support (MVP-lite):**
- Cache **only owned data** in browser storage:
  - user-generated data (lists, notes, drafts)
  - editorial guides + curated place cards (owned text/images only)
- Cache the **app shell** (PWA-lite) so the app loads offline
- Store provider `place_id` references but do not persist provider names/addresses/photos
- Show "You're offline" indicator
- Queue favorites/review drafts for sync when online

**Service worker cache allowlist:**
- ✅ OK: `/guides/*`, `/lists/*` (owned pages), static assets
- ❌ Never: `/place/*` routes that render provider fields, provider photo proxy responses beyond short TTL

## Architecture Overview

```mermaid
flowchart TB
    subgraph frontend [Frontend - Next.js]
        Pages[App Router Pages]
        Components[Components]
        MapView[Map + List UI]
        I18n[i18n (AR/FR/EN)]
        PhotoProxyRoute[Photo Proxy (Route Handler)]
    end

    subgraph convex [Convex Backend]
        Queries[Queries]
        Mutations[Mutations]
        Actions[Actions - External APIs]
        Cron[Scheduled Jobs]
        RateLimit[Rate Limiter]
        CircuitBreaker[Circuit Breaker]
        ProviderGateway[Provider Gateway (field masks, budgets, redaction)]
        ConvexAuth[Convex Auth]
        Database[(Convex Database)]
    end

    subgraph providers [Places Providers]
        ProviderIface[PlacesProvider Interface]
        GooglePlaces[Google Places API]
    end

    subgraph external [External Services]
        CDN[Vercel Edge / CDN]
        GoogleMaps[Google Maps JS API]
        Sentry[Sentry/Observability]
        Analytics[Product Analytics]
    end

    Pages --> Queries
    Pages --> Mutations
    Pages --> ConvexAuth
    MapView --> GoogleMaps
    I18n --> Pages

    Queries --> Database
    Mutations --> Database
    ConvexAuth --> Database

    Actions --> ProviderGateway
    ProviderGateway --> CircuitBreaker
    CircuitBreaker --> ProviderIface
    ProviderIface --> GooglePlaces
    %% Photo proxy must also flow through ProviderGateway to enforce budgets/breaker/redaction
    PhotoProxyRoute --> ProviderGateway

    CDN --> PhotoProxyRoute
    MapView --> CDN

    Cron --> Actions
    RateLimit --> Actions

    Pages --> Sentry
    Actions --> Sentry
    Pages --> Analytics
```

### Resilience Patterns

**Circuit Breaker States:**
- **Closed**: Normal operation, requests flow through
- **Open**: After 5 consecutive failures or 50% error rate in 1 minute, reject requests immediately and serve stale cache
- **Half-Open**: After 30 seconds, allow one test request through

**Bulkheads + Backpressure (additive):**
- Cap concurrent provider calls (e.g., max 25 in-flight per region) to prevent stampedes
- Queue or shed low-priority requests (photos, "more results") under load

**Singleflight (in-process request coalescing):**
- Coalesce identical in-flight provider calls keyed by a request signature:
  - details: `{placeId, fieldSet, language, region}`
  - search: `{query, bounds, filters, fieldSet, language, region}`
  - photos: `{photoRef, size}`
- Ensures 20 concurrent users opening the same place detail triggers ~1 upstream call per server instance.

**Priority classes (load shedding order):**
1) Place details for an explicit user click
2) Search results (explicit search submit)
3) Autocomplete
4) Photos + "more results"

**Adaptive Budgets:**
- Daily budget guardrail per endpoint class (autocomplete/search/details/photos)
- If budget exceeded: disable expensive endpoints + display "Limited mode" banner

### Scheduled Safety Jobs (Cron)
- **Geo expiry purge**: delete/clear expired `lat/lng` rows on a schedule.
- **ID-only cache purge**: delete expired `mapTileCache` + `searchResultCache` entries.
- **Aggregates repair**: periodically recompute `favoritesCount`, `communityRatingAvg/Count` from source-of-truth tables.
- **Budget watchdog**: if daily budget threshold is crossed, flip feature flags (photos/open-now/provider search) automatically.
- **Degraded mode manager**: promote/demote degraded mode based on health checks + error budget burn rate.

**Photo Proxy Benefits:**
- Implemented as a **single Next.js Route Handler** (`/api/photos/...`) to avoid Convex vs Next.js ambiguity.
- Photo proxy requests **still flow through ProviderGateway enforcement** (budgets + circuit breaker + metrics + redaction)
- Server-side caching with configurable TTL (short-lived, policy-safe)
- Automatic image resizing for different device sizes (thumbnail, medium, full)
- WebP/AVIF format conversion for modern browsers
- API key never exposed to client
- CDN-cacheable URLs (e.g., `/api/photos/{placeId}/{photoRef}?size=medium`)
- Optional **signed URLs** to prevent hotlinking:
  - `/api/photos/{placeId}/{photoRef}?size=medium&exp=...&sig=...`
- Explicit cache headers with small TTL:
  - `Cache-Control: public, s-maxage=900, max-age=300, stale-while-revalidate=60`
- No persistence of image bytes to DB/object storage

## Tech Stack

- **Framework**: Next.js 16.x (App Router) + explicit no-store for provider-backed routes
- **Backend**: Convex (real-time database + serverless functions)
- **Authentication**: Convex Auth (Google OAuth + email/password) (optional later: Apple)
- **Maps**: Google Maps JavaScript API
- **Places Data**: Google Places API (New) with mandatory FieldMask (behind a provider abstraction)
- **Search (Owned Content)**: Convex search index for curated places, guides, lists, dish/taste tags, and review text (owned)
- **Place Discovery (Provider)**: Google Places (New) Text/Nearby Search + ID-only caches (searchResultCache/mapTileCache)
- **Styling**: Tailwind CSS + shadcn/ui components
- **Observability**: Sentry + custom metrics (see Observability section)
- **Testing**: Vitest (unit) + Playwright (e2e) + axe-core (a11y)
- **Deployment**: Vercel (frontend) + Convex Cloud (backend)

## Observability

### Key Metrics

**Performance:**
- Search latency (P50, P95, P99) - target: P95 backend processing < 100ms, end-to-end < 800ms when provider is hit, < 300ms when cache hit
- Place detail load time - target: P95 < 800ms
- Map initial render time - target: < 2s
- Time to interactive - target: < 3s

**Cost:**
- Google Places API calls per hour (by endpoint type)
- Cache hit rate (target: >70% after 30 days)
- Cost per active user per day
- Cost per user journey:
  - autocomplete → selection → details
  - map pan → "search this area" → details
  - details → photos (proxy)
- Photo proxy bandwidth
- FieldMask/SKU mix over time (Essentials vs Pro vs Enterprise)
- Cost spikes by feature flag (e.g., "photos enabled", "open now enabled")

**Business:**
- Search-to-detail conversion rate
- Detail-to-favorite conversion rate
- Reviews per active user per week
- List creation rate
- Share events

### Reliability Targets (SLOs)
- Search success rate: 99.5% over 7 days
- Place page success rate: 99.5% over 7 days
- Error budget policy: when burned >50%, auto-tighten rate limits + disable expensive features

### Synthetic Monitoring (Canaries)
- A scheduled canary that hits:
  - provider health (lightweight call)
  - photo proxy endpoint
  - key user flows (search + details) in a staging-safe way
- Canary failures page on-call and optionally flip feature flags into degraded mode.

### Auto-Mitigation Playbook (When Error Budget Burns)
- Disable photos first
- Disable open-now filter next
- Reduce max results / pagination
- Fall back to curated + community-only discovery mode

### Dependency & Security Policy
- Weekly dependency update window (patch/minor)
- Immediate update workflow for high-severity advisories (framework/runtime)

### Alerts

| Metric | Threshold | Action |
|--------|-----------|--------|
| Google API error rate | >5% for 5 min | Page on-call, enable degraded mode |
| Search P95 latency | >2s for 10 min | Warning notification |
| Daily API cost | >$X (configurable) | Alert + consider emergency throttling |
| Cache hit rate | <50% for 1 hour | Investigate cache invalidation |
| Error rate (any endpoint) | >1% for 5 min | Warning notification |
| Review spam flags | >10/hour | Alert moderation team |

## Performance Patterns

### Optimistic Updates

Apply optimistic updates for these user actions:
- **Favorite/unfavorite**: Update UI immediately, revert on error
- **Add to list**: Show item in list immediately
- **Submit review**: Show review with "Posting..." indicator
- **Helpful vote**: Increment count immediately

```typescript
// Example: Optimistic favorite toggle
const toggleFavorite = useMutation(api.lists.toggleFavorite)
  .withOptimisticUpdate((localStore, args) => {
    const place = localStore.getQuery(api.places.get, { id: args.placeId });
    if (place) {
      localStore.setQuery(api.places.get, { id: args.placeId }, {
        ...place,
        isFavorited: !place.isFavorited,
        favoritesCount: place.favoritesCount + (place.isFavorited ? -1 : 1),
      });
    }
  });
```

### Loading States

- **Skeleton screens**: Use for place cards, review lists, search results
- **Blur placeholders**: Generate blur hash for cached place photos
- **Progressive loading**: Load place summary first, then details, then reviews
- **Infinite scroll**: For search results and reviews (not pagination)

### Image Optimization

- **Lazy loading**: Use `loading="lazy"` + Intersection Observer for below-fold images
- **Responsive sizes**: Request appropriate size from photo proxy based on container
- **Format negotiation**: Serve WebP to supporting browsers, JPEG fallback
- **Blur-up pattern**: Show blurred thumbnail while full image loads

### Map Performance

- **Debounce bounds changes**: 300ms debounce on `onBoundsChanged`
- **Throttle marker updates**: Max 1 update per 100ms during pan
- **Clustering threshold**: Cluster when >50 markers visible
- **Viewport buffer + strict post-filter**:
  - Request with a buffered rectangle/circle
  - Post-filter results by actual returned lat/lng to the *true* viewport bounds
- **Zoom-aware ID-only tile cache (recommended)**:
  - Use geohash/S2 tiles with granularity derived from zoom level (coarser tiles when zoomed out)
  - Maintain a client `seenTiles` set; on pan/zoom request only newly-visible tiles
  - Persist **ID-only tile membership** `{tileKey -> [placeKey...]}` with TTL in Convex (policy-safe)
  - Overlay owned/community data by joining on `placeKey`
  - Keep provider place content ephemeral (in-memory only), never persisted
- **Marker recycling**: Reuse marker objects instead of creating/destroying

**Stampede protection for map pans:**
- Limit provider map-search calls per user per minute separately from text search.
- Under load: serve cached tile IDs + show "results may be incomplete" hint.

## Setup Commands

```bash
# Create Next.js project
npx create-next-app@latest morocco-eats --typescript --tailwind --eslint --app

# Install Convex
npm install convex
npx convex dev  # Creates the Convex project and syncs schema

# Install Convex Auth
npm install @convex-dev/auth @auth/core

# Install Google Maps
npm install @react-google-maps/api

# Install shadcn/ui
npx shadcn@latest init

# Optional (recommended): observability + tests
npm install @sentry/nextjs
npm install -D vitest playwright @axe-core/playwright
npx playwright install

# MSW for API mocking in tests
npm install -D msw
```

## Data Strategy (Policy-First + Owned Data Layer)

Since bulk scraping violates provider terms, we use a hybrid approach:

1. **Just-in-time provider data**: Fetch provider place content on demand using strict field masks (no persistent storage of restricted fields).
2. **Allowed persistence only**: Store `place_id` indefinitely; store lat/lng only with explicit expiry and purge/refresh rules.
3. **Owned data layer**: Store UGC (reviews, photos, lists, tags, notes) + editorial curated content (your own text/photos) in Convex.
4. **Curated seed set**: Maintain a small owned set of "Place Cards" for top spots to power SEO/offline/degraded mode.

### Place Identity Model (Single Key Everywhere)
Use a namespaced `placeKey` across the entire product to support:
- Google places (provider-backed): `placeKey = "g:" + place_id`
- Curated-only places (no provider dependency): `placeKey = "c:" + curatedPlace.slug`
- Future providers: `placeKey = "<provider>:" + providerPlaceId`

All UGC (reviews/lists/tags/notes) references `placeKey`, not Convex doc IDs.

## Provider Data Policy Guardrails (Non-Negotiable)

This section exists to prevent accidental policy violations through caching, logging, analytics, or client storage.

### Data Classification
- **Provider Identifiers (allowed to persist):** `place_id`, `photo_reference`, provider session tokens (ephemeral), provider attribution assets/strings (as required).
- **Provider Place Content (restricted):** provider name, address, phone, hours, ratings, reviews, photos/bytes, etc.
- **Owned Content (safe to persist):** editorial Place Cards, user lists, user reviews (UGC), user photos, tags, notes.
- **Derived/Aggregated (safe to persist):** community aggregates computed from owned data (counts/averages), tile caches of IDs-only, geohash cells.

### Storage + Retention Matrix

| Data Type | Convex DB | CDN/Edge Cache | Server Memory | Browser Storage | Logs/Analytics |
|---|---:|---:|---:|---:|---:|
| Provider identifiers (`place_id`, `photo_reference`) | ✅ allowed | ✅ allowed | ✅ allowed | ✅ allowed (IDs only) | ✅ allowed |
| Provider place content (name/address/phone/hours/ratings/photos) | ❌ never | ⚠️ only via short-lived responses | ✅ ephemeral only | ❌ never | ❌ never |
| Owned editorial + UGC | ✅ allowed | ✅ allowed | ✅ allowed | ✅ allowed | ✅ allowed (PII-minimized) |
| Derived aggregates (community score, counts) | ✅ allowed | ✅ allowed | ✅ allowed | ✅ allowed | ✅ allowed |

### Hard Rules
- Never log full provider responses (including errors). Log only request IDs + status + cost class + latency.
- Analytics events must use `place_id`/`placeKey` only; never include provider name/address as event props.
- Client storage: allow only **IDs + owned content drafts** (notes, drafts), never provider content fields.
- Next.js pages that fetch provider content must be explicitly configured as **no-store** and must not be statically generated.

### Compliance Tests (CI Gate)
- A test that writes a representative provider response into any persistence surface must fail.
- A test that inspects Sentry/analytics payload construction must fail if provider content appears.

### Important Google Places Notes

- Cache strategy must be compatible with Google Places policies (retention windows, attribution, and display requirements).
- Avoid storing Google photo bytes; store `photo_reference` values and fetch images on demand via server-side photo proxy.
- Use **autocomplete session tokens** to reduce cost and correctly bill grouped requests.
- Use **Places API (New)** endpoints with **mandatory FieldMask** and **SKU-aware field sets**:
  - Define SearchResultLite, PlaceHeader, PlaceDetailsFull models
  - Never use wildcard field masks in production
  - Track SKU mix in analytics/metrics to detect silent cost creep

### Provider Gateway (Implementation Detail)
- Centralize provider access behind a single `ProviderGateway` wrapper that:
  - Applies only pre-approved field sets (no ad-hoc masks)
  - Enforces timeouts + retries (jittered) + circuit breaker
  - Emits metrics: latency, error code, cost class, field set, cache outcome
  - Redacts provider responses from logs/errors by default
  - Enforces budget guardrails per endpoint class (autocomplete/search/details/photos)
  - Applies localization defaults:
    - `languageCode` from user locale ("ar" | "fr" | "en")
    - `regionCode: "MA"` unless user explicitly browses another country

### Caching Policy

- **Persisted DB caching**: only `place_id` and expiring lat/lng; do not persist restricted provider place fields (name/address/photos/ratings/etc).
- **Session caching (in-memory only)**: keep last N provider responses in-memory per user session to avoid duplicate calls while typing/panning.
- **ID-only map tile cache** (optional): store only place_id lists per viewport tile (no names/addresses), with short TTL.

### Why Convex?

- **Real-time by default**: Reviews, lists, and favorites update instantly across all clients
- **Type-safe**: Full TypeScript from database to frontend
- **Serverless functions**: No separate API routes needed
- **Built-in auth**: Convex Auth handles OAuth and sessions

## Core Features

### MVP (Launch)

- Home
  - "Near me" quick action (requests geolocation permission)
  - Search bar with autocomplete
  - City quick-picks (Marrakech, Casablanca, Rabat, Tangier, Fes)
  - Curated guides ("Best tagine", "Best cafes")
  - Dish quick-picks ("Tagine", "Couscous", "Pastilla", "Seafood", "Coffee", "Pastries")
  - **Featured Place Cards** (hand-curated "iconic" spots per city)
  - Featured/trending in the selected city
- Search + Browse
  - Autocomplete (session-tokened)
  - Filters: category, price, rating, **open now**, city, **diet/amenities tags** (veg, halal, family, wifi, cash-only)
  - Sort: distance, rating, "community score"
  - Map/list sync + "Search this area" with bounding-box search
- Place Details
  - Photos (via `photo_reference`), hours, phone, website
  - Place Card section (owned): must-try dish + tips + tags
  - Photo gallery with swipe/lightbox view
  - Google rating + community rating aggregates
  - Reviews with edit/delete
  - Save to favorites / lists
  - Personal note + nickname for saved places (helps offline + list clarity)
  - Taste tags (community voting): tagine, couscous, seafood, coffee, pastries, etc.
  - **What to order (owned):** top dishes derived from UGC `dishesTried` + editorial `mustTry`
  - Action buttons:
    - Call (tel: link)
    - Directions (deep link to Google Maps / Apple Maps)
    - Share (Web Share API with fallback to copy link)
    - Website (external link with exit indicator)
- User
  - Sign in (Google + email)
  - Favorites + custom lists (private/public)
  - Basic profile
  - My reviews
- i18n
  - Arabic (RTL), French, English

### V1 (Post-Launch)

- Shareable guides/lists with SEO-friendly pages
- Trust signals: reviewer history, helpful votes, report/flag flow
- Lightweight admin/curation tools for guides and moderation
- Social sharing cards (OpenGraph images for places/lists)
- Food Crawl / Itinerary lists:
  - drag-and-drop ordering
  - optional time slots (breakfast/lunch/dinner)
  - "start here" + "walk/drive to next" links (deep links)
  - shareable link with collaborators (viewer/editor roles)
  - real-time collaboration (Convex): reorder + notes sync instantly
- **Owned Place Cards** (editorial + community metadata you own):
  - Must-try dishes, tips, price notes (MAD), etiquette notes
  - Amenities tags (cash-only, Wi-Fi, family-friendly, vegetarian/halal)
  - Community-uploaded photos as primary gallery when available
- **Dish Explorer**:
  - browse by dish + city
  - "top places for this dish" ranked by owned signals (favorites + dish mentions + review recency)

### V2

- Full offline saved lists (PWA) with selective caching (owned-only + strict allowlist)
- Personal recommendations (based on favorites/reviews + city)
- Notifications (new guide drops, new reviews on saved places, collaborator edits, editorial updates)

## Search & Ranking (Performance + Cost)

### Search Features

**Transliteration Support:**
- Normalize Arabic/French/English variants at index and query time
- Common mappings: "tagine" <-> "tajine" <-> "طاجين", "couscous" <-> "كسكس"
- Use a lightweight transliteration library (e.g., arabic-to-latin mapping table)
- Index places with normalized searchable text combining all variants

**Recent Searches (per user):**
- Store last 20 searches per user
- Display on search focus before typing
- "Clear history" option for privacy

**Popular Searches:**
- Aggregate anonymous search queries daily
- Display top 5-10 trending searches per city
- Useful for tourists who don't know what to search for
- Privacy guardrails:
  - Only display queries that meet a k-anonymity threshold (e.g., >= 20 unique users)
  - Drop queries containing emails/phones/URLs
  - Retain only normalized aggregates (no raw per-user query logs beyond short TTL)

### Search Architecture

**Two-track search: Provider discovery + Owned enrichment**

1) **Provider discovery (places):** Google Places (New) returns ephemeral provider content for rendering + place IDs for joining.
2) **Owned search (food intent):** Convex search indexes dish mentions, curated cards, guides, tags, and reviews.

**Provider-first search (FieldMask + session-token optimized):**
1. Autocomplete (New) with a session token while typing.
2. On selection, Place Details (New) with the same session token.
3. For map viewport, use Text Search (New) with rectangle `locationRestriction` for "Search this area".
4. Overlay community score/favorites/reviews by joining on `placeKey`.

- **Pagination**:
  - Support Google `next_page_token` behavior (including required delay before reuse).
- **Ranking**:
  - Combine distance + Google rating + community score + recency signals.
  - Community score formula: `(favoritesCount * 2) + (communityRatingCount * communityRatingAvg) + (recentReviewBoost)` — adjust weights based on data.
- **Cost controls**:
  - Debounce user input, coalesce identical in-flight requests, and enforce per-user/IP rate limits.
  - Timebox external calls, retry with jitter on transient failures, and fall back to stale cache on provider errors.

### Search Sessions (Token + Dedupe + Cancellation)
- Create a client-side `SearchSession` object on focus of the search bar.
- Keep a single provider session token for the autocomplete → details flow.
- Cancel in-flight autocomplete requests on each keystroke (AbortController).
- Coalesce identical requests within a short window to prevent duplicate calls from map + list + search bar.
- Expire the session token after inactivity (configurable) and start a new session.

## Trust & Safety (UGC)

### Input Validation

| Field | Constraints |
|-------|-------------|
| Review text | 10-2000 characters, no URLs/emails (spam prevention) |
| Review rating | Integer 1-5 |
| Dishes tried | 0-10 items, 1-40 chars each |
| Price paid (MAD) | Optional range bucket (e.g., "<30", "30-70", "70-150", "150+") |
| Visit context | Optional enum ("solo", "couple", "family", "friends") |
| List name | 1-100 characters |
| List description | 0-500 characters |
| Report reason | Required, 10-500 characters |
| User name | 2-50 characters, alphanumeric + spaces |

### Photo Moderation

- Max 5 photos per review
- Max 10MB per photo, JPEG/PNG/WebP only
- Automatic NSFW detection via cloud service (e.g., Google Cloud Vision SafeSearch)
- Photos held for moderation if flagged, auto-approved if clean
- Strip EXIF metadata on upload (privacy)
- Generate thumbnails + blurhash + perceptual hash (spam/dup detection)
- Store per-photo moderation status (pending/approved/rejected) for a real queue

### Rate Limiting (Granular)

| Action | Limit |
|--------|-------|
| Search (authenticated) | 60/minute |
| Search (anonymous) | 20/minute |
| Place detail view | 30/minute |
| Review create/edit | 5/hour |
| Photo upload | 10/hour |
| Report submit | 10/day |
| List create | 10/day |
| Favorite toggle | 60/minute |

### Moderation Policies

- One review per user per place (edit/update instead of duplicates)
- Report/flag reviews + basic moderation queue
- Soft delete for reviews (retain for moderation/audit)
- Automatic spam detection: flag reviews with repetitive text across places
- Add reviewer reputation:
  - "Account age + contribution quality + helpful votes" -> trust tier
  - New/low-rep users: lower rate limits + reviews require "cooldown" before public visibility
- Add edit history + audit log:
  - Keep previous versions of review text (internal) for moderation and dispute resolution
- Add near-duplicate detection:
  - Hash/similarity check on review bodies to catch copy-paste spam across places

### Admin Access Control (RBAC)
- Roles: `admin`, `moderator`, `editor`
- All admin/moderation mutations must check RBAC server-side (never client-side gating only).
- All actions that hide/delete/restore content must write an immutable audit log entry.

## Privacy & Compliance

- Minimize PII in app tables; support account deletion (and UGC handling policy).
- Follow Google attribution/display requirements wherever place data is shown.
- Enforce cache retention rules via `staleAt` + refresh/delete workflows.
- Provide an analytics opt-out toggle (optional) and document data usage.

## Security Hardening (Cost + Compliance)
- Add a strict Content Security Policy (CSP) suitable for Maps JS + your domains.
- Add bot protection for anonymous high-cost endpoints (search/details/photos), with progressive challenges.
- Require **signed photo proxy URLs** (or strict referrer/origin allowlists) in production to prevent hotlinking and budget drain.
- Ensure provider server key is only ever available in server runtimes (Convex env / Next.js server env).
- Redact provider content from error reporting by default (Sentry beforeSend + breadcrumb filtering).

## Project Structure

```
morocco-eats/
├── app/
│   ├── (auth)/
│   ├── (main)/
│   │   ├── page.tsx
│   │   ├── search/page.tsx
│   │   ├── search/popular/route.ts   # Popular searches API
│   │   ├── map/page.tsx
│   │   ├── place/g/[googlePlaceId]/page.tsx
│   │   ├── place/c/[slug]/page.tsx
│   │   ├── category/[slug]/
│   │   ├── lists/
│   │   ├── guides/
│   │   └── profile/
│   ├── api/
│   │   └── photos/[placeId]/[photoRef]/route.ts  # Photo proxy (single source of truth)
│   └── layout.tsx
├── convex/
│   ├── _generated/
│   ├── schema.ts
│   ├── auth.ts
│   ├── places.ts
│   ├── placeDetails.ts            # Full details management
│   ├── placesProvider.ts          # Provider abstraction (Google first)
│   ├── providerGateway.ts         # Central enforcement: masks/budgets/redaction/metrics
│   ├── fieldSets.ts               # Approved FieldMask sets + cost class mapping
│   ├── search.ts
│   ├── searchHistory.ts           # Recent/popular searches
│   ├── reviews.ts
│   ├── reviewHelpful.ts           # Helpful votes
│   ├── lists.ts
│   ├── guides.ts                  # Editorial guides
│   ├── cities.ts                  # City metadata
│   ├── moderation.ts
│   ├── rateLimit.ts
│   ├── circuitBreaker.ts          # Resilience patterns
│   ├── healthCheck.ts             # External service health
│   ├── jobs.ts                    # Cron: purge/repair/budget watchdog
│   ├── featureFlags.ts            # Runtime flags toggled by budgets/health
│   └── googlePlaces.ts            # Google-specific implementation
├── components/
│   ├── maps/
│   ├── places/
│   ├── search/
│   ├── lists/
│   ├── providers/
│   ├── feedback/                  # Banners, toasts, degraded mode UI
│   └── ui/
├── lib/
│   ├── i18n/
│   ├── transliteration/           # Arabic/French/English normalization
│   ├── geohash/                   # Geospatial utilities
│   └── utils.ts
├── tests/
│   ├── fixtures/                  # Google API response fixtures
│   ├── mocks/                     # MSW handlers
│   └── utils/                     # Test helpers
└── public/
```

## Database Schema (Convex)

```typescript
// convex/schema.ts
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
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

  // Audit log for privileged actions (moderation + editorial changes)
  auditLogs: defineTable({
    actorUserId: v.id("users"),
    action: v.string(),      // e.g. "review.softDelete", "review.restore", "guide.publish"
    targetType: v.string(),  // e.g. "review" | "guide" | "curatedPlace"
    targetKey: v.string(),   // e.g. reviewId string or placeKey
    metadata: v.optional(v.string()), // JSON string if needed (avoid PII/provider content)
    createdAt: v.number(),
  }).index("by_actor_recent", ["actorUserId", "createdAt"]),

  categories: defineTable({
    name: v.string(),
    nameAr: v.optional(v.string()),
    nameFr: v.optional(v.string()),
    slug: v.string(),
    icon: v.optional(v.string()),
  }).index("by_slug", ["slug"]),

  // Places table is a policy-safe **anchor** for community content.
  // Use `placeKey` everywhere to support curated-only + future providers.
  places: defineTable({
    placeKey: v.string(),                  // "g:ChIJ..." | "c:..." | "<provider>:..."
    provider: v.optional(v.string()),      // e.g. "google"
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
    cacheKey: v.string(),          // hash(query+filters+city+lang+mode)
    provider: v.string(),          // "google"
    placeKeys: v.array(v.string()),// ID-only ("g:..." or "c:...")
    expiresAt: v.number(),
    createdAt: v.number(),
  })
    .index("by_key", ["cacheKey"])
    .index("by_expiry", ["expiresAt"]),

  // Policy-safe ID-only cache: map tile membership. Chunk to keep documents small.
  mapTileCache: defineTable({
    tileKey: v.string(),           // e.g. "s2:12:89ab..."
    zoom: v.number(),
    chunk: v.number(),             // 0..N
    provider: v.string(),          // "google"
    placeKeys: v.array(v.string()),// ID-only
    expiresAt: v.number(),
    createdAt: v.number(),
  })
    .index("by_tile", ["tileKey", "zoom", "chunk"])
    .index("by_expiry", ["expiresAt"]),

  // Owned editorial + community place cards (safe to persist)
  curatedPlaces: defineTable({
    title: v.string(),                 // display name you own
    slug: v.string(),
    city: v.string(),
    neighborhood: v.optional(v.string()),
    placeKey: v.string(),                 // "c:" + slug
    linkedPlaceKey: v.optional(v.string()), // optional link to provider placeKey ("g:...")
    summary: v.string(),
    mustTry: v.optional(v.array(v.string())),
    priceNote: v.optional(v.string()),     // e.g., "30-70 MAD"
    tags: v.optional(v.array(v.string())), // amenities/diet vibes
    coverStorageId: v.optional(v.id("_storage")),
    locale: v.string(),                   // "ar" | "fr" | "en"
    publishedAt: v.optional(v.number()),
    featured: v.boolean(),
    sortOrder: v.number(),
  })
    .index("by_slug", ["slug"])
    .index("by_city_featured", ["city", "featured", "sortOrder"]),

  // Community taste tags for places
  placeTags: defineTable({
    placeKey: v.string(),
    tag: v.string(),               // normalized tag key
    votesUp: v.number(),
    votesDown: v.number(),
    updatedAt: v.number(),
  }).index("by_place", ["placeKey"]),

  // Dish mentions derived from owned UGC + editorial must-try lists
  placeDishes: defineTable({
    placeKey: v.string(),
    dish: v.string(),             // normalized key, e.g. "tagine"
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

  // User reviews (one per user per place)
  reviews: defineTable({
    userId: v.id("users"),
    placeKey: v.string(),
    rating: v.number(),
    text: v.optional(v.string()),
    dishesTried: v.optional(v.array(v.string())),
    pricePaidBucketMad: v.optional(v.string()),
    visitContext: v.optional(v.string()),
    photoIds: v.optional(v.array(v.id("ugcPhotos"))), // User-uploaded photos (moderation-aware)
    helpfulCount: v.number(), // Denormalized count
    createdAt: v.number(),
    updatedAt: v.optional(v.number()),
    deletedAt: v.optional(v.number()),
  })
    .index("by_place", ["placeKey"])
    .index("by_user", ["userId"])
    .index("by_user_place", ["userId", "placeKey"])
    .index("by_place_recent", ["placeKey", "createdAt"]), // For sorting reviews

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
    .index("by_user_review", ["userId", "reviewId"]), // Prevent duplicate votes

  // User lists (favorites is just a default list type)
  lists: defineTable({
    userId: v.id("users"),
    name: v.string(),
    description: v.optional(v.string()), // For shareable guides
    coverPhotoReference: v.optional(v.string()), // Visual appeal
    type: v.string(), // "favorites" | "custom" | "itinerary"
    visibility: v.string(), // "private" | "public"
    slug: v.optional(v.string()), // For SEO-friendly URLs
    itemCount: v.number(), // Denormalized for display
    createdAt: v.number(),
    updatedAt: v.optional(v.number()),
  })
    .index("by_user", ["userId"])
    .index("by_slug", ["slug"]), // For public list URLs

  listItems: defineTable({
    listId: v.id("lists"),
    placeKey: v.string(),
    sortOrder: v.number(),                // supports itinerary ordering
    timeSlot: v.optional(v.string()),     // "breakfast" | "lunch" | "dinner" | "snack"
    itemNote: v.optional(v.string()),     // owned note per stop
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

  // Editorial guides (curated content, different from user lists)
  guides: defineTable({
    title: v.string(),
    slug: v.string(),
    description: v.string(),
    coverImageUrl: v.string(),
    city: v.optional(v.string()),
    categorySlug: v.optional(v.string()),
    placeKeys: v.array(v.string()),
    authorId: v.optional(v.id("users")), // Optional editorial author
    publishedAt: v.optional(v.number()),
    featured: v.boolean(),
    sortOrder: v.number(),
    locale: v.string(), // "ar" | "fr" | "en"
  })
    .index("by_slug", ["slug"])
    .index("by_city", ["city"])
    .index("by_featured", ["featured", "sortOrder"]),

  // City metadata
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

  // User preferences
  userPreferences: defineTable({
    userId: v.id("users"),
    analyticsOptOut: v.boolean(),
    defaultCity: v.optional(v.string()),
    mapStyle: v.optional(v.string()), // "standard" | "satellite" | "terrain"
    distanceUnit: v.string(), // "km" | "mi"
  }).index("by_user", ["userId"]),

  // Recent searches (per user)
  recentSearches: defineTable({
    userId: v.id("users"),
    query: v.string(),
    filters: v.optional(v.object({
      city: v.optional(v.string()),
      category: v.optional(v.string()),
    })),
    resultCount: v.number(),
    searchedAt: v.number(),
  }).index("by_user_recent", ["userId", "searchedAt"]),

  // Moderation primitives
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

  // Simple rate limiting (per user/IP + action key)
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
    key: v.string(),           // e.g. "photos_enabled", "open_now_enabled"
    enabled: v.boolean(),
    reason: v.optional(v.string()), // e.g. "budget_exceeded", "degraded_mode"
    updatedAt: v.number(),
  }).index("by_key", ["key"]),
});
```

## API Keys and Secrets

1. **Convex**
   - Environment variables via Convex dashboard

2. **Google Cloud Console**
   - Use **two** keys:
     - Browser key: Maps JS API (HTTP referrer restrictions)
     - Server key: Places API (kept in Convex env; restrict by API and tight quotas)
   - Enable Maps JavaScript API + Places API
   - Set quotas + budget alerts from day one

3. **Runtime Security Headers**
   - CSP, Referrer-Policy, Permissions-Policy, X-Content-Type-Options
   - Disable caching by default on provider-backed pages/routes unless explicitly allowed

## Cost Considerations

Note: Google pricing changes frequently; confirm current rates in the Google Cloud pricing page and your billing console.

Mitigation strategies:

- Serve from cache first; refresh stale in background
- Use session tokens for autocomplete and detail fetch sequences
- Coalesce in-flight identical requests (avoid N users triggering N detail fetches)
- Rate limit per user/IP; require explicit user intent for expensive calls (photos/details)
- Set monthly budget alerts + per-endpoint quotas in Google Cloud
- Photo proxy with CDN caching reduces repeated photo fetches
- Use strict FieldMask to control SKU tier and avoid unnecessary Pro/Enterprise charges

## Testing & CI

### Test Types

**Unit Tests (Vitest):**
- Provider mapping + response transformation
- Caching logic (stale detection, TTL calculation)
- Transliteration/search normalization
- Rate limit calculations
- Geohash encoding/decoding

**Compliance Regression Tests (Must-have):**
- Tests that verify provider response objects are never written to Convex tables.
- Tests that verify analytics payload builders reject provider content fields.
- Tests that verify Next.js provider-backed routes are configured as no-store.

**Contract Tests (Provider Field Sets):**
- For each approved field set, validate:
  - the mapping layer handles missing fields safely
  - no extra fields are requested beyond what the UI needs

**Integration Tests (Convex test framework):**
- Review/list mutations with aggregate updates
- Rate limiting enforcement
- Auth flows
- Search with filters

**E2E Tests (Playwright):**
- Critical flows: search -> place -> favorite -> review
- RTL layout verification (Arabic locale)
- Mobile responsive breakpoints
- Offline behavior (service worker)

**Accessibility Tests (axe-core + Playwright):**
- WCAG 2.1 AA compliance
- Screen reader navigation
- Keyboard navigation
- Color contrast (all themes)

**Visual Regression (Playwright screenshots):**
- Component library in all locales
- RTL vs LTR layouts
- Mobile vs desktop views

**Load Tests (k6 or Artillery):**
- Simulate 1000 concurrent users searching
- Measure Google API call amplification
- Verify rate limiting under load
- Cache behavior under pressure

### Mocking Strategy

- Use MSW (Mock Service Worker) for Google API in development/test
- Seed database with realistic test data (100 places, 500 reviews)
- Fixtures for common Google API responses
- Error simulation for resilience testing

## Development Workflow

```bash
# Terminal 1: Next.js frontend
npm run dev

# Terminal 2: Convex backend
npx convex dev

# Tests
npm test
npx playwright test
```

## Implementation Order (Milestones)

1. **Foundations**: Repo setup, env separation (dev/staging/prod), Sentry, basic rate limiting, circuit breaker
2. **Schema + Provider**: Places provider abstraction + policy-safe caching fields + photo proxy + Provider Gateway
3. **Search MVP**: Autocomplete w/ session tokens + FieldMask + SearchSession (dedupe/cancellation), Google fallback, transliteration
4. **Map MVP**: Bounds-based search (Text Search with rectangle) + clustering + map/list sync + zoom-aware ID-only tile cache
5. **Place Page MVP**: Details fetch with FieldMask, save to favorites/list, action buttons (call/directions/share)
6. **UGC MVP**: One-review-per-place, aggregates, edit/delete, photo uploads, taste tags, structured review fields
7. **Curated Places MVP**: Editorial place cards for top spots, degraded mode backbone
8. **i18n MVP**: AR/FR/EN with RTL layout testing
9. **Trust + Moderation**: Reports, basic admin queue (RBAC + audit logs), anti-spam tightening, helpful votes, reputation tiers
10. **Safety Jobs**: Geo expiry purge, aggregates repair, budget watchdog, feature flag automation
11. **Polish + Launch**: Performance pass, accessibility audit, SEO metadata for lists/guides, observability dashboard, security headers
