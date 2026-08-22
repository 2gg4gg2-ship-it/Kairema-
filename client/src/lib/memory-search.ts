function normalizedMemoryText(value: string): string {
  return value.trim().toLocaleLowerCase("ru-RU").replace(/ё/g, "е");
}

/**
 * Local UI matching only. It keeps an exact match first and permits one
 * Cyrillic terminal-letter trim, so a required query such as «Луна» finds
 * «размер луны» without changing persisted private memory entries.
 */
export function memorySearchMatches(value: string, query: string): boolean {
  const normalizedValue = normalizedMemoryText(value);
  const tokens = normalizedMemoryText(query).split(/\s+/).filter(Boolean);
  if (!tokens.length) return true;

  const words = normalizedValue.split(/[^а-яa-z0-9]+/).filter(Boolean);
  return tokens.every((token) => {
    if (normalizedValue.includes(token)) return true;
    if (!/^[а-я]+$/i.test(token) || token.length < 4) return false;
    const stem = token.slice(0, -1);
    return words.some((word) => word.startsWith(stem));
  });
}
