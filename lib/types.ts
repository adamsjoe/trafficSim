export interface LatLng {
  lat: number;
  lng: number;
}

export interface RoadGraph {
  nodes: Record<number, LatLng>;
  edges: Record<number, number[]>;
  nodeIds: number[];
  /** Set of "nodeA-nodeB" pairs that are currently closed to traffic */
  closedEdges: Set<string>;
}

export interface PolylineData {
  polyline: import('leaflet').Polyline;
  nodeSeq: number[];
  originalColor: string;
  originalWeight: number;
  closed: boolean;
}

export interface SimParams {
  carCount: number;
  speedMult: number;
  trailLength: number;
  carSize: number;
  glowRadius: number;
  roadOpacity: number;
}

/** Trails are disabled above this car count to maintain framerate */
export const TRAIL_MAX_CARS = 400;

export interface RoadTypeConfig {
  label: string;
  color: string;
  weight: number;
  enabled: boolean;
}

export type RoadTypesMap = Record<string, RoadTypeConfig>;

export type SimStatus = 'idle' | 'running' | 'stopped';

export interface StatusState {
  cls: '' | 'active' | 'loading' | 'error';
  msg: string;
}

export interface LiveStats {
  cars: number;
  fps: string;
  nodes: string;
  edges: string;
}

export interface TrailPoint {
  x: number;
  y: number;
}

// Raw OSM element types
export interface OSMElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  nodes?: number[];
  tags?: Record<string, string>;
}

export interface OverpassResponse {
  elements: OSMElement[];
}
