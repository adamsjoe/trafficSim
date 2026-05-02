import type { OSMElement, OverpassResponse, RoadGraph } from './types';

export async function fetchRoadData(
  bbox: [south: number, west: number, north: number, east: number],
  enabledTypes: string[],
): Promise<OverpassResponse> {
  if (enabledTypes.length === 0) {
    throw new Error('No road types enabled');
  }

  const [s, w, n, e] = bbox;
  const bboxStr = [s, w, n, e].map((v) => v.toFixed(6)).join(',');
  const types = enabledTypes.join('|');
  const query = `[out:json][timeout:30];(way["highway"~"^(${types})$"](${bboxStr});>;);out body;`;

  const res = await fetch('https://overpass-api.de/api/interpreter', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'data=' + encodeURIComponent(query),
  });

  if (!res.ok) {
    throw new Error(`Overpass API returned HTTP ${res.status}`);
  }

  return res.json() as Promise<OverpassResponse>;
}

export function buildGraph(data: OverpassResponse): RoadGraph {
  const nodes: RoadGraph['nodes'] = {};
  const edges: RoadGraph['edges'] = {};

  // Index nodes
  for (const el of data.elements) {
    if (el.type === 'node' && el.lat !== undefined && el.lon !== undefined) {
      nodes[el.id] = { lat: el.lat, lng: el.lon };
    }
  }

  // Build edge list from ways
  for (const el of data.elements) {
    if (el.type !== 'way' || !el.nodes) continue;

    const oneway = el.tags?.oneway === 'yes';
    const nds: number[] = el.nodes;

    for (let i = 0; i < nds.length - 1; i++) {
      const a = nds[i];
      const b = nds[i + 1];
      if (!nodes[a] || !nodes[b]) continue;

      if (!edges[a]) edges[a] = [];
      if (!edges[b]) edges[b] = [];

      if (!edges[a].includes(b)) edges[a].push(b);
      if (!oneway && !edges[b].includes(a)) edges[b].push(a);
    }
  }

  const nodeIds = Object.keys(edges)
    .map(Number)
    .filter((id) => edges[id].length > 0);

  return { nodes, edges, nodeIds, closedEdges: new Set<string>() };
}

export function countEdges(graph: RoadGraph): number {
  return Math.round(
    Object.values(graph.edges).reduce((sum, arr) => sum + arr.length, 0) / 2,
  );
}

export async function geocodeLocation(query: string): Promise<{ lat: number; lng: number; displayName: string }> {
  const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1`;

  const res = await fetch(url, {
    headers: { 'Accept-Language': 'en', 'User-Agent': 'TrafficSim/1.0' },
  });

  if (!res.ok) throw new Error(`Nominatim returned HTTP ${res.status}`);

  const data = await res.json() as Array<{
    lat: string;
    lon: string;
    display_name: string;
  }>;

  if (!data.length) throw new Error('Location not found');

  const { lat, lon, display_name } = data[0];
  const short = display_name.split(',').slice(0, 2).join(',').trim();

  return { lat: parseFloat(lat), lng: parseFloat(lon), displayName: short };
}
