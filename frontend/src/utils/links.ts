export function safeExternalUrl(raw: string): string | null {
  const value = raw.trim();
  if (!value || /\s/.test(value)) return null;
  try {
    const url = new URL(value, "https://vodex.local/");
    return url.protocol === "http:" || url.protocol === "https:" || url.protocol === "mailto:"
      ? value
      : null;
  } catch {
    return null;
  }
}
