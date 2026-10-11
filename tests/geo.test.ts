import { describe, expect, it } from "vitest";
import {
  buildLoopWaypoints,
  distanceMeters,
  featuresAlongRoute,
  lineLengthMeters,
  pointAtDistanceAndBearing,
  routePreferenceScore,
} from "../src/lib/geo";
import type { Coordinate, OsmFeature } from "../src/types";

const origin: Coordinate = { lat: 37.7694, lon: -122.4862 };

describe("geospatial utilities", () => {
  it("measures the one-degree latitude arc within expected tolerance", () => {
    expect(distanceMeters({ lat: 0, lon: 0 }, { lat: 1, lon: 0 })).toBeCloseTo(111_195, -1);
  });

  it("projects a point at the requested bearing and distance", () => {
    const north = pointAtDistanceAndBearing(origin, 1000, 0);
    expect(distanceMeters(origin, north)).toBeCloseTo(1000, 0);
    expect(north.lat).toBeGreaterThan(origin.lat);
  });

  it("creates a closed waypoint ring with a predictable approximate perimeter", () => {
    const waypoints = buildLoopWaypoints(origin, 5);
    expect(waypoints).toHaveLength(5);
    expect(waypoints[0]).toEqual(origin);
    expect(waypoints.at(-1)).toEqual(origin);
    expect(lineLengthMeters(waypoints)).toBeCloseTo(5000, -2);
  });

  it("matches only mapped features close to the returned route geometry", () => {
    const route: Coordinate[] = [origin, { lat: origin.lat + 0.001, lon: origin.lon }];
    const mappedPark: OsmFeature = {
      id: 1,
      geometry: [
        { lat: origin.lat - 0.0001, lon: origin.lon - 0.0002 },
        { lat: origin.lat - 0.0001, lon: origin.lon + 0.0002 },
        { lat: origin.lat + 0.0002, lon: origin.lon + 0.0002 },
        { lat: origin.lat + 0.0002, lon: origin.lon - 0.0002 },
        { lat: origin.lat - 0.0001, lon: origin.lon - 0.0002 },
      ],
      tags: { leisure: "park", name: "Mapped Park" },
    };
    const distantPath: OsmFeature = {
      id: 2,
      geometry: [{ lat: 38, lon: -122 }, { lat: 38.001, lon: -122 }],
      tags: { highway: "footway" },
    };
    expect(featuresAlongRoute(route, [mappedPark, distantPath]).map((feature) => feature.id)).toEqual([1]);
  });

  it("scores park coverage and busy-road proximity only when those preferences are enabled", () => {
    const route: Coordinate[] = [origin, { lat: origin.lat + 0.002, lon: origin.lon }];
    const park: OsmFeature = {
      id: 3,
      geometry: [
        { lat: origin.lat - 0.0002, lon: origin.lon - 0.0002 },
        { lat: origin.lat - 0.0002, lon: origin.lon + 0.0002 },
        { lat: origin.lat + 0.003, lon: origin.lon + 0.0002 },
        { lat: origin.lat + 0.003, lon: origin.lon - 0.0002 },
        { lat: origin.lat - 0.0002, lon: origin.lon - 0.0002 },
      ],
      tags: { leisure: "park" },
    };
    const road: OsmFeature = {
      id: 4,
      geometry: [{ lat: origin.lat, lon: origin.lon + 0.00001 }, { lat: origin.lat + 0.002, lon: origin.lon + 0.00001 }],
      tags: { highway: "primary" },
    };
    expect(routePreferenceScore(route, [park], { preferGreenSpaces: true, avoidBusyRoads: false })).toBeLessThan(0.1);
    expect(routePreferenceScore(route, [road], { preferGreenSpaces: false, avoidBusyRoads: true })).toBeGreaterThan(1);
  });
});
