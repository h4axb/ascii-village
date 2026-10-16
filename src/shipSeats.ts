// Where the player and Mitchy board a ship (the quest's boarding cinematic,
// App.tsx questTravel): per ship (a library ship's reference id, or
// "default" for every other boat) four points as fractions of the ship's
// drawn box, each the FEET of who stands there:
//   playerLand / mitchyLand ... where each one lands after the jump
//   playerFinal / mitchyFinal . where each one then walks to on deck, and
//                               stays while sailing
// Set in the world editor (E, Markers tab, "Ship seats"), saved to
// src/data/shipSeats.json through POST /__dev/save-ship-seats.
import data from './data/shipSeats.json';

export interface Seat {
  x: number; // 0-1 of the ship's width, from its left
  y: number; // 0-1 of its height, from its top
}
export type SeatKey = 'playerLand' | 'mitchyLand' | 'playerFinal' | 'mitchyFinal';
export type ShipSeats = Partial<Record<SeatKey, Seat>>;
export const SEAT_KEYS: { key: SeatKey; label: string }[] = [
  { key: 'mitchyLand', label: 'Mitchy · landing' },
  { key: 'mitchyFinal', label: 'Mitchy · final' },
  { key: 'playerLand', label: 'player · landing' },
  { key: 'playerFinal', label: 'player · final' },
];

let SEATS: Record<string, ShipSeats> = data as Record<string, ShipSeats>;
export const allShipSeats = () => SEATS;
export function setShipSeat(ship: string, key: SeatKey, seat: Seat | null) {
  const cur = { ...(SEATS[ship] ?? {}) };
  if (seat) cur[key] = { x: Math.round(seat.x * 1000) / 1000, y: Math.round(seat.y * 1000) / 1000 };
  else delete cur[key];
  SEATS = { ...SEATS, [ship]: cur };
}
export async function saveShipSeats(): Promise<boolean> {
  const r = await fetch('/__dev/save-ship-seats', { method: 'POST', body: JSON.stringify(SEATS) });
  return r.ok;
}
// a ship's seats: its own, else the default ones
export function seatsFor(refId?: string): ShipSeats {
  return (refId && SEATS[refId]) || SEATS.default || {};
}
