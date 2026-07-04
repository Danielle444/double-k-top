"use client";

import { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "danger" | "ghost";

const variantClasses: Record<Variant, string> = {
  primary: "bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-40",
  secondary: "bg-secondary text-secondary-foreground hover:opacity-80 disabled:opacity-50",
  danger: "bg-danger text-danger-foreground hover:opacity-90 disabled:opacity-40",
  ghost: "bg-transparent text-card-foreground hover:bg-muted disabled:opacity-50",
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
}

export function Button({ variant = "primary", className = "", ...props }: ButtonProps) {
  return (
    <button
      className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed ${variantClasses[variant]} ${className}`}
      {...props}
    />
  );
}
