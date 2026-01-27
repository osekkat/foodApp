/**
 * Internationalization Configuration
 *
 * Supports Arabic (RTL), French, and English for Morocco.
 * Uses cookie-based locale persistence for App Router compatibility.
 */

export const SUPPORTED_LOCALES = ["ar", "fr", "en"] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE: SupportedLocale = "en";

export const LOCALE_COOKIE_NAME = "NEXT_LOCALE";

/**
 * Locale metadata
 */
export const LOCALE_CONFIG: Record<
  SupportedLocale,
  {
    name: string;
    nativeName: string;
    dir: "ltr" | "rtl";
    dateFormat: string;
    numberFormat: Intl.NumberFormatOptions;
  }
> = {
  ar: {
    name: "Arabic",
    nativeName: "العربية",
    dir: "rtl",
    dateFormat: "dd/MM/yyyy",
    numberFormat: { style: "decimal" },
  },
  fr: {
    name: "French",
    nativeName: "Français",
    dir: "ltr",
    dateFormat: "dd/MM/yyyy",
    numberFormat: { style: "decimal" },
  },
  en: {
    name: "English",
    nativeName: "English",
    dir: "ltr",
    dateFormat: "MM/dd/yyyy",
    numberFormat: { style: "decimal" },
  },
};

/**
 * Check if a locale is supported
 */
export function isSupportedLocale(locale: string): locale is SupportedLocale {
  return SUPPORTED_LOCALES.includes(locale as SupportedLocale);
}

/**
 * Get the direction (LTR/RTL) for a locale
 */
export function getLocaleDirection(locale: SupportedLocale): "ltr" | "rtl" {
  return LOCALE_CONFIG[locale].dir;
}

/**
 * Parse Accept-Language header to get preferred locale
 */
export function getPreferredLocaleFromHeader(
  acceptLanguage: string | null
): SupportedLocale {
  if (!acceptLanguage) return DEFAULT_LOCALE;

  // Parse Accept-Language header (e.g., "ar-MA,ar;q=0.9,fr;q=0.8,en;q=0.7")
  const locales = acceptLanguage
    .split(",")
    .map((part) => {
      const [locale, q] = part.trim().split(";q=");
      return {
        locale: locale.split("-")[0].toLowerCase(), // Get language code without region
        quality: q ? parseFloat(q) : 1,
      };
    })
    .sort((a, b) => b.quality - a.quality);

  // Find first supported locale
  for (const { locale } of locales) {
    if (isSupportedLocale(locale)) {
      return locale;
    }
  }

  return DEFAULT_LOCALE;
}
