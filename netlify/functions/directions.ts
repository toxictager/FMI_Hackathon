// Netlify Function: the hosted site's /api/directions. Set GOOGLE_MAPS_API_KEY in Netlify's environment variables.
import { getDirections } from "../../server/directions";
import { directionsInput } from "../../server/schemas";

export default async (req: Request): Promise<Response> => {
  if (req.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }
  const parsed = directionsInput.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "Invalid input" }, { status: 400 });
  }
  try {
    return Response.json(await getDirections(parsed.data));
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Directions failed" },
      { status: 502 },
    );
  }
};

export const config = { path: "/api/directions" };
