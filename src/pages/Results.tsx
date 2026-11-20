import { useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  Bus, Train, Car, Clock, Euro, Zap, PiggyBank, Sparkles, ArrowLeft,
  Fuel, Ticket, CarTaxiFront, AlertTriangle, Info, CloudRain, Map as MapIcon,
  ChevronLeft, ChevronRight,
} from "lucide-react";
import { Check } from "lucide-react";
import { LANDMARKS, geocode, getWikiLandmarkImage, type GeocodeResult, type Coords, type Landmark } from "@/lib/bulgaria-data";
import { decodePolyline, distanceToPathKm, distanceToSegmentKm, roadKm } from "@/lib/geo";
import { postJson } from "@/lib/api";
import type { AlertsResult, BdzDeparture, BdzScheduleResult, DirectionsResult, TripAlert } from "@/lib/types";
import { RouteMap } from "@/components/RouteMap";
import { Header, Footer } from "@/components/SiteChrome";
import { useDocumentMeta } from "@/lib/useDocumentMeta";

type Mode = "bus" | "train" | "car";
type Category = "fastest" | "cheapest" | "convenient";

interface RouteOption {
  sharedWith: Category[];
  category: Category;
  mode: Mode;
  hours: number;
  minutes: number;
  cost: number;
  note: string;
  breakdown: { label: string; amount: number; icon: typeof Fuel }[];
}

const MAX_LANDMARK_KM = 30;

function hashStr(s: string) {
  let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}
async function lookupTownCoords(name: string): Promise<GeocodeResult | null> {
  try {
    return await geocode(name);
  } catch {
    return null; // not found or request failed
  }
}

interface ModeOption {
  mode: Mode;
  totalMinutes: number;
  cost: number;
  transfers: number;
  note: string;
  breakdown: { label: string; amount: number; icon: typeof Fuel }[];
}

// Every mode is calculated for every trip. Each card then picks its winner by
// comparing these numbers, so one mode can win more than one card.
function buildModeOptions(seed: number, km: number, realDriveMin?: number, trainMin?: number): ModeOption[] {
  const carMinutes = realDriveMin ?? Math.max(45, Math.round((km / 95) * 60));
  const busMinutes = Math.round((km / 70) * 60) + 60;
  const trainMinutes = trainMin ?? Math.round((km / 80) * 60) + 20;

  const fuel = Math.round(km * 0.085 * 10) / 10;
  const tolls = km > 200 ? Math.round((km * 0.012) * 10) / 10 : 0;
  const carCost = Math.round((fuel + tolls) * 10) / 10;

  const ticket = Math.round((km * 0.045 + 4) * 10) / 10;
  const transfer = Math.round((seed % 3) * 1.5 * 10) / 10;
  const taxiToTerminal = 4 + (seed % 4);
  const busCost = Math.round((ticket + transfer + taxiToTerminal) * 10) / 10;

  const trainTicket = Math.round((km * 0.06 + 5) * 10) / 10;
  const taxiToStation = 5 + (seed % 5);
  const trainCost = Math.round((trainTicket + taxiToStation) * 10) / 10;

  return [
    {
      mode: "car", totalMinutes: carMinutes, cost: carCost, transfers: 0,
      note: "Direct highway route via private car",
      breakdown: [
        { label: "Fuel (~7L/100km)", amount: fuel, icon: Fuel },
        { label: "Tolls & vignette", amount: tolls, icon: Ticket },
        { label: "Taxi", amount: 0, icon: CarTaxiFront },
      ],
    },
    {
      mode: "bus", totalMinutes: busMinutes, cost: busCost, transfers: transfer > 0 ? 1 : 0,
      note: "Intercity bus, may include a transfer",
      breakdown: [
        { label: "Bus ticket", amount: ticket, icon: Ticket },
        { label: "Transfer fee", amount: transfer, icon: Bus },
        { label: "Taxi to terminal", amount: taxiToTerminal, icon: CarTaxiFront },
      ],
    },
    {
      mode: "train", totalMinutes: trainMinutes, cost: trainCost, transfers: 0,
      note: "Direct train, comfortable seating",
      breakdown: [
        { label: "Train ticket", amount: trainTicket, icon: Ticket },
        { label: "Fuel", amount: 0, icon: Fuel },
        { label: "Taxi to station", amount: taxiToStation, icon: CarTaxiFront },
      ],
    },
  ];
}

