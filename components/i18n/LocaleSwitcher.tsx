"use client";

/**
 * Locale Switcher Component
 *
 * Dropdown menu for switching between Arabic, French, and English.
 * Persists choice to cookie and updates document direction.
 */

import { useTranslation } from "@/lib/i18n/context";
import {
  SUPPORTED_LOCALES,
  LOCALE_CONFIG,
  type SupportedLocale,
} from "@/lib/i18n/config";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Globe } from "lucide-react";

interface LocaleSwitcherProps {
  /** Show only the icon (compact mode) */
  compact?: boolean;
  /** Custom className */
  className?: string;
}

export function LocaleSwitcher({ compact = false, className }: LocaleSwitcherProps) {
  const { locale, setLocale } = useTranslation();
  const currentConfig = LOCALE_CONFIG[locale];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size={compact ? "icon" : "default"} className={className}>
          <Globe className="h-4 w-4" />
          {!compact && (
            <span className="ml-2">{currentConfig.nativeName}</span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {SUPPORTED_LOCALES.map((loc) => {
          const config = LOCALE_CONFIG[loc];
          const isSelected = loc === locale;

          return (
            <DropdownMenuItem
              key={loc}
              onClick={() => setLocale(loc)}
              className={isSelected ? "bg-accent" : ""}
            >
              <span className="font-medium" dir={config.dir}>
                {config.nativeName}
              </span>
              <span className="ml-2 text-muted-foreground text-sm">
                ({config.name})
              </span>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Simplified locale buttons for footer or settings
 */
export function LocaleButtons({ className }: { className?: string }) {
  const { locale, setLocale } = useTranslation();

  return (
    <div className={`flex gap-2 ${className ?? ""}`}>
      {SUPPORTED_LOCALES.map((loc) => {
        const config = LOCALE_CONFIG[loc];
        const isSelected = loc === locale;

        return (
          <Button
            key={loc}
            variant={isSelected ? "default" : "outline"}
            size="sm"
            onClick={() => setLocale(loc)}
            dir={config.dir}
          >
            {config.nativeName}
          </Button>
        );
      })}
    </div>
  );
}
