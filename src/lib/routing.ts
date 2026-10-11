import type { Coordinate, OsmFeature, Preferences, RouteInstruction } from "../types";
import { buildLoopWaypoints, distanceMeters, routePreferenceScore } from "./geo";
import { OpenDataError } from "./openData";

export const ROUTING_SOURCE = "OSM-based walking router · routing.openstreetmap.de";
const ROUTING_ENDPOINT = "https://routing.openstreetmap.de/routed-foot/route/v1/foot/";
const REQUEST_GAP_MS = 1050;

class NoWalkingRouteError extends OpenDataError {}

interface RouterStep {
  name?: string;
  distance?: number;
  maneuver?: {
    type?: string;
    modifier?: string;
    exit?: number;
  };
}

interface RouterResponse {
  code?: string;
  message?: string;
  routes?: Array<{
    distance: number;
    duration: number;
    geometry: { type: "LineString"; coordinates: [number, number][] };
    legs?: Array<{ steps?: RouterStep[] }>;
  }>;
}

export interface WalkingRoute {
  distanceMeters: number;
  durationSeconds: number;
  geometry: Coordinate[];
  cues: RouteInstruction[];
}

let lastRouteRequestAt = 0;

function describeManeuver(step: RouterStep): string | null {
  const type = step.maneuver?.type;
  const modifier = step.maneuver?.modifier;
  const namedRoad = step.name && step.name !== "(unnamed road)" ? ` onto ${step.name}` : "";
  if (!type) return null;
  if (type === "depart") return `Start${namedRoad}`;
  if (type === "arrive") return "Arrive at the route end";
  if (type === "roundabout" || type === "rotary") {
    const exit = step.maneuver?.exit ? `, take exit ${step.maneuver.exit}` : "";
    return `At the roundabout${exit}${namedRoad}`;
  }
  if (type === "turn" || type === "end of road" || type === "fork" || type === "merge") {
    const turn = modifier ? ` ${modifier}` : "";
    return `Turn${turn}${namedRoad}`;
  }
  if (type === "new name") return `Continue${namedRoad}`;
  if (type === "continue" || type === "on ramp" || type === "off ramp") {
    return `Continue${namedRoad}`;
  }
  if (type === "uturn") return `Turn around${namedRoad}`;
  return null;
}

export function parseWalkingRouteResponse(data: RouterResponse): WalkingRoute {
  if (data.code !== "Ok" || !data.routes?.[0]?.geometry?.coordinates?.length) {
    const message = data.message || (data.code === "NoRoute"
      ? "No mapped walking route could be found for these waypoints."
      : "The walking router could not return a route.");
    if (data.code === "NoRoute") throw new NoWalkingRouteError(message);
    throw new OpenDataError(message);
  }

  const route = data.routes[0];
  const cues = (route.legs ?? [])
    .flatMap((leg) => leg.steps ?? [])
    .map((step) => ({ text: describeManeuver(step), distanceMeters: step.distance ?? 0 }))
    .filter((cue): cue is RouteInstruction => Boolean(cue.text))
    .filter((cue, index, all) => index === 0 || cue.text !== all[index - 1].text);

  return {
    distanceMeters: route.distance,
    durationSeconds: route.duration,
    geometry: route.geometry.coordinates.map(([lon, lat]) => ({ lat, lon })),
    cues,
  };
}

async function requestWalkingRoute(waypoints: Coordinate[], signal?: AbortSignal): Promise<WalkingRoute> {
  const remainingWait = REQUEST_GAP_MS - (Date.now() - lastRouteRequestAt);
  if (remainingWait > 0) await new Promise((resolve) => setTimeout(resolve, remainingWait));

  const coordinates = waypoints.map(({ lat, lon }) => `${lon.toFixed(6)},${lat.toFixed(6)}`).join(";");
  const url = new URL(`${coordinates}`, ROUTING_ENDPOINT);
  url.searchParams.set("overview", "full");
  url.searchParams.set("geometries", "geojson");
  url.searchParams.set("steps", "true");

  let response: Response;
  try {
    lastRouteRequestAt = Date.now();
    response = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: signal ?? AbortSignal.timeout(35_000),
    });
  } catch {
    throw new OpenDataError("The walking router could not connect. Check your connection and try again.");
  }
  if (!response.ok) {
    if (response.status === 429) {
      throw new OpenDataError("The public walking router is rate limited. Please wait a little before trying again.", 429);
    }
    throw new OpenDataError(`The walking router failed (HTTP ${response.status}). Please try again.`, response.status);
  }
  return parseWalkingRouteResponse((await response.json()) as RouterResponse);
}

function routeScore(route: WalkingRoute, targetMeters: number, features: OsmFeature[], preferences: Preferences): number {
  const distanceError = Math.abs(route.distanceMeters - targetMeters) / targetMeters;
  return distanceError * 3 + routePreferenceScore(route.geometry, features, preferences);
}

export async function planWalkingRoute(
  origin: Coordinate,
  targetDistanceKm: number,
  featureData: OsmFeature[] | Promise<OsmFeature[]>,
  preferences: Preferences,
  signal?: AbortSignal,
): Promise<WalkingRoute> {
  const targetMeters = targetDistanceKm * 1000;
  const rotations = [0, 60, 120];
  const candidates: Array<{ route: WalkingRoute; rotation: number }> = [];

  for (const rotation of rotations) {
    const waypoints = buildLoopWaypoints(origin, targetDistanceKm, rotation);
    try {
      candidates.push({ route: await requestWalkingRoute(waypoints, signal), rotation });
    } catch (error) {
      if (!(error instanceof NoWalkingRouteError)) throw error;
    }
  }

  if (candidates.length === 0) {
    throw new NoWalkingRouteError("No mapped walking loop could be found nearby. Try another starting place or a shorter distance.");
  }

  const features = await featureData;
  const selected = candidates.reduce((best, candidate) =>
    routeScore(candidate.route, targetMeters, features, preferences) <
    routeScore(best.route, targetMeters, features, preferences)
      ? candidate
      : best,
  );
  if (Math.abs(selected.route.distanceMeters - targetMeters) / targetMeters <= 0.12) {
    return selected.route;
  }

  const scale = Math.max(0.65, Math.min(1.35, targetMeters / selected.route.distanceMeters));
  const adjustedWaypoints = buildLoopWaypoints(origin, targetDistanceKm, selected.rotation, scale);
  let adjustedRoute: WalkingRoute;
  try {
    adjustedRoute = await requestWalkingRoute(adjustedWaypoints, signal);
  } catch (error) {
    if (error instanceof NoWalkingRouteError) return selected.route;
    throw error;
  }
  return routeScore(adjustedRoute, targetMeters, features, preferences) <
    routeScore(selected.route, targetMeters, features, preferences)
    ? adjustedRoute
    : selected.route;
}

export function routeIsLoop(route: WalkingRoute, origin: Coordinate, toleranceMeters = 150): boolean {
  const first = route.geometry[0];
  const last = route.geometry[route.geometry.length - 1];
  return Boolean(first && last && distanceMeters(first, origin) <= toleranceMeters && distanceMeters(last, origin) <= toleranceMeters);
}
