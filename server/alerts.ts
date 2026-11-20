// Live alerts for a trip, built only from real data:
//  - traffic: TomTom live traffic delay + incidents (accidents, closures, roadworks, jams)
//    when TOMTOM_API_KEY is set; otherwise Google's traffic-aware drive time
//  - weather: Open-Meteo forecast at points along the route, at the hour you'd pass each one
// (Train delays are added on the client from the BDŽ timetable data.)
// Nothing here is invented; with no disruptions the list is simply empty.

import { decodePolyline, haversineKm } from "../src/lib/geo";
import { tomtomIncidents, tomtomRoute, type Incident } from "./tomtom";

type Coords = { lat: number; lng: number };

export interface TripAlert {
  level: "info" | "warning" | "delay";
  title: string;
  body: string;
  source: string;
  /** ISO time the underlying data was fetched. */
  updatedAt: string;
}

export interface AlertsInput {
  from: Coords;
  to: Coords;
  fromName: string;
  toName: string;
  /** Google encoded polyline of the drive; a straight line is used without it. */
  polyline?: string;
  /** Drive time with current traffic, in minutes. */
  durationMin?: number;
  /** Drive time without traffic, in minutes (Google's static duration). */
  typicalDurationMin?: number;
}

export interface AlertsResult {
  alerts: TripAlert[];
  /** Which sources were checked successfully, for the "nothing to report" message. */
  checked: string[];
}

// Traffic adding less than this is normal variation, not worth an alert.
const TRAFFIC_ALERT_MIN = 10;

function trafficAlert(
  input: AlertsInput,
  durationMin: number | undefined,
  typicalDurationMin: number | undefined,
  source: string,
  now: string,
): TripAlert | null {
  if (durationMin === undefined || typicalDurationMin === undefined) return null;
  const extra = Math.round(durationMin - typicalDurationMin);
  if (extra < TRAFFIC_ALERT_MIN) return null;
  return {
    level: extra >= 25 ? "delay" : "warning",
    title: `Traffic: +${extra} min by car right now`,
    body: `Driving ${input.fromName} → ${input.toName} takes about ${fmtDuration(durationMin)} with current traffic, instead of the usual ${fmtDuration(typicalDurationMin)}.`,
    source,
    updatedAt: now,
  };
}

const MAX_INCIDENT_ALERTS = 3;

function incidentAlert(i: Incident, now: string): TripAlert {
  // The road number is already in the title.
  const where = i.from && i.to ? `${i.from} → ${i.to}` : i.from ?? i.to;
  const delay = i.delayMin > 0 ? ` Delay about ${i.delayMin} min.` : "";
  return {
    // Based on the actual minutes lost: TomTom marks any standstill "major", even a 2-minute one.
    level: i.delayMin >= 15 ? "delay" : i.closure || i.delayMin >= 5 ? "warning" : "info",
    title: `${i.kind}${i.road ? ` on ${i.road}` : ""}`,
    body: `${i.description}${where ? ` (${where})` : ""}.${delay}`,
    source: "TomTom traffic",
    updatedAt: now,
  };
}

function fmtDuration(min: number): string {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h > 0 ? `${h} h ${m} min` : `${m} min`;
}

interface RoutePoint extends Coords {
  label: string;
  /** Minutes after departure that you'd reach this point. */
  etaMin: number;
}

// Start, quarter, halfway, three-quarters and destination, spaced by distance along the route.
function samplePoints(input: AlertsInput, path: Coords[], driveMin: number): RoutePoint[] {
  const cumKm = [0];
  for (let i = 1; i < path.length; i++) cumKm.push(cumKm[i - 1] + haversineKm(path[i - 1], path[i]));
  const totalKm = cumKm[cumKm.length - 1] || 1;

  const at = (fraction: number): Coords => {
    const target = fraction * totalKm;
    const i = Math.max(1, cumKm.findIndex((d) => d >= target));
    if (i >= path.length) return path[path.length - 1];
    const seg = cumKm[i] - cumKm[i - 1] || 1;
    const t = (target - cumKm[i - 1]) / seg;
    return {
      lat: path[i - 1].lat + (path[i].lat - path[i - 1].lat) * t,
      lng: path[i - 1].lng + (path[i].lng - path[i - 1].lng) * t,
    };
  };

  // Short trips only need both ends.
  const fractions = totalKm < 60 ? [0, 1] : [0, 0.25, 0.5, 0.75, 1];
  return fractions.map((f) => ({
    ...(f === 0 ? input.from : f === 1 ? input.to : at(f)),
    label:
      f === 0
        ? `near ${input.fromName}`
        : f === 1
          ? `near ${input.toName}`
          : `about ${Math.round((f * totalKm) / 10) * 10} km from ${input.fromName}`,
    etaMin: f * driveMin,
  }));
}

