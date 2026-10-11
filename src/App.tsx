import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import MapView from "./components/MapView";
import { featuresAlongRoute } from "./lib/geo";
import { fetchOsmContext, OpenDataError, searchPlaces } from "./lib/openData";
import { narrativeEngine } from "./lib/narrative";
import { planWalkingRoute, ROUTING_SOURCE } from "./lib/routing";
import { loadLastItinerary, saveLastItinerary } from "./lib/storage";
import type { Itinerary, OsmFeature, Place, Preferences } from "./types";

const DISTANCE_OPTIONS = [3, 5, 10];

function formatDistance(meters: number): string {
  return `${(meters / 1000).toFixed(2)} km`;
}

function firstLine(value: string): string {
  return value.split(",")[0];
}

function itineraryText(itinerary: Itinerary): string {
  const cues = itinerary.narrative.cues.map((cue) => `• ${cue.text}`).join("\n");
  return [
    `TrailScout walk near ${firstLine(itinerary.place.displayName)}`,
    `${formatDistance(itinerary.distanceMeters)} · about ${itinerary.estimatedMinutes} min`,
    "",
    cues,
    "",
    "Walking route from OpenStreetMap-based routing. Check conditions and access before setting out.",
  ].join("\n");
}

function App() {
  const [query, setQuery] = useState("");
  const [places, setPlaces] = useState<Place[]>([]);
  const [selectedPlace, setSelectedPlace] = useState<Place | null>(null);
  const [presetDistance, setPresetDistance] = useState(5);
  const [customDistance, setCustomDistance] = useState("5");
  const [customSelected, setCustomSelected] = useState(false);
  const [preferences, setPreferences] = useState<Preferences>({
    preferGreenSpaces: true,
    avoidBusyRoads: true,
  });
  const [isSearching, setIsSearching] = useState(false);
  const [isPlanning, setIsPlanning] = useState(false);
  const [searchFeedback, setSearchFeedback] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [progress, setProgress] = useState("");
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [itinerary, setItinerary] = useState<Itinerary | null>(() => loadLastItinerary());

  const targetDistanceKm = useMemo(
    () => (customSelected ? Number(customDistance) : presetDistance),
    [customDistance, customSelected, presetDistance],
  );

  useEffect(() => {
    const updateOnlineStatus = () => setIsOnline(navigator.onLine);
    window.addEventListener("online", updateOnlineStatus);
    window.addEventListener("offline", updateOnlineStatus);
    return () => {
      window.removeEventListener("online", updateOnlineStatus);
      window.removeEventListener("offline", updateOnlineStatus);
    };
  }, []);

  async function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const cleanQuery = query.trim();
    if (cleanQuery.length < 3) {
      setError("Enter at least three characters to search for a place.");
      setPlaces([]);
      return;
    }

    setIsSearching(true);
    setError("");
    setNotice("");
    setSearchFeedback("");
    setPlaces([]);
    setSelectedPlace(null);
    try {
      const result = await searchPlaces(cleanQuery);
      setPlaces(result.places);
      setSearchFeedback(
        result.places.length === 0
          ? "No matching places. Try a nearby park, neighborhood, or town."
          : result.cached
            ? "Showing a location saved in this browser."
            : "Choose the right place from the results.",
      );
      if (!result.cacheSaved && !result.cached) {
        setNotice("Browser storage is unavailable, so this search will not be cached.");
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Location search failed. Try again.");
    } finally {
      setIsSearching(false);
    }
  }

  async function handlePlanRoute(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");
    if (!selectedPlace) {
      setError("Search for a location and choose one of the results first.");
      return;
    }
    if (!Number.isFinite(targetDistanceKm) || targetDistanceKm < 1 || targetDistanceKm > 30) {
      setError("Choose a distance between 1 and 30 km.");
      return;
    }

    setIsPlanning(true);
    setProgress("Checking nearby map data and requesting real mapped walking paths…");

    try {
      const featureDataPromise = fetchOsmContext(selectedPlace)
        .then((features) => ({ features, warning: "" }))
        .catch((cause: unknown) => ({
          features: [] as OsmFeature[],
          warning: cause instanceof Error
            ? cause.message
            : "OpenStreetMap feature data could not be loaded.",
        }));
      const [featureResult, route] = await Promise.all([
        featureDataPromise,
        planWalkingRoute(
          selectedPlace,
          targetDistanceKm,
          featureDataPromise.then(({ features }) => features),
          preferences,
        ),
      ]);
      const { features, warning: featureWarning } = featureResult;
      const narrative = await narrativeEngine.generate({
        route: route.geometry,
        cues: route.cues,
        features,
      });
      const result: Itinerary = {
        createdAt: new Date().toISOString(),
        place: selectedPlace,
        targetDistanceKm,
        distanceMeters: route.distanceMeters,
        estimatedMinutes: Math.max(1, Math.round(route.distanceMeters / 1000 / 5 * 60)),
        geometry: route.geometry,
        narrative,
        mapFeatures: featuresAlongRoute(route.geometry, features, 160).slice(0, 45),
        routingSource: ROUTING_SOURCE,
      };
      setItinerary(result);
      if (!saveLastItinerary(result)) {
        setNotice("Your route is ready, but browser storage is unavailable so it will not be saved for offline viewing.");
      } else if (featureWarning) {
        setNotice(`${featureWarning} Preference scoring and nearby feature highlights were unavailable for this route.`);
      } else {
        setNotice("");
      }
    } catch (cause) {
      setError(
        cause instanceof OpenDataError || cause instanceof Error
          ? cause.message
          : "Could not create a walking route. Please try again.",
      );
    } finally {
      setIsPlanning(false);
      setProgress("");
    }
  }

  async function handleCopy() {
    if (!itinerary) return;
    try {
      await navigator.clipboard.writeText(itineraryText(itinerary));
      setNotice("Route summary copied.");
    } catch {
      setNotice("Clipboard access was denied. Use the share button or select the route details to copy.");
    }
  }

  function setDistancePreset(distance: number) {
    setPresetDistance(distance);
    setCustomSelected(false);
  }

  function togglePreference(key: keyof Preferences) {
    setPreferences((current) => ({ ...current, [key]: !current[key] }));
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="TrailScout home">
          <img src="/trailscout-mark.svg" alt="" width="38" height="38" />
          <span>TrailScout</span>
        </a>
        <div className="topbar-right">
          <span className="local-badge"><span className="badge-dot" /> Open-data routes</span>
          <a className="text-link" href="#how-it-works">How it works <span aria-hidden="true">↗</span></a>
        </div>
      </header>

      {!isOnline && (
        <div className="offline-banner" role="status">
          <span aria-hidden="true">◌</span>
          You&apos;re offline. Saved route details stay available; new place search and route planning need a connection.
        </div>
      )}

      <main id="top">
        <section className="intro">
          <div className="intro-copy">
            <p className="eyebrow"><span className="eyebrow-mark">✳</span> A little farther, a little greener</p>
            <h1>Make outside<br /><em>your plan.</em></h1>
            <p className="intro-text">
              Find a real walking route near a place you love. Then take your next run-club challenge out into the open.
            </p>
          </div>
          <div className="intro-aside" aria-label="Built for your next outside day">
            <span className="aside-sun" aria-hidden="true">✳</span>
            <span className="aside-label">WEEKEND<br />WELL SPENT</span>
            <span className="aside-line" />
            <span className="aside-note">One good route<br />is a great start.</span>
          </div>
        </section>

        <div className="workspace">
          <section className="planner panel" aria-labelledby="planner-title">
            <div className="panel-heading">
              <div className="section-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24"><path d="M12 21s7-6.3 7-12a7 7 0 1 0-14 0c0 5.7 7 12 7 12Z" /><circle cx="12" cy="9" r="2.3" /></svg>
              </div>
              <div>
                <p className="eyebrow">YOUR STARTING POINT</p>
                <h2 id="planner-title">Pick a place to wander</h2>
              </div>
            </div>

            {!itinerary && !isOnline && (
              <div className="cached-route-callout">
                <span aria-hidden="true">↗</span>
                <p><strong>Saved route available</strong><br />This route is stored on this device and can be opened offline.</p>
                <button
                  onClick={() => {
                    const saved = loadLastItinerary();
                    if (saved) setItinerary(saved);
                  }}
                  type="button"
                >View route</button>
              </div>
            )}

            <form onSubmit={handleSearch} className="search-form">
              <label className="field-label" htmlFor="location">Park, neighborhood, or town</label>
              <div className="search-field">
                <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.8" cy="10.8" r="6.3" /><path d="m16 16 4 4" /></svg>
                <input
                  autoComplete="off"
                  id="location"
                  maxLength={120}
                  onChange={(event) => {
                    setQuery(event.target.value);
                    if (selectedPlace) {
                      setSelectedPlace(null);
                      setSearchFeedback("");
                    }
                  }}
                  placeholder="e.g. Golden Gate Park, San Francisco"
                  value={query}
                />
                <button className="search-button" disabled={isSearching || !isOnline} type="submit">
                  {isSearching ? <span className="button-spinner" aria-hidden="true" /> : "Search"}
                </button>
              </div>
              <p className="field-hint">We only look up places when you search.</p>
            </form>

            {searchFeedback && (
              <p className={`search-feedback ${places.length === 0 ? "muted" : ""}`} role="status">{searchFeedback}</p>
            )}
            {places.length > 0 && (
              <div className="place-results" role="listbox" aria-label="Location search results">
                {places.map((place, index) => (
                  <button
                    aria-selected={selectedPlace?.displayName === place.displayName}
                    className={`place-result ${selectedPlace?.displayName === place.displayName ? "selected" : ""}`}
                    key={`${place.lat}-${place.lon}-${index}`}
                    onClick={() => {
                      setSelectedPlace(place);
                      setSearchFeedback(`Start point selected: ${firstLine(place.displayName)}.`);
                      setError("");
                    }}
                    role="option"
                    type="button"
                  >
                    <span className="place-pin" aria-hidden="true">⌖</span>
                    <span>{place.displayName}</span>
                    <span className="place-chevron" aria-hidden="true">↗</span>
                  </button>
                ))}
              </div>
            )}

            <div className="form-divider" />
            <fieldset className="distance-fieldset">
              <legend className="field-label">How far are we going?</legend>
              <div className="distance-options">
                {DISTANCE_OPTIONS.map((distance) => (
                  <button
                    aria-pressed={!customSelected && presetDistance === distance}
                    className={`distance-option ${!customSelected && presetDistance === distance ? "active" : ""}`}
                    key={distance}
                    onClick={() => setDistancePreset(distance)}
                    type="button"
                  >
                    <strong>{distance}</strong><span>km</span>
                  </button>
                ))}
                <button
                  aria-pressed={customSelected}
                  className={`distance-option custom-option ${customSelected ? "active" : ""}`}
                  onClick={() => setCustomSelected(true)}
                  type="button"
                >
                  <strong>Custom</strong><span>distance</span>
                </button>
              </div>
              {customSelected && (
                <div className="custom-distance">
                  <label htmlFor="custom-distance">Distance</label>
                  <input
                    id="custom-distance"
                    max="30"
                    min="1"
                    onChange={(event) => setCustomDistance(event.target.value)}
                    step="0.5"
                    type="number"
                    value={customDistance}
                  />
                  <span>km · between 1 and 30 km</span>
                </div>
              )}
            </fieldset>

            <div className="preferences">
              <p className="field-label">Set the feel</p>
              <label className="preference-row">
                <span className="preference-icon green-icon" aria-hidden="true">✳</span>
                <span className="preference-copy"><strong>Favor green spaces</strong><small>Look for routes by mapped parks</small></span>
                <input
                  checked={preferences.preferGreenSpaces}
                  onChange={() => togglePreference("preferGreenSpaces")}
                  type="checkbox"
                />
              </label>
              <label className="preference-row">
                <span className="preference-icon quiet-icon" aria-hidden="true">〰</span>
                <span className="preference-copy"><strong>Avoid busy roads</strong><small>Prefer quieter mapped streets</small></span>
                <input
                  checked={preferences.avoidBusyRoads}
                  onChange={() => togglePreference("avoidBusyRoads")}
                  type="checkbox"
                />
              </label>
              <p className="preference-caveat">Preferences rank real walking-route options using nearby map tags; they cannot guarantee park access or traffic-free paths.</p>
            </div>

            {error && <p className="error-message" role="alert">{error}</p>}
            {notice && <p className="notice-message" role="status">{notice}</p>}

            <form onSubmit={handlePlanRoute}>
              <button className="plan-button" disabled={isPlanning || !selectedPlace || !isOnline} type="submit">
                {isPlanning ? <><span className="button-spinner light" aria-hidden="true" /> Finding a walking route…</> : <>Find my route <span aria-hidden="true">↗</span></>}
              </button>
            </form>
            {progress && <p className="progress-message" role="status"><span className="progress-dot" />{progress}</p>}
            <p className="planner-footnote"><span aria-hidden="true">⌁</span> Walking paths from OpenStreetMap. No account, no subscription.</p>
          </section>

          <section className="results-column" aria-label="Route itinerary">
            {itinerary ? (
              <article className="itinerary panel">
                <div className="itinerary-heading">
                  <div>
                    <p className="eyebrow"><span className="live-dot" /> YOUR OUTSIDE PLAN</p>
                    <h2>{firstLine(itinerary.place.displayName)}</h2>
                    <p className="itinerary-subtitle">{itinerary.place.displayName}</p>
                  </div>
                  <span className="route-loop-badge"><span aria-hidden="true">↻</span> Walking loop</span>
                </div>

                <div className="route-stats">
                  <div><strong>{formatDistance(itinerary.distanceMeters)}</strong><span>ROUTE DISTANCE</span></div>
                  <div><strong>~{itinerary.estimatedMinutes}<small> min</small></strong><span>AT AN EASY PACE</span></div>
                  <div><strong>{itinerary.targetDistanceKm}<small> km</small></strong><span>YOUR TARGET</span></div>
                </div>

                <div className="map-heading">
                  <div><span className="map-legend-route" /> Walking route <span className="map-legend-park" /> Mapped green space</div>
                  <span className="map-live-label">OSM MAP DATA</span>
                </div>
                <div className="map-frame" aria-label="Map showing the returned walking route geometry">
                  <MapView route={itinerary.geometry} features={itinerary.mapFeatures} />
                </div>

                <div className="data-trust">
                  <span className="trust-check" aria-hidden="true">✓</span>
                  <p><strong>Real mapped geometry</strong><br />This line is returned by an OSM-based pedestrian router, not drawn between points.</p>
                </div>

                <section className="route-notes" aria-labelledby="route-notes-title">
                  <div className="subsection-heading">
                    <div><p className="eyebrow">THE WAY AHEAD</p><h3 id="route-notes-title">Route notes</h3></div>
                    <span className="rules-badge">Local rule-based · not AI-generated</span>
                  </div>
                  <ol className="cue-list">
                    {itinerary.narrative.cues.map((cue, index) => (
                      <li key={`${cue.text}-${index}`}>
                        <span className="cue-marker">{String(index + 1).padStart(2, "0")}</span>
                        <span><strong>{cue.text}</strong>{cue.distanceMeters > 0 &&                         <small>{formatDistance(cue.distanceMeters)} step length</small>}</span>
                      </li>
                    ))}
                  </ol>
                  <div className="challenge-box">
                    <span className="challenge-spark" aria-hidden="true">✳</span>
                    <div><strong>A small outside challenge</strong>
                      <ul>{itinerary.narrative.challengeTips.map((tip) => <li key={tip}>{tip}</li>)}</ul>
                    </div>
                  </div>
                  {itinerary.narrative.facts.length > 0 && (
                    <p className="verified-facts"><strong>Matched map tags:</strong> {itinerary.narrative.facts.map((fact) => `${fact.label} (${fact.kind === "green-space" ? "green space" : "footway"})`).join(" · ")}. These are OSM-tagged features, not a guarantee of access.</p>
                  )}
                </section>

                <div className="action-row">
                  <button className="secondary-button" onClick={() => void handleCopy()} type="button"><span aria-hidden="true">▣</span> Copy details</button>
                  <a
                    className="secondary-button"
                    href={`https://wa.me/?text=${encodeURIComponent(itineraryText(itinerary))}`}
                    rel="noreferrer"
                    target="_blank"
                  ><span aria-hidden="true">↗</span> WhatsApp</a>
                  <button className="secondary-button print-button" onClick={() => window.print()} type="button"><span aria-hidden="true">⌑</span> Print</button>
                </div>

                <p className="route-caveat"><strong>Before you go:</strong> Map coverage and access can change. Routes may use shared streets; this app has no live traffic, accessibility, surface, or safety data. Check local signs and conditions, and use your judgment.</p>
                <div className="attribution">
                  <span>Route: <a href="https://routing.openstreetmap.de/" rel="noreferrer" target="_blank">OSM-based pedestrian router</a></span>
                  <span>Map &amp; features: <a href="https://www.openstreetmap.org/copyright" rel="noreferrer" target="_blank">© OpenStreetMap contributors</a></span>
                </div>
              </article>
            ) : (
              <div className="empty-state panel">
                <div className="empty-illustration" aria-hidden="true">
                  <svg viewBox="0 0 420 260" role="presentation">
                    <path d="M0 202c53-31 94 8 148-14 45-18 73-15 117 0 49 17 93-7 155-20v92H0z" fill="#dce7ce" />
                    <path d="M0 222c64-23 110 12 162-5 69-22 100-18 153-1 40 13 68-1 105-13v57H0z" fill="#c6dbb4" />
                    <path d="M121 238c16-38 33-48 46-71 12-20 25-48 47-49 24-1 33 40 53 52 20 13 37 29 48 68" fill="none" stroke="#fffdf7" strokeLinecap="round" strokeWidth="14" />
                    <path d="M166 173c12-20 25-48 47-49 24-1 33 40 53 52" fill="none" stroke="#e6a17d" strokeLinecap="round" strokeWidth="4" strokeDasharray="2 9" />
                    <circle cx="213" cy="62" r="27" fill="#eb9a63" opacity=".16" />
                    <circle cx="213" cy="62" r="11" fill="#eb9a63" />
                    <path d="m170 150 20-47 15 25 16-41 36 74" fill="#78966c" />
                    <path d="m202 161 20-55 30 55" fill="#476d52" />
                    <path d="M58 200v-44m0 18-11-13m11 4 11-13" fill="none" stroke="#456c4d" strokeLinecap="round" strokeWidth="5" />
                    <circle cx="58" cy="149" r="13" fill="#9eb982" />
                    <path d="M359 202v-48m0 17-12-14m12 4 12-14" fill="none" stroke="#456c4d" strokeLinecap="round" strokeWidth="5" />
                    <circle cx="359" cy="147" r="15" fill="#9eb982" />
                  </svg>
                </div>
                <p className="eyebrow">YOUR NEXT OUTSIDE DAY</p>
                <h2>A good route starts with a place.</h2>
                <p>Choose a park or neighborhood and we&apos;ll find a walking loop from real pedestrian map data.</p>
                <div className="empty-pills"><span>↻ Walking loops</span><span>✳ Green-space aware</span><span>⌁ No paid API</span></div>
                <p className="offline-saved">{isOnline ? "Your saved route will be ready here next time." : "No saved route on this device yet."}</p>
              </div>
            )}
          </section>
        </div>

        <section className="how-section" id="how-it-works">
          <div><p className="eyebrow">OPEN MAPS, OPEN AIR</p><h2>Good data. Fresh air.<br /><em>That&apos;s the whole idea.</em></h2></div>
          <div className="how-grid">
            <article><span className="how-number">01</span><h3>Choose your start</h3><p>Search a town or park using OpenStreetMap&apos;s public place search.</p></article>
            <article><span className="how-number">02</span><h3>Get mapped paths</h3><p>A pedestrian router returns real road-network geometry. Nothing is invented or straight-lined.</p></article>
            <article><span className="how-number">03</span><h3>Take it outside</h3><p>Use the route notes as a starting point, then check access and local conditions before you go.</p></article>
          </div>
        </section>

        <footer className="footer">
          <a className="brand footer-brand" href="#top"><img src="/trailscout-mark.svg" alt="" width="30" height="30" /><span>TrailScout</span></a>
          <p>Made for more outside days. <span>·</span> Open source, MIT licensed.</p>
          <a href="https://github.com/abhiv-creator/TrailScout-CLI" rel="noreferrer" target="_blank">View the project <span aria-hidden="true">↗</span></a>
        </footer>
      </main>
    </div>
  );
}

export default App;
