import { StudentClient } from "@/app/student/StudentClient";

export const dynamic = "force-dynamic";

export default function StudentPage() {
  return (
    <div className="mx-auto flex min-h-screen w-full max-w-lg flex-col justify-center bg-background px-4 py-10">
      <StudentClient />
    </div>
  );
}
