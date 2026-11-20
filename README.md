# Routique (React + Vite + Express)

A React 19 + TypeScript app for comparing bus, train and car routes across Bulgaria.

## Setup

    npm install
    # create .env with your keys (both optional):
    #   GOOGLE_MAPS_API_KEY=...
    #   TOMTOM_API_KEY=...

## Run in development

    npm run dev

Opens the React app on http://localhost:5173 and the API on http://localhost:3001.
Vite proxies `/api` to the API.

## Run in production

    npm run build
    npm start                 # serves the built app and the API on PORT (default 3001)

## Deploy to Netlify

`netlify.toml` builds the app and serves `/api/bdz`, `/api/bdz/prices`, `/api/directions` and
`/api/alerts` as Netlify Functions (`netlify/functions/`), which reuse the code in `server/`.
Set these under Site configuration → Environment variables:

- `GOOGLE_MAPS_API_KEY`: live Google route and drive times
- `TOMTOM_API_KEY`: live traffic delay and incidents (accidents, closures, roadworks) in Live alerts

Both are optional: without them the app falls back to estimates, and Live alerts still show
BDŽ train delays and Open-Meteo weather. GitHub Pages can't run the API, so BDŽ and live
directions only work on a host that runs server code (Netlify, or `npm start` on a Node host).

## Structure

- `src/` React client (pages, components, UI kit, styles)
- `server/` Express API: `/api/directions` (Google Directions, key stays on the server) and `/api/bdz` (train schedule scraping)