// Each transfer counts as this many extra minutes when judging convenience.
const TRANSFER_PENALTY_MIN = 30;

function minBy<T>(items: T[], score: (item: T) => number): T {
  return items.reduce((best, item) => (score(item) < score(best) ? item : best));
}

function generateRoutes(seed: number, km: number, realDriveMin?: number, trainMin?: number): RouteOption[] {
  const options = buildModeOptions(seed, km, realDriveMin, trainMin);

  const picks: Array<[Category, ModeOption]> = [
    ["fastest", minBy(options, (o) => o.totalMinutes)],
    ["cheapest", minBy(options, (o) => o.cost)],
    ["convenient", minBy(options, (o) => o.totalMinutes + o.transfers * TRANSFER_PENALTY_MIN)],
  ];

  return picks.map(([category, opt]) => ({
    category,
    mode: opt.mode,
    hours: Math.floor(opt.totalMinutes / 60),
    minutes: opt.totalMinutes % 60,
    cost: opt.cost,
    note: opt.note,
    breakdown: opt.breakdown,
    sharedWith: picks
      .filter(([other, o]) => other !== category && o.mode === opt.mode)
      .map(([other]) => other),
  }));
}

function landmarksAlongRoute(
  from: Coords,
  to: Coords,
  path?: Coords[],
): Array<Landmark & { detourKm: number }> {
  return LANDMARKS
    .map((l) => {
      const p = { lat: l.lat, lng: l.lng };
      const detourKm = path && path.length > 1
        ? distanceToPathKm(p, path)
        : distanceToSegmentKm(p, from, to);
      return { ...l, detourKm };
    })
    .filter((l) => l.detourKm <= MAX_LANDMARK_KM)
    .sort((a, b) => a.detourKm - b.detourKm);
}

const MODE_ICON: Record<Mode, typeof Bus> = { bus: Bus, train: Train, car: Car };
const MODE_LABEL: Record<Mode, string> = { bus: "Bus", train: "Train", car: "Car" };
const CAT_META: Record<Category, { label: string; tagline: string; icon: typeof Zap; accent: string }> = {
  fastest:    { label: "Fastest",         tagline: "Save hours",          icon: Zap,        accent: "from-primary to-accent" },
  cheapest:   { label: "Cheapest",        tagline: "Stretch your budget", icon: PiggyBank,  accent: "from-secondary to-primary" },
  convenient: { label: "Most Convenient", tagline: "Smoothest ride",      icon: Sparkles,   accent: "from-accent to-secondary" },
};

