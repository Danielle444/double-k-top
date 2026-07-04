import { NextResponse } from "next/server";
import { auth } from "@/auth";

// Optimistic check only: reads the already-decoded session from the JWT
// cookie, no database call (Proxy runs on every matched request, including
// prefetches, so a DB hit here would be wasteful). The authoritative
// allowlist check happens in requireAdmin() on every /admin/* page.
export default auth((req) => {
  if (!req.auth) {
    return NextResponse.redirect(new URL("/login", req.url));
  }
});

export const config = {
  matcher: ["/admin/:path*"],
};
