"use client";

import dynamic from "next/dynamic";

// Dynamically import the sign-in form to avoid SSR issues with auth hooks
const SignInForm = dynamic(() => import("@/components/auth/SignInForm"), {
  ssr: false,
  loading: () => (
    <div className="rounded-xl border border-zinc-200 bg-white p-8 shadow-sm dark:border-zinc-700 dark:bg-zinc-800">
      <p className="text-center text-zinc-600 dark:text-zinc-400">Loading...</p>
    </div>
  ),
});

export default function SignInPage() {
  return <SignInForm />;
}
