import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function chatTitleFrom(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return "New chat";
  return clean.length > 42 ? `${clean.slice(0, 42)}…` : clean;
}

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
