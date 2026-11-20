// Scrapes razpisanie.bdz.bg for train departures. Ported from the TanStack server function.

import { getDepartureDelays } from "./bdzLive";

const SUPPORTED_CITIES = new Set([
  "sofia", "plovdiv", "varna", "burgas", "ruse", "stara zagora", "pleven",
  "veliko tarnovo", "blagoevgrad", "shumen", "sliven", "pernik", "vidin",
  "haskovo", "bansko", "razlog", "karlovo", "gorna oryahovitsa", "dobrich",
  "kazanlak", "asenovgrad", "lovech", "yambol", "dimitrovgrad", "mezdra",
]);

export interface BdzDeparture {
  trainName: string;
  departTime: string;
  arriveTime: string;
  departDate: string;
  arriveDate: string;
  totalTime: string;
  totalMinutes: number;
  distanceKm: number;
  transfers: number;
  hasFirstClass: boolean;
  hasSecondClass: boolean;
  isDelayed: boolean;
  /** Live delay in minutes from BDŽ's departures board (today's upcoming trains only). */
  delayMin?: number;
  /** Regular adult fare in EUR; missing when that class isn't sold or the price lookup failed. */
  priceSecondClass?: number;
  priceFirstClass?: number;
  /** ok: fare found; none: BDŽ sells no regular online fare; pending: BDŽ hasn't answered yet. */
  priceStatus?: "ok" | "none" | "pending";
}

type ParsedDeparture = BdzDeparture & { routeIndex?: string; priceIndex?: string; priceKey?: string };

export interface BdzScheduleResult {
  supported: boolean;
  fromName?: string;
  toName?: string;
  date?: string;
  departures: BdzDeparture[];
  error?: string;
}

function citySlug(name: string): string | null {
  const key = name.trim().toLowerCase();
  if (!SUPPORTED_CITIES.has(key)) return null;
  return key.replace(/\s+/g, "-");
}

// Today's date in Bulgaria as YYYY-MM-DD (the server itself may run in UTC).
function sofiaToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Sofia" }).format(new Date());
}

function toDDMMYYYY(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&mdash;/g, "—")
    .replace(/&ndash;/g, "–");
}

// The page embeds route data: station codes, plus legs with distances per route
// index (trains[routeIndex][trainNumber].distance, in km).
interface RouteData {
  route?: { date: string; from: string; to: string };
  trains?: Record<string, Record<string, { distance?: number }>>;
}

function parseRouteData(html: string): RouteData {
  const m = html.match(/BDTJSONItemsPriceAPI\s*=\s*JSON\.parse\('(.+?)'\);/);
  if (!m) return {};
  try {
    return JSON.parse(m[1].replace(/\\'/g, "'")) as RouteData;
  } catch {
    return {}; // Data block changed shape; distances and prices are skipped.
  }
}

function routeDistances(data: RouteData): Map<string, number> {
  const out = new Map<string, number>();
  for (const [index, legs] of Object.entries(data.trains ?? {})) {
    const km = Object.values(legs).reduce((sum, leg) => sum + (Number(leg.distance) || 0), 0);
    if (km > 0) out.set(index, km);
  }
  return out;
}

// "7,16 €" -> 7.16; "--" -> undefined
function parseEuro(cell: string): number | undefined {
  const m = cell.match(/(\d+)[,.](\d{2})\s*€/);
  return m ? Number(`${m[1]}.${m[2]}`) : undefined;
}

interface Fare {
  second?: number;
  first?: number;
  // Seat classes from the per-leg icons; set even when BDŽ shows "--" for the fare.
  hasSecond: boolean;
  hasFirst: boolean;
}

// Successful lookups are kept for a while, so a reload or a second visitor
// doesn't depend on BDŽ answering every price request again.
const FARE_TTL_MS = 30 * 60 * 1000;
const fareCache = new Map<string, { fare: Fare; at: number }>();

async function fetchFareOnce(
  url: string,
  body: string,
  ctx: { token: string; cookie: string },
  timeoutMs: number,
): Promise<Fare | null> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        ...BROWSER_HEADERS,
        "Content-Type": "application/json;charset=UTF-8",
        "X-CSRF-Token": ctx.token,
        Cookie: ctx.cookie,
      },
      body,
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    const html = (await res.text()).replace(/\s+/g, " ");
    // No fare table at all means BDŽ didn't finish; a table without a "Regular fare"
    // row means it sells no online fare for this trip.
    if (!/<th>\s*Fares/.test(html)) return null;
    const row = html.match(/Regular fare\s*<\/td>\s*<td[^>]*>([^<]*)<\/td>\s*<td[^>]*>([^<]*)<\/td>/);
    const second = row ? parseEuro(row[1]) : undefined;
    const first = row ? parseEuro(row[2]) : undefined;
    const legs = html.split(/<th>\s*Fares/)[0].toLowerCase();
    return {
      second,
      first,
      hasSecond: second !== undefined || /second class|2nd class/.test(legs),
      hasFirst: first !== undefined || /first class|1st class/.test(legs),
    };
  } catch {
    return null;
  }
}

