"use client";

import { motion, AnimatePresence } from "framer-motion";
import type { ReactNode } from "react";

interface BadgeProps {
  children: ReactNode;
  variant?: "default" | "primary" | "success" | "warning" | "danger" | "outline";
  size?: "sm" | "md";
  className?: string;
}

const badgeVariants = {
  default: "bg-[hsl(var(--surface))] text-[hsl(var(--foreground-muted))]",
  primary: "bg-[hsl(var(--primary)/0.15)] text-[hsl(var(--primary))]",
  success: "bg-[hsl(var(--success)/0.15)] text-[hsl(var(--success))]",
  warning: "bg-[hsl(var(--warning)/0.15)] text-[hsl(var(--warning))]",
  danger: "bg-[hsl(var(--danger)/0.15)] text-[hsl(var(--danger))]",
  outline: "bg-transparent border border-[hsl(var(--border))] text-[hsl(var(--foreground-muted))]",
};

const badgeSizes = {
  sm: "px-2 py-0.5 text-xs",
  md: "px-3 py-1 text-sm",
};

export function Badge({
  children,
  variant = "default",
  size = "md",
  className = "",
}: BadgeProps) {
  return (
    <span
      className={`
        inline-flex items-center gap-1 rounded-full font-medium
        ${badgeVariants[variant]}
        ${badgeSizes[size]}
        ${className}
      `}
    >
      {children}
    </span>
  );
}

interface ToggleGroupProps {
  options: Array<{ value: string; label: string }>;
  value: string;
  onChange: (value: string) => void;
  className?: string;
}

export function ToggleGroup({
  options,
  value,
  onChange,
  className = "",
}: ToggleGroupProps) {
  return (
    <div
      className={`
        inline-flex p-1 rounded-xl
        bg-[hsl(var(--surface))] border border-[hsl(var(--border))]
        ${className}
      `}
    >
      {options.map((option) => (
        <motion.button
          key={option.value}
          whileTap={{ scale: 0.98 }}
          onClick={() => onChange(option.value)}
          className={`
            relative px-4 py-2 rounded-lg text-sm font-medium
            transition-colors duration-200
            ${value === option.value
              ? "text-[hsl(var(--foreground))]"
              : "text-[hsl(var(--foreground-muted))] hover:text-[hsl(var(--foreground))]"
            }
          `}
        >
          {value === option.value && (
            <motion.div
              layoutId="toggle-indicator"
              className="absolute inset-0 bg-[hsl(var(--card))] rounded-lg shadow-sm"
              transition={{ type: "spring", stiffness: 400, damping: 30 }}
            />
          )}
          <span className="relative z-10">{option.label}</span>
        </motion.button>
      ))}
    </div>
  );
}

export function StatusPill({ status, children }: { status: "active" | "pending" | "completed" | "rejected" | "draft" | "archived"; children?: ReactNode }) {
  const statusStyles = {
    active: "bg-[hsl(var(--success)/0.15)] text-[hsl(var(--success))]",
    pending: "bg-[hsl(var(--warning)/0.15)] text-[hsl(var(--warning))]",
    completed: "bg-[hsl(var(--primary)/0.15)] text-[hsl(var(--primary))]",
    rejected: "bg-[hsl(var(--danger)/0.15)] text-[hsl(var(--danger))]",
    draft: "bg-[hsl(var(--surface))] text-[hsl(var(--foreground-muted))]",
    archived: "bg-[hsl(var(--surface))] text-[hsl(var(--foreground-muted))]",
  };

  const statusLabels = {
    active: "Active", pending: "Pending", completed: "Completed",
    rejected: "Rejected", draft: "Draft", archived: "Archived",
  };

  return (
    <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold ${statusStyles[status]}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${
        status === "active" ? "bg-[hsl(var(--success))]" :
        status === "pending" ? "bg-[hsl(var(--warning))]" :
        status === "completed" ? "bg-[hsl(var(--primary))]" :
        status === "rejected" ? "bg-[hsl(var(--danger))]" :
        "bg-[hsl(var(--foreground-muted))]"
      }`} />
      {children || statusLabels[status]}
    </span>
  );
}

export function Avatar({ src, name, size = "md", className = "" }: { src?: string; name: string; size?: "sm" | "md" | "lg" | "xl"; className?: string }) {
  const avatarSizes = { sm: "w-8 h-8 text-xs", md: "w-10 h-10 text-sm", lg: "w-14 h-14 text-lg", xl: "w-20 h-20 text-2xl" };
  const initials = name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2);

  return (
    <div className={`${avatarSizes[size]} rounded-full flex items-center justify-center font-semibold bg-gradient-to-br from-[hsl(var(--primary))] to-[hsl(280_70%_50%)] text-white overflow-hidden ${className}`}>
      {src ? <img src={src} alt={name} className="w-full h-full object-cover" /> : initials}
    </div>
  );
}

export function Progress({ value, max = 100, showLabel = false, size = "md", className = "" }: { value: number; max?: number; showLabel?: boolean; size?: "sm" | "md" | "lg"; className?: string }) {
  const progressSizes = { sm: "h-1.5", md: "h-2.5", lg: "h-4" };
  const percentage = Math.min((value / max) * 100, 100);

  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      {showLabel && (
        <div className="flex justify-between text-sm">
          <span className="text-[hsl(var(--foreground-muted))]">Progress</span>
          <span className="font-medium text-[hsl(var(--foreground))]">{Math.round(percentage)}%</span>
        </div>
      )}
      <div className={`w-full ${progressSizes[size]} rounded-full bg-[hsl(var(--surface))] overflow-hidden`}>
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${percentage}%` }}
          transition={{ duration: 0.5, ease: "easeOut" }}
          className="h-full bg-gradient-to-r from-[hsl(var(--primary))] to-[hsl(280_70%_60%)] rounded-full"
        />
      </div>
    </div>
  );
}

export function Skeleton({ className = "", rounded = "md" }: { className?: string; rounded?: "sm" | "md" | "lg" | "full" }) {
  const roundedClasses = { sm: "rounded-lg", md: "rounded-xl", lg: "rounded-2xl", full: "rounded-full" };
  return <div className={`skeleton animate-pulse ${roundedClasses[rounded]} ${className}`} />;
}
