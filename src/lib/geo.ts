import type { Coordinate, OsmFeature } from "../types";

const EARTH_RADIUS_METERS = 6_371_008.8;

export function distanceMeters(a: Coordinate, b: Coordinate): number {
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const latitudeDifference = toRadians(b.lat - a.lat);
  const longitudeDifference = toRadians(b.lon - a.lon);
  const firstLatitude = toRadians(a.lat);
  const secondLatitude = toRadians(b.lat);
  const haversine =
    Math.sin(latitudeDifference / 2) ** 2 +
    Math.cos(firstLatitude) *
      Math.cos(secondLatitude) *
      Math.sin(longitudeDifference / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(Math.min(1, haversine)));
}

export function pointAtDistanceAndBearing(
  origin: Coordinate,
  meters: number,
  bearingDegrees: number,
): Coordinate {
  const angularDistance = meters / EARTH_RADIUS_METERS;
  const bearing = (bearingDegrees * Math.PI) / 180;
  const latitude = (origin.lat * Math.PI) / 180;
  const longitude = (origin.lon * Math.PI) / 180;
  const destinationLatitude = Math.asin(
    Math.sin(latitude) * Math.cos(angularDistance) +
      Math.cos(latitude) * Math.sin(angularDistance) * Math.cos(bearing),
  );
  const destinationLongitude =
    longitude +
    Math.atan2(
      Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(latitude),
      Math.cos(angularDistance) - Math.sin(latitude) * Math.sin(destinationLatitude),
    );
  return {
    lat: (destinationLatitude * 180) / Math.PI,
    lon: ((((destinationLongitude * 180) / Math.PI + 540) % 360) - 180),
  };
}

export function lineLengthMeters(points: Coordinate[]): number {
  return points.slice(1).reduce((total, point, index) => total + distanceMeters(points[index], point), 0);
}

export function buildLoopWaypoints(
  origin: Coordinate,
  targetDistanceKm: number,
  rotationDegrees = 0,
  scale = 1,
): Coordinate[] {
  const radialFraction = 1 / (2 + 2 * Math.sqrt(3));
  const radius = targetDistanceKm * 1000 * radialFraction * scale;
  return [
    origin,
    pointAtDistanceAndBearing(origin, radius, rotationDegrees),
    pointAtDistanceAndBearing(origin, radius, rotationDegrees + 120),
    pointAtDistanceAndBearing(origin, radius, rotationDegrees + 240),
    origin,
  ];
}

function isGreenSpace(tags: Record<string, string>): boolean {
  return (
    ["park", "garden", "nature_reserve", "common"].includes(tags.leisure ?? "") ||
    ["grass", "forest", "recreation_ground", "meadow"].includes(tags.landuse ?? "")
  );
}

function isBusyRoad(tags: Record<string, string>): boolean {
  return ["primary", "secondary", "tertiary", "trunk", "motorway"].includes(tags.highway ?? "");
}

function distanceToSegmentMeters(point: Coordinate, start: Coordinate, end: Coordinate): number {
  const latitudeScale = 111_132;
  const longitudeScale = 111_320 * Math.cos((point.lat * Math.PI) / 180);
  const x = (coordinate: Coordinate) => (coordinate.lon - point.lon) * longitudeScale;
  const y = (coordinate: Coordinate) => (coordinate.lat - point.lat) * latitudeScale;
  const startX = x(start);
  const startY = y(start);
  const endX = x(end);
  const endY = y(end);
  const deltaX = endX - startX;
  const deltaY = endY - startY;
  const lengthSquared = deltaX * deltaX + deltaY * deltaY;
  const projection =
    lengthSquared === 0
      ? 0
      : Math.max(0, Math.min(1, -(startX * deltaX + startY * deltaY) / lengthSquared));
  return Math.hypot(startX + projection * deltaX, startY + projection * deltaY);
}

function isInsidePolygon(point: Coordinate, polygon: Coordinate[]): boolean {
  let inside = false;
  for (let current = 0, previous = polygon.length - 1; current < polygon.length; previous = current++) {
    const currentPoint = polygon[current];
    const previousPoint = polygon[previous];
    const crosses =
      currentPoint.lat > point.lat !== previousPoint.lat > point.lat &&
      point.lon <
        ((previousPoint.lon - currentPoint.lon) * (point.lat - currentPoint.lat)) /
          (previousPoint.lat - currentPoint.lat) +
          currentPoint.lon;
    if (crosses) inside = !inside;
  }
  return inside;
}

function isNearFeature(point: Coordinate, feature: OsmFeature, maximumDistanceMeters: number): boolean {
  if (feature.geometry.length < 2) return false;
  for (let index = 1; index < feature.geometry.length; index += 1) {
    if (distanceToSegmentMeters(point, feature.geometry[index - 1], feature.geometry[index]) <= maximumDistanceMeters) {
      return true;
    }
  }
  return false;
}

export function sampleLine(points: Coordinate[], spacingMeters = 40): Coordinate[] {
  if (points.length < 2) return points;
  const samples: Coordinate[] = [points[0]];
  let sinceLastSample = 0;
  for (let segmentIndex = 1; segmentIndex < points.length; segmentIndex += 1) {
    const start = points[segmentIndex - 1];
    const end = points[segmentIndex];
    const segmentLength = distanceMeters(start, end);
    const steps = Math.max(1, Math.ceil(segmentLength / spacingMeters));
    for (let step = 1; step <= steps; step += 1) {
      sinceLastSample += segmentLength / steps;
      if (sinceLastSample >= spacingMeters || step === steps) {
        const ratio = step / steps;
        samples.push({
          lat: start.lat + (end.lat - start.lat) * ratio,
          lon: start.lon + (end.lon - start.lon) * ratio,
        });
        sinceLastSample = 0;
      }
    }
  }
  return samples;
}

export function featuresAlongRoute(
  route: Coordinate[],
  features: OsmFeature[],
  toleranceMeters = 30,
): OsmFeature[] {
  const samples = sampleLine(route);
  return features.filter((feature) => {
    if (feature.geometry.length < 2) return false;
    const greenArea =
      isGreenSpace(feature.tags) &&
      samples.some((sample) => isInsidePolygon(sample, feature.geometry));
    return (
      greenArea ||
      samples.some((sample) => isNearFeature(sample, feature, toleranceMeters))
    );
  });
}

export function routePreferenceScore(
  route: Coordinate[],
  features: OsmFeature[],
  preferences: { preferGreenSpaces: boolean; avoidBusyRoads: boolean },
): number {
  const samples = sampleLine(route, 80);
  if (samples.length === 0) return Number.POSITIVE_INFINITY;
  let score = 0;
  if (preferences.preferGreenSpaces) {
    const greenSamples = samples.filter((sample) =>
      features.some(
        (feature) =>
          isGreenSpace(feature.tags) &&
          (isInsidePolygon(sample, feature.geometry) || isNearFeature(sample, feature, 20)),
      ),
    ).length;
    score += 1 - greenSamples / samples.length;
  }
  if (preferences.avoidBusyRoads) {
    const busyRoadSamples = samples.filter((sample) =>
      features.some((feature) => isBusyRoad(feature.tags) && isNearFeature(sample, feature, 30)),
    ).length;
    score += 1.5 * (busyRoadSamples / samples.length);
  }
  return score;
}