// Lookups still running after we've answered the client. BDŽ only finishes computing a fare
// if the request stays open (up to ~30 s cold, then ~0.2 s), so we never cut them short.
const inflight = new Map<string, Promise<Fare | null>>();

/** Resolves when every background fare lookup has finished (for Netlify's waitUntil). */
export function pendingFareLookups(): Promise<unknown> {
  return Promise.allSettled([...inflight.values()]);
}

// Same request the "Prices" button on razpisanie.bdz.bg makes; returns the regular adult fare.
// Waits up to a few seconds; a slower lookup keeps running in the background and lands in the
// cache, so null here means "ask again shortly", not "no fare".
// With cacheOnly, nothing is requested and only remembered fares are returned.
async function fetchFare(
  ctx: { data: RouteData; token: string; cookie: string; cacheOnly: boolean },
  key: { priceIndex?: string; priceKey?: string },
): Promise<Fare | null> {
  const r = ctx.data.route;
  if (!r) return null;
  let url = `https://razpisanie.bdz.bg/en/price/${r.date}/${r.from}/${r.to}`;
  let body = "{}";
  if (key.priceKey) {
    url += `?is_key=${encodeURIComponent(key.priceKey)}`;
  } else if (key.priceIndex && ctx.data.trains?.[key.priceIndex]) {
    body = JSON.stringify(ctx.data.trains[key.priceIndex]);
  } else {
    return null;
  }

  const cacheKey = `${url}|${body}`;
  const cached = fareCache.get(cacheKey);
  if (cached && Date.now() - cached.at < FARE_TTL_MS) return cached.fare;
  if (ctx.cacheOnly) return null;

  let lookup = inflight.get(cacheKey);
  if (!lookup) {
    lookup = fetchFareOnce(url, body, ctx, 45000).then((fare) => {
      if (fare) fareCache.set(cacheKey, { fare, at: Date.now() });
      inflight.delete(cacheKey);
      return fare;
    });
    inflight.set(cacheKey, lookup);
  }
  // Kept well under Netlify's 10 s limit, together with the timetable page fetch.
  const waited = new Promise<null>((done) => setTimeout(() => done(null), 5000));
  return Promise.race([lookup, waited]);
}


const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  "Accept-Language": "en-US,en;q=0.9",
};

