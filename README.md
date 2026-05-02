# TrafficSim

A real-world traffic simulation built on live OpenStreetMap data. Search any location, load the road network, and watch traffic flow across actual streets — with congestion, traffic signals, weighted routing, and rush hour simulation.

Built with Next.js 14, TypeScript, Leaflet, and WebGL.

---

## Features

### Map & Roads

- Search any city, street, or area worldwide via Nominatim geocoding
- Road network fetched live from OpenStreetMap via the Overpass API
- Roads rendered and colour-coded by class (motorway → living street)
- Toggle which road classes are loaded before fetching
- **Road closure mode** — click any road on the map to close it; cars reroute in real time. Click again to reopen

### Simulation

- Cars navigate the real road graph using random-walk traversal, respecting one-way streets
- Scales from a handful of cars up to **100,000+** via a WebGL point-sprite renderer — all vehicles drawn in a single GPU draw call
- Trails rendered on a 2D canvas overlay (auto-disabled above 400 cars)

### Realism

| Feature              | Detail                                                                                                                                                                                                                                                |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Congestion**       | Live edge car counts slow vehicles proportionally — `speed × 1/(1 + 0.05n)` where n is cars on that edge                                                                                                                                              |
| **Weighted routing** | Cars prefer faster road classes (motorway > primary > residential) using roulette-wheel selection weighted by road speed multiplier                                                                                                                   |
| **Traffic signals**  | OSM `highway=traffic_signals` nodes fetched and rendered. 90-second cycles (45s green / 45s red) with deterministic per-node phase offsets so junctions don't all change together. Cars hold visibly on the approach at t=0.97 and release when green |
| **Rush hour**        | 24-hour simulation clock with a demand curve peaking at 1.9× (08:00) and 2.0× (17:00), dropping to 0.12× overnight. Car count scales with the curve. Time scale is configurable (1×–300×)                                                             |
| **Color by speed**   | Optionally colour cars by speed factor — red = stopped/congested, amber = moderate, green = free-flowing                                                                                                                                              |

---

## Stack

| Layer           | Technology                        |
| --------------- | --------------------------------- |
| Framework       | Next.js 14 (App Router)           |
| Language        | TypeScript (strict)               |
| Map             | Leaflet 1.9 + OpenStreetMap tiles |
| Road data       | OpenStreetMap via Overpass API    |
| Geocoding       | Nominatim                         |
| Car rendering   | WebGL (custom GLSL point sprites) |
| Trail rendering | Canvas 2D                         |
| Fonts           | IBM Plex Mono, Barlow Condensed   |
| Deployment      | Vercel                            |

---

## Project Structure

```
trafficsim/
├── app/
│   ├── layout.tsx          # Root layout, fonts, metadata
│   ├── page.tsx            # Entry — dynamic import with ssr: false
│   └── globals.css         # All styles
├── components/
│   ├── TrafficMap.tsx      # Map init, simulation loop, road closure, canvas/WebGL overlay
│   ├── ControlPanel.tsx    # All sliders, toggles, stats, rush hour clock
│   └── InfoModal.tsx       # Info modal shown on premature Start
└── lib/
    ├── types.ts            # All TypeScript interfaces
    ├── roadTypes.ts        # Road class config (colour, weight, speed multiplier)
    ├── overpass.ts         # Overpass API fetch, graph building, signal node collection
    ├── car.ts              # Car agent — congestion, weighted routing, signal stops
    ├── rushHour.ts         # Rush hour curve, sim time formatting, speed-to-colour
    ├── webglRenderer.ts    # WebGL context, shaders, typed array buffer management
    └── utils.ts            # fmtN, clamp
```

---

## Getting Started

### Prerequisites

- Node.js 20+
- npm

### Local development

```bash
git clone <repo-url>
cd trafficsim
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Deploy to Vercel

Push to GitHub, then import the repository at [vercel.com](https://vercel.com). Vercel auto-detects Next.js — no environment variables or build configuration needed.

All data is sourced from public APIs (Overpass, Nominatim). No backend required.

---

## Usage

1. **Locate** — type a city or street and click Locate (or press Enter)
2. **Load Roads** — fetches the road network for the current map view from OpenStreetMap
3. **Start** — cars begin navigating the road graph
4. **Close Roads** — click the 🚧 button, then click any road on the map to close it. Cars will reroute immediately. Click again to reopen, or use Reopen All
5. **Realism panel** — toggle congestion, weighted routing, traffic signals, and rush hour independently
6. **Rush hour** — enable and adjust time scale to watch traffic build through the morning peak, ease off midday, and peak again in the evening

---

## Architecture Notes

**Why WebGL?**
Canvas 2D `arc()` requires one draw call per car. At 10k+ cars this collapses the main thread. The WebGL renderer packs all car positions and colours into a single `Float32Array` and draws them with one `gl.drawArrays(gl.POINTS, ...)` call. The fragment shader draws each point as a smooth anti-aliased circle. Cost goes from O(n) draw calls to O(1).

**Signal handling**
Cars check the signal state _before_ crossing a junction, not after. If red, `t` is clamped to `0.97` on the approach edge so the car is visible on the road. When the signal turns green the car crosses immediately. The 90-second simulation cycle runs at configurable speed — the clock ticks every frame regardless of whether rush hour is enabled, so signals always cycle.

**Congestion model**
Each directed edge maintains a live car count in `graph.edgeCounts`. Cars decrement when leaving an edge and increment when entering. Speed is factored by `1 / (1 + 0.05 × edgeCount)`, giving roughly 0.5× speed at 10 cars on one edge, approaching gridlock above ~40. Queuing at signals emerges naturally as trailing cars slow when they enter the congested approach edge.

**Weighted routing**
Each edge stores a speed multiplier derived from its OSM highway class (motorway = 2.8×, residential = 0.65×, etc.). When weighted routing is enabled, car junction decisions use roulette-wheel selection proportional to these weights, so traffic naturally concentrates on primary roads.

---

## Data sources

- Road network: [OpenStreetMap](https://www.openstreetmap.org/) via [Overpass API](https://overpass-api.de/)
- Geocoding: [Nominatim](https://nominatim.org/)
- Map tiles: [OpenStreetMap](https://www.openstreetmap.org/) contributors

© OpenStreetMap contributors — data available under the [Open Database Licence](https://opendatacommons.org/licenses/odbl/)
