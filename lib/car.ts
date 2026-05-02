import type { RoadGraph, TrailPoint } from './types';

export const CAR_PALETTE = [
  '#ffb347', '#ff6b6b', '#ffd93d', '#b6f36a',
  '#6bcbff', '#ff9ff3', '#54a0ff', '#ff6348',
  '#2ed573', '#eccc68', '#ff4d4d', '#00d4ff',
  '#e056fd', '#0be881', '#f8b400', '#ff5e57',
] as const;

/** Approximate metres between two lat/lng points (good enough for short edges). */
function edgeMetres(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const dlat = (bLat - aLat) * 111_320;
  const dlng = (bLng - aLng) * 111_320 * Math.cos((aLat * Math.PI) / 180);
  return Math.sqrt(dlat * dlat + dlng * dlng) || 1;
}

export class Car {
  cur: number;
  nxt: number;
  /** Progress along current edge [0, 1) */
  t: number;
  prevNode: number;
  color: string;
  trail: TrailPoint[];

  private graph: RoadGraph;

  constructor(graph: RoadGraph) {
    this.graph = graph;
    this.color = CAR_PALETTE[Math.floor(Math.random() * CAR_PALETTE.length)];
    this.trail = [];
    this.prevNode = -1;
    this.cur = 0;
    this.nxt = 0;
    this.t = 0;
    this.place();
  }

  /** Teleport to a random node and pick a random neighbour. */
  place(): void {
    const { nodeIds, edges } = this.graph;
    if (nodeIds.length === 0) return;

    this.cur = nodeIds[Math.floor(Math.random() * nodeIds.length)];
    const nb = edges[this.cur];
    if (!nb || nb.length === 0) return;

    this.nxt = nb[Math.floor(Math.random() * nb.length)];
    this.t = Math.random();
    this.trail = [];
    this.prevNode = -1;
  }

  /**
   * Advance the car by `dt` milliseconds at the given speed multiplier.
   * Base speed ≈ 11 m/s (~40 km/h). Respects graph.closedEdges.
   */
  update(dt: number, speedMult: number): void {
    const { nodes, edges, closedEdges } = this.graph;
    const a = nodes[this.cur];
    const b = nodes[this.nxt];
    if (!a || !b) { this.place(); return; }

    const dist = edgeMetres(a.lat, a.lng, b.lat, b.lng);
    const step = (11 * speedMult * dt) / (dist * 1000);
    this.t += step;

    // Advance nodes when edge is complete
    while (this.t >= 1) {
      this.t -= 1;
      this.prevNode = this.cur;
      this.cur = this.nxt;

      const nb = edges[this.cur];
      if (!nb || nb.length === 0) { this.place(); return; }

      // Filter out closed edges, then avoid U-turns
      const open = nb.filter((n) => !closedEdges.has(`${this.cur}-${n}`));
      const pool = open.length > 0 ? open : nb; // fallback to all if everything is closed
      const fwd  = pool.filter((n) => n !== this.prevNode);
      const choices = fwd.length > 0 ? fwd : pool;
      this.nxt = choices[Math.floor(Math.random() * choices.length)];
    }
  }

  getLatLng(): { lat: number; lng: number } | null {
    const { nodes } = this.graph;
    const a = nodes[this.cur];
    const b = nodes[this.nxt];
    if (!a || !b) return null;

    return {
      lat: a.lat + (b.lat - a.lat) * this.t,
      lng: a.lng + (b.lng - a.lng) * this.t,
    };
  }

  clearTrail(): void {
    this.trail = [];
  }
}
