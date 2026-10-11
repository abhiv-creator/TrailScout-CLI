export interface Coordinate {
  lat: number;
  lon: number;
}

export interface Place {
  displayName: string;
  lat: number;
  lon: number;
}

export interface OsmFeature {
  id: number;
  geometry: Coordinate[];
  tags: Record<string, string>;
}

export interface RouteInstruction {
  text: string;
  distanceMeters: number;
}

export interface RouteFact {
  label: string;
  kind: "green-space" | "footway";
  tags: Record<string, string>;
}

export interface RouteNarrative {
  cues: RouteInstruction[];
  facts: RouteFact[];
  challengeTips: string[];
  generatedBy: "local-rules";
}

export interface Itinerary {
  createdAt: string;
  place: Place;
  targetDistanceKm: number;
  distanceMeters: number;
  estimatedMinutes: number;
  geometry: Coordinate[];
  narrative: RouteNarrative;
  mapFeatures: OsmFeature[];
  routingSource: string;
}

export interface Preferences {
  preferGreenSpaces: boolean;
  avoidBusyRoads: boolean;
}
