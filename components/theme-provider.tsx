"use client";

import { useEffect } from "react";

type Theme = "system" | "light" | "dark";

const storageKey = "cartograph-theme";

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const savedTheme = window.localStorage.getItem(storageKey);
    const root = document.documentElement;
    if (savedTheme === "light" || savedTheme === "dark") {
      root.dataset.theme = savedTheme;
    } else {
      root.removeAttribute("data-theme");
    }
  }, []);

  return <>{children}</>;
}

export type { Theme };
