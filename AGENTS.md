# AGENTS.md - Morocco Food Discovery App (foodApp)

## RULE 1 - ABSOLUTE (DO NOT EVER VIOLATE THIS)

You may NOT delete any file or directory unless I explicitly give the exact command **in this session**.

- This includes files you just created (tests, tmp files, scripts, etc.).
- You do not get to decide that something is "safe" to remove.
- If you think something should be removed, stop and ask. You must receive clear written approval **before** any deletion command is even proposed.

Treat "never delete files without permission" as a hard invariant.

---

## IRREVERSIBLE GIT & FILESYSTEM ACTIONS

Absolutely forbidden unless I give the **exact command and explicit approval** in the same message:

- `git reset --hard`
- `git clean -fd`
- `rm -rf`
- Any command that can delete or overwrite code/data

Rules:

1. If you are not 100% sure what a command will delete, do not propose or run it. Ask first.
2. Prefer safe tools: `git status`, `git diff`, `git stash`, copying to backups, etc.
3. After approval, restate the command verbatim, list what it will affect, and wait for confirmation.
4. When a destructive command is run, record in your response:
   - The exact user text authorizing it
   - The command run
   - When you ran it

If that audit trail is missing, then you must act as if the operation never happened.

---

## JS/TS TOOLCHAIN

- Use **bun** for everything JS/TS.
- Never use `npm`, `yarn`, or `pnpm`.
- Lockfiles: only `bun.lock`.
- Target **latest Node.js**.
- `bun install -g <pkg>` is valid (alias for `bun add -g`).

---

## PROJECT SUMMARY

- Map-first food discovery for Morocco (Marrakech, Casablanca, Rabat, Tangier, Fes).
- Curated and UGC overlays on top of provider place IDs.
- **Policy-first architecture**: only allowed provider identifiers can be stored; provider content is ephemeral.
- Cost-controlled Google Places usage with strict field masks, budgets, and graceful degradation.

---

## NON-NEGOTIABLE PROVIDER DATA POLICY

- Allowed to persist: `place_id`, `placeKey`, `photo_reference`, ID-only caches, owned content, community aggregates.
- Forbidden to persist: provider name/address/phone/hours/ratings/reviews/photos/bytes or raw provider responses.
- Logs/analytics must never include provider content (log request ID, status, cost class, latency only).
- Provider-backed pages must be `no-store` and `noindex`.
- Photo proxy MUST go through ProviderGateway, use signed URLs, and short TTL caching.
- Service worker allowlist: `/guides/*`, `/lists/*`, static assets. Never cache `/place/*` or `/api/photos/*`.

---

## PLACE IDENTITY MODEL

- Provider: `placeKey = "g:" + place_id`
- Curated: `placeKey = "c:" + curatedPlace.slug`
- All UGC references `placeKey` (never Convex doc IDs).

---

## SERVICE MODES (GRACEFUL DEGRADATION)

- Mode 0 Normal: provider-first search/details/photos.
- Mode 1 Cost-saver: tighter limits, photos disabled, ID-only cache first.
- Mode 2 Provider-limited: curated + owned search only; details only for saved/opened places.
- Mode 3 Offline/Owned only: curated cards + notes only; no provider calls.
- UI: subtle notice on disabled features; banner in Mode 2+.

---

## ARCHITECTURE (PLANNED)

- Next.js 16 App Router + React 19
- Convex backend (queries, mutations, actions)
- ProviderGateway: field mask registry, budgets, circuit breaker, redaction, metrics
- ID-only caches: `searchResultCache`, `mapTileCache` (TTL)
- Photo proxy: `app/api/photos/[placeId]/[photoRef]/route.ts` (signed URLs)
- Service mode manager + feature flags
- i18n AR/FR/EN + RTL support

---

## REPO LAYOUT (TARGET)

```
foodApp/
  app/
  convex/
  components/
  lib/
  tests/
  public/
  .beads/
```

---

## DEV WORKFLOW (ONCE SCAFFOLD EXISTS)

```bash
bun install
bun run dev
bunx convex dev

# tests
bun run test
bunx playwright test
```

**Note:** Always use `bun run test` (never `bun test`).

---

## QUALITY GATES

- Unit tests (Vitest), e2e (Playwright), a11y (axe), compliance tests for provider data policy.
- Provider-backed routes must set `dynamic = "force-dynamic"` and `revalidate = 0`.

---

## BEADS: CURRENT WORK MAP (AS OF 2026-01-26)

### P0 Epics

foodApp-9v8 (P0) Project Foundation & Infrastructure
- foodApp-9v8.1 (P0) Initialize Next.js 16 project with App Router
- foodApp-9v8.2 (P0) Initialize Convex backend
- foodApp-9v8.3 (P0) Set up Convex Auth with Google OAuth
- foodApp-9v8.4 (P0) Configure Google Cloud Console with dual API keys
- foodApp-9v8.8 (P0) Implement core Convex database schema
- foodApp-9v8.9 (P0) Implement home page with discovery features
- foodApp-9v8.5 (P1) Install and configure shadcn/ui component library
- foodApp-9v8.6 (P1) Set up Sentry for error tracking with provider content redaction
- foodApp-9v8.7 (P1) Configure environment separation (dev/staging/prod)

