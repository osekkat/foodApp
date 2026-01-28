"use client";

import { useRef, useEffect } from "react";
import { Search, X, Loader2, MapPin, AlertTriangle } from "lucide-react";
import { Input } from "@/components/ui/input";
import type { AutocompleteResult } from "@/lib/searchSession";

export interface SearchInputProps {
  query: string;
  onQueryChange: (query: string) => void;
  suggestions: AutocompleteResult[];
  isLoading: boolean;
  isDegraded: boolean;
  error: string | null;
  isOpen: boolean;
  onFocus: () => void;
  onBlur: () => void;
  onSelectSuggestion: (placeId: string) => void;
  onClear: () => void;
  selectedIndex: number;
  onKeyDown: (e: React.KeyboardEvent) => void;
  placeholder?: string;
}

export function SearchInput({
  query,
  onQueryChange,
  suggestions,
  isLoading,
  isDegraded,
  error,
  isOpen,
  onFocus,
  onBlur,
  onSelectSuggestion,
  onClear,
  selectedIndex,
  onKeyDown,
  placeholder = "Search for restaurants, dishes, or guides...",
}: SearchInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Scroll selected item into view
  useEffect(() => {
    if (dropdownRef.current && selectedIndex >= 0) {
      const selectedElement = dropdownRef.current.children[selectedIndex] as HTMLElement;
      if (selectedElement) {
        selectedElement.scrollIntoView({ block: "nearest" });
      }
    }
  }, [selectedIndex]);

  const showDropdown = isOpen && (suggestions.length > 0 || isLoading || error || isDegraded);

  return (
    <div className="relative w-full">
      <div className="relative">
        <Search className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-zinc-400" />
        <Input
          ref={inputRef}
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          onFocus={onFocus}
          onBlur={onBlur}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          className="h-12 pl-12 pr-12 text-lg rounded-xl border-zinc-200 bg-white focus:border-orange-500 focus:ring-orange-500/20 dark:border-zinc-700 dark:bg-zinc-800"
          aria-label="Search"
          aria-expanded={showDropdown ? "true" : "false"}
          aria-haspopup="listbox"
          aria-autocomplete="list"
        />
        {isLoading ? (
          <Loader2 className="absolute right-4 top-1/2 h-5 w-5 -translate-y-1/2 text-zinc-400 animate-spin" />
        ) : query ? (
          <button
            onClick={onClear}
            className="absolute right-4 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
            aria-label="Clear search"
          >
            <X className="h-5 w-5" />
          </button>
        ) : null}
      </div>

      {/* Autocomplete Dropdown */}
      {showDropdown && (
        <div
          ref={dropdownRef}
          className="absolute left-0 right-0 top-full z-50 mt-2 max-h-80 overflow-y-auto rounded-xl border border-zinc-200 bg-white shadow-lg dark:border-zinc-700 dark:bg-zinc-800"
          role="listbox"
        >
          {isDegraded && (
            <div className="flex items-center gap-2 px-4 py-3 border-b border-zinc-200 bg-amber-50 text-amber-700 dark:border-zinc-700 dark:bg-amber-900/20 dark:text-amber-400">
              <AlertTriangle className="h-4 w-4 flex-shrink-0" />
              <span className="text-sm">Search is limited due to high demand</span>
            </div>
          )}

          {error && (
            <div className="flex items-center gap-2 px-4 py-3 text-red-600 dark:text-red-400">
              <AlertTriangle className="h-4 w-4 flex-shrink-0" />
              <span className="text-sm">{error}</span>
            </div>
          )}

          {isLoading && suggestions.length === 0 && (
            <div className="flex items-center justify-center gap-2 px-4 py-6 text-zinc-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-sm">Searching...</span>
            </div>
          )}

          {suggestions.map((suggestion, index) => (
            <button
              key={suggestion.placeId}
              onClick={() => onSelectSuggestion(suggestion.placeId)}
              onMouseDown={(e) => e.preventDefault()} // Prevent blur before click
              className={`flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-700/50 ${
                index === selectedIndex
                  ? "bg-orange-50 dark:bg-orange-900/20"
                  : ""
              } ${
                index < suggestions.length - 1
                  ? "border-b border-zinc-100 dark:border-zinc-700/50"
                  : ""
              }`}
              role="option"
              aria-selected={index === selectedIndex}
            >
              <div className="flex-shrink-0 mt-0.5">
                <MapPin className="h-5 w-5 text-zinc-400" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-zinc-900 dark:text-zinc-100 truncate">
                  {suggestion.structuredFormat?.mainText.text || suggestion.text.text}
                </p>
                {suggestion.structuredFormat?.secondaryText && (
                  <p className="text-sm text-zinc-500 dark:text-zinc-400 truncate">
                    {suggestion.structuredFormat.secondaryText.text}
                  </p>
                )}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
