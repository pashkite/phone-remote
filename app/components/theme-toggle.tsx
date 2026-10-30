"use client";
import { useEffect, useState } from "react";
import UiIcon from "./ui-icon";
export default function ThemeToggle() {
  const [theme, setTheme] = useState("dark");
  useEffect(() => {
    const timer = window.setTimeout(() => {
      let saved: string | null = null;
      try { saved = localStorage.getItem("gr_pref_theme"); } catch { /* Storage is optional. */ }
      const initial = saved === "light" || saved === "dark" ? saved : "dark";
      document.documentElement.dataset.theme = initial;
      setTheme(initial);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);
  return <button className="theme-toggle" type="button" aria-label={theme === "dark" ? "라이트 테마로 변경" : "다크 테마로 변경"} onClick={() => {
    const next = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    setTheme(next);
    try { localStorage.setItem("gr_pref_theme", next); } catch { /* Storage is optional. */ }
  }}><UiIcon name={theme === "dark" ? "sun" : "moon"} /></button>;
}
