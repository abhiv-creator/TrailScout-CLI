import type { Coordinate, OsmFeature, Place } from "../types";

const GEOCODING_ENDPOINT = "https://nominatim.openstreetmap.org/search";
const OVERPASS_ENDPOINT = "https://overpass-api.de/api/interpreter";
const GEOCODE_CACHE_PREFIX = "trailscout-geocode-v1:";
const GEOCODE_CACHE_MAX_AGE = 24 * 60 * 60 * 1000;
const GEOCODE_REQUEST_GAP = 1100;

export class OpenDataError extends Error {
  constructor(message: string, public readonly status?: number) {
    super(message);
    this.name = "OpenDataError";
  }
}

interface NominatimResult {
  display_name: string;
  lat: string;
  lon: string;
}

interface OverpassWay {
  id: number;
  tags?: Record<string, string>;
  geometry?: Array<{ lat: number; lon: number }>;
}

interface OverpassResponse {
  elements: OverpassWay[];
}

let lastGeocodeRequestAt = 0;

function readCachedPlaces(query: string): Place[] | null {
  try {
    const raw = localStorage.getItem(`${GEOCODE_CACHE_PREFIX}${query}`);
    if (!raw) return null;
    const cached: { savedAt: number; places: Place[] } = JSON.parse(raw);
    if (Date.now() - cached.savedAt > GEOCODE_CACHE_MAX_AGE) {
      localStorage.removeItem(`${GEOCODE_CACHE_PREFIX}${query}`);
      return null;
    }
    return cached.places;
  } catch {
    return null;
  }
}

export function cachePlaces(query: string, places: Place[]): boolean {
  try {
    localStorage.setItem(
      `${GEOCODE_CACHE_PREFIX}${query}`,
      JSON.stringify({ savedAt: Date.now(), places }),
    );
    return true;
  } catch {
    return false;
  }
}

export async function searchPlaces(query: string): Promise<{ places: Place[]; cached: boolean; cacheSaved: boolean }> {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const cached = readCachedPlaces(normalizedQuery);
  if (cached) return { places: cached, cached: true, cacheSaved: true };

  const remainingWait = GEOCODE_REQUEST_GAP - (Date.now() - lastGeocodeRequestAt);
  if (remainingWait > 0) await new Promise((resolve) => setTimeout(resolve, remainingWait));

  const url = new URL(GEOCODING_ENDPOINT);
  url.searchParams.set("q", query.trim());
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "5");
  url.searchParams.set("addressdetails", "1");
  let response: Response;
  try {
    lastGeocodeRequestAt = Date.now();
    response = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new OpenDataError("Could not reach OpenStreetMap search. Check your connection and try again.");
  }
  if (!response.ok) {
    if (response.status === 429) {
      throw new OpenDataError("Location search is temporarily rate limited. Please wait a little before trying again.", 429);
    }
    throw new OpenDataError(`Location search failed (HTTP ${response.status}). Please try again.`, response.status);
  }

  const results = (await response.json()) as NominatimResult[];
  const places = results.map((result) => ({
    displayName: result.display_name,
    lat: Number(result.lat),
    lon: Number(result.lon),
  }));
  return {
    places,
    cached: false,
    cacheSaved: cachePlaces(normalizedQuery, places),
  };
}

export async function fetchOsmContext(
  center: Coordinate,
  signal?: AbortSignal,
): Promise<OsmFeature[]> {
  const latitude = center.lat.toFixed(5);
  const longitude = center.lon.toFixed(5);
  const around = `around:2200,${latitude},${longitude}`;
  const query = `[out:json][timeout:20];(
    way(${around})["leisure"~"park|garden|nature_reserve|common"];
    way(${around})["landuse"~"grass|forest|recreation_ground|meadow"];
    way(${around})["highway"~"footway|path|pedestrian|steps|track|living_street|primary|secondary|tertiary|trunk"];
  );out geom;`;

  let response: Response;
  try {
    response = await fetch(OVERPASS_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
      body: new URLSearchParams({ data: query }),
      signal: signal ?? AbortSignal.timeout(25_000),
    });
  } catch {
    throw new OpenDataError("OpenStreetMap feature lookup could not connect.");
  }
  if (!response.ok) {
    if (response.status === 429 || response.status === 504) {
      throw new OpenDataError("OpenStreetMap feature lookup is busy. The route can still be planned without these preferences.", response.status);
    }
    throw new OpenDataError(`OpenStreetMap feature lookup failed (HTTP ${response.status}).`, response.status);
  }

  const data = (await response.json()) as OverpassResponse;
  return data.elements
    .filter((element) => element.geometry && element.geometry.length > 1)
    .slice(0, 500)
    .map((element) => ({
      id: element.id,
      tags: element.tags ?? {},
      geometry: (element.geometry ?? []).map((point) => ({ lat: point.lat, lon: point.lon })),
    }));
}
