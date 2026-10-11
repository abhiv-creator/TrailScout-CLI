import type {
  Coordinate,
  OsmFeature,
  RouteFact,
  RouteInstruction,
  RouteNarrative,
} from "../types";
import { featuresAlongRoute } from "./geo";

export interface NarrativeContext {
  route: Coordinate[];
  cues: RouteInstruction[];
  features: OsmFeature[];
}

export interface NarrativeEngine {
  readonly kind: "local-rules" | "local-gemma";
  generate(context: NarrativeContext): Promise<RouteNarrative>;
}

function featureLabel(feature: OsmFeature): string {
  return feature.tags.name || feature.tags.leisure || feature.tags.landuse || feature.tags.highway || "mapped feature";
}

function factsForRoute(route: Coordinate[], features: OsmFeature[]): RouteFact[] {
  return featuresAlongRoute(route, features)
    .flatMap((feature) => {
      const green = ["park", "garden", "nature_reserve", "common"].includes(feature.tags.leisure ?? "") ||
        ["grass", "forest", "recreation_ground", "meadow"].includes(feature.tags.landuse ?? "");
      const footway = ["footway", "path", "pedestrian", "steps", "track"].includes(feature.tags.highway ?? "");
      if (!green && !footway) return [];
      return [{
        label: featureLabel(feature),
        kind: green ? "green-space" as const : "footway" as const,
        tags: feature.tags,
      }];
    })
    .filter((fact, index, facts) =>
      facts.findIndex((candidate) => candidate.label === fact.label && candidate.kind === fact.kind) === index,
    )
    .slice(0, 4);
}

export function parseRouteInstructions(cues: RouteInstruction[]): RouteInstruction[] {
  return cues
    .filter((cue) => cue.text.trim().length > 0)
    .map((cue) => ({ text: cue.text.trim(), distanceMeters: Math.max(0, cue.distanceMeters) }))
    .slice(0, 8);
}

export function buildChallengeTips(facts: RouteFact[]): string[] {
  const tips = [
    "Start at a pace that still lets you chat; the first kilometre is your warm-up.",
    "Take water, check the forecast, and turn back if conditions or footing feel unsafe.",
  ];
  const park = facts.find((fact) => fact.kind === "green-space");
  if (park) tips.unshift(`Pause in the mapped ${park.label} area for a quick stretch or nature check-in.`);
  const path = facts.find((fact) => fact.kind === "footway");
  if (path) tips.push(`A mapped ${path.label} feature is near this route; check the surface before you set off.`);
  return tips.slice(0, 4);
}

export class RuleBasedNarrativeEngine implements NarrativeEngine {
  readonly kind = "local-rules" as const;

  async generate(context: NarrativeContext): Promise<RouteNarrative> {
    const facts = factsForRoute(context.route, context.features);
    const cues = parseRouteInstructions(context.cues);
    return {
      cues: cues.length > 0
        ? cues
        : [{ text: "Follow the mapped walking line on the map; turn-by-turn steps were not returned by the router.", distanceMeters: 0 }],
      facts,
      challengeTips: buildChallengeTips(facts),
      generatedBy: "local-rules",
    };
  }
}

export const narrativeEngine: NarrativeEngine = new RuleBasedNarrativeEngine();
