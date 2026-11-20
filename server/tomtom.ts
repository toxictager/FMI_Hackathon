// TomTom traffic: live drive time with traffic delay, and incidents (accidents, closures,
// roadworks, jams) along the route. Needs TOMTOM_API_KEY; every function returns null when
// the key is missing or TomTom fails, so alerts simply fall back to the other sources.

import { haversineKm } from "../src/lib/geo";

type Coords = { lat: number; lng: number };

function apiKey(): string | undefined {
  return process.env.TOMTOM_API_KEY || undefined;
}

export interface TomTomRoute {
  /** Route geometry, start to end. */
  path: Coords[];
  durationMin: number;
  /** Drive time without traffic. */
  typicalDurationMin: number;
  trafficDelayMin: number;
}

/** Fastest car route right now, with TomTom's live traffic delay. */
export async function tomtomRoute(from: Coords, to: Coords): Promise<TomTomRoute | null> {
  const key = apiKey();
  if (!key) return null;
  const params = new URLSearchParams({
    key,
    traffic: "true",
    travelMode: "car",
    routeType: "fastest",
    computeTravelTimeFor: "all",
  });
  const url = `https://api.tomtom.com/routing/1/calculateRoute/${from.lat},${from.lng}:${to.lat},${to.lng}/json?${params}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(7000) });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      routes?: Array<{
        summary: {
          travelTimeInSeconds: number;
          trafficDelayInSeconds?: number;
          noTrafficTravelTimeInSeconds?: number;
        };
        legs: Array<{ points: Array<{ latitude: number; longitude: number }> }>;
      }>;
    };
    const route = json.routes?.[0];
    if (!route) return null;
    const s = route.summary;
    const path = route.legs.flatMap((leg) => leg.points.map((p) => ({ lat: p.latitude, lng: p.longitude })));
    const durationMin = Math.round(s.travelTimeInSeconds / 60);
    const delayMin = Math.round((s.trafficDelayInSeconds ?? 0) / 60);
    return {
      path,
      durationMin,
      typicalDurationMin: Math.round((s.noTrafficTravelTimeInSeconds ?? s.travelTimeInSeconds - (s.trafficDelayInSeconds ?? 0)) / 60),
      trafficDelayMin: delayMin,
    };
  } catch {
    return null;
  }
}

export interface Incident {
  kind: string;
  description: string;
  road?: string;
  from?: string;
  to?: string;
  delayMin: number;
  /** 0 unknown, 1 minor, 2 moderate, 3 major, 4 closure/undefined (TomTom magnitudeOfDelay). */
  magnitude: number;
  closure: boolean;
}

// TomTom iconCategory codes.
const ICON_KIND: Record<number, string> = {
  1: "Accident",
  2: "Fog",
  3: "Dangerous conditions",
  4: "Rain",
  5: "Ice",
  6: "Traffic jam",
  7: "Lane closed",
  8: "Road closed",
  9: "Roadworks",
  10: "Wind",
  11: "Flooding",
  14: "Broken-down vehicle",
};
// Weather is covered by Open-Meteo; these would only duplicate it.
const SKIP_ICONS = new Set([2, 4, 5, 10]);

// TomTom limits each incident query to a 10,000 km² box, so a long route is split into
// several boxes that follow it.
function routeBoxes(path: Coords[], padKm = 3, maxAreaKm2 = 9000): Array<[number, number, number, number]> {
  const boxes: Array<[number, number, number, number]> = [];
  const padLat = padKm / 111;
  let box: [number, number, number, number] | null = null; // minLng, minLat, maxLng, maxLat
  const area = (b: [number, number, number, number]) => {
    const midLat = ((b[1] + b[3]) / 2) * (Math.PI / 180);
    return (b[2] - b[0]) * 111 * Math.cos(midLat) * (b[3] - b[1]) * 111;
  };
  for (const p of path) {
    const padLng = padKm / (111 * Math.cos((p.lat * Math.PI) / 180));
    const pb: [number, number, number, number] = [p.lng - padLng, p.lat - padLat, p.lng + padLng, p.lat + padLat];
    if (!box) {
      box = pb;
      continue;
    }
    const merged: [number, number, number, number] = [
      Math.min(box[0], pb[0]), Math.min(box[1], pb[1]), Math.max(box[2], pb[2]), Math.max(box[3], pb[3]),
    ];
    if (area(merged) > maxAreaKm2) {
      boxes.push(box);
      box = pb;
    } else {
      box = merged;
    }
  }
  if (box) boxes.push(box);
  return boxes;
}

function distanceToPathKm(p: Coords, path: Coords[]): number {
  // Point-to-vertex distance is enough here: TomTom route points are dense (tens of metres).
  let best = Infinity;
  for (const q of path) {
    const d = haversineKm(p, q);
    if (d < best) best = d;
  }
  return best;
}

const CITY_RADIUS_KM = 3;
const ON_ROUTE_KM = 0.2;

/** Current incidents on (within ~1 km of) the route, most severe first. */
export async function tomtomIncidents(path: Coords[]): Promise<Incident[] | null> {
  const key = apiKey();
  if (!key || path.length < 2) return null;

  // Thin the path for the distance check; keep every ~200th point for box building.
  const boxes = routeBoxes(path.filter((_, i) => i % 20 === 0 || i === path.length - 1)).slice(0, 10);
  const fields =
    "{incidents{type,geometry{type,coordinates},properties{id,iconCategory,magnitudeOfDelay,events{description},from,to,delay,roadNumbers}}}";

  type Raw = {
    geometry: { type: string; coordinates: number[] | number[][] };
    properties: {
      id: string;
      iconCategory: number;
      magnitudeOfDelay: number;
      events?: Array<{ description: string }>;
      from?: string;
      to?: string;
      delay?: number | null;
      roadNumbers?: string[];
    };
  };

  try {
    const results = await Promise.all(
      boxes.map(async (b) => {
        const params = new URLSearchParams({
          key,
          bbox: b.map((n) => n.toFixed(5)).join(","),
          fields,
          language: "en-GB",
          timeValidityFilter: "present",
        });
        const res = await fetch(`https://api.tomtom.com/traffic/services/5/incidentDetails?${params}`, {
          signal: AbortSignal.timeout(7000),
        });
        if (!res.ok) throw new Error(`TomTom incidents error ${res.status}`);
        return ((await res.json()) as { incidents?: Raw[] }).incidents ?? [];
      }),
    );

    const seen = new Set<string>();
    const out: Incident[] = [];
    for (const raw of results.flat()) {
      const p = raw.properties;
      if (seen.has(p.id) || SKIP_ICONS.has(p.iconCategory)) continue;
      seen.add(p.id);
      const coords = (raw.geometry.type === "Point"
        ? [raw.geometry.coordinates as number[]]
        : (raw.geometry.coordinates as number[][])
      ).map(([lng, lat]) => ({ lat, lng }));
      // Keep only incidents on the route itself: most of the incident's geometry must lie
      // within ~200 m of it. A side street that merely crosses the route touches it at one end.
      const onRoute = coords.filter((c) => distanceToPathKm(c, path) <= ON_ROUTE_KM).length;
      if (onRoute === 0 || onRoute < coords.length / 2) continue;
      const numbered = !!p.roadNumbers?.length;
      // The route starts and ends at a town's centre point, not the traveller's real address,
      // so small downtown street closures there are noise. Keep them only on numbered roads.
      const nearEnds = coords.every(
        (c) => haversineKm(c, path[0]) < CITY_RADIUS_KM || haversineKm(c, path[path.length - 1]) < CITY_RADIUS_KM,
      );
      if (nearEnds && !numbered) continue;
      const delayMin = Math.round((p.delay ?? 0) / 60);
      // Tiny slowdowns on unnumbered streets aren't worth an alert.
      if (!numbered && p.iconCategory === 6 && delayMin < 3) continue;
      out.push({
        kind: ICON_KIND[p.iconCategory] ?? "Traffic incident",
        description: p.events?.[0]?.description ?? ICON_KIND[p.iconCategory] ?? "Incident",
        // Bulgarian national roads come back as bare numbers ("7"); motorways as "A1", "E83".
        road: p.roadNumbers?.[0] && /^\d+$/.test(p.roadNumbers[0]) ? `road ${p.roadNumbers[0]}` : p.roadNumbers?.[0],
        from: p.from,
        // "Бургас → Бургас" says nothing; keep just one name then.
        to: p.to && p.to !== p.from ? p.to : undefined,
        delayMin,
        magnitude: p.magnitudeOfDelay,
        closure: p.iconCategory === 8,
      });
    }
    const rank = (i: Incident) => (i.closure ? 1000 : 0) + i.delayMin * 10 + i.magnitude;
    return out.sort((a, b) => rank(b) - rank(a));
  } catch {
    return null;
  }
}
