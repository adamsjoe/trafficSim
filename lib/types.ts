export interface LatLng {
  lat: number;
  lng: number;
}

export interface RoadGraph {
  nodes: Record<number, LatLng>;
  edges: Record<number, number[]>;
  nodeIds: number[];
  /** Edges blocked by user closure */
  closedEdges: Set<string>;
  /** Live car count per directed edge key "a-b" */
  edgeCounts: Map<string, number>;
  /** Speed multiplier per directed edge, derived from highway class */
  edgeWeights: Map<string, number>;
  /** Signal node id → phase offset in seconds (0–89) */
  signalNodes: Map<number, number>;
}

export interface SimParams {
  carCount: number;
  speedMult: number;
  trailLength: number;
  carSize: number;
  glowRadius: number;
  roadOpacity: number;
}

export interface RealismSettings {
  congestion:      boolean;
  weightedRouting: boolean;
  signals:         boolean;
  colorBySpeed:    boolean;
  rushHour:        boolean;
  timeScale:       number;   // sim seconds per real second (1–300)
}

export interface CarUpdateConfig {
  speedMult:       number;
  simTime:         number;   // seconds from midnight
  congestion:      boolean;
  weightedRouting: boolean;
  signals:         boolean;
}

export interface RoadTypeConfig {
  label:   string;
  color:   string;
  weight:  number;
  speed:   number;   // base speed multiplier for this road class
  enabled: boolean;
}

export type RoadTypesMap = Record<string, RoadTypeConfig>;

export type SimStatus = 'idle' | 'running' | 'stopped';

export interface StatusState {
  cls: '' | 'active' | 'loading' | 'error';
  msg: string;
}

export interface LiveStats {
  cars:     number;
  fps:      string;
  nodes:    string;
  edges:    string;
  signals:  string;
  simTime:  string;
  period:   string;
  rushMult: number;
}

export interface TrailPoint {
  x: number;
  y: number;
}

export interface PolylineData {
  polyline:       import('leaflet').Polyline;
  nodeSeq:        number[];
  originalColor:  string;
  originalWeight: number;
  closed:         boolean;
}

// Raw OSM types
export interface OSMElement {
  type:  'node' | 'way' | 'relation';
  id:    number;
  lat?:  number;
  lon?:  number;
  nodes?: number[];
  tags?: Record<string, string>;
}

export interface OverpassResponse {
  elements: OSMElement[];
}

/** Trails auto-disable above this car count */
export const TRAIL_MAX_CARS = 400;
