export type GmGame = {
  id: string;
  white: string;
  black: string;
  event: string;
  year: number;
  result: string;
  pgn: string;
  annotations: { moveNumber: number; comment: string }[];
  source: string;
};

export type GmPlayer = {
  id: string;
  name: string;
  title: string;
  bio: string;
  photo: string;
  gameIds: string[];
};

export const gmGames: GmGame[] = Object.values(import.meta.glob('../games/*.json', { eager: true, import: 'default' }) as Record<string, GmGame>)
  .sort((a, b) => a.id.localeCompare(b.id));

export const gmPlayers: GmPlayer[] = Object.values(import.meta.glob('../players/*.json', { eager: true, import: 'default' }) as Record<string, GmPlayer>)
  .filter((player) => player.id);

export function getDailyGameId(date: Date = new Date()): string {
  const start = new Date(date.getFullYear(), 0, 0);
  const dayOfYear = Math.floor((date.getTime() - start.getTime()) / 86_400_000);
  return gmGames[dayOfYear % gmGames.length].id;
}

export function getDailyGameNumber(date: Date = new Date()): number {
  const start = new Date(date.getFullYear(), 0, 0);
  return Math.floor((date.getTime() - start.getTime()) / 86_400_000) + 1;
}
