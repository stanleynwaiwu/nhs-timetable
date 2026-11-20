/* Shared settings and rules. Edit DAYS / HOURS / VENUES / INSTRUCTORS here. */
export const DAYS = [["Mon", "Monday"], ["Tue", "Tuesday"], ["Wed", "Wednesday"], ["Thu", "Thursday"], ["Fri", "Friday"]];
export const HOURS = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17];          // each = a 1-hour lesson (8:00 to 18:00)
export const VENUES = { old: "Old NHS Lab", new: "New NHS Lab" };
export const INSTRUCTORS = [
  { id: "stanley", name: "Mr Stanley", color: "#2563eb" },
  { id: "inem",    name: "Miss Inem",  color: "#db2777" },
  { id: "femi",    name: "Mr Femi",    color: "#059669" }
];

export const pad = (n) => String(n).padStart(2, "0");
export const keyOf = (day, hour) => `${day}_${pad(hour)}`;

// slot = { old: {...}|undefined, new: {...}|undefined } for ONE day + hour.
// Returns null when the booking is allowed, otherwise a description of the clash.
export function findClash(slot, venue, instructorId) {
  slot = slot || {};
  if (slot[venue]) return { type: "venue", by: slot[venue] };
  for (const v of Object.keys(VENUES)) {
    if (v !== venue && slot[v] && slot[v].instructor === instructorId)
      return { type: "self", venue: v, course: slot[v].course };
  }
  return null;
}
