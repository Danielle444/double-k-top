import { signInWithGoogle } from "@/lib/actions/auth-actions";
import { Logo } from "@/lib/components/Logo";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const accessDenied = error === "AccessDenied";

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background px-4 text-center">
      <Logo width={260} />
      <h1 className="text-xl font-bold text-card-foreground">כניסת מנהל/ת מערכת</h1>

      {accessDenied && (
        <div className="max-w-sm rounded-lg bg-danger-muted p-4 text-sm text-danger">
          אין לך הרשאה להיכנס למערכת הניהול
        </div>
      )}

      <form action={signInWithGoogle}>
        <button
          type="submit"
          className="rounded-lg bg-primary px-6 py-3 text-sm font-medium text-primary-foreground hover:opacity-90"
        >
          כניסה עם Google
        </button>
      </form>
    </div>
  );
}
