# Dragon Haven

Breed, hatch, raise and battle original dragons on a floating island.
Batch 1 ships 100 dragons (10 Common, 45 Rare, 35 Epic, 10 Legendary) across 10 elements plus Aether, built from 8 body types with element features.

The world is 5 floating islands plus an Arena islet. Drag (finger, left or right mouse), pinch or scroll to move around. Land is bought in sections or as a whole island at 25% off. New players get a guided start from Pip the owl.

## Deploy on Render (Blueprint — easiest)
1. Push this folder to a GitHub repo.
2. In Render: **New > Blueprint**, pick the repo. `render.yaml` creates the web service **and** a free Postgres database and wires `DATABASE_URL` for you.
3. Open the service URL, create an account, play.

## Deploy on Render (manual)
1. **New > PostgreSQL** (free) and copy its *Internal Database URL*.
2. **New > Web Service** from the repo. Runtime Node, Build `npm install`, Start `node server.js`.
3. Add env var `DATABASE_URL` = the URL from step 1.

Without `DATABASE_URL` the server saves to `data/players.json`, which Render wipes on every deploy, so use Postgres in production.

## Run locally
```
npm install
node server.js      # http://localhost:3000
```

## How saves work
- Every player can also play as a guest (save stays in that browser).
- Logged-in saves go to Postgres every 20 s and when the tab is hidden; the newest save wins across devices.
- All timers use real time, so gold, crops, breeding and eggs keep going while the game is closed.

## Adding the next 100 dragons
In `public/index.html`, add a new builder function to `BATCHES` that pushes dragons with ids 100-199 and bump `RELEASED` to 200. Saves only store dragon ids, so existing players keep everything.
