// Netlify Function: the hosted site's /api/alerts (Google traffic + Open-Meteo weather).
import { getAlerts } from "../../server/alerts";
import { alertsInput } from "../../server/schemas";

export default async (req: Request): Promise<Response> => {
  if (req.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }
  const parsed = alertsInput.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "Invalid input" }, { status: 400 });
  }
  return Response.json(await getAlerts(parsed.data));
};

export const config = { path: "/api/alerts" };