foodApp-ag1 (P0) Provider Gateway & Policy Engine
- foodApp-ag1.1 (P0) Implement ProviderGateway wrapper with field mask registry
- foodApp-ag1.2 (P0) Implement circuit breaker state machine
- foodApp-ag1.4 (P0) Implement budget guardrails per endpoint class
- foodApp-ag1.6 (P0) Implement compliance tests for policy enforcement
- foodApp-ag1.3 (P1) Implement singleflight request coalescing
- foodApp-ag1.5 (P1) Implement priority classes for load shedding

foodApp-u0a (P0) Search Architecture
- foodApp-u0a.1 (P0) Implement provider search with session tokens
- foodApp-u0a.2 (P1) Implement ID-only search result cache
- foodApp-u0a.3 (P1) Implement Convex search index for owned content
- foodApp-u0a.4 (P1) Implement transliteration for AR/FR/EN search
- foodApp-u0a.5 (P2) Implement Popular Searches with privacy guardrails

foodApp-v4y (P0) Service Modes & Graceful Degradation
- foodApp-v4y.1 (P0) Implement Service Mode state machine
- foodApp-v4y.2 (P1) Implement Service Mode UI feedback

foodApp-zrx (P0) Photo Proxy & Security Hardening
- foodApp-zrx.1 (P0) Implement photo proxy route handler with signed URLs
- foodApp-zrx.2 (P1) Implement Content Security Policy and security headers

### P1 Epics

foodApp-008 (P1) Place Details & UGC Layer
- foodApp-008.1 (P0) Implement place details page with provider + owned data
- foodApp-008.2 (P1) Implement review CRUD with one-per-user-per-place
- foodApp-008.3 (P1) Implement UGC photo upload with moderation pipeline
- foodApp-008.4 (P1) Implement taste tags and placeDishes aggregation
- foodApp-008.5 (P1) Implement optimistic updates for user actions

foodApp-7t7 (P1) Curated Content & Dish Explorer
- foodApp-7t7.1 (P1) Implement curated place cards system
- foodApp-7t7.2 (P1) Implement Dish Explorer feature
- foodApp-7t7.3 (P1) Implement editorial guides

foodApp-8wa (P1) Observability & Reliability
- foodApp-8wa.1 (P1) Implement metrics collection and dashboard
- foodApp-8wa.2 (P1) Implement alerting system

foodApp-d2m (P1) i18n & Localization
- foodApp-d2m.1 (P1) Configure Next.js i18n with AR/FR/EN support
- foodApp-d2m.2 (P1) Implement RTL layout support for Arabic

foodApp-d4u (P1) Map & Geospatial Features
- foodApp-d4u.1 (P1) Implement Google Maps integration with clustering
- foodApp-d4u.2 (P1) Implement ID-only map tile cache
- foodApp-d4u.3 (P1) Implement "Search this area" with debouncing

foodApp-ff3 (P1) User Features & Collaborative Lists
- foodApp-ff3.1 (P1) Implement lists with favorites, custom, and itinerary types
- foodApp-ff3.2 (P1) Implement collaborative lists with real-time sync
- foodApp-ff3.3 (P1) Implement user profile page

foodApp-v8r (P1) Testing & CI/CD
- foodApp-v8r.1 (P1) Set up testing infrastructure with Vitest and Playwright
- foodApp-v8r.2 (P1) Set up CI/CD pipeline with compliance gates

foodApp-zj9 (P1) Trust, Safety & Moderation
- foodApp-zj9.1 (P1) Implement rate limiting system
- foodApp-zj9.2 (P1) Implement RBAC for admin and moderation

---

## ISSUE TRACKING WITH BR (BEADS_RUST)

**Note:** `br` is non-invasive and never executes git commands. After `br sync --flush-only`, you must manually run `git add .beads/ && git commit`.

Key invariants:
- `.beads/` is authoritative state and **must always be committed** with code changes.
- Do not edit `.beads/*.jsonl` directly; only via `br`.

Basics:

```bash
br ready --json
br show <id>
br update <id> --status in_progress --json
br close <id> --reason "Completed" --json
```

Sync:

```bash
br sync --flush-only
git add .beads/
git commit -m "sync beads"
```

Never:
- Use markdown TODO lists.
- Use other trackers.
- Duplicate tracking.

---

## LANDING THE PLANE (SESSION COMPLETION)

When ending a work session, complete ALL steps below. Work is NOT complete until `git push` succeeds.

1. File issues for remaining work.
2. Run quality gates (if code changed).
3. Update issue status.
4. PUSH TO REMOTE (MANDATORY):
   ```bash
   git pull --rebase
   br sync --flush-only
   git add .beads/
   git commit -m "sync beads"
   git push
   git status  # MUST show "up to date with origin"
   ```
5. Clean up (clear stashes, prune remote branches).
6. Verify all changes committed AND pushed.
7. Hand off context for the next session.

CRITICAL RULES:
- Work is NOT complete until `git push` succeeds.
- NEVER stop before pushing.
- If push fails, resolve and retry until it succeeds.
