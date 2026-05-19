import type { LiveSearchResult } from "../services/aiConcierge";

interface CacheEntry {
  result: LiveSearchResult;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

export function buildCacheKey(origin: string, destination: string, date: string): string {
  return `${origin}:${destination}:${date}`;
}

export function getCached(
  origin: string,
  destination: string,
  date: string
): LiveSearchResult | null {
  const key = buildCacheKey(origin, destination, date);
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  return entry.result;
}

export function setCached(
  origin: string,
  destination: string,
  date: string,
  result: LiveSearchResult,
  ttlMs = 60 * 60 * 1000
): void {
  const key = buildCacheKey(origin, destination, date);
  cache.set(key, { result, expiresAt: Date.now() + ttlMs });
}

export function clearCache(): void {
  cache.clear();
}