// On some transfer trips BDŽ prices only one short leg (e.g. 0.82 € for Varna → Sofia).
// Regular fares run ~2-3 cents/km, so anything under 1 cent/km is treated as "no online fare".
function plausibleFare(fare: Fare | null, distanceKm: number): Fare | null {
  if (!fare || distanceKm < 50) return fare;
  const minPrice = distanceKm * 0.01;
  return {
    ...fare,
    second: fare.second !== undefined && fare.second >= minPrice ? fare.second : undefined,
    first: fare.first !== undefined && fare.first >= minPrice ? fare.first : undefined,
  };
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

function parseCard(raw: string, date: string): ParsedDeparture | null {
  const chunk = decodeEntities(raw);
  const times = chunk.match(/(\d{2}:\d{2})\s*[—–-]\s*(\d{2}:\d{2})/);
  if (!times) return null;

  const name = chunk.match(/train-info\/(\d+)\/[^"]+"[^>]*>([^<]+)<\/a>/);
  const trainName = name ? name[2].trim() : "Train";

  // "2 h 51 min", "9 h" or "45 min"; if BDŽ changes the format, derive it from the times.
  const dur = chunk.match(/>\s*(?:(\d+)\s*h)?\s*(?:(\d+)\s*min)?\s*</g)?.find((m) => /\d/.test(m));
  let totalMinutes: number;
  if (dur) {
    const h = dur.match(/(\d+)\s*h/);
    const m = dur.match(/(\d+)\s*min/);
    totalMinutes = (h ? Number(h[1]) * 60 : 0) + (m ? Number(m[1]) : 0);
  } else {
    const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
    totalMinutes = (toMin(times[2]) - toMin(times[1]) + 24 * 60) % (24 * 60);
  }
  const hours = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;
  const totalTime = `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;

  const stops = Array.from(
    chunk.matchAll(/list-inline-item ps-1">([^<]+)<\/li>/g),
  ).map((m) => m[1].trim());
  const transfers = Math.max(0, stops.length - 2);

  const routeIndex = chunk.match(/data-route-index="(\d+)"/);
  const priceIndex = chunk.match(/data-price-index="(\d+)"/);
  const priceKey = chunk.match(/data-is-price-key="([^"]+)"/);
  const lower = chunk.toLowerCase();
  const hasFirstClass =
    lower.includes("first class") || lower.includes("1st class") || lower.includes("1/2 class");
  const hasSecondClass =
    lower.includes("second class") || lower.includes("2nd class") || lower.includes("1/2 class");

  return {
    trainName,
    departTime: times[1],
    arriveTime: times[2],
    departDate: date,
    arriveDate: date,
    totalTime,
    totalMinutes,
    distanceKm: 0,
    routeIndex: routeIndex ? routeIndex[1] : undefined,
    priceIndex: priceIndex ? priceIndex[1] : undefined,
    priceKey: priceKey ? priceKey[1] : undefined,
    transfers,
    hasFirstClass,
    hasSecondClass,
    isDelayed: lower.includes("delay"),
  };
}

// withPrices=false returns the timetable fast, using only remembered fares (others "pending").
// withPrices=true also asks BDŽ for every missing fare; the client calls it after the timetable
// and repeats it while some fares are still pending.
export async function getBdzSchedule(
  input: { from: string; to: string; date?: string },
  { withPrices = false }: { withPrices?: boolean } = {},
): Promise<BdzScheduleResult> {
  const fromSlug = citySlug(input.from);
  const toSlug = citySlug(input.to);
  if (!fromSlug || !toSlug) {
    return { supported: false, departures: [] };
  }
  const isoDate = input.date ?? sofiaToday();
  const ddmmyyyy = toDDMMYYYY(isoDate);
  const url = `https://razpisanie.bdz.bg/en/${fromSlug}/${toSlug}/${ddmmyyyy}`;

  try {
    const res = await fetch(url, {
      headers: {
        ...BROWSER_HEADERS,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });
    if (!res.ok) {
      return { supported: true, departures: [], error: `BDŽ site error ${res.status}` };
    }
    const html = await res.text();

    // Each result card starts with the marker class "card uv-card".
    const parts = html.split("card uv-card").slice(1);
    const parsed: ParsedDeparture[] = [];
    for (const part of parts) {
      const dep = parseCard(part.slice(0, 6000), ddmmyyyy);
      if (dep) parsed.push(dep);
    }

    // Cards linked to the embedded route data get their exact distance; the rest
    // (BDŽ gives no leg data for them) use the typical distance for this city pair.
    const routeData = parseRouteData(html);
    const distances = routeDistances(routeData);
    const fallbackKm = median([...distances.values()]);

    // Prices need the page's CSRF token and session cookie, like the site's own "Prices" button.
    const token = html.match(/X-CSRF-Token',\s*'([^']+)'/)?.[1] ?? "";
    const cookie = res.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; ");
    const ctx = { data: routeData, token, cookie, cacheOnly: !withPrices || !token };
    // Live delays only exist for today's trains, from the origin station's departures board.
    const isToday = isoDate === sofiaToday();
    const [fares, delays] = await Promise.all([
      Promise.all(parsed.map((dep) => fetchFare(ctx, dep))),
      isToday && routeData.route
        ? getDepartureDelays(routeData.route.from).catch(() => null)
        : Promise.resolve(null),
    ]);

    const departures: BdzDeparture[] = parsed.map(
      ({ routeIndex, priceIndex: _pi, priceKey: _pk, ...dep }, i) => {
        const distanceKm = (routeIndex && distances.get(routeIndex)) || fallbackKm;
        const fare = plausibleFare(fares[i], distanceKm);
        // "SU 10261" -> "10261": on transfer trips this is the first train, the one you board here.
        const trainNumber = dep.trainName.match(/(\d+)\s*$/)?.[1];
        const delayMin = trainNumber ? delays?.get(trainNumber) : undefined;
        return {
          ...dep,
          distanceKm,
          delayMin,
          isDelayed: (delayMin ?? 0) > 0,
          // The fare table is the reliable source for which classes the trip offers;
          // the card icons are missing on commuter and transfer trips.
          hasSecondClass: fare ? fare.hasSecond : dep.hasSecondClass,
          hasFirstClass: fare ? fare.hasFirst : dep.hasFirstClass,
          priceSecondClass: fare?.second,
          priceFirstClass: fare?.first,
          priceStatus: !fare ? "pending" : (fare.second ?? fare.first) !== undefined ? "ok" : "none",
        };
      },
    );

    // Display names come from the H1: "Sofia — Plovdiv, 18 May".
    const heading = html.match(/<h1[^>]*>\s*([^—<]+?)\s*[—–-]\s*([^,<]+?),/);
    const fromName = heading ? decodeEntities(heading[1]).trim() : input.from;
    const toName = heading ? decodeEntities(heading[2]).trim() : input.to;

    return { supported: true, fromName, toName, date: ddmmyyyy, departures };
  } catch (err) {
    return {
      supported: true,
      departures: [],
      error: err instanceof Error ? err.message : "Failed to reach BDŽ",
    };
  }
}