function toTitleCase(str: String) {
  return str
    .toLowerCase()
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export default function ResultsPage() {
  const [params] = useSearchParams();
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";

  const coordsQuery = useQuery({
    queryKey: ["coords", from, to],
    enabled: !!from && !!to,
    queryFn: async () => {
      const [fromGeo, toGeo] = await Promise.all([
        lookupTownCoords(from),
        lookupTownCoords(to),
      ]);
      if (!fromGeo || !toGeo) return null; // town not found
      return {
        fromCoords: fromGeo,
        toCoords: toGeo,
        fromName: fromGeo.name,
        toName: toGeo.name,
      };
    },
    staleTime: Infinity, // town coordinates never change
  });

  const base = useMemo(() => {
    const coords = coordsQuery.data;
    if (!coords) return null;
    const seed = hashStr(from.toLowerCase() + "→" + to.toLowerCase());
    return { ...coords, seed };
  }, [coordsQuery.data, from, to]);

  const fromLabel = base?.fromName ?? from;
  const toLabel = base?.toName ?? to;

  useDocumentMeta(
    fromLabel && toLabel ? `${fromLabel} - ${toLabel}` : "Routique",
    `Compare bus, train and car routes from ${fromLabel || "your start"} to ${toLabel || "your destination"} in Bulgaria.`,
  );

  const directionsQuery = useQuery<DirectionsResult>({
    queryKey: ["directions", from, to],
    enabled: !!base,
    queryFn: () => postJson<DirectionsResult>("/api/directions", { from: base!.fromCoords, to: base!.toCoords }),
    staleTime: 1000 * 60 * 60,
    // Live alerts wait for this; without a Google key it fails every time, so don't keep retrying.
    retry: 1,
  });

  // Real alerts: TomTom traffic + Open-Meteo weather along the route (train delays are added
  // below). Waits for the directions call so the Google route line can place the weather
  // points if TomTom is unavailable.
  const alertsQuery = useQuery<AlertsResult>({
    queryKey: ["alerts", from, to, directionsQuery.dataUpdatedAt],
    enabled: !!base && !directionsQuery.isLoading,
    queryFn: () => {
      const dir = directionsQuery.data;
      return postJson<AlertsResult>("/api/alerts", {
        from: base!.fromCoords,
        to: base!.toCoords,
        fromName: from,
        toName: to,
        polyline: dir?.polyline,
        durationMin: dir?.durationMin,
      });
    },
    staleTime: 1000 * 60 * 5,
    // If no source answered (e.g. TomTom and Open-Meteo both timed out), try again soon.
    refetchInterval: (query) => (query.state.data?.checked.length === 0 ? 15_000 : 1000 * 60 * 10),
  });

  const bdzQuery = useQuery<BdzScheduleResult>({
    queryKey: ["bdz", from, to],
    enabled: !!from && !!to,
    queryFn: () => postJson<BdzScheduleResult>("/api/bdz", { from, to }),
    staleTime: 1000 * 60 * 10,
    // The timetable is cached on BDŽ's side; re-asking mainly refreshes live delays.
    refetchInterval: 1000 * 60 * 2,
  });

  // Prices load after the timetable. BDŽ is slow the first time it computes a fare,
  // so while some are still pending we ask again every few seconds, up to a limit.
  const MAX_PRICE_TRIES = 6;
  const pricesQuery = useQuery<BdzScheduleResult>({
    queryKey: ["bdz-prices", from, to],
    enabled: !!bdzQuery.data?.supported && bdzQuery.data.departures.length > 0,
    queryFn: () => postJson<BdzScheduleResult>("/api/bdz/prices", { from, to }),
    staleTime: 1000 * 60 * 10,
    refetchInterval: (query) => {
      const pending = query.state.data?.departures.some((d) => d.priceStatus === "pending");
      return pending && query.state.dataUpdateCount < MAX_PRICE_TRIES ? 3000 : false;
    },
  });
  const priceTries = useQueryClient().getQueryState(["bdz-prices", from, to])?.dataUpdateCount ?? 0;
  // Stop showing "Loading price…" once we've given up (or the request failed outright).
  const pricesGaveUp = pricesQuery.isError || (priceTries >= MAX_PRICE_TRIES && !pricesQuery.isFetching);

  // Prices come from the slower query; live delays from the timetable query, which refreshes
  // every 2 minutes. Combine both so neither goes stale.
  const schedule = useMemo(() => {
    const base = pricesQuery.data ?? bdzQuery.data;
    if (!base || !pricesQuery.data || !bdzQuery.data) return base;
    const live = new Map(bdzQuery.data.departures.map((d) => [`${d.departTime}|${d.trainName}`, d]));
    return {
      ...base,
      departures: base.departures.map((d) => {
        const l = live.get(`${d.departTime}|${d.trainName}`);
        return l ? { ...d, delayMin: l.delayMin, isDelayed: l.isDelayed } : d;
      }),
    };
  }, [pricesQuery.data, bdzQuery.data]);

  const trainAlerts = useMemo(
    () => (schedule ? trainDelayAlerts(schedule, from, to, bdzQuery.dataUpdatedAt) : []),
    [schedule, from, to, bdzQuery.dataUpdatedAt],
  );
  const trainsChecked = !!schedule?.departures.some((d) => d.delayMin !== undefined);

  const trip = useMemo(() => {
    if (!base) return null;
    const dir = directionsQuery.data;
    const decoded = dir ? decodePolyline(dir.polyline).map(([lat, lng]) => ({ lat, lng })) : undefined;
    const km = dir ? Math.round(dir.distanceKm) : roadKm(base.fromCoords, base.toCoords);
    const realDriveMin = dir?.durationMin;
    const nextTrain = bdzQuery.data?.departures.find((d) => {
      // pick the next upcoming departure if today's data
      return true;
    });
    const trainMin = nextTrain?.totalMinutes;
    return {
      ...base,
      km,
      pathLatLng: decoded ? (decoded.map((c) => [c.lat, c.lng]) as Array<[number, number]>) : undefined,
      pathCoords: decoded,
      routes: generateRoutes(base.seed, km, realDriveMin, trainMin),
      landmarks: landmarksAlongRoute(base.fromCoords, base.toCoords, decoded),
    };
  }, [base, directionsQuery.data, bdzQuery.data]);

  return (
    <main className="font-unified min-h-screen bg-background">
      <Header />

      <div className="mx-auto max-w-6xl px-6 pt-8">
        <Link
          to="/"
          className="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> New search
        </Link>
      </div>

      <section className="mx-auto max-w-6xl px-6 py-10">
      {!from || !to ? (
        <EmptyState />
      ) : coordsQuery.isLoading ? (
        <div className="rounded-3xl border border-border bg-card p-8 text-center">
          <p className="text-muted-foreground">
            Finding <strong className="text-foreground">{from}</strong> and{" "}
            <strong className="text-foreground">{to}</strong>…
          </p>
        </div>
      ) : !trip ? (
        <div className="rounded-3xl border border-border bg-card p-8 text-center">
          <p className="text-foreground">
            We couldn't find <strong>{from}</strong> or <strong>{to}</strong>.
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            Check the spelling or try a major Bulgarian city from the home page.
          </p>
        </div>
      ) : (
          <div className="space-y-14">
            <div className="flex items-baseline justify-between gap-4 flex-wrap">
              <h1 className="font-display text-3xl font-bold text-foreground sm:text-5xl">
                {fromLabel} <span className="text-muted-foreground">→</span> {toLabel}
              </h1>
              <span className="text-sm text-muted-foreground">
                {directionsQuery.isLoading
                  ? "Loading live route from Google…"
                  : directionsQuery.isError
                    ? `~${trip.km} km · live route unavailable, showing estimates`
                    : `${trip.km} km · live Google route · estimates in EUR`}
              </span>
            </div>

            <div className="grid gap-5 md:grid-cols-3">
              {trip.routes.map((r) => <RouteCard key={r.category} route={r} />)}
            </div>

            <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
              <section>
                <SectionHeader icon={MapIcon} title="Route on the map" subtitle="OpenStreetMap overview of your trip" />
                <RouteMap
                  from={trip.fromCoords}
                  to={trip.toCoords}
                  fromName={fromLabel}
                  toName={toLabel}
                  path={trip.pathLatLng}
                />
              </section>
              <section>
                <SectionHeader icon={AlertTriangle} title="Live alerts" subtitle="Trains, traffic and weather on your route" />
                <AlertsList
                  isLoading={alertsQuery.isLoading || directionsQuery.isLoading}
                  isError={alertsQuery.isError}
                  data={alertsQuery.data}
                  trainAlerts={trainAlerts}
                  trainsChecked={trainsChecked}
                />
              </section>
            </div>

            <section>
              <SectionHeader
                icon={Sparkles}
                title="Worth a stop along the way"
                subtitle={`Landmarks within ${MAX_LANDMARK_KM} km of your route`}
              />
              {trip.landmarks.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-border bg-card/50 p-8 text-center text-sm text-muted-foreground">
                  No notable landmarks within {MAX_LANDMARK_KM} km of this route.
                </div>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  {trip.landmarks.map((l) => <LandmarkCard key={l.name} landmark={l} />)}
                </div>
              )}
            </section>

            <BdzScheduleSection
              isLoading={bdzQuery.isLoading}
              isError={bdzQuery.isError}
              data={schedule}
              pricesGaveUp={pricesGaveUp}
            />
          </div>
        )}
      </section>

      <Footer />
    </main>
  );
}

