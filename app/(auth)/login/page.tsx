import { redirect } from "next/navigation";

export const metadata = {
  title: "Login",
  description: "Sign in to Morocco Eats",
};

export default function LoginPage() {
  redirect("/signin");
}
