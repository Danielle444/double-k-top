import type { Metadata, Viewport } from "next";
import { Heebo } from "next/font/google";
import "./globals.css";

const heebo = Heebo({
  variable: "--font-heebo",
  subsets: ["hebrew", "latin"],
});

export const metadata: Metadata = {
  title: "Double K Top",
  description: "מערכת לניהול שיבוצי תורנויות יומיים בקורס מדריכי רכיבה - דאבל קיי",
  manifest: "/manifest.webmanifest",
  // capable:true + statusBarStyle is what makes iOS treat a home-screen
  // install as a standalone app (hides Safari's chrome) instead of just
  // opening the bookmarked URL in a normal browser tab.
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Double K Top",
  },
};

// Next 16 requires theme-color in the separate viewport export, not metadata.
//
// viewportFit: "cover" is required for env(safe-area-inset-*) to resolve to
// real (non-zero) values instead of 0px - without it, BottomTabs' own
// `pb-[env(safe-area-inset-bottom)]` (lib/components/BottomTabs.tsx) is
// silently a no-op. This matters specifically because the app is
// installable as a standalone PWA (see app/manifest.ts's display:
// "standalone" and appleWebApp.capable above): once installed and launched
// without Safari's browser chrome, the fixed bottom nav must account for
// the iPhone home-indicator's safe area itself, which this opt-in enables.
export const viewport: Viewport = {
  themeColor: "#1e4a6d",
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="he" dir="rtl" className={`${heebo.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-background text-card-foreground">
        {children}
      </body>
    </html>
  );
}
