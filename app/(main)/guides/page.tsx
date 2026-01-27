import { Metadata } from "next";
import { fetchQuery } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import { GuidesListPage } from "./GuidesListPage";

export const metadata: Metadata = {
  title: "Curated Food Guides | Morocco Eats",
  description:
    "Discover the best food experiences in Morocco with our curated guides. From tagine spots in Marrakech to seafood in Casablanca.",
  openGraph: {
    title: "Curated Food Guides | Morocco Eats",
    description:
      "Discover the best food experiences in Morocco with our curated guides.",
    type: "website",
  },
};

export default async function GuidesPage() {
  // Pre-fetch guides for SSR
  const guides = await fetchQuery(api.guides.list, { locale: "en", limit: 50 });

  return <GuidesListPage initialGuides={guides} />;
}
