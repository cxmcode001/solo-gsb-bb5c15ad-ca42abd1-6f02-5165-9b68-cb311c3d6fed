import type { TournamentState } from './types';

const STORAGE_KEY = 'swiss-pairing-tournament-v1';

export function loadState(): TournamentState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as TournamentState;
    if (!Array.isArray(parsed.players) || !Array.isArray(parsed.rounds)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveState(state: TournamentState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // 存储不可用时静默降级（内存中仍可用）
  }
}

export function clearState(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
