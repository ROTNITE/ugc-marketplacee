"use client";

import { motion } from "framer-motion";
import type { ReactNode, ButtonHTMLAttributes } from "react";

type ButtonVariant = "primary" | "secondary" | "outline" | "ghost" | "danger";
type ButtonSize = "sm" | "md" | "lg" | "xl";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: ReactNode;
  iconRight?: ReactNode;
  loading?: boolean;
  fullWidth?: boolean;
  children: ReactNode;
}

const variants: Record<ButtonVariant, string> = {
  primary: `
    bg-[hsl(var(--primary))] hover:bg-[hsl(var(--primary-hover))]
    text-[hsl(var(--primary-foreground))]
    shadow-lg shadow-[hsl(var(--primary)/0.25)]
    hover:shadow-xl hover:shadow-[hsl(var(--primary)/0.35)]
  `,
  secondary: `
    bg-[hsl(var(--secondary))] hover:bg-[hsl(var(--secondary-hover))]
    text-[hsl(var(--secondary-foreground))]
  `,
  outline: `
    bg-transparent hover:bg-[hsl(var(--surface))]
    text-[hsl(var(--foreground))]
    border border-[hsl(var(--border))] hover:border-[hsl(var(--border-hover))]
  `,
  ghost: `
    bg-transparent hover:bg-[hsl(var(--surface))]
    text-[hsl(var(--foreground-muted))] hover:text-[hsl(var(--foreground))]
  `,
  danger: `
    bg-[hsl(var(--danger))] hover:bg-[hsl(var(--danger)/0.9)]
    text-[hsl(var(--danger-foreground))]
    shadow-lg shadow-[hsl(var(--danger)/0.25)]
  `,
};

const sizes: Record<ButtonSize, string> = {
  sm: "px-3 py-1.5 text-sm rounded-lg gap-1.5",
  md: "px-4 py-2.5 text-sm rounded-xl gap-2",
  lg: "px-6 py-3 text-base rounded-xl gap-2.5",
  xl: "px-8 py-4 text-lg rounded-2xl gap-3",
};

export function Button({
  variant = "primary",
  size = "md",
  icon,
  iconRight,
  loading = false,
  fullWidth = false,
  disabled,
  children,
  className = "",
  ...props
}: ButtonProps) {
  const isDisabled = disabled || loading;

  return (
    <motion.button
      whileHover={{ scale: isDisabled ? 1 : 1.02 }}
      whileTap={{ scale: isDisabled ? 1 : 0.98 }}
      transition={{ duration: 0.15, ease: "easeOut" }}
      disabled={isDisabled}
      className={`
        inline-flex items-center justify-center font-semibold
        transition-all duration-200 ease-out
        disabled:opacity-50 disabled:cursor-not-allowed
        ${variants[variant]}
        ${sizes[size]}
        ${fullWidth ? "w-full" : ""}
        ${className}
      `}
      {...props}
    >
      {loading ? (
        <Spinner className="w-4 h-4" />
      ) : (
        <>
          {icon && <span className="flex-shrink-0">{icon}</span>}
          <span>{children}</span>
          {iconRight && <span className="flex-shrink-0">{iconRight}</span>}
        </>
      )}
    </motion.button>
  );
}

function Spinner({ className = "" }: { className?: string }) {
  return (
    <svg
      className={`animate-spin ${className}`}
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      />
    </svg>
  );
}
