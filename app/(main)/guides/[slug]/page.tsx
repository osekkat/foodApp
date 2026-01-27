import { Metadata } from "next";
import { notFound } from "next/navigation";
import { fetchQuery } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import { GuidePage } from "./GuidePage";

interface GuidePageParams {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: GuidePageParams): Promise<Metadata> {
  const { slug } = await params;
  const guide = await fetchQuery(api.guides.getBySlug, { slug });

  if (!guide) {
    return {
      title: "Guide Not Found",
    };
  }

  return {
    title: guide.title,
    description: guide.description,
    openGraph: {
      title: guide.title,
      description: guide.description,
      images: guide.coverImageUrl ? [guide.coverImageUrl] : undefined,
      type: "article",
    },
    twitter: {
      card: "summary_large_image",
      title: guide.title,
      description: guide.description,
      images: guide.coverImageUrl ? [guide.coverImageUrl] : undefined,
    },
  };
}

export default async function GuideDetailPage({ params }: GuidePageParams) {
  const { slug } = await params;
  const guide = await fetchQuery(api.guides.getBySlug, { slug });

  if (!guide) {
    notFound();
  }

  return <GuidePage initialGuide={guide} slug={slug} />;
}
