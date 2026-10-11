# TrailScout Web

TrailScout is a mobile-first walking-route planner for outdoor enthusiasts and run-club organizers. It turns an OpenStreetMap place search into an OSM-routed walking loop, highlights nearby mapped green spaces, and adds concise, deterministic route notes and low-friction challenge ideas.

**Live app:** [trailscout-web-three.vercel.app](https://trailscout-web-three.vercel.app/)

Built for the **DEV Hacktoberfest Open-Source AI Challenge — Week 1 / Touch Grass theme**. The route planner does not call a paid AI service: its current narrative engine is local, deterministic TypeScript. A typed adapter boundary is ready for a future local Gemma integration, but no model is downloaded or required.

## Features

- Search for a park, neighborhood, or town; choose a 3 km, 5 km, 10 km, or custom 1–30 km target.
- Request actual pedestrian network routes from the OSM-based [routing.openstreetmap.de](https://routing.openstreetmap.de/) foot router. Up to three real route candidates are ranked for target-distance fit and the selected green-space / quieter-road preferences; an unroutable candidate is skipped, and a fourth adjusted-distance request is made only when needed.
- Fetch nearby green-space, footway, and major-road tags from Overpass; show matching features alongside the returned route geometry on an OpenStreetMap-backed map.
- Generate local turn cues from router-provided maneuvers and challenge tips from matched OSM tags. No directions or local features are invented when data is absent.
- Copy a compact itinerary, share it through WhatsApp, or print a screenshot-friendly route card.
- Cache place search results for 24 hours and the latest itinerary in this browser. The app shell is cached by a service worker after the first successful online visit.
- Responsive, keyboard-accessible controls, clear request/empty/error feedback, and a visible offline state.

## How the route works (and its limits)

Nominatim resolves the chosen place. TrailScout requests nearby map context from Overpass concurrently with real pedestrian routes from the public OSM-based foot router. The router returns loop-shaped waypoint options; an individual unroutable option is skipped rather than terminating the search. Every displayed line is geometry returned by the routing service; the app never substitutes straight lines or claims that a constructed segment is a safe path. The target is approximate: roads, path connectivity, and waypoint snapping can make the returned distance differ. The app displays the returned distance, not the requested target, and may make one scaled retry.

The green-space and quieter-road controls rank a small set of real pedestrian routes against nearby OSM tags; they cannot guarantee that a route enters a park, avoids traffic, is open to the public, or is safe. OSM may be incomplete or out of date. There is no live traffic, path-condition, accessibility, lighting, or closure information. Check signs and local conditions before setting out.

Nominatim, Overpass, the public router, and OpenStreetMap tiles are third-party community services, not a production SLA. They can be slow, unavailable, rate-limited, or subject to their own usage policies. TrailScout spaces Nominatim lookups, caches searches locally, sends no API keys, and has no backend proxy. Your chosen place coordinates are sent to Overpass and the router to build a route. Use these public services responsibly; do not deploy a high-volume public service against their community endpoints.

## Offline and privacy

- After the app has loaded online once, its service worker caches the production app shell and local static assets.
- The most recent itinerary and recent place searches are stored in browser `localStorage` on this device. They are not synced to an account or sent to a TrailScout server.
- Previously saved route text and its route geometry can be viewed offline, but the map tiles themselves are supplied by OpenStreetMap and may not be cached.
- New place searches, map-context lookups, route generation, and map tiles need an internet connection. TrailScout is **not** an offline map or offline routing engine.
- No analytics, login, paid API, secret, or external AI provider is used. The optional Google Fonts stylesheet is decorative; the system-font fallback works without it.

## Stack and architecture

- React 18, TypeScript, Vite, and responsive hand-authored CSS.
- Leaflet / React-Leaflet for route geometry and map display.
- `src/lib/openData.ts`: Nominatim place search, local search cache, and Overpass map context.
- `src/lib/routing.ts`: public foot-router adapter, loop candidates, distance tuning, and truthful response parsing.
- `src/lib/geo.ts`: projection, distance, OSM-feature matching, and preference scoring utilities.
- `src/lib/narrative.ts`: deterministic route-note engine behind the async `NarrativeEngine` interface; `NarrativeContext` is the seam for a local Gemma adapter.
- `src/lib/storage.ts`: last-itinerary persistence.
- `public/sw.js`: app-shell-only service worker; it does not cache live API responses or map tiles.

The route line is provider-returned map geometry. Rule-based notes are explicitly labeled as **not AI-generated**; map facts are separately identified as matched OpenStreetMap tags.

## Run locally

Requirements: Node.js 20 or later and npm.

```sh
npm install
npm run dev
```

Vite prints the local development URL. To create and preview a production build:

```sh
npm run build
npm run preview
```

Focused tests and a standalone TypeScript check:

```sh
npm test
npm run typecheck
```

No environment variables or API keys are required.

## Attribution and licensing

Map tiles and map context © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), available under the [Open Database License](https://opendatacommons.org/licenses/odbl/). Nominatim, Overpass, and the OSM-based foot router are independent public services; their availability and terms apply. TrailScout source code is MIT licensed; see [LICENSE](LICENSE).

## Challenge context

TrailScout is an open-source, zero-subscription-cost project concept for the DEV Hacktoberfest Open-Source AI Challenge Week 1 and Touch Grass theme. Its local, rules-based narrative is intentionally not presented as AI output. Challenge rules, current eligibility, and submission requirements have not been independently verified here.

## Screenshot

_Screenshot placeholder — capture the responsive planner and generated itinerary after running `npm run dev`._