interface Hazard {
  key: string;
  level: TripAlert["level"];
  title: string;
  advice: string;
  /** Higher = more severe; used to keep the worst reading per hazard. */
  severity: number;
  detail: string;
}

// WMO weather codes 95-99 are thunderstorms.
function hazardsForHour(h: {
  temp: number;
  precip: number;
  snow: number;
  gusts: number;
  visibility: number;
  code: number;
}): Hazard[] {
  const out: Hazard[] = [];
  if (h.snow >= 0.3) {
    out.push({
      key: "snow", level: "warning", title: "Snow on your route",
      advice: "Roads may be slippery; winter tyres required, allow extra time.",
      severity: h.snow, detail: `${h.snow.toFixed(1)} cm/h`,
    });
  } else if (h.precip >= 0.2 && h.temp <= 1) {
    out.push({
      key: "ice", level: "warning", title: "Icy roads possible",
      advice: "Rain near freezing can form black ice, especially on bridges and passes.",
      severity: 1 - h.temp, detail: `${h.temp.toFixed(0)} °C with rain`,
    });
  } else if (h.precip >= 4) {
    out.push({
      key: "heavy-rain", level: "warning", title: "Heavy rain on your route",
      advice: "Expect poor visibility and spray; keep extra distance.",
      severity: h.precip, detail: `${h.precip.toFixed(1)} mm/h`,
    });
  } else if (h.precip >= 1) {
    out.push({
      key: "rain", level: "info", title: "Rain on your route",
      advice: "Roads will be wet.",
      severity: h.precip, detail: `${h.precip.toFixed(1)} mm/h`,
    });
  }
  if (h.code >= 95) {
    out.push({
      key: "storm", level: "warning", title: "Thunderstorms on your route",
      advice: "Avoid stopping under trees; expect sudden heavy rain.",
      severity: h.code, detail: "thunderstorm",
    });
  }
  if (h.gusts >= 60) {
    out.push({
      key: "wind", level: "warning", title: "Strong wind on your route",
      advice: "Crosswinds on open stretches and bridges; take care with high vehicles.",
      severity: h.gusts, detail: `gusts ${Math.round(h.gusts)} km/h`,
    });
  }
  if (h.visibility < 1000) {
    out.push({
      key: "fog", level: "warning", title: "Fog on your route",
      advice: "Visibility is low; use dipped headlights and slow down.",
      severity: 1000 - h.visibility, detail: `visibility ~${Math.round(h.visibility / 100) * 100} m`,
    });
  }
  if (h.temp >= 35) {
    out.push({
      key: "heat", level: "info", title: "Very hot along the way",
      advice: "Carry water and avoid leaving anyone in a parked car.",
      severity: h.temp, detail: `${Math.round(h.temp)} °C`,
    });
  }
  return out;
}

interface OpenMeteoPoint {
  hourly: {
    time: number[];
    temperature_2m: number[];
    precipitation: number[];
    snowfall: number[];
    wind_gusts_10m: number[];
    visibility: number[];
    weather_code: number[];
  };
}

