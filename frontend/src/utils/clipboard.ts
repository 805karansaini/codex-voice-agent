export type ClipboardWriter = (text: string) => Promise<void>;

export async function copyTextToClipboard(
  text: string,
  writeText: ClipboardWriter = (value) => navigator.clipboard.writeText(value),
): Promise<boolean> {
  try {
    await writeText(text);
    return true;
  } catch {
    return false;
  }
}
