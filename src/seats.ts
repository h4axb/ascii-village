// Where the player can sit on a piece of furniture (the bench): per asset,
// one area as fractions of its drawn box. x0..x1 is where along it they can
// sit, y1 is where the sitter's bottom rests (the seat's front edge: the
// shorts end there, the legs hang below); y0, the seat's back, only shows the
// area in the editor. Set in the world editor (E,
// Markers tab, "Seats"), saved to src/data/seats.json through
// POST /__dev/save-seats.
import data from './data/seats.json';

export interface SeatArea {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

let SEATS: Record<string, SeatArea> = data as Record<string, SeatArea>;
export const allSeats = () => SEATS;
export const seatOf = (asset?: string): SeatArea | undefined => (asset ? SEATS[asset] : undefined);
export function setSeat(asset: string, a: SeatArea | null) {
  const r = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 1000) / 1000;
  const next = { ...SEATS };
  if (a) next[asset] = { x0: r(Math.min(a.x0, a.x1)), y0: r(Math.min(a.y0, a.y1)), x1: r(Math.max(a.x0, a.x1)), y1: r(Math.max(a.y0, a.y1)) };
  else delete next[asset];
  SEATS = next;
}
export async function saveSeats(): Promise<boolean> {
  const r = await fetch('/__dev/save-seats', { method: 'POST', body: JSON.stringify(SEATS) });
  return r.ok;
}
