export function normalizeMapSearchQuery(
  query: string | undefined,
  defaultQuery: string,
): string {
  const normalizedQuery = query?.trim() ?? "";
  if (normalizedQuery.length > 0) {
    return normalizedQuery;
  }

  const normalizedDefaultQuery = defaultQuery.trim();
  if (normalizedDefaultQuery.length > 0) {
    return normalizedDefaultQuery;
  }

  return "restaurant";
}

export function shouldAutoExecuteUrlSearch(options: {
  hasAutoSearched: boolean;
  hasSearchBounds: boolean;
  isOnCooldown: boolean;
  urlQuery: string;
}): boolean {
  if (options.hasAutoSearched) return false;
  if (!options.hasSearchBounds) return false;
  if (options.isOnCooldown) return false;

  return options.urlQuery.trim().length > 0;
}

export function shouldMarkAutoSearchedOnSubmit(options: {
  hasSearchBounds: boolean;
  isOnCooldown: boolean;
}): boolean {
  return options.hasSearchBounds && !options.isOnCooldown;
}
