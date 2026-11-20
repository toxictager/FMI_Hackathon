// Request validation shared by the Express server and the Netlify Functions.
import { z } from "zod";

const coords = z.object({ lat: z.number(), lng: z.number() });

export const directionsInput = z.object({ from: coords, to: coords });

const minutes = z.number().min(0).max(5000);

export const alertsInput = z.object({
  from: coords,
  to: coords,
  fromName: z.string().min(1).max(80),
  toName: z.string().min(1).max(80),
  polyline: z.string().max(150_000).optional(),
  durationMin: minutes.optional(),
});

export const bdzInput = z.object({
  from: z.string().min(1).max(80),
  to: z.string().min(1).max(80),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});
