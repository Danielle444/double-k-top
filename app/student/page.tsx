import { StudentClient } from "@/app/student/StudentClient";

export const dynamic = "force-dynamic";

export default function StudentPage() {
  return (
    // Widens from tablet upward (mobile portrait keeps today's max-w-lg) -
    // same approach as app/instructor/page.tsx, using px arbitrary values
    // (not max-w-3xl/4xl or max-w-screen-*, which this Tailwind v4 project
    // doesn't ship) so each tier's cap equals that breakpoint's own viewport
    // width. BottomTabs gets the same ladder via its maxWidthClassName prop
    // in StudentClient.tsx, so the fixed bottom nav never mismatches this
    // shell's width.
    //
    // min-h-dvh (100dvh), not min-h-screen (100vh) - see
    // app/instructor/page.tsx's own comment on this same change: 100vh is
    // computed against the address-bar-collapsed layout viewport on mobile,
    // which is what made the fixed BottomTabs appear to float/detach from
    // the true bottom edge as the browser's address bar animates in/out.
    <div className="mx-auto flex min-h-dvh w-full max-w-lg flex-col bg-background sm:max-w-[640px] md:max-w-[768px] lg:max-w-[1024px] xl:max-w-[1280px]">
      <StudentClient />
    </div>
  );
}
