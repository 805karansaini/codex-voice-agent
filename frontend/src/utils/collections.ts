type Identified = { id: string };

export function mergeUniqueById<Item extends Identified>(
  preferred: readonly Item[],
  fallback: readonly Item[],
): Item[] {
  const seen = new Set(preferred.map((item) => item.id));
  return [...preferred, ...fallback.filter((item) => !seen.has(item.id))];
}

export function reconcileLoadedById<Item extends Identified>(
  loaded: readonly Item[],
  current: readonly Item[],
  options: { hasLocalChanges: boolean; wasCleared: boolean },
): Item[] {
  if (options.wasCleared) return [...current];
  if (options.hasLocalChanges) return mergeUniqueById(current, loaded);
  return [...loaded];
}
