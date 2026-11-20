// Netlify Function: the hosted site's /api/bdz (the Express server only runs locally).
import { getBdzSchedule } from "../../server/bdz";
import { bdzInput } from "../../server/schemas";

export default async (req: Request): Promise<Response> => {
  if (req.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }
  const parsed = bdzInput.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "Invalid input" }, { status: 400 });
  }
  return Response.json(await getBdzSchedule(parsed.data));
};

export const config = { path: "/api/bdz" };
