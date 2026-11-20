// Live train delays from BDŽ's station boards (live.bdz.bg). Each board row is tagged with
// data-train="<number>" and data-delay="<minutes>", so we read those attributes only.

const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  "Accept-Language": "en-US,en;q=0.9",
};

const STATIONS_TTL_MS = 24 * 60 * 60 * 1000;
const BOARD_TTL_MS = 60 * 1000;

let stationSlugs: { at: number; byId: Map<string, string> } | null = null;
const boards = new Map<string, { at: number; delays: Map<string, number> }>();

async function getText(url: string): Promise<string> {
  const res = await fetch(url, { headers: BROWSER_HEADERS, signal: AbortSignal.timeout(6000) });
  if (!res.ok) throw new Error(`live.bdz.bg error ${res.status}`);
  return res.text();
}

// Every live.bdz.bg page embeds the station list: {id: '160002', name: 'Sofia', slug: 'sofia', ...}.
// The ids are the same ones razpisanie.bdz.bg uses for route.from / route.to.
async function slugForStation(stationId: string): Promise<string | undefined> {
  if (!stationSlugs || Date.now() - stationSlugs.at > STATIONS_TTL_MS) {
    const html = await getText("https://live.bdz.bg/en");
    const byId = new Map<string, string>();
    for (const m of html.matchAll(/\{id:\s*'(\d+)',\s*name:\s*'[^']*',\s*slug:\s*'([a-z0-9-]+)'/g)) {
      byId.set(m[1], m[2]);
    }
    if (byId.size === 0) throw new Error("live.bdz.bg station list not found");
    stationSlugs = { at: Date.now(), byId };
  }
  return stationSlugs.byId.get(stationId);
}

/**
 * Current delay in minutes for each train on a station's departures board, keyed by train
 * number. Only trains still to depart (roughly the next few hours) are listed by BDŽ.
 */
export async function getDepartureDelays(stationId: string): Promise<Map<string, number>> {
  const cached = boards.get(stationId);
  if (cached && Date.now() - cached.at < BOARD_TTL_MS) return cached.delays;

  const slug = await slugForStation(stationId);
  if (!slug) return new Map();
  const html = await getText(`https://live.bdz.bg/en/${slug}/departures`);
  const delays = new Map<string, number>();
  for (const m of html.matchAll(/data-train="(\d+)"[^>]*?data-delay="(-?\d+)"/g)) {
    delays.set(m[1], Math.max(0, Number(m[2])));
  }
  boards.set(stationId, { at: Date.now(), delays });
  return delays;
}
