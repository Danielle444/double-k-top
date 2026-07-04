import { cache } from "react";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export interface CurrentAdmin {
  email: string;
  name: string | null;
}

// React.cache() de-dupes this within a single render pass, so calling it from
// both the layout and a page costs one DB query, not two. It is called on
// every /admin/* page (not just the layout) because Next.js does not
// guarantee a shared layout re-executes on client-side sibling navigation.
export const requireAdmin = cache(async (): Promise<CurrentAdmin> => {
  const session = await auth();
  const email = session?.user?.email;

  if (!email) {
    redirect("/login");
  }

  const adminEmail = await prisma.adminEmail.findUnique({ where: { email } });

  if (!adminEmail || !adminEmail.isActive) {
    redirect("/login?error=AccessDenied");
  }

  return { email, name: session.user?.name ?? adminEmail.name };
});
