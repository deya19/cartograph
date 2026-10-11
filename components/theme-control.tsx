"use client";

import { useEffect, useState } from "react";
import type { Theme } from "./theme-provider";

const storageKey = "cartograph-theme";

export function ThemeControl() {
  const [theme, setTheme] = useState<Theme>("system");

  useEffect(() => {
    const savedTheme = window.localStorage.getItem(storageKey);
    if (savedTheme === "light" || savedTheme === "dark") {
      window.setTimeout(() => setTheme(savedTheme), 0);
    }
  }, []);

  function handleChange(nextTheme: Theme) {
    setTheme(nextTheme);
    const root = document.documentElement;
    if (nextTheme === "system") {
      root.removeAttribute("data-theme");
      window.localStorage.removeItem(storageKey);
    } else {
      root.dataset.theme = nextTheme;
      window.localStorage.setItem(storageKey, nextTheme);
    }
  }

  return (
    <label className="flex items-center gap-2 font-mono text-xs text-zinc-500">
      <span className="sr-only">Theme</span>
      <select
        aria-label="Theme"
        className="rounded-md border border-zinc-300 bg-transparent px-2 py-1.5 text-xs text-current outline-none focus:border-blue-500 dark:border-zinc-700"
        onChange={(event) => handleChange(event.target.value as Theme)}
        value={theme}
      >
        <option value="system">System</option>
        <option value="light">Light</option>
        <option value="dark">Dark</option>
      </select>
    </label>
  );
}
