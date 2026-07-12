export type StoredValueGuard<T> = (value: unknown) => value is T;

export function loadJSON<T>(key: string, fallback: T, isValid: StoredValueGuard<T>): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const value: unknown = JSON.parse(raw);
    return isValid(value) ? value : fallback;
  } catch {
    return fallback;
  }
}

export function saveJSON(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore storage failures from private mode or exhausted quota.
  }
}

export function isString(value: unknown): value is string {
  return typeof value === "string";
}

export function isNumberInRange(minimum: number, maximum: number): StoredValueGuard<number> {
  return (value: unknown): value is number =>
    typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum;
}

export function isOneOf<const Value extends string>(
  ...allowed: readonly Value[]
): StoredValueGuard<Value> {
  const values = new Set<string>(allowed);
  return (value: unknown): value is Value => typeof value === "string" && values.has(value);
}

export function isStringRecord(value: unknown): value is Record<string, string> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every((item) => typeof item === "string")
  );
}

export function isStringArrayRecord(value: unknown): value is Record<string, string[]> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every(
      (item) => Array.isArray(item) && item.every((entry) => typeof entry === "string"),
    )
  );
}
