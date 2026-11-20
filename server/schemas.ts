// Request validation shared by the Express server and the Netlify Functions.
import { z } from "zod";

const coords = z.object({ lat: z.number(), lng: z.number() });

export const directionsInput = z.object({ from: coords, to: coords });

export const bdzInput = z.object({
  from: z.string().min(1).max(80),
  to: z.string().min(1).max(80),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});
