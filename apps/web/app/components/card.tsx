"use client";

import { motion } from "framer-motion";
import type { ReactNode } from "react";

interface CardProps {
  children: ReactNode;
  className?: string;
  hover?: boolean;
  glass?: boolean;
  padding?: "none" | "sm" | "md" | "lg";
}

const paddingSizes = {
  none: "",
  sm: "p-4",
  md: "p-6",
  lg: "p-8",
};

export function Card({
  children,
  className = "",
  hover = false,
  glass = false,
  padding = "md",
}: CardProps) {
  const baseStyles = `
    rounded-2xl
    ${glass 
      ? "bg-[var(--glass-bg)] backdrop-blur-xl border border-[var(--glass-border)]" 
      : "bg-[hsl(var(--card))] border border-[hsl(var(--border))]"
    }
    ${paddingSizes[padding]}
    ${className}
  `;

  if (hover) {
    return (
      <motion.div
        whileHover={{ 
          y: -4,
          transition: { duration: 0.25, ease: "easeOut" }
        }}
        className={`
          ${baseStyles}
          transition-shadow duration-300
          hover:shadow-xl hover:border-[hsl(var(--border-hover))]
        `}
      >
        {children}
      </motion.div>
    );
  }

  return <div className={baseStyles}>{children}</div>;
}

export function FeatureCard({
  icon,
  title,
  description,
  className = "",
}: {
  icon: ReactNode;
  title: string;
  description: string;
  className?: string;
}) {
  return (
    <Card hover className={className}>
      <div className="flex flex-col gap-4">
        <div className="w-12 h-12 rounded-xl bg-[hsl(var(--primary)/0.1)] flex items-center justify-center text-[hsl(var(--primary))]">
          {icon}
        </div>
        <div className="flex flex-col gap-2">
          <h3 className="text-lg font-semibold text-[hsl(var(--foreground))]">
            {title}
          </h3>
          <p className="text-sm text-[hsl(var(--foreground-muted))] leading-relaxed">
            {description}
          </p>
        </div>
      </div>
    </Card>
  );
}
