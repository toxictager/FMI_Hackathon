// Netlify Function: the hosted site's /api/bdz/prices (timetable plus ticket prices).
import { getBdzSchedule, pendingFareLookups } from "../../server/bdz";
import { bdzInput } from "../../server/schemas";

// The part of Netlify's function context used here.
type Context = { waitUntil(promise: Promise<unknown>): void };

export default async (req: Request, context: Context): Promise<Response> => {
  if (req.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }
  const parsed = bdzInput.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "Invalid input" }, { status: 400 });
  }
  const result = await getBdzSchedule(parsed.data, { withPrices: true });
  // Let slow BDŽ fare lookups finish after responding, so the client's next poll finds them.
  context.waitUntil(pendingFareLookups());
  return Response.json(result);
};

export const config = { path: "/api/bdz/prices" };
