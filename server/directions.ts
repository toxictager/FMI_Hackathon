// Google Directions call. The API key lives only on the server.

export interface DirectionsResult {
  distanceKm: number;
  durationMin: number;
  polyline: string;
  status: string;
}

export async function getDirections(input: {
  from: { lat: number; lng: number };
  to: { lat: number; lng: number };
}): Promise<DirectionsResult> {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) {
    throw new Error("GOOGLE_MAPS_API_KEY is not configured on the server");
  }
  const url = new URL("https://maps.googleapis.com/maps/api/directions/json");
  url.searchParams.set("origin", `${input.from.lat},${input.from.lng}`);
  url.searchParams.set("destination", `${input.to.lat},${input.to.lng}`);
  url.searchParams.set("mode", "driving");
  url.searchParams.set("region", "bg");
  url.searchParams.set("key", key);

  const res = await fetch(url.toString());
  if (!res.ok) {
    throw new Error(`Google Directions error ${res.status}`);
  }
  const json = (await res.json()) as {
    status: string;
    error_message?: string;
    routes: Array<{
      overview_polyline: { points: string };
      legs: Array<{ distance: { value: number }; duration: { value: number } }>;
    }>;
  };
  if (json.status !== "OK" || !json.routes[0]) {
    throw new Error(
      `Directions failed: ${json.status}${json.error_message ? ` — ${json.error_message}` : ""}`,
    );
  }
  const route = json.routes[0];
  const meters = route.legs.reduce((s, l) => s + l.distance.value, 0);
  const seconds = route.legs.reduce((s, l) => s + l.duration.value, 0);
  return {
    distanceKm: Math.round(meters / 100) / 10,
    durationMin: Math.round(seconds / 60),
    polyline: route.overview_polyline.points,
    status: json.status,
  };
}
