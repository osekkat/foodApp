/**
 * Internationalization Module
 *
 * Exports all i18n functionality for the app.
 *
 * Usage:
 * ```tsx
 * import { useTranslation, I18nProvider } from "@/lib/i18n";
 *
 * // In layout or root
 * <I18nProvider>
 *   <App />
 * </I18nProvider>
 *
 * // In components
 * const { t, locale, setLocale, dir } = useTranslation();
 * <p>{t("common.search")}</p>
 * <p>{t("place.basedOnReviews", { count: 42 })}</p>
 * ```
 */

export {
  I18nProvider,
  useTranslation,
  useLocale,
  useDirection,
} from "./context";

export {
  SUPPORTED_LOCALES,
  DEFAULT_LOCALE,
  LOCALE_CONFIG,
  LOCALE_COOKIE_NAME,
  isSupportedLocale,
  getLocaleDirection,
  getPreferredLocaleFromHeader,
  type SupportedLocale,
} from "./config";