function EmptyState() {
  return (
    <div className="rounded-3xl border border-border bg-card p-10 text-center">
      <h2 className="font-display text-2xl font-bold text-foreground">Pick a start and destination</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Head back to the home page and choose your cities.
      </p>
      <Link
        to="/"
        className="mt-6 inline-flex items-center gap-2 rounded-2xl px-5 py-3 font-semibold text-primary-foreground"
        style={{ background: "var(--gradient-hero)" }}
      >
        <ArrowLeft className="h-4 w-4" /> Back to search
      </Link>
    </div>
  );
}

function RouteCard({ route }: { route: RouteOption }) {
  const meta = CAT_META[route.category];
  const isShared = route.sharedWith.length >0;
  const ModeIcon = MODE_ICON[route.mode];
  const CatIcon = meta.icon;
  return (
    <article
      className={`group relative flex flex-col overflow-hidden rounded-3xl border border-border bg-card p-6 transition-all hover:-translate-y-1 ${
        isShared ? "route-card-shared" : ""
      }`}
      style={isShared ? undefined : { boxShadow: "var(--shadow-card)" }}  
    >
      <div className={`absolute inset-x-0 top-0 h-1 bg-gradient-to-r ${meta.accent}`} />
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            <CatIcon className="h-3.5 w-3.5" />{meta.tagline}
          </div>
          <h3 className={`mt-1 text-2xl font-bold ${isShared ? "text-[var(--win)]" : "text-foreground"}`}>
            {meta.label}
          </h3>
        </div>
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-muted text-foreground">
          <ModeIcon className="h-5 w-5" />
        </div>
      </div>
      <div className="mt-6 flex items-end justify-between border-t border-border pt-5">
        <Stat icon={<Clock className="h-4 w-4" />} label="Time" value={`${route.hours}h ${route.minutes.toString().padStart(2, "0")}m`} />
        <Stat icon={<Euro className="h-4 w-4" />} label="Total" value={`€${route.cost.toFixed(2)}`} align="right" />
      </div>
      <p className="mt-5 text-sm text-muted-foreground">
        <span className="font-medium text-foreground">{MODE_LABEL[route.mode]}</span> · {route.note}
        {route.sharedWith.length > 0 && (
          <span className="mt-2 block text-xs font-semibold text-foreground">
            Also the {route.sharedWith.map((c) => CAT_META[c].label.toLowerCase()).join(" and ")}
          </span>
        )}
      </p>
      
      <div className="mt-5 rounded-2xl bg-muted/60 p-4">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Cost breakdown</div>
        <ul className="mt-3 space-y-2">
          {route.breakdown.filter((b) => b.amount > 0).map((b) => {
            const Icon = b.icon;
            return (
              <li key={b.label} className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2 text-foreground">
                  <Icon className="h-3.5 w-3.5 text-muted-foreground" />{b.label}
                </span>
                <span className="font-semibold text-foreground tabular-nums">€{b.amount.toFixed(2)}</span>
              </li>
            );
          })}
        </ul>
      </div>
    </article>
  );
}

