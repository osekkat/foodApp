/**
 * Search Session Manager
 *
 * Manages session tokens for Google Places API (New) autocomplete flow.
 * Session tokens bundle autocomplete requests with the final place details request,
 * resulting in bundled pricing instead of per-request pricing.
 *
 * Session Flow:
 * 1. User starts typing → Create session token
 * 2. Multiple autocomplete calls → All use same token
 * 3. User selects result → Place Details call with same token
 * 4. Session complete → Token is consumed and discarded
 *
 * @see https://developers.google.com/maps/documentation/places/web-service/session-tokens
 */

export interface SearchSessionConfig {
  /** Maximum session age in milliseconds (default: 3 minutes) */
  maxAgeMs?: number;
}

export interface AutocompleteResult {
  placeId: string;
  text: {
    text: string;
    matches?: { startOffset: number; endOffset: number }[];
  };
  structuredFormat?: {
    mainText: { text: string };
    secondaryText?: { text: string };
  };
  types?: string[];
}

/**
 * Manages a single search session with token and request lifecycle
 */
export class SearchSession {
  private token: string;
  private createdAt: number;
  private abortController: AbortController | null = null;
  private consumed = false;
  private maxAgeMs: number;

  constructor(config: SearchSessionConfig = {}) {
    this.token = crypto.randomUUID();
    this.createdAt = Date.now();
    this.maxAgeMs = config.maxAgeMs ?? 3 * 60 * 1000; // 3 minutes default
  }

  /**
   * Get the session token for API requests
   */
  getToken(): string {
    if (this.consumed) {
      throw new Error("Session has been consumed. Create a new session.");
    }
    if (this.isExpired()) {
      throw new Error("Session has expired. Create a new session.");
    }
    return this.token;
  }

  /**
   * Check if session is still valid
   */
  isValid(): boolean {
    return !this.consumed && !this.isExpired();
  }

  /**
   * Check if session has expired based on age
   */
  isExpired(): boolean {
    return Date.now() - this.createdAt > this.maxAgeMs;
  }

  /**
   * Get session age in milliseconds
   */
  getAgeMs(): number {
    return Date.now() - this.createdAt;
  }

  /**
   * Get an AbortSignal for the current request.
   * Calling this will abort any previous pending request.
   */
  getAbortSignal(): AbortSignal {
    // Cancel any previous request
    this.abortController?.abort();
    this.abortController = new AbortController();
    return this.abortController.signal;
  }

  /**
   * Cancel any pending request
   */
  cancelPendingRequest(): void {
    this.abortController?.abort();
    this.abortController = null;
  }

  /**
   * Mark session as consumed (after place selection)
   * After this, the session cannot be used for more requests.
   */
  consume(): void {
    this.consumed = true;
    this.cancelPendingRequest();
  }

  /**
   * Invalidate the session without consuming it (e.g., user cleared search)
   */
  invalidate(): void {
    this.consumed = true;
    this.cancelPendingRequest();
  }
}

/**
 * Search Session Manager
 *
 * Manages the lifecycle of search sessions, ensuring:
 * - Only one active session at a time
 * - Automatic session renewal on expiry
 * - Proper cleanup of old sessions
 */
export class SearchSessionManager {
  private currentSession: SearchSession | null = null;
  private config: SearchSessionConfig;

  constructor(config: SearchSessionConfig = {}) {
    this.config = config;
  }

  /**
   * Get the current active session, creating one if needed
   */
  getSession(): SearchSession {
    if (!this.currentSession || !this.currentSession.isValid()) {
      this.currentSession = new SearchSession(this.config);
    }
    return this.currentSession;
  }

  /**
   * Get the session token for API requests
   */
  getToken(): string {
    return this.getSession().getToken();
  }

  /**
   * Get an AbortSignal for the current request
   */
  getAbortSignal(): AbortSignal {
    return this.getSession().getAbortSignal();
  }

  /**
   * Cancel any pending request in the current session
   */
  cancelPendingRequest(): void {
    this.currentSession?.cancelPendingRequest();
  }

  /**
   * Complete the current session (after user selects a place)
   * This consumes the session token and starts a new session on next request.
   */
  completeSession(): void {
    this.currentSession?.consume();
    this.currentSession = null;
  }

  /**
   * Clear the current session (e.g., user cleared the search input)
   * This invalidates the session without triggering billing completion.
   */
  clearSession(): void {
    this.currentSession?.invalidate();
    this.currentSession = null;
  }

  /**
   * Check if there's an active valid session
   */
  hasActiveSession(): boolean {
    return this.currentSession?.isValid() ?? false;
  }
}

// Default singleton instance for app-wide use
let defaultManager: SearchSessionManager | null = null;

/**
 * Get the default search session manager singleton
 */
export function getSearchSessionManager(): SearchSessionManager {
  if (!defaultManager) {
    defaultManager = new SearchSessionManager();
  }
  return defaultManager;
}
