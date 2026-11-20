import "dotenv/config";
import path from "node:path";
import express from "express";
import { getAlerts } from "./alerts";
import { getBdzSchedule } from "./bdz";
import { getDirections } from "./directions";
import { alertsInput, bdzInput, directionsInput } from "./schemas";

const app = express();
// /api/alerts carries the route's encoded polyline, which can be tens of KB on long trips.
app.use(express.json({ limit: "200kb" }));

app.post("/api/directions", async (req, res) => {
  const parsed = directionsInput.safeParse(req.body);
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

app.post("/api/bdz", async (req, res) => {
  const parsed = bdzInput.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }
  res.json(await getBdzSchedule(parsed.data));
});

// Same timetable plus ticket prices; slower, so the client loads it after /api/bdz.
app.post("/api/bdz/prices", async (req, res) => {
  const parsed = bdzInput.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }
  res.json(await getBdzSchedule(parsed.data, { withPrices: true }));
});

app.post("/api/alerts", async (req, res) => {
  const parsed = alertsInput.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }
  res.json(await getAlerts(parsed.data));
});

// In production, serve the built React app from the same server.
if (process.env.NODE_ENV === "production") {
  const dist = path.resolve("dist");
  app.use(express.static(dist));
  app.get("/{*splat}", (_req, res) => res.sendFile(path.join(dist, "index.html")));
}

const port = Number(process.env.PORT) || 3001;
app.listen(port, () => console.log(`Routique API listening on http://localhost:${port}`));
