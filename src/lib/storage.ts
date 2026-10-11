import type { Itinerary } from "../types";

const LAST_ITINERARY_KEY = "trailscout-last-itinerary-v1";

export function loadLastItinerary(): Itinerary | null {
  try {
    const value = localStorage.getItem(LAST_ITINERARY_KEY);
    return value ? (JSON.parse(value) as Itinerary) : null;
  } catch {
    return null;
  }
}

export function saveLastItinerary(itinerary: Itinerary): boolean {
  try {
    localStorage.setItem(LAST_ITINERARY_KEY, JSON.stringify(itinerary));
    return true;
  } catch {
    return false;
  }
}
