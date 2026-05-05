import type { CarUpdateConfig, RoadGraph, TrailPoint } from './types';
import { isSignalGreen } from './rushHour';

export const CAR_PALETTE = [
  '#ffb347', '#ff6b6b', '#ffd93d', '#b6f36a',
  '#6bcbff', '#ff9ff3', '#54a0ff', '#ff6348',
  '#2ed573', '#eccc68', '#ff4d4d', '#00d4ff',
  '#e056fd', '#0be881', '#f8b400', '#ff5e57',
] as const;

function edgeMetres(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const dlat = (bLat - aLat) * 111_320;
  const dlng = (bLng - aLng) * 111_320 * Math.cos((aLat * Math.PI) / 180);
  return Math.sqrt(dlat * dlat + dlng * dlng) || 1;
}

export class Car {
  cur:         number;
  nxt:         number;
  t:           number;
  prevNode:    number;
  color:       string;
  trail:       TrailPoint[];
  /** 0 = stopped, 1 = full road speed */
  speedFactor: number;
  /** Waiting at a red signal */
  waiting:     boolean;

  private graph: RoadGraph;

  constructor(graph: RoadGraph) {
    this.graph       = graph;
    this.color       = CAR_PALETTE[Math.floor(Math.random() * CAR_PALETTE.length)] ?? CAR_PALETTE[0];
    this.trail       = [];
    this.prevNode    = -1;
    this.cur         = 0;
    this.nxt         = 0;
    this.t           = 0;
    this.speedFactor = 1;
    this.waiting     = false;
    this.place();
  }

  // ── Edge count helpers ───────────────────────────────────────────────────────
  private enterEdge(a: number, b: number) {
    const key = `${a}-${b}`;
    this.graph.edgeCounts.set(key, (this.graph.edgeCounts.get(key) ?? 0) + 1);
  }

  private leaveEdge(a: number, b: number) {
    const key   = `${a}-${b}`;
    const count = this.graph.edgeCounts.get(key) ?? 0;
    if (count > 0) this.graph.edgeCounts.set(key, count - 1);
    else this.graph.edgeCounts.delete(key);
  }

  // ── Placement ────────────────────────────────────────────────────────────────
  place(): void {
    // Leave current edge before teleporting
    if (this.cur !== 0) this.leaveEdge(this.cur, this.nxt);

    const { nodeIds, edges } = this.graph;
    if (!nodeIds.length) return;

    this.cur      = nodeIds[Math.floor(Math.random() * nodeIds.length)] ?? 0;
    const nb      = edges[this.cur];
    if (!nb?.length) return;

    this.nxt      = nb[Math.floor(Math.random() * nb.length)] ?? 0;
    this.t        = Math.random();
    this.trail    = [];
    this.prevNode = -1;
    this.waiting  = false;

    this.enterEdge(this.cur, this.nxt);
  }

  /** Called when car is removed from simulation — cleans up edge count */
  destroy(): void {
    if (this.cur !== 0) this.leaveEdge(this.cur, this.nxt);
  }

  // ── Next node selection ──────────────────────────────────────────────────────
  private chooseNext(cfg: CarUpdateConfig): void {
    const { edges, closedEdges, edgeWeights } = this.graph;
    const nb = edges[this.cur];
    if (!nb?.length) { this.place(); return; }

    const open    = nb.filter((n) => !closedEdges.has(`${this.cur}-${n}`));
    const pool    = open.length ? open : nb;
    const fwd     = pool.filter((n) => n !== this.prevNode);
    const choices = fwd.length ? fwd : pool;

    if (cfg.weightedRouting && choices.length > 1) {
      // Roulette wheel weighted by road speed class
      const weights = choices.map((n) => edgeWeights.get(`${this.cur}-${n}`) ?? 1.0);
      const total   = weights.reduce((a, b) => a + b, 0);
      let rand      = Math.random() * total;
      for (let i = 0; i < choices.length; i++) {
        rand -= weights[i] ?? 0;
        if (rand <= 0) { this.nxt = choices[i] ?? this.nxt; return; }
      }
      this.nxt = choices[choices.length - 1] ?? this.nxt;
    } else {
      this.nxt = choices[Math.floor(Math.random() * choices.length)] ?? this.nxt;
    }
  }

  // ── Update ───────────────────────────────────────────────────────────────────
  update(dt: number, cfg: CarUpdateConfig): void {
    const { nodes, edgeCounts, edgeWeights, signalNodes } = this.graph;

    // ── Release from red light when signal turns green ───────────────────────
    if (this.waiting) {
      const isSignalNode = cfg.signals && signalNodes.has(this.nxt);
      if (isSignalNode) {
        const phase = signalNodes.get(this.nxt)!;
        if (!isSignalGreen(cfg.signalTime, phase)) { this.speedFactor = 0; return; }
      }
      this.waiting = false;
    }

    const a = nodes[this.cur];
    const b = nodes[this.nxt];
    if (!a || !b) { this.place(); return; }

    // ── Speed computation ────────────────────────────────────────────────────
    const roadWeight      = cfg.weightedRouting
      ? (edgeWeights.get(`${this.cur}-${this.nxt}`) ?? 1.0)
      : 1.0;
    const edgeCount       = cfg.congestion
      ? (edgeCounts.get(`${this.cur}-${this.nxt}`) ?? 0)
      : 0;
    const congestionFactor = 1 / (1 + 0.05 * edgeCount);

    this.speedFactor = Math.min(1, roadWeight * congestionFactor);

    const dist  = edgeMetres(a.lat, a.lng, b.lat, b.lng);
    const speed = 11 * cfg.speedMult * roadWeight * congestionFactor;
    this.t += (speed * dt) / (dist * 1_000);

    // ── Advance to next edge ─────────────────────────────────────────────────
    while (this.t >= 1) {
      // Check signal BEFORE crossing the junction
      if (cfg.signals && signalNodes.has(this.nxt)) {
        const phase = signalNodes.get(this.nxt)!;
        if (!isSignalGreen(cfg.signalTime, phase)) {
          this.t           = 0.97;
          this.waiting     = true;
          this.speedFactor = 0;
          return;
        }
      }

      this.t -= 1;
      this.leaveEdge(this.cur, this.nxt);
      this.prevNode = this.cur;
      this.cur      = this.nxt;
      this.chooseNext(cfg);
      this.enterEdge(this.cur, this.nxt);
    }
  }

  getLatLng(): { lat: number; lng: number } | null {
    const a = this.graph.nodes[this.cur];
    const b = this.graph.nodes[this.nxt];
    if (!a || !b) return null;
    return {
      lat: a.lat + (b.lat - a.lat) * this.t,
      lng: a.lng + (b.lng - a.lng) * this.t,
    };
  }

  clearTrail(): void { this.trail = []; }
}
