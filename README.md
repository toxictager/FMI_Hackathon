# Routique (React + Vite + Express)

A React 19 + TypeScript app for comparing bus, train and car routes across Bulgaria.

## Setup

    npm install
    cp .env.example .env      # then put your Google Maps key in .env

## Run in development

    npm run dev

Opens the React app on http://localhost:5173 and the API on http://localhost:3001.
Vite proxies `/api` to the API.

## Run in production

    npm run build
    npm start                 # serves the built app and the API on PORT (default 3001)

## Structure

- `src/` React client (pages, components, UI kit, styles)
- `server/` Express API: `/api/directions` (Google Directions, key stays on the server) and `/api/bdz` (train schedule scraping)
