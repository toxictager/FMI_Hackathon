import "dotenv/config";
import path from "node:path";
import express from "express";
import { z } from "zod";
import { getBdzSchedule } from "./bdz";
import { getDirections } from "./directions";

const app = express();
app.use(express.json({ limit: "10kb" }));

const coords = z.object({ lat: z.number(), lng: z.number() });

app.post("/api/directions", async (req, res) => {
  const parsed = z.object({ from: coords, to: coords }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }
  try {
    res.json(await getDirections(parsed.data));
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : "Directions failed" });
  }
});

const bdzInput = z.object({
  from: z.string().min(1).max(80),
  to: z.string().min(1).max(80),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

app.post("/api/bdz", async (req, res) => {
  const parsed = bdzInput.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }
  res.json(await getBdzSchedule(parsed.data));
});

// In production, serve the built React app from the same server.
if (process.env.NODE_ENV === "production") {
  const dist = path.resolve("dist");
  app.use(express.static(dist));
  app.get("/{*splat}", (_req, res) => res.sendFile(path.join(dist, "index.html")));
}

const port = Number(process.env.PORT) || 3001;
app.listen(port, () => console.log(`Routique API listening on http://localhost:${port}`));
