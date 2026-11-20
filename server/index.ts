import "dotenv/config";
import path from "node:path";
import express from "express";
import { getBdzSchedule } from "./bdz";
import { getDirections } from "./directions";
import { bdzInput, directionsInput } from "./schemas";

const app = express();
app.use(express.json({ limit: "10kb" }));

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

// In production, serve the built React app from the same server.
if (process.env.NODE_ENV === "production") {
  const dist = path.resolve("dist");
  app.use(express.static(dist));
  app.get("/{*splat}", (_req, res) => res.sendFile(path.join(dist, "index.html")));
}

const port = Number(process.env.PORT) || 3001;
app.listen(port, () => console.log(`Routique API listening on http://localhost:${port}`));
