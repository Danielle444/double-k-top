"use server";

import { signIn, signOut } from "@/auth";

export async function signInWithGoogle() {
  // Without an explicit redirectTo, NextAuth falls back to the request's
  // Referer header (i.e. the /login page itself) as the post-auth redirect
  // target - which looked like a silent login loop with no error at all.
  await signIn("google", { redirectTo: "/admin" });
}

export async function signOutAdmin() {
  await signOut({ redirectTo: "/login" });
}
