import Link from "next/link";
import { Logo } from "@/lib/components/Logo";

export default function Home() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 bg-background px-4 py-16 text-center">
      <Logo width={260} />
      <h1 className="text-2xl font-bold text-card-foreground">Double K Top</h1>
      <div className="flex flex-col gap-3 sm:flex-row">
        <Link
          href="/admin"
          className="rounded-lg bg-primary px-6 py-3 text-sm font-medium text-primary-foreground hover:opacity-90"
        >
          כניסת מנהל/ת קורס
        </Link>
        <Link
          href="/student"
          className="rounded-lg bg-secondary px-6 py-3 text-sm font-medium text-secondary-foreground hover:opacity-80"
        >
          כניסת חניך/ה
        </Link>
        <Link
          href="/instructor"
          className="rounded-lg bg-muted px-6 py-3 text-sm font-medium text-muted-foreground hover:opacity-80"
        >
          כניסת מדריך/ה
        </Link>
      </div>
    </div>
  );
}
