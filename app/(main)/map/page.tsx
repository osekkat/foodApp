import { Suspense } from "react";
import { MapProvider } from "@/components/providers/MapProvider";
import { MapPageClient } from "@/components/maps";
import { MapPageSkeleton } from "./MapPageSkeleton";

export const metadata = {
  title: "Map",
  description: "Explore food on the map",
};

export default function MapPage() {
  return (
    <MapProvider>
      <Suspense fallback={<MapPageSkeleton />}>
        <MapPageClient
          initialCity="casablanca"
          initialQuery="restaurants"
        />
      </Suspense>
    </MapProvider>
  );
}
