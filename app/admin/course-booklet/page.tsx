import { requireAdmin } from "@/lib/auth/require-admin";
import { getBookletAccess } from "@/lib/actions/course-booklet";
import { CourseBookletAdminClient } from "@/app/admin/course-booklet/CourseBookletAdminClient";

export const dynamic = "force-dynamic";

export default async function CourseBookletAdminPage() {
  await requireAdmin();
  const booklet = await getBookletAccess();

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-bold text-card-foreground">חוברת קורס</h1>
      <p className="text-sm text-muted-foreground">
        העלאת חוברת הקורס (PDF) שתוצג לתלמידים ולמדריכים בלשונית &quot;חוברת קורס&quot;.
        העלאה חדשה מחליפה את הקובץ הקיים.
      </p>
      <CourseBookletAdminClient initialBooklet={booklet} />
    </div>
  );
}
