export const metadata = {
  title: "Signing In",
  description: "Completing sign-in",
};

export default function AuthCallbackPage() {
  return (
    <div className="min-h-screen bg-white dark:bg-black">
      <div className="mx-auto max-w-2xl px-4 py-16 text-center sm:px-6 lg:px-8">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100">
          Signing you in…
        </h1>
        <p className="mt-4 text-sm text-zinc-500 dark:text-zinc-400">
          If this takes more than a few seconds, please return to the login page
          and try again.
        </p>
      </div>
    </div>
  );
}