function Stat({ icon, label, value, align = "left" }: { icon: React.ReactNode; label: string; value: string; align?: "left" | "right" }) {
  return (
    <div className={align === "right" ? "text-right" : ""}>
      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {align === "left" && icon}{label}{align === "right" && icon}
      </div>
      <div className="mt-1 font-display text-2xl font-bold text-foreground">{value}</div>
    </div>
  );
}

function SectionHeader({ icon: Icon, title, subtitle }: { icon: typeof MapIcon; title: string; subtitle: string }) {
  return (
    <div className="mb-4 flex items-end justify-between gap-3">
      <div>
        <h3 className="font-display text-2xl font-bold text-foreground flex items-center gap-2">
          <Icon className="h-5 w-5 text-primary" />{title}
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
      </div>
    </div>
  );
}

// Delays of 5+ min become alerts; smaller ones only show as a badge in the timetable.
const TRAIN_ALERT_MIN = 5;

function trainDelayAlerts(schedule: BdzScheduleResult, from: string, to: string, updatedAt: number): TripAlert[] {
  return schedule.departures
    .filter((d) => (d.delayMin ?? 0) >= TRAIN_ALERT_MIN)
    .map((d) => ({
      level: d.delayMin! >= 15 ? "delay" : "warning",
      title: `Train ${d.trainName} running ${d.delayMin} min late`,
      body: `The ${d.departTime} departure from ${from} towards ${to} is now expected at ${addMinutes(d.departTime, d.delayMin!)}.`,
      source: "BDŽ live",
      updatedAt: new Date(updatedAt || Date.now()).toISOString(),
    }));
}

