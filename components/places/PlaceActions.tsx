"use client";

import { Button } from "@/components/ui/button";
import { Heart, MapPin, Phone, Share2, Navigation } from "lucide-react";
import { useState } from "react";

interface PlaceActionsProps {
  placeKey: string;
  phoneNumber?: string;
  websiteUri?: string;
  googleMapsUri?: string;
  location?: { latitude: number; longitude: number };
  hasFavorited: boolean;
  isAuthenticated: boolean;
  onToggleFavorite: () => Promise<void>;
}

export function PlaceActions({
  placeKey,
  phoneNumber,
  websiteUri,
  googleMapsUri,
  location,
  hasFavorited,
  isAuthenticated,
  onToggleFavorite,
}: PlaceActionsProps) {
  const [isSaving, setIsSaving] = useState(false);
  const [localFavorited, setLocalFavorited] = useState(hasFavorited);

  const handleCall = () => {
    if (phoneNumber) {
      window.location.href = `tel:${phoneNumber}`;
    }
  };

  const handleDirections = () => {
    if (googleMapsUri) {
      window.open(googleMapsUri, "_blank");
    } else if (location) {
      const url = `https://www.google.com/maps/dir/?api=1&destination=${location.latitude},${location.longitude}`;
      window.open(url, "_blank");
    }
  };

  const handleShare = async () => {
    const shareData = {
      title: document.title,
      url: window.location.href,
    };

    if (navigator.share) {
      try {
        await navigator.share(shareData);
      } catch {
        // User cancelled or error
      }
    } else {
      // Fallback: copy to clipboard
      await navigator.clipboard.writeText(window.location.href);
      // Could show a toast here
    }
  };

  const handleSave = async () => {
    if (!isAuthenticated) {
      // Redirect to login
      window.location.href = `/login?redirect=${encodeURIComponent(window.location.pathname)}`;
      return;
    }

    setIsSaving(true);
    try {
      await onToggleFavorite();
      setLocalFavorited(!localFavorited);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="flex flex-wrap gap-2">
      {phoneNumber && (
        <Button
          variant="outline"
          size="sm"
          onClick={handleCall}
          className="gap-2"
        >
          <Phone className="h-4 w-4" />
          Call
        </Button>
      )}

      {(googleMapsUri || location) && (
        <Button
          variant="outline"
          size="sm"
          onClick={handleDirections}
          className="gap-2"
        >
          <Navigation className="h-4 w-4" />
          Directions
        </Button>
      )}

      <Button
        variant="outline"
        size="sm"
        onClick={handleShare}
        className="gap-2"
      >
        <Share2 className="h-4 w-4" />
        Share
      </Button>

      <Button
        variant={localFavorited ? "default" : "outline"}
        size="sm"
        onClick={handleSave}
        disabled={isSaving}
        className="gap-2"
      >
        <Heart
          className={`h-4 w-4 ${localFavorited ? "fill-current" : ""}`}
        />
        {localFavorited ? "Saved" : "Save"}
      </Button>
    </div>
  );
}
