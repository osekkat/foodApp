import Link from "next/link";

export const metadata = {
  title: "Login",
  description: "Sign in to Morocco Eats",
};

export default function LoginPage() {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-8 shadow-sm dark:border-zinc-700 dark:bg-zinc-800">
      <h1 className="mb-6 text-center text-2xl font-bold text-zinc-900 dark:text-zinc-100">
        Sign In
      </h1>
      <p className="mb-6 text-center text-zinc-600 dark:text-zinc-400">
        Sign in to save your favorite places and write reviews.
      </p>

      <p className="text-center text-sm text-amber-600 dark:text-amber-400">
        Google Sign-In will be available once authentication is configured.
      </p>

      <p className="mt-6 text-center text-sm text-zinc-500 dark:text-zinc-400">
        Visit{" "}
        <Link className="underline" href="/signin">
          /signin
        </Link>{" "}
        for the sign-in form.
      </p>
    </div>
  );
}
