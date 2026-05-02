'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Map as LeafletMap } from 'leaflet';
import type {
  LiveStats,
  PolylineData,
  RoadGraph,
  RoadTypesMap,
  SimParams,
  SimStatus,
  StatusState,
} from '@/lib/types';
import { TRAIL_MAX_CARS } from '@/lib/types';
import { Car } from '@/lib/car';
import { DEFAULT_ROAD_TYPES } from '@/lib/roadTypes';
import { buildGraph, countEdges, fetchRoadData, geocodeLocation } from '@/lib/overpass';
import { fmtN } from '@/lib/utils';
import { createWebGLRenderer, hexToRgb } from '@/lib/webglRenderer';
import type { WebGLRenderer } from '@/lib/webglRenderer';
import ControlPanel from './ControlPanel';
import InfoModal from './InfoModal';

const DEFAULT_CENTER: [number, number] = [55.864, -4.251];
const DEFAULT_ZOOM = 15;

type AugmentedMap = LeafletMap & { _tsGraph?: RoadGraph };

// Pre-allocated typed arrays — grown as needed, never shrunk
let glBuf    = new Float32Array(5000 * 5);  // [x, y, r, g, b] per car
let trailBuf = new Float32Array(400  * 5);  // same layout but smaller

export default function TrafficMap() {
  // ── Refs ─────────────────────────────────────────────────────────────────────
  const mapDivRef    = useRef<HTMLDivElement>(null);
  const mapRef       = useRef<AugmentedMap | null>(null);
  const initRef      = useRef(false);

  // WebGL renderer for car dots
  const glRendererRef   = useRef<WebGLRenderer | null>(null);
  // 2D canvas — trails only (skipped above TRAIL_MAX_CARS)
  const trailCanvasRef  = useRef<HTMLCanvasElement | null>(null);
  const trailCtxRef     = useRef<CanvasRenderingContext2D | null>(null);

  const carsRef         = useRef<Car[]>([]);
  const simRunningRef   = useRef(false);
  const animFrameRef    = useRef<number | null>(null);
  const lastTimeRef     = useRef(0);
  const fpsBufRef       = useRef(60);
  const polylineDataRef = useRef<PolylineData[]>([]);
  const hitPolylinesRef = useRef<import('leaflet').Polyline[]>([]);

  const paramsRef = useRef<SimParams>({
    carCount:    50,
    speedMult:   1.0,
    trailLength: 10,
    carSize:     3,
    glowRadius:  5,
    roadOpacity: 0.5,
  });

  // ── State ─────────────────────────────────────────────────────────────────────
  const [locInput,    setLocInput]    = useState('Glasgow, Scotland');
  const [status,      setStatus]      = useState<StatusState>({ cls: '', msg: 'Enter a location and click Load Roads' });
  const [simStatus,   setSimStatus]   = useState<SimStatus>('idle');
  const [progress,    setProgress]    = useState(0);
  const [params,      setParams]      = useState<SimParams>(paramsRef.current);
  const [roadTypes,   setRoadTypes]   = useState<RoadTypesMap>(DEFAULT_ROAD_TYPES);
  const [stats,       setStats]       = useState<LiveStats>({ cars: 0, fps: '—', nodes: '—', edges: '—' });
  const [graphReady,  setGraphReady]  = useState(false);
  const [showModal,   setShowModal]   = useState(false);
  const [closedCount, setClosedCount] = useState(0);
  const [closureMode, setClosureMode] = useState(false);
  const closureModeRef = useRef(false);

  useEffect(() => { paramsRef.current = params; }, [params]);
  useEffect(() => { closureModeRef.current = closureMode; }, [closureMode]);

  // ── Map init ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!mapDivRef.current || initRef.current) return;
    initRef.current = true;

    import('leaflet').then((L) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (L.Icon.Default.prototype as any)._getIconUrl;
      L.Icon.Default.mergeOptions({
        iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
        iconUrl:       'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
        shadowUrl:     'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
      });

      const map = L.map(mapDivRef.current!, { zoomControl: true }).setView(DEFAULT_CENTER, DEFAULT_ZOOM);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© <a href="https://openstreetmap.org">OpenStreetMap</a> contributors',
        maxZoom: 19,
      }).addTo(map);

      const container = map.getContainer();

      // ── Trail canvas (2D) ──────────────────────────────────────────────────
      const trailCanvas = document.createElement('canvas');
      trailCanvas.style.cssText = 'position:absolute;top:0;left:0;pointer-events:none;z-index:600;';
      container.appendChild(trailCanvas);
      trailCanvasRef.current = trailCanvas;
      trailCtxRef.current    = trailCanvas.getContext('2d');

      // ── WebGL canvas ───────────────────────────────────────────────────────
      try {
        const gl = createWebGLRenderer(container);
        glRendererRef.current = gl;
      } catch (e) {
        console.warn('WebGL unavailable, falling back to 2D canvas rendering', e);
      }

      const resize = () => {
        const w = container.clientWidth;
        const h = container.clientHeight;
        trailCanvas.width  = w;
        trailCanvas.height = h;
        glRendererRef.current?.resize(w, h);
      };
      resize();
      map.on('resize', resize);

      map.on('movestart zoomstart', () => {
        trailCtxRef.current?.clearRect(0, 0, trailCanvasRef.current!.width, trailCanvasRef.current!.height);
        glRendererRef.current?.clear();
        carsRef.current.forEach((c) => c.clearTrail());
      });

      mapRef.current = map;
    });

    return () => {
      glRendererRef.current?.destroy();
      glRendererRef.current = null;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Helpers ──────────────────────────────────────────────────────────────────
  const progressSet = useCallback((pct: number) => {
    setProgress(pct);
    if (pct >= 100) setTimeout(() => setProgress(0), 800);
  }, []);

  // ── Road closure ─────────────────────────────────────────────────────────────
  const toggleRoadClosure = useCallback((pd: PolylineData, graph: RoadGraph) => {
    pd.closed = !pd.closed;
    for (let i = 0; i < pd.nodeSeq.length - 1; i++) {
      const a = pd.nodeSeq[i], b = pd.nodeSeq[i + 1];
      if (pd.closed) { graph.closedEdges.add(`${a}-${b}`); graph.closedEdges.add(`${b}-${a}`); }
      else           { graph.closedEdges.delete(`${a}-${b}`); graph.closedEdges.delete(`${b}-${a}`); }
    }
    if (pd.closed) {
      pd.polyline.setStyle({ color: '#ff2244', weight: pd.originalWeight + 1, opacity: 0.9, dashArray: '8 5' });
    } else {
      pd.polyline.setStyle({ color: pd.originalColor, weight: pd.originalWeight, opacity: paramsRef.current.roadOpacity, dashArray: '' });
    }
    setClosedCount(polylineDataRef.current.filter((p) => p.closed).length);
  }, []);

  // ── Search ────────────────────────────────────────────────────────────────────
  const handleSearch = useCallback(async () => {
    if (!mapRef.current || !locInput.trim()) return;
    setStatus({ cls: 'loading', msg: 'Locating…' });
    try {
      const { lat, lng, displayName } = await geocodeLocation(locInput);
      mapRef.current.setView([lat, lng], DEFAULT_ZOOM);
      setStatus({ cls: '', msg: `Viewing: ${displayName}` });
      setGraphReady(false);
      setSimStatus('idle');
    } catch (err) {
      setStatus({ cls: 'error', msg: err instanceof Error ? err.message : 'Search failed' });
    }
  }, [locInput]);

  // ── Fetch roads ───────────────────────────────────────────────────────────────
  const handleFetchRoads = useCallback(async () => {
    const map = mapRef.current;
    if (!map) return;

    simRunningRef.current = false;
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    glRendererRef.current?.clear();
    trailCtxRef.current?.clearRect(0, 0, trailCanvasRef.current!.width, trailCanvasRef.current!.height);

    polylineDataRef.current.forEach((pd) => map.removeLayer(pd.polyline));
    hitPolylinesRef.current.forEach((p) => map.removeLayer(p));
    polylineDataRef.current = [];
    hitPolylinesRef.current = [];
    carsRef.current = [];
    setSimStatus('idle');
    setGraphReady(false);
    setClosedCount(0);
    setClosureMode(false);
    setStatus({ cls: 'loading', msg: 'Querying Overpass API…' });
    progressSet(15);

    const enabledTypes = Object.entries(roadTypes)
      .filter(([, cfg]) => cfg.enabled).map(([k]) => k);

    if (!enabledTypes.length) {
      setStatus({ cls: 'error', msg: 'Enable at least one road type' });
      return;
    }

    try {
      const b    = map.getBounds();
      const bbox: [number, number, number, number] = [b.getSouth(), b.getWest(), b.getNorth(), b.getEast()];
      const data = await fetchRoadData(bbox, enabledTypes);
      progressSet(70);

      const graph = buildGraph(data);
      progressSet(85);

      const L = await import('leaflet');
      for (const el of data.elements) {
        if (el.type !== 'way' || !el.nodes) continue;
        const ht      = el.tags?.highway ?? 'residential';
        const cfg     = roadTypes[ht] ?? roadTypes.residential;
        const nodeSeq = el.nodes.filter((id) => graph.nodes[id]);
        const pts     = nodeSeq.map((id) => [graph.nodes[id].lat, graph.nodes[id].lng] as [number, number]);
        if (pts.length < 2) continue;

        const visual = L.polyline(pts, { color: cfg.color, weight: cfg.weight, opacity: paramsRef.current.roadOpacity, interactive: false }).addTo(map);
        const pd: PolylineData = { polyline: visual, nodeSeq, originalColor: cfg.color, originalWeight: cfg.weight, closed: false };
        polylineDataRef.current.push(pd);

        const hit = L.polyline(pts, { color: cfg.color, weight: cfg.weight + 8, opacity: 0, interactive: true }).addTo(map);
        hit.on('mouseover', () => { if (closureModeRef.current && !pd.closed) visual.setStyle({ color: '#ffcc00', opacity: 1, weight: pd.originalWeight + 1 }); });
        hit.on('mouseout',  () => { if (!pd.closed) visual.setStyle({ color: pd.originalColor, opacity: paramsRef.current.roadOpacity, weight: pd.originalWeight }); });
        hit.on('click',     (e) => { L.DomEvent.stopPropagation(e); if (closureModeRef.current) toggleRoadClosure(pd, graph); });
        hitPolylinesRef.current.push(hit);
      }

      progressSet(100);
      const nc = graph.nodeIds.length;
      const ec = countEdges(graph);
      setStats((s) => ({ ...s, nodes: fmtN(nc), edges: fmtN(ec) }));

      if (nc < 3) { setStatus({ cls: 'error', msg: 'Too few nodes — zoom out or enable more road types' }); return; }

      carsRef.current = [];
      map._tsGraph = graph;
      setGraphReady(true);
      setStatus({ cls: 'active', msg: `${fmtN(nc)} nodes · ${fmtN(ec)} edges ready` });
    } catch (err) {
      setStatus({ cls: 'error', msg: err instanceof Error ? err.message : 'Fetch failed' });
      progressSet(0);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roadTypes, progressSet, toggleRoadClosure]);

  const handleReopenAll = useCallback(() => {
    const graph = mapRef.current?._tsGraph;
    if (!graph) return;
    [...polylineDataRef.current].forEach((pd) => { if (pd.closed) toggleRoadClosure(pd, graph); });
  }, [toggleRoadClosure]);

  // ── Simulation ────────────────────────────────────────────────────────────────
  const syncCarCount = useCallback((graph: RoadGraph) => {
    const target = paramsRef.current.carCount;
    while (carsRef.current.length < target) carsRef.current.push(new Car(graph));
    while (carsRef.current.length > target) carsRef.current.pop();
  }, []);

  const startSim = useCallback(() => {
    if (!graphReady) { setShowModal(true); return; }
    const map = mapRef.current;
    if (!map?._tsGraph) return;
    const graph = map._tsGraph;

    syncCarCount(graph);
    simRunningRef.current = true;
    lastTimeRef.current   = performance.now();
    fpsBufRef.current     = 60;
    setSimStatus('running');
    setStatus({ cls: 'active', msg: 'Simulation running' });

    const tick = (now: number) => {
      if (!simRunningRef.current) return;

      const dt = Math.min(now - lastTimeRef.current, 120);
      lastTimeRef.current = now;
      fpsBufRef.current   = fpsBufRef.current * 0.88 + (1000 / Math.max(dt, 1)) * 0.12;

      const p         = paramsRef.current;
      const cars      = carsRef.current;
      const mi        = mapRef.current!;
      const glr       = glRendererRef.current;
      const trailCtx  = trailCtxRef.current;
      const trailCanvas = trailCanvasRef.current;
      const doTrails  = p.trailLength > 0 && cars.length <= TRAIL_MAX_CARS;

      syncCarCount(graph);

      // ── Update positions ─────────────────────────────────────────────────────
      cars.forEach((car) => car.update(dt, p.speedMult));

      // ── Grow GPU buffer if needed ────────────────────────────────────────────
      if (glBuf.length < cars.length * 5) {
        glBuf = new Float32Array(cars.length * 5 * 2);
      }
      if (trailBuf.length < cars.length * 5) {
        trailBuf = new Float32Array(cars.length * 5 * 2);
      }

      // ── Build position buffer + draw trails ──────────────────────────────────
      if (doTrails && trailCtx && trailCanvas) {
        trailCtx.clearRect(0, 0, trailCanvas.width, trailCanvas.height);
      } else if (trailCtx && trailCanvas && !doTrails) {
        trailCtx.clearRect(0, 0, trailCanvas.width, trailCanvas.height);
      }

      let idx = 0;
      cars.forEach((car) => {
        const pos = car.getLatLng();
        if (!pos) return;

        const pt = mi.latLngToContainerPoint([pos.lat, pos.lng]);
        const [r, g, b] = hexToRgb(car.color);

        glBuf[idx    ] = pt.x;
        glBuf[idx + 1] = pt.y;
        glBuf[idx + 2] = r;
        glBuf[idx + 3] = g;
        glBuf[idx + 4] = b;
        idx += 5;

        // Trails via 2D canvas (only when car count is low enough)
        if (doTrails && trailCtx) {
          car.trail.push({ x: pt.x, y: pt.y });
          if (car.trail.length > p.trailLength) car.trail.shift();

          if (car.trail.length > 1) {
            trailCtx.beginPath();
            trailCtx.moveTo(car.trail[0].x, car.trail[0].y);
            for (let i = 1; i < car.trail.length; i++) trailCtx.lineTo(car.trail[i].x, car.trail[i].y);
            trailCtx.strokeStyle = car.color + '55';
            trailCtx.lineWidth   = Math.max(1, p.carSize - 1);
            trailCtx.lineCap = 'round'; trailCtx.lineJoin = 'round';
            trailCtx.stroke();
          }
        } else {
          car.trail = [];
        }
      });

      const drawCount = idx / 5;

      // ── WebGL draw ───────────────────────────────────────────────────────────
      if (glr) {
        glr.draw(glBuf, drawCount, p.carSize, p.glowRadius);
      }

      // ── Stats ────────────────────────────────────────────────────────────────
      if (Math.round(now / 160) !== Math.round((now - dt) / 160)) {
        setStats({
          cars:  cars.length,
          fps:   String(Math.round(fpsBufRef.current)),
          nodes: fmtN(graph.nodeIds.length),
          edges: fmtN(countEdges(graph)),
        });
      }

      animFrameRef.current = requestAnimationFrame(tick);
    };

    animFrameRef.current = requestAnimationFrame(tick);
  }, [graphReady, syncCarCount]);

  const stopSim = useCallback(() => {
    simRunningRef.current = false;
    if (animFrameRef.current) { cancelAnimationFrame(animFrameRef.current); animFrameRef.current = null; }
    glRendererRef.current?.clear();
    if (trailCtxRef.current && trailCanvasRef.current) {
      trailCtxRef.current.clearRect(0, 0, trailCanvasRef.current.width, trailCanvasRef.current.height);
    }
    setSimStatus('stopped');
    setStats((s) => ({ ...s, cars: 0, fps: '—' }));
    setStatus({ cls: '', msg: 'Stopped — press Start to resume' });
  }, []);

  useEffect(() => {
    polylineDataRef.current.forEach((pd) => {
      if (!pd.closed) pd.polyline.setStyle({ opacity: params.roadOpacity });
    });
  }, [params.roadOpacity]);

  useEffect(() => {
    const c = mapRef.current?.getContainer();
    if (c) c.style.cursor = closureMode ? 'crosshair' : '';
  }, [closureMode]);

  const handleParamChange = useCallback((key: keyof SimParams, value: number) => {
    setParams((prev) => ({ ...prev, [key]: value }));
  }, []);

  const handleRoadTypeToggle = useCallback((key: string, enabled: boolean) => {
    setRoadTypes((prev) => ({ ...prev, [key]: { ...prev[key], enabled } }));
  }, []);

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <div className="layout">
      {showModal && <InfoModal onClose={() => setShowModal(false)} />}

      <header className="topbar">
        <span className="brand">Traffic<span className="brand-dim">Sim</span></span>
        <div className="topbar-sep" />
        <div className="search-wrap">
          <input
            className="loc-input" type="text"
            value={locInput}
            onChange={(e) => setLocInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            placeholder="City, street, or area…"
          />
          <button className="btn btn-locate" onClick={handleSearch}>Locate</button>
          <button className="btn btn-fetch"  onClick={handleFetchRoads}>Load Roads</button>
        </div>

        {graphReady && (
          <div className="closure-bar">
            <button
              className={`btn btn-closure${closureMode ? ' active' : ''}`}
              onClick={() => setClosureMode((m) => !m)}
            >
              {closureMode ? '✕ Exit Closure Mode' : '🚧 Close Roads'}
            </button>
            {closedCount > 0 && (
              <button className="btn btn-reopen" onClick={handleReopenAll}>
                Reopen All ({closedCount})
              </button>
            )}
          </div>
        )}
      </header>

      <div className="main">
        <div className="map-wrap">
          <div ref={mapDivRef} className="map-div" />
          {closureMode && (
            <div className="closure-hint">
              Click any road to close it &nbsp;·&nbsp; click again to reopen
            </div>
          )}
          {params.carCount > TRAIL_MAX_CARS && params.trailLength > 0 && simStatus === 'running' && (
            <div className="closure-hint" style={{ bottom: closureMode ? 70 : 30, borderColor: '#3d5068', color: '#5a7a9a' }}>
              Trails disabled above {TRAIL_MAX_CARS} cars
            </div>
          )}
        </div>

        <ControlPanel
          status={status}
          simStatus={simStatus}
          stats={stats}
          params={params}
          roadTypes={roadTypes}
          progress={progress}
          closedCount={closedCount}
          onParamChange={handleParamChange}
          onRoadTypeToggle={handleRoadTypeToggle}
          onStart={startSim}
          onStop={stopSim}
        />
      </div>
    </div>
  );
}