function addMinutes(hhmm: string, add: number): string {
  const [h, m] = hhmm.split(":").map(Number);
  const total = (h * 60 + m + add) % (24 * 60);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

function AlertsList({
  isLoading,
  isError,
  data,
  trainAlerts,
  trainsChecked,
}: {
  isLoading: boolean;
  isError: boolean;
  data: AlertsResult | undefined;
  trainAlerts: TripAlert[];
  trainsChecked: boolean;
}) {
  const note = (text: string, clear: boolean = false) => (
    <div
      className="flex items-center gap-3 rounded-2xl border border-border bg-card p-4 text-sm text-muted-foreground"
      style={{ boxShadow: "var(--shadow-card)" }}
    >
      {clear && <Check className="h-5 w-5 shrink-0 text-emerald-600" />}
      <span>{text}</span>
    </div>
  );
  const alerts = [...trainAlerts, ...(data?.alerts ?? [])];
  const checked = [...(trainsChecked ? ["BDŽ live trains"] : []), ...(data?.checked ?? [])];

  // Show alerts a page at a time; alerts refresh, so keep the page in range if the list shrinks.
  const [page, setPage] = useState(0);
  const pages = Math.max(1, Math.ceil(alerts.length / ALERTS_PER_PAGE));
  const current = Math.min(page, pages - 1);
  const first = current * ALERTS_PER_PAGE;
  const shown = alerts.slice(first, first + ALERTS_PER_PAGE);

  // Keep the arrows where they are when a later page has fewer (or shorter) alerts: the card
  // area keeps the height of the tallest page shown so far.
  const listRef = useRef<HTMLDivElement>(null);
  const [listMinHeight, setListMinHeight] = useState(0);
  useLayoutEffect(() => {
    const h = listRef.current?.scrollHeight ?? 0;
    if (h > listMinHeight) setListMinHeight(h);
  });

  if (alerts.length === 0) {
    if (isLoading) return note("Checking trains, traffic and weather along your route…");
    if (checked.length === 0 || (isError && !trainsChecked)) return note("Live alerts are unavailable right now.");
    return note(`No disruptions on this route right now, according to ${joinList(checked)}.`, true);
  }
  const arrow =
    "flex h-8 w-8 items-center justify-center rounded-xl border border-border bg-card text-foreground transition-colors hover:bg-muted disabled:cursor-default disabled:opacity-40 disabled:hover:bg-card";
  return (
    <div className="space-y-3">
      <div ref={listRef} className="space-y-3" style={pages > 1 ? { minHeight: listMinHeight } : undefined}>
        {shown.map((a, i) => <AlertCard key={first + i} alert={a} />)}
      </div>
      {pages > 1 && (
        <div className="flex items-center justify-end gap-2">
          <span className="mr-1 text-xs text-muted-foreground tabular-nums">
            {shown.length > 1 ? `${first + 1}–${first + shown.length}` : first + 1} of {alerts.length}
          </span>
          <button
            type="button"
            className={arrow}
            onClick={() => setPage(current - 1)}
            disabled={current === 0}
            aria-label="Previous alerts"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            className={arrow}
            onClick={() => setPage(current + 1)}
            disabled={current >= pages - 1}
            aria-label="Next alerts"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  );
}

const ALERTS_PER_PAGE = 3;

function joinList(items: string[]): string {
  return items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

function AlertCard({ alert }: { alert: TripAlert }) {
  const config = {
    delay:   { Icon: Clock,         dot: "bg-primary",   label: "Delay" },
    warning: { Icon: AlertTriangle, dot: "bg-accent",    label: "Warning" },
    info:    { Icon: Info,          dot: "bg-secondary", label: "Info" },
  }[alert.level];
  const Icon = alert.source.includes("Meteo") ? CloudRain : alert.source.includes("BDŽ") ? Train : config.Icon;
  const time = new Date(alert.updatedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  return (
    <article className="rounded-2xl border border-border bg-card p-4" style={{ boxShadow: "var(--shadow-card)" }}>
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-muted">
          <Icon className="h-4 w-4 text-foreground" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className={`h-1.5 w-1.5 rounded-full ${config.dot}`} />
            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              {config.label} · {alert.source} · {time}
            </span>
          </div>
          <h4 className="mt-1 font-semibold text-foreground">{alert.title}</h4>
          <p className="mt-1 text-sm text-muted-foreground">{alert.body}</p>
        </div>
      </div>
    </article>
  );
}

function LandmarkCard({ landmark }: { landmark: Landmark & { detourKm: number } }) {
  const [imageUrl, setImageUrl] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    getWikiLandmarkImage(landmark.name)
      .then((url) => {
        if (isMounted) setImageUrl(url);
      })
      .catch(() => {
        if (isMounted) setImageUrl(null);
      });

    return () => {
      isMounted = false;
    };
  }, [landmark.name]);

  const [searchParams] = useSearchParams();

  return (
    <Link
      to={`/landmark/${landmark.slug}?${searchParams.toString()}`}
      className="group flex flex-col overflow-hidden rounded-2xl border border-border bg-card p-5 transition-all hover:-translate-y-1 hover:border-primary/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      style={{ boxShadow: "var(--shadow-card)" }}
    >
      <div
        className="mb-4 flex h-24 w-full items-center justify-center rounded-xl bg-slate-200 bg-cover bg-center text-5xl"
        style={{
          backgroundImage: imageUrl ? `url("${imageUrl}")` : "var(--gradient-warm)",
          opacity: 0.95,
        }}
      >
        {!imageUrl && <span aria-hidden>{landmark.emoji}</span>}
      </div>
      <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        <span><CloudRain className="mr-1 inline h-3 w-3" />{landmark.city}</span>
        <span className="rounded-full bg-muted px-2 py-0.5 text-foreground">
          {landmark.detourKm < 1 ? "on route" : `${landmark.detourKm.toFixed(0)} km off`}
        </span>
      </div>
      <h4 className="mt-1 font-display text-lg font-bold text-foreground transition-colors group-hover:text-primary"><span aria-hidden>{imageUrl ? landmark.emoji + " " : ""}</span>{landmark.name}</h4>
      <p className="mt-1 text-sm text-muted-foreground">{landmark.description}</p>
      <span className="mt-3 text-xs font-semibold uppercase tracking-wider text-primary opacity-0 transition-opacity group-hover:opacity-100">
        View details →
      </span>
    </Link>
  );
}

function BdzScheduleSection({
  isLoading,
  isError,
  data,
  pricesGaveUp,
}: {
  isLoading: boolean;
  isError: boolean;
  data: { supported: boolean; fromName?: string; toName?: string; date?: string; departures: BdzDeparture[]; error?: string } | undefined;
  pricesGaveUp: boolean;
}) {
  if (isLoading) {
    return (
      <section>
        <SectionHeader icon={Train} title="Train schedule (БДЖ)" subtitle="Live departures from Bulgarian Railways" />
        <div className="rounded-2xl border border-dashed border-border bg-card/50 p-8 text-center text-sm text-muted-foreground">
          Loading live BDŽ schedule…
        </div>
      </section>
    );
  }
  if (!data || isError) return null;
  if (!data.supported) {
    return (
      <section>
        <SectionHeader icon={Train} title="Train schedule (БДЖ)" subtitle="Live departures from Bulgarian Railways" />
        <div className="rounded-2xl border border-dashed border-border bg-card/50 p-8 text-center text-sm text-muted-foreground">
          No BDŽ station mapped for this route yet.
        </div>
      </section>
    );
  }
  if (data.error) {
    return (
      <section>
        <SectionHeader icon={Train} title="Train schedule (БДЖ)" subtitle="Live departures from Bulgarian Railways" />
        <div className="rounded-2xl border border-dashed border-border bg-card/50 p-6 text-center text-sm text-muted-foreground">
          Couldn't reach БДЖ: {data.error}
        </div>
      </section>
    );
  }
  if (data.departures.length === 0) {
    return (
      <section>
        <SectionHeader icon={Train} title="Train schedule (БДЖ)" subtitle={`No direct departures found for ${data.date ?? "today"}`} />
      </section>
    );
  }
  const next = data.departures;
  return (
    <section>
      <SectionHeader
        icon={Train}
        title="Train schedule (БДЖ)"
        subtitle={`Live from Bulgarian Railways · ${data.fromName} → ${data.toName} · ${data.date}`}
      />
      <div className="overflow-hidden rounded-2xl border border-border bg-card" style={{ boxShadow: "var(--shadow-card)" }}>
        <ul className="divide-y divide-border">
          {next.map((d, i) => (
            <li key={`${d.trainName}-${d.departTime}-${i}`} className="grid grid-cols-[1fr_auto] items-center gap-4 px-5 py-4 sm:grid-cols-[1fr_5rem_14rem]">
              <div>
                <div className="font-display text-lg font-bold text-foreground tabular-nums">
                  {d.departTime} <span className="text-muted-foreground">→</span> {d.arriveTime}
                  {d.delayMin !== undefined && (
                    d.delayMin > 0 ? (
                      <span className="ml-2 align-middle rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
                        +{d.delayMin} min late
                      </span>
                    ) : (
                      <span className="ml-2 align-middle text-[11px] font-medium text-muted-foreground">on time</span>
                    )
                  )}
                </div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  {d.trainName}
                  {d.distanceKm > 0 ? ` · ${d.distanceKm} km` : ""}
                  {d.transfers > 0 ? ` · ${d.transfers} transfer${d.transfers > 1 ? "s" : ""}` : " · direct"}
                </div>
              </div>
              <div className="hidden text-sm text-foreground sm:block">
                <Clock className="mr-1 inline h-3.5 w-3.5 text-muted-foreground" />
                {d.totalTime}
              </div>
              <div className="flex flex-col items-end gap-1">
                <span className="text-xs text-muted-foreground/80">
                  {d.priceSecondClass !== undefined || d.priceFirstClass !== undefined
                    ? "Adult price"
                    : d.priceStatus === "none"
                      ? "No online price · buy at the station"
                      : pricesGaveUp
                        ? "Price unavailable right now"
                        : "Loading price…"}
                </span>
                <div className="flex flex-wrap items-center justify-end gap-1.5">
                  {d.hasSecondClass && <ClassFare label="2nd" price={d.priceSecondClass} />}
                  {d.hasFirstClass && <ClassFare label="1st" price={d.priceFirstClass} />}
                </div>
              </div>
            </li>
          ))}
        </ul>
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        Source: razpisanie.bdz.bg · prices on the card above are estimates; click БДЖ to book.
      </p>
    </section>
  );
}

function ClassFare({ label, price }: { label: string; price?: number }) {
  return (
    <span className="inline-flex items-center rounded-full bg-muted px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-foreground">
      {label}
      {price !== undefined && (
        <span className="font-medium normal-case tracking-normal tabular-nums">&nbsp;: {price.toFixed(2)} €</span>
      )}
    </span>
  );
}