async function weatherAlerts(points: RoutePoint[], now: string): Promise<TripAlert[]> {
  const params = new URLSearchParams({
    latitude: points.map((p) => p.lat.toFixed(3)).join(","),
    longitude: points.map((p) => p.lng.toFixed(3)).join(","),
    hourly: "temperature_2m,precipitation,snowfall,wind_gusts_10m,visibility,weather_code",
    forecast_hours: "24",
    timeformat: "unixtime",
    timezone: "Europe/Sofia",
  });
  const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`, {
    signal: AbortSignal.timeout(6000),
  });
  if (!res.ok) throw new Error(`Open-Meteo error ${res.status}`);
  const json = (await res.json()) as OpenMeteoPoint | OpenMeteoPoint[];
  const series = Array.isArray(json) ? json : [json];

  const nowSec = Date.now() / 1000;
  const worst = new Map<string, { hazard: Hazard; places: string[]; hour: number }>();

  series.forEach((s, i) => {
    const point = points[i];
    if (!point) return;
    // The forecast hours around when you'd be at this point: 30 min before to 90 min after.
    const eta = nowSec + point.etaMin * 60;
    s.hourly.time.forEach((t, k) => {
      if (t + 3600 < eta - 30 * 60 || t > eta + 90 * 60) return;
      const hazards = hazardsForHour({
        temp: s.hourly.temperature_2m[k],
        precip: s.hourly.precipitation[k],
        snow: s.hourly.snowfall[k],
        gusts: s.hourly.wind_gusts_10m[k],
        visibility: s.hourly.visibility[k],
        code: s.hourly.weather_code[k],
      });
      for (const hazard of hazards) {
        const prev = worst.get(hazard.key);
        if (!prev) {
          worst.set(hazard.key, { hazard, places: [point.label], hour: t });
        } else {
          if (!prev.places.includes(point.label)) prev.places.push(point.label);
          if (hazard.severity > prev.hazard.severity) {
            prev.hazard = hazard;
            prev.hour = t;
          }
        }
      }
    });
  });

  const levelRank = { delay: 0, warning: 1, info: 2 } as const;
  return [...worst.values()]
    .sort((a, b) => levelRank[a.hazard.level] - levelRank[b.hazard.level])
    .map(({ hazard, places, hour }) => ({
      level: hazard.level,
      title: hazard.title,
      body: `${capitalize(joinPlaces(places))}, around ${fmtHour(hour)} (${hazard.detail}). ${hazard.advice}`,
      source: "Open-Meteo forecast",
      updatedAt: now,
    }));
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function joinPlaces(places: string[]): string {
  if (places.length <= 2) return places.join(" and ");
  return `${places.slice(0, -1).join(", ")} and ${places[places.length - 1]}`;
}

function fmtHour(unixSec: number): string {
  return new Date(unixSec * 1000).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Sofia",
  });
}

export async function getAlerts(input: AlertsInput): Promise<AlertsResult> {
  const now = new Date().toISOString();
  const alerts: TripAlert[] = [];
  const checked: string[] = [];

  // TomTom (if configured) gives the route line and live traffic; Google's values are the fallback.
  const tt = await tomtomRoute(input.from, input.to);
  const googlePath = input.polyline
    ? decodePolyline(input.polyline).map(([lat, lng]) => ({ lat, lng }))
    : undefined;
  const path: Coords[] = tt?.path ?? googlePath ?? [input.from, input.to];

  const traffic = tt
    ? trafficAlert(input, tt.durationMin, tt.typicalDurationMin, "TomTom traffic", now)
    : trafficAlert(input, input.durationMin, input.typicalDurationMin, "Google traffic", now);
  if (traffic) alerts.push(traffic);
  if (tt) checked.push("TomTom traffic");
  else if (input.durationMin !== undefined && input.typicalDurationMin !== undefined) checked.push("Google traffic");

  // Without a real drive time, estimate it (~75 km/h average on Bulgarian roads).
  const driveMin =
    tt?.durationMin ??
    input.durationMin ??
    Math.round(((haversineKm(input.from, input.to) * 1.25) / 75) * 60);

  const [incidents, weather] = await Promise.all([
    path.length > 2 ? tomtomIncidents(path) : Promise.resolve(null),
    weatherAlerts(samplePoints(input, path, driveMin), now).catch(() => null),
  ]);
  if (incidents) {
    alerts.push(...incidents.slice(0, MAX_INCIDENT_ALERTS).map((i) => incidentAlert(i, now)));
    if (!checked.includes("TomTom traffic")) checked.push("TomTom traffic");
  }
  if (weather) {
    alerts.push(...weather);
    checked.push("Open-Meteo weather");
  }

  const levelRank = { delay: 0, warning: 1, info: 2 } as const;
  alerts.sort((a, b) => levelRank[a.level] - levelRank[b.level]);
  return { alerts, checked };
}
