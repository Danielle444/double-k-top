import type { Metadata } from "next";
import { Heebo } from "next/font/google";
import "./globals.css";

const heebo = Heebo({
  variable: "--font-heebo",
  subsets: ["hebrew", "latin"],
});

export const metadata: Metadata = {
  title: "ניהול תורנויות - קורס מדריכי רכיבה",
  description: "מערכת לניהול שיבוצי תורנויות יומיים בקורס מדריכי רכיבה",
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
