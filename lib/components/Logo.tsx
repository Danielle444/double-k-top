import Image from "next/image";

const LOGO_ASPECT_RATIO = 752 / 1424;

interface LogoProps {
  variant?: "full" | "mark";
  width?: number;
  className?: string;
}

export function Logo({ variant = "full", width = 220, className = "" }: LogoProps) {
  if (variant === "mark") {
    return (
      <div
        className={`relative overflow-hidden rounded-lg ${className}`}
        style={{ width, height: width }}
      >
        <Image
          src="/logo.jpeg"
          alt="Double K Top"
          fill
          className="object-cover object-top"
          sizes={`${width}px`}
          priority
        />
      </div>
    );
  }

  return (
    <Image
      src="/logo.jpeg"
      alt="Double K Top - קורסי מדריכים ומאמנים"
      width={width}
      height={Math.round(width * LOGO_ASPECT_RATIO)}
      className={className}
      priority
    />
  );
}
