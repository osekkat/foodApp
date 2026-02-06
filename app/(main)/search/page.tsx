import { redirect } from "next/navigation";

export const metadata = {
  title: "Map",
  description: "Redirecting to map",
};

export const dynamic = "force-dynamic";

interface SearchPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function SearchPage({ searchParams }: SearchPageProps) {
  const params = await searchParams;
  const nextParams = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (typeof value === "string") {
      nextParams.set(key, value);
      continue;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        nextParams.append(key, item);
      }
    }
  }

  const target = nextParams.toString() ? `/map?${nextParams.toString()}` : "/map";
  redirect(target);
}
