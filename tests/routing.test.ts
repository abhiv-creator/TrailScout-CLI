import { afterEach, describe, expect, it, vi } from "vitest";
import { parseWalkingRouteResponse, planWalkingRoute, ROUTING_SOURCE } from "../src/lib/routing";
import type { Coordinate } from "../src/types";

describe("walking route provider contract", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("identifies the public OSM-based pedestrian routing source", () => {
    expect(ROUTING_SOURCE).toContain("walking router");
    expect(ROUTING_SOURCE).toContain("routing.openstreetmap.de");
  });

  it("keeps map coordinates in latitude/longitude order after GeoJSON conversion", () => {
    const coordinate: Coordinate = { lat: 37.77, lon: -122.42 };
    const route = parseWalkingRouteResponse({
      code: "Ok",
      routes: [{
        distance: 2400,
        duration: 1800,
        geometry: { type: "LineString", coordinates: [[coordinate.lon, coordinate.lat], [-122.421, 37.771]] },
        legs: [{
          steps: [
            { name: "Pine Street", distance: 80, maneuver: { type: "depart" } },
            { name: "Oak Avenue", distance: 125, maneuver: { type: "turn", modifier: "right" } },
          ],
        }],
      }],
    });

    expect(route.geometry[0]).toEqual(coordinate);
    expect(route.distanceMeters).toBe(2400);
    expect(route.cues.map((cue) => cue.text)).toEqual(["Start onto Pine Street", "Turn right onto Oak Avenue"]);
    expect(route.cues[1].distanceMeters).toBe(125);
  });

  it("does not return a route when the provider reports that no route exists", () => {
    expect(() => parseWalkingRouteResponse({ code: "NoRoute", message: "No route found." })).toThrow("No route found.");
  });

  it("skips an unroutable loop candidate and uses returned geometry from the next candidate", async () => {
    const origin: Coordinate = { lat: 37.77, lon: -122.42 };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: "NoRoute" }), { status: 200 }))
      .mockImplementation(() => Promise.resolve(new Response(JSON.stringify({
          code: "Ok",
          routes: [{
            distance: 3000,
            duration: 2100,
            geometry: {
              type: "LineString",
              coordinates: [[-122.42, 37.77], [-122.421, 37.771], [-122.42, 37.77]],
            },
            legs: [],
          }],
        }), { status: 200 })));
    vi.stubGlobal("fetch", fetchMock);

    const route = await planWalkingRoute(
      origin,
      3,
      [],
      { preferGreenSpaces: false, avoidBusyRoads: false },
    );

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(route.distanceMeters).toBe(3000);
    expect(route.geometry[0]).toEqual(origin);
  });
});
