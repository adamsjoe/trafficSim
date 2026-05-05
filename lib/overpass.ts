import type { OverpassResponse, RoadGraph } from './types';
import { DEFAULT_ROAD_TYPES } from './roadTypes';

// Speed multiplier per highway class (fallback for unknown types)
const ROAD_SPEED: Record<string, number> = Object.fromEntries(
  Object.entries(DEFAULT_ROAD_TYPES).map(([k, v]) => [k, v.speed])
);

export async function fetchRoadData(
  bbox: [number, number, number, number],
  enabledTypes: string[],
): Promise<OverpassResponse> {
  if (!enabledTypes.length) throw new Error('No road types enabled');

  const [s, w, n, e] = bbox;
  const bboxStr = [s, w, n, e].map((v) => v.toFixed(6)).join(',');
  const types   = enabledTypes.join('|');

  // Include traffic signal nodes in the same query
  const query = `
[out:json][timeout:30];
(
  way["highway"~"^(${types})$"](${bboxStr});
  >;
  node["highway"="traffic_signals"](${bboxStr});
);
out body;`.trim();

  const res = await fetch('https://overpass-api.de/api/interpreter', {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    'data=' + encodeURIComponent(query),
  });

  if (!res.ok) throw new Error(`Overpass API HTTP ${res.status}`);
  return res.json() as Promise<OverpassResponse>;
}

export function buildGraph(data: OverpassResponse): RoadGraph {
  const nodes:        RoadGraph['nodes']       = {};
  const edges:        RoadGraph['edges']       = {};
  const edgeWeights:  RoadGraph['edgeWeights'] = new Map();
  const signalNodes:  RoadGraph['signalNodes'] = new Map();

  // Index all nodes
  for (const el of data.elements) {
    if (el.type === 'node' && el.lat !== undefined && el.lon !== undefined) {
      nodes[el.id] = { lat: el.lat, lng: el.lon };
    }
  }

  // Build edges from ways, recording highway class per edge
  for (const el of data.elements) {
    if (el.type !== 'way' || !el.nodes) continue;

    const ht      = el.tags?.['highway'] ?? 'residential';
    const oneway  = el.tags?.['oneway'] === 'yes';
    const speed   = ROAD_SPEED[ht] ?? 0.6;
    const nds     = el.nodes;

    for (let i = 0; i < nds.length - 1; i++) {
      const a = nds[i], b = nds[i + 1];
      if (a === undefined || b === undefined) continue;
      if (!nodes[a] || !nodes[b]) continue;

      if (!edges[a]) edges[a] = [];
      if (!edges[b]) edges[b] = [];

      if (!edges[a].includes(b)) edges[a].push(b);
      if (!oneway && !edges[b].includes(a)) edges[b].push(a);

      // Only set weight if not already assigned by a higher-class road
      const keyAB = `${a}-${b}`, keyBA = `${b}-${a}`;
      if (!edgeWeights.has(keyAB) || (edgeWeights.get(keyAB) ?? 0) < speed) {
        edgeWeights.set(keyAB, speed);
      }
      if (!oneway) {
        if (!edgeWeights.has(keyBA) || (edgeWeights.get(keyBA) ?? 0) < speed) {
          edgeWeights.set(keyBA, speed);
        }
      }
    }
  }

  // Collect traffic signal nodes
  for (const el of data.elements) {
    if (el.type === 'node' && el.tags?.['highway'] === 'traffic_signals') {
      // Deterministic phase offset based on node ID so lights don't all cycle together
      const phase = (el.id * 7 + 13) % 90;
      signalNodes.set(el.id, phase);
    }
  }

  const nodeIds = Object.keys(edges)
    .map(Number)
    .filter((id) => (edges[id]?.length ?? 0) > 0);

  return {
    nodes,
    edges,
    nodeIds,
    closedEdges: new Set(),
    edgeCounts:  new Map(),
    edgeWeights,
    signalNodes,
  };
}

export function countEdges(graph: RoadGraph): number {
  return Math.round(
    Object.values(graph.edges).reduce((s, a) => s + a.length, 0) / 2,
  );
}

export async function geocodeLocation(query: string): Promise<{ lat: number; lng: number; displayName: string }> {
  const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1`;
  const res  = await fetch(url, {
    headers: { 'Accept-Language': 'en', 'User-Agent': 'TrafficSim/1.0' },
  });
  if (!res.ok) throw new Error(`Nominatim HTTP ${res.status}`);
  const data = await res.json() as Array<{ lat: string; lon: string; display_name: string }>;
  if (!data.length) throw new Error('Location not found');
  const first = data[0];
  if (!first) throw new Error('Location not found');
  const { lat, lon, display_name } = first;
  return {
    lat: parseFloat(lat),
    lng: parseFloat(lon),
    displayName: display_name.split(',').slice(0, 2).join(',').trim(),
  };
}
