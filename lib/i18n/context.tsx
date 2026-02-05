"use client";

/**
 * Internationalization Context and Provider
 *
 * Provides locale state and translation function to the entire app.
 * Uses cookies for persistence across sessions.
 */

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useMemo,
  type ReactNode,
} from "react";
import {
  type SupportedLocale,
  DEFAULT_LOCALE,
  LOCALE_COOKIE_NAME,
  LOCALE_CONFIG,
  isSupportedLocale,
} from "./config";

// Import all locales
import en from "./locales/en.json";
import fr from "./locales/fr.json";
import ar from "./locales/ar.json";

const MESSAGES: Record<SupportedLocale, typeof en> = { en, fr, ar };

// ============================================================================
// Types
// ============================================================================

interface I18nContextValue {
  locale: SupportedLocale;
  setLocale: (locale: SupportedLocale) => void;
  t: (key: string, params?: Record<string, string | number>) => string;
  dir: "ltr" | "rtl";
}

// ============================================================================
// Context
// ============================================================================

const I18nContext = createContext<I18nContextValue | null>(null);

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get nested value from object by dot-separated path
 */
function getNestedValue(obj: Record<string, unknown>, path: string): string | undefined {
  const keys = path.split(".");
  let current: unknown = obj;

  for (const key of keys) {
    if (current === null || current === undefined || typeof current !== "object") {
      return undefined;
    }
    current = (current as Record<string, unknown>)[key];
  }

  return typeof current === "string" ? current : undefined;
}

/**
 * Interpolate parameters into a string
 * Supports {paramName} syntax
 */
function interpolate(str: string, params: Record<string, string | number>): string {
  return str.replace(/{(\w+)}/g, (_, key) => {
    const value = params[key];
    return value !== undefined ? String(value) : `{${key}}`;
  });
}

/**
 * Get locale from cookie (client-side only)
 */
function getLocaleFromCookie(): SupportedLocale {
  if (typeof document === "undefined") return DEFAULT_LOCALE;

  const cookies = document.cookie.split(";");
  for (const cookie of cookies) {
    const [name, value] = cookie.trim().split("=");
    if (name === LOCALE_COOKIE_NAME && isSupportedLocale(value)) {
      return value;
    }
  }
  return DEFAULT_LOCALE;
}

/**
 * Set locale cookie
 */
function setLocaleCookie(locale: SupportedLocale): void {
  if (typeof document === "undefined") return;

  // Set cookie with 1 year expiry
  const maxAge = 365 * 24 * 60 * 60;
  document.cookie = `${LOCALE_COOKIE_NAME}=${locale};path=/;max-age=${maxAge};samesite=lax`;
}

// ============================================================================
// Provider
// ============================================================================

interface I18nProviderProps {
  children: ReactNode;
  initialLocale?: SupportedLocale;
}

export function I18nProvider({ children, initialLocale }: I18nProviderProps) {
  const [locale, setLocaleState] = useState<SupportedLocale>(
    initialLocale ?? DEFAULT_LOCALE
  );

  // Initialize locale from cookie on mount
  useEffect(() => {
    if (!initialLocale) {
      const cookieLocale = getLocaleFromCookie();
      if (cookieLocale !== locale) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setLocaleState(cookieLocale);
      }
    }
  }, [initialLocale, locale]);

  // Update document direction when locale changes
  useEffect(() => {
    document.documentElement.dir = LOCALE_CONFIG[locale].dir;
    document.documentElement.lang = locale;
  }, [locale]);

  const setLocale = useCallback((newLocale: SupportedLocale) => {
    setLocaleState(newLocale);
    setLocaleCookie(newLocale);
  }, []);

  const t = useCallback(
    (key: string, params?: Record<string, string | number>): string => {
      const messages = MESSAGES[locale];
      const value = getNestedValue(messages as unknown as Record<string, unknown>, key);

      if (value === undefined) {
        // Fallback to English, then to key
        const fallback = getNestedValue(MESSAGES.en as unknown as Record<string, unknown>, key);
        const result = fallback ?? key;
        return params ? interpolate(result, params) : result;
      }

      return params ? interpolate(value, params) : value;
    },
    [locale]
  );

  const value = useMemo(
    () => ({
      locale,
      setLocale,
      t,
      dir: LOCALE_CONFIG[locale].dir,
    }),
    [locale, setLocale, t]
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

// ============================================================================
// Hook
// ============================================================================

export function useTranslation() {
  const context = useContext(I18nContext);

  if (!context) {
    throw new Error("useTranslation must be used within an I18nProvider");
  }

  return context;
}

/**
 * Hook for just getting the current locale (lighter weight)
 */
export function useLocale(): SupportedLocale {
  const context = useContext(I18nContext);
  return context?.locale ?? DEFAULT_LOCALE;
}

/**
 * Hook for getting text direction
 */
export function useDirection(): "ltr" | "rtl" {
  const context = useContext(I18nContext);
  return context?.dir ?? "ltr";
}
