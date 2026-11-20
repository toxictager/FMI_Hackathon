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

  const res = await fetch(
    "https://routes.googleapis.com/directions/v2:computeRoutes",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": key,
        "X-Goog-FieldMask":
          "routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline",
      },
      body: JSON.stringify({
        origin: {
          location: {
            latLng: { latitude: input.from.lat, longitude: input.from.lng },
          },
        },
        destination: {
          location: {
            latLng: { latitude: input.to.lat, longitude: input.to.lng },
          },
        },
        travelMode: "DRIVE",
        regionCode: "BG",
      }),
    },
  );

  if (!res.ok) {
    const err = (await res.json().catch(() => null)) as {
      error?: { status?: string; message?: string };
    } | null;
    throw new Error(
      `Routes API error ${res.status}${
        err?.error ? `: ${err.error.status} — ${err.error.message}` : ""
      }`,
    );
  }

  const json = (await res.json()) as {
    routes?: Array<{
      distanceMeters?: number;
      duration?: string; // e.g. "1234s"
      polyline?: { encodedPolyline: string };
    }>;
  };

  const route = json.routes?.[0];
  if (!route || !route.polyline) {
    throw new Error("Routes API returned no route for these coordinates");
  }

  const meters = route.distanceMeters ?? 0;
  const seconds = parseInt(route.duration ?? "0", 10); // "1234s" -> 1234

  return {
    distanceKm: Math.round(meters / 100) / 10,
    durationMin: Math.round(seconds / 60),
    polyline: route.polyline.encodedPolyline,
    status: "OK",
  };
}
