import { useEffect } from "react";
import { CircleMarker, MapContainer, Polygon, Polyline, TileLayer, useMap } from "react-leaflet";
import type { Coordinate, OsmFeature } from "../types";

function MapViewport({ route }: { route: Coordinate[] }) {
  const map = useMap();
  useEffect(() => {
    if (route.length > 1) {
      map.fitBounds(route.map(({ lat, lon }) => [lat, lon] as [number, number]), { padding: [28, 28] });
    }
  }, [map, route]);
  return null;
}

function isGreenSpace(feature: OsmFeature): boolean {
  return Boolean(
    feature.tags.leisure &&
      ["park", "garden", "nature_reserve", "common"].includes(feature.tags.leisure) ||
      feature.tags.landuse &&
      ["grass", "forest", "recreation_ground", "meadow"].includes(feature.tags.landuse),
  );
}

export default function MapView({ route, features }: { route: Coordinate[]; features: OsmFeature[] }) {
  const center = route[0] ?? { lat: 0, lon: 0 };
  return (
    <MapContainer center={[center.lat, center.lon]} zoom={14} scrollWheelZoom className="route-map">
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      {features.map((feature) => {
        const positions = feature.geometry.map(({ lat, lon }) => [lat, lon] as [number, number]);
        if (isGreenSpace(feature) && positions.length > 2) {
          return (
            <Polygon
              key={`area-${feature.id}`}
              positions={positions}
              pathOptions={{ color: "#789e61", weight: 1, fillColor: "#cce2ad", fillOpacity: 0.45 }}
            />
          );
        }
        if (["footway", "path", "pedestrian", "steps", "track"].includes(feature.tags.highway ?? "")) {
          return (
            <Polyline
              key={`way-${feature.id}`}
              positions={positions}
              pathOptions={{ color: "#86a777", weight: 2, opacity: 0.65, dashArray: "3 6" }}
            />
          );
        }
        return null;
      })}
      <Polyline positions={route.map(({ lat, lon }) => [lat, lon] as [number, number])} pathOptions={{ color: "#e77e4d", weight: 5, lineCap: "round" }} />
      {route[0] && <CircleMarker center={[route[0].lat, route[0].lon]} radius={8} pathOptions={{ color: "#fff", weight: 3, fillColor: "#123d32", fillOpacity: 1 }} />}
      <MapViewport route={route} />
    </MapContainer>
  );
}
