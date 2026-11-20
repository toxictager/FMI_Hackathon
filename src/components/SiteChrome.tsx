import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { Moon, Sun } from "lucide-react";
import { LogoMark } from "./Logo";

export function Header() {
  const [dark, setDark] = useState(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("theme") === "dark";
    }
    return false;
  });

  useEffect(() => {
    const root = document.documentElement;
    if (dark) {
      root.classList.add("dark");
      localStorage.setItem("theme", "dark");
    } else {
      root.classList.remove("dark");
      localStorage.setItem("theme", "light");
    }
  }, [dark]);

  return (
    <div className="w-full px-6 pt-10">
      <div className="flex items-center justify-between">
        <Link to="/" className="flex items-center gap-2">
          <LogoMark className="h-9 w-9" />
          <span className="brand-wordmark text-2xl font-extrabold tracking-tight text-foreground">Routique</span>
        </Link>
        <div className="flex items-center gap-4">
          <span className="hidden text-sm text-muted-foreground sm:block">Bulgaria, end to end</span>
          <button
            onClick={() => setDark((d) => !d)}
            className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-xl border border-border bg-card text-foreground transition-colors hover:bg-muted"
            aria-label="Toggle dark mode"
          >
            {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
        </div>
      </div>
    </div>
  );
}

export function Footer() {
  return (
    <footer className="border-t border-border py-8 text-center text-xs text-muted-foreground">
      Routique · Estimates only · Built for travelers in Bulgaria
    </footer>
  );
}

