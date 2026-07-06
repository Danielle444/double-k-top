import Link from "next/link";
import { Logo } from "@/lib/components/Logo";

export default function Home() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 bg-background px-4 py-16 text-center">
      <Logo width={260} className="h-auto w-full max-w-[260px]" />
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-card-foreground">Double K Top</h1>
        <p className="mt-1 text-base text-muted-foreground">מערכת ניהול קורס מדריכים</p>
      </div>
      <div className="flex w-full max-w-sm flex-col gap-3 sm:max-w-none sm:flex-row">
        <Link
          href="/admin"
          className="rounded-xl bg-primary px-6 py-3.5 text-sm font-semibold text-primary-foreground shadow-sm transition-opacity hover:opacity-90"
        >
          כניסת מנהל/ת קורס
        </Link>
        <Link
          href="/student"
          className="rounded-xl bg-secondary px-6 py-3.5 text-sm font-semibold text-secondary-foreground shadow-sm transition-opacity hover:opacity-80"
        >
          כניסת חניך/ה
        </Link>
        <Link
          href="/instructor"
          className="rounded-xl bg-muted px-6 py-3.5 text-sm font-semibold text-muted-foreground shadow-sm transition-opacity hover:opacity-80"
        >
          כניסת מדריך/ה
        </Link>
      </div>
    </div>
  );
}
