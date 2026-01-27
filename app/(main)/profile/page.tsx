"use client";

import dynamic from "next/dynamic";

// Dynamically import to avoid SSR issues with auth hooks
const ProfileContent = dynamic(
  () => import("@/components/auth/ProfileContent"),
  {
    ssr: false,
    loading: () => (
      <div className="min-h-screen bg-white dark:bg-black">
        <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
          <p className="text-zinc-600 dark:text-zinc-400">Loading...</p>
        </div>
      </div>
    ),
  }
);

export default function ProfilePage() {
  return <ProfileContent />;
}
