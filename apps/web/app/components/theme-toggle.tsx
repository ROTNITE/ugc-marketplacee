"use client";

import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { Sun, Moon } from "lucide-react";
import { motion } from "framer-motion";

export function ThemeToggle({ className = "" }: { className?: string }) {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <div 
        className={`w-10 h-10 rounded-xl bg-[hsl(var(--surface))] ${className}`}
        aria-hidden="true"
      />
    );
  }

  const isDark = theme === "dark";

  return (
    <motion.button
      whileHover={{ scale: 1.05 }}
      whileTap={{ scale: 0.95 }}
      onClick={() => setTheme(isDark ? "light" : "dark")}
      className={`
        relative w-10 h-10 rounded-xl flex items-center justify-center
        bg-[hsl(var(--surface))] hover:bg-[hsl(var(--surface-hover))]
        border border-[hsl(var(--border))] hover:border-[hsl(var(--border-hover))]
        transition-all duration-300 ease-out
        ${className}
      `}
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
    >
      <motion.div
        initial={false}
        animate={{ 
          rotate: isDark ? 0 : 180,
          scale: isDark ? 1 : 0
        }}
        transition={{ duration: 0.3, ease: "easeOut" }}
        className="absolute"
      >
        <Moon className="w-5 h-5 text-[hsl(var(--foreground-muted))]" />
      </motion.div>
      <motion.div
        initial={false}
        animate={{ 
          rotate: isDark ? -180 : 0,
          scale: isDark ? 0 : 1
        }}
        transition={{ duration: 0.3, ease: "easeOut" }}
        className="absolute"
      >
        <Sun className="w-5 h-5 text-[hsl(var(--foreground-muted))]" />
      </motion.div>
    </motion.button>
  );
}
