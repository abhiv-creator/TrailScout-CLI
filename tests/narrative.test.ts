import { describe, expect, it } from "vitest";
import { RuleBasedNarrativeEngine } from "../src/lib/narrative";
import type { Coordinate, OsmFeature } from "../src/types";

const route: Coordinate[] = [
  { lat: 37.77, lon: -122.49 },
  { lat: 37.771, lon: -122.49 },
];

describe("rule-based route narrative", () => {
  it("uses router cues and only names OSM features that intersect the route", async () => {
    const features: OsmFeature[] = [
      {
        id: 1,
        geometry: [
          { lat: 37.7699, lon: -122.4902 },
          { lat: 37.7699, lon: -122.4898 },
          { lat: 37.7703, lon: -122.4898 },
          { lat: 37.7703, lon: -122.4902 },
          { lat: 37.7699, lon: -122.4902 },
        ],
        tags: { leisure: "park", name: "Cedar Green" },
      },
      {
        id: 2,
        geometry: [{ lat: 38, lon: -122 }, { lat: 38.001, lon: -122 }],
        tags: { highway: "path", name: "Distant Trail" },
      },
    ];
    const narrative = await new RuleBasedNarrativeEngine().generate({
      route,
      features,
      cues: [{ text: "Turn right onto Pine Road", distanceMeters: 125 }],
    });

    expect(narrative.generatedBy).toBe("local-rules");
    expect(narrative.cues[0].text).toBe("Turn right onto Pine Road");
    expect(narrative.facts.map((fact) => fact.label)).toEqual(["Cedar Green"]);
    expect(narrative.challengeTips.some((tip) => tip.includes("Cedar Green"))).toBe(true);
  });

  it("does not invent turn-by-turn directions when the router supplies no steps", async () => {
    const narrative = await new RuleBasedNarrativeEngine().generate({
      route,
      features: [],
      cues: [],
    });
    expect(narrative.cues).toHaveLength(1);
    expect(narrative.cues[0].text).toContain("were not returned by the router");
    expect(narrative.facts).toEqual([]);
  });

  it("cleans and bounds router instructions", async () => {
    const cues = Array.from({ length: 10 }, (_, index) => ({
      text: index === 0 ? "  Start  " : `Turn ${index}`,
      distanceMeters: index - 2,
    }));
    const narrative = await new RuleBasedNarrativeEngine().generate({ route, features: [], cues });
    expect(narrative.cues).toHaveLength(8);
    expect(narrative.cues[0]).toEqual({ text: "Start", distanceMeters: 0 });
  });
});
