# Compliance Tests

These tests enforce the provider data policy for the Morocco Food Discovery App. They run on every PR and **block deployment on failure**.

## Policy Summary

- **ALLOWED** to persist: `place_id`, `placeKey`, `photo_reference`, owned content, community aggregates
- **FORBIDDEN** to persist: `displayName`, `formattedAddress`, `phone`, `hours`, `ratings`, `reviews`, `photos` bytes

## Test Categories

### 1. Policy Enforcement (`policy-enforcement.test.ts`)
- Schema field validation (no forbidden fields in tables)
- ProviderGateway redaction of error messages
- Field set registry validation
- Metric logging compliance

### 2. Analytics Redaction (`analytics-redaction.test.ts`)
- Event validation (no provider content in tracked events)
- Search/review/list event compliance
- PlaceKey-only tracking enforcement

### 3. Route Headers (`route-headers.test.ts`)
- Provider routes have `no-store` cache headers
- Provider routes use `force-dynamic`
- Service worker allowlist compliance
- Robots noindex enforcement

### 4. Sentry Redaction (`sentry-redaction.test.ts`)
- `beforeSend` hook scrubbing
- Exception message sanitization
- Breadcrumb data cleaning
- Nested content redaction

## Running Tests

```bash
# Run all compliance tests
bun run test

# Run in watch mode
bun run test:watch

# Run specific test file
bunx vitest run tests/compliance/policy-enforcement.test.ts
```

## CI Integration

Add to your CI pipeline:

```yaml
- name: Run compliance tests
  run: bun run test
  # These tests use bail:1 - first failure stops all tests
```

## Adding New Tests

When adding new routes or features that touch provider data:

1. Add validation tests for any new schema tables
2. Add event validation for any new analytics events
3. Add header checks for any new provider-backed routes
4. Add scrubbing tests for any new Sentry contexts
