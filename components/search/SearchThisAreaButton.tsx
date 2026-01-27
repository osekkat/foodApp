"use client";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Loader2, MapPin } from "lucide-react";

export interface SearchThisAreaButtonProps {
  /** Click handler to trigger search */
  onClick: () => void;
  /** Whether search is in progress */
  isLoading?: boolean;
  /** Whether button is disabled (e.g., on cooldown) */
  disabled?: boolean;
  /** Cooldown remaining in milliseconds (shows progress) */
  cooldownRemaining?: number;
  /** Additional CSS classes */
  className?: string;
}

/**
 * "Search this area" button that appears when user pans the map.
 *
 * Features:
 * - Loading state while search is in progress
 * - Cooldown indicator to prevent rapid searches
 * - Accessible button with icon and text
 *
 * @example
 * ```tsx
 * <SearchThisAreaButton
 *   onClick={() => searchArea()}
 *   isLoading={isLoading}
 *   disabled={isOnCooldown}
 *   cooldownRemaining={cooldownRemaining}
 * />
 * ```
 */
export function SearchThisAreaButton({
  onClick,
  isLoading = false,
  disabled = false,
  cooldownRemaining = 0,
  className,
}: SearchThisAreaButtonProps) {
  const isOnCooldown = cooldownRemaining > 0;
  const isDisabled = disabled || isLoading || isOnCooldown;

  // Format cooldown for display (e.g., "1.5s")
  const cooldownText = cooldownRemaining > 0
    ? `${(cooldownRemaining / 1000).toFixed(1)}s`
    : null;

  return (
    <Button
      variant="secondary"
      size="sm"
      onClick={onClick}
      disabled={isDisabled}
      className={cn(
        // Base styles
        "shadow-lg backdrop-blur-sm",
        // Background with slight transparency
        "bg-background/95 hover:bg-background",
        // Border
        "border border-border",
        // Transition for smooth state changes
        "transition-all duration-200",
        // When on cooldown, show subdued state
        isOnCooldown && "opacity-75",
        className
      )}
      aria-label={
        isLoading
          ? "Searching this area..."
          : isOnCooldown
            ? `Please wait ${cooldownText}`
            : "Search this area"
      }
    >
      {isLoading ? (
        <>
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Searching...
        </>
      ) : isOnCooldown ? (
        <>
          <MapPin className="mr-2 h-4 w-4" />
          Wait {cooldownText}
        </>
      ) : (
        <>
          <MapPin className="mr-2 h-4 w-4" />
          Search this area
        </>
      )}
    </Button>
  );
}
