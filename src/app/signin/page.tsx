import { redirect } from "next/navigation";

// Clerk SDK v6 redirects unauthenticated users to /signin (no hyphen) by default.
// This stub catches that and forwards to the canonical /sign-in route where the
// actual Clerk <SignIn /> component lives.
export default function SignInRedirect() {
  redirect("/sign-in");
}
