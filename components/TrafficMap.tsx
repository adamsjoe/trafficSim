'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Map as LeafletMap } from 'leaflet';
import type {
  CarUpdateConfig,
  LiveStats,
  PolylineData,
  RealismSettings,
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
import { formatSimTime, getPeriodName, getRushMultiplier, getSignalPhase, signalPhaseColor, speedToRgb } from '@/lib/rushHour';
import ControlPanel from './ControlPanel';
import InfoModal from './InfoModal';

const DEFAULT_CENTER: [number, number] = [55.864, -4.251];
const DEFAULT_ZOOM   = 15;
const SIM_START_SECS = 7 * 3600; // 07:00 AM

type AugmentedMap = LeafletMap & { _tsGraph?: RoadGraph };

let glBuf = new Float32Array(5_000 * 5);

export default function TrafficMap() {
  // ── Refs ──────────────────────────────────────────────────────────────────────
  const mapDivRef      = useRef<HTMLDivElement>(null);
  const mapRef         = useRef<AugmentedMap | null>(null);
  const initRef        = useRef(false);
  const glRendererRef  = useRef<WebGLRenderer | null>(null);
  const trailCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const trailCtxRef    = useRef<CanvasRenderingContext2D | null>(null);

  const carsRef         = useRef<Car[]>([]);
  const simRunningRef   = useRef(false);
  const animFrameRef    = useRef<number | null>(null);
  const lastTimeRef     = useRef(0);
  const fpsBufRef       = useRef(60);
  const polylineDataRef = useRef<PolylineData[]>([]);
  const hitPolylinesRef = useRef<import('leaflet').Polyline[]>([]);
  const simTimeRef      = useRef(SIM_START_SECS);  // rush hour clock — advances at timeScale
  const signalTimeRef   = useRef(0);               // signal clock  — always real seconds

  // Refs that mirror state for rAF loop access
  const paramsRef  = useRef<SimParams>({ carCount: 50, speedMult: 1, trailLength: 10, carSize: 8, glowRadius: 5, roadOpacity: 0.5 });
  const realismRef = useRef<RealismSettings>({ congestion: true, weightedRouting: true, signals: true, colorBySpeed: false, rushHour: false, timeScale: 60 });
  const closureModeRef = useRef(false);

  // ── State ─────────────────────────────────────────────────────────────────────
  const [locInput,    setLocInput]    = useState('Glasgow, Scotland');
  const [status,      setStatus]      = useState<StatusState>({ cls: '', msg: 'Enter a location and click Load Roads' });
  const [simStatus,   setSimStatus]   = useState<SimStatus>('idle');
  const [progress,    setProgress]    = useState(0);
  const [params,      setParams]      = useState<SimParams>(paramsRef.current);
  const [realism,     setRealism]     = useState<RealismSettings>(realismRef.current);
  const [roadTypes,   setRoadTypes]   = useState<RoadTypesMap>(DEFAULT_ROAD_TYPES);
  const [stats,       setStats]       = useState<LiveStats>({ cars: 0, fps: '—', nodes: '—', edges: '—', signals: '—', simTime: formatSimTime(SIM_START_SECS), period: getPeriodName(7), rushMult: 1 });
  const [graphReady,  setGraphReady]  = useState(false);
  const [showModal,   setShowModal]   = useState(false);
  const [closedCount, setClosedCount] = useState(0);
  const [closureMode, setClosureMode] = useState(false);

  useEffect(() => { paramsRef.current  = params;  }, [params]);
  useEffect(() => { realismRef.current = realism; }, [realism]);
  useEffect(() => { closureModeRef.current = closureMode; }, [closureMode]);

  // ── Map init ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!mapDivRef.current || initRef.current) return;
    initRef.current = true;

    import('leaflet').then((L) => {
      // Polyfill roundRect for browsers that don't support it yet
      if (!CanvasRenderingContext2D.prototype.roundRect) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (CanvasRenderingContext2D.prototype as any).roundRect = function(
          x: number, y: number, w: number, h: number, r: number
        ) {
          this.beginPath();
          this.moveTo(x + r, y);
          this.lineTo(x + w - r, y);
          this.quadraticCurveTo(x + w, y, x + w, y + r);
          this.lineTo(x + w, y + h - r);
          this.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
          this.lineTo(x + r, y + h);
          this.quadraticCurveTo(x, y + h, x, y + h - r);
          this.lineTo(x, y + r);
          this.quadraticCurveTo(x, y, x + r, y);
          this.closePath();
        };
      }
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

      // 2D trail canvas
      const tc = document.createElement('canvas');
      tc.style.cssText = 'position:absolute;top:0;left:0;pointer-events:none;z-index:600;';
      container.appendChild(tc);
      trailCanvasRef.current = tc;
      trailCtxRef.current    = tc.getContext('2d');

      // WebGL car canvas
      try { glRendererRef.current = createWebGLRenderer(container); } catch {}

      const resize = () => {
        const w = container.clientWidth, h = container.clientHeight;
        tc.width = w; tc.height = h;
        glRendererRef.current?.resize(w, h);
      };
      resize();
      map.on('resize', resize);
      map.on('movestart zoomstart', () => {
        trailCtxRef.current?.clearRect(0, 0, tc.width, tc.height);
        glRendererRef.current?.clear();
        carsRef.current.forEach((c) => c.clearTrail());
      });
      mapRef.current = map;
    });

    return () => { glRendererRef.current?.destroy(); mapRef.current?.remove(); mapRef.current = null; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Helpers ───────────────────────────────────────────────────────────────────
  const progressSet = useCallback((pct: number) => {
    setProgress(pct);
    if (pct >= 100) setTimeout(() => setProgress(0), 800);
  }, []);

  // ── Road closure ──────────────────────────────────────────────────────────────
  const toggleRoadClosure = useCallback((pd: PolylineData, graph: RoadGraph) => {
    pd.closed = !pd.closed;
    for (let i = 0; i < pd.nodeSeq.length - 1; i++) {
      const a = pd.nodeSeq[i], b = pd.nodeSeq[i + 1];
      if (pd.closed) { graph.closedEdges.add(`${a}-${b}`); graph.closedEdges.add(`${b}-${a}`); }
      else           { graph.closedEdges.delete(`${a}-${b}`); graph.closedEdges.delete(`${b}-${a}`); }
    }
    if (pd.closed) pd.polyline.setStyle({ color: '#ff2244', weight: pd.originalWeight + 1, opacity: 0.9, dashArray: '8 5' });
    else           pd.polyline.setStyle({ color: pd.originalColor, weight: pd.originalWeight, opacity: paramsRef.current.roadOpacity, dashArray: '' });
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
      setGraphReady(false); setSimStatus('idle');
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
    hitPolylinesRef.current.forEach((p)  => map.removeLayer(p));
    polylineDataRef.current = []; hitPolylinesRef.current = [];
    carsRef.current = [];
    setSimStatus('idle'); setGraphReady(false); setClosedCount(0); setClosureMode(false);
    setStatus({ cls: 'loading', msg: 'Querying Overpass API…' });
    progressSet(15);

    const enabledTypes = Object.entries(roadTypes).filter(([, c]) => c.enabled).map(([k]) => k);
    if (!enabledTypes.length) { setStatus({ cls: 'error', msg: 'Enable at least one road type' }); return; }

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
        const ht      = el.tags?.['highway'] ?? 'residential';
        const cfg     = roadTypes[ht] ?? roadTypes['residential'];
        if (!cfg) continue;
        const nodeSeq = el.nodes.filter((id) => graph.nodes[id]);
        const pts     = nodeSeq.map((id) => [graph.nodes[id]!.lat, graph.nodes[id]!.lng] as [number, number]);
        if (pts.length < 2) continue;

        const visual = L.polyline(pts, { color: cfg.color, weight: cfg.weight, opacity: paramsRef.current.roadOpacity, interactive: false }).addTo(map);
        const pd: PolylineData = { polyline: visual, nodeSeq, originalColor: cfg.color, originalWeight: cfg.weight, closed: false };
        polylineDataRef.current.push(pd);

        const hit = L.polyline(pts, { color: '#fff', weight: cfg.weight + 8, opacity: 0, interactive: true }).addTo(map);
        hit.on('mouseover', () => { if (closureModeRef.current && !pd.closed) visual.setStyle({ color: '#ffcc00', opacity: 1, weight: pd.originalWeight + 1 }); });
        hit.on('mouseout',  () => { if (!pd.closed) visual.setStyle({ color: pd.originalColor, opacity: paramsRef.current.roadOpacity, weight: pd.originalWeight }); });
        hit.on('click', (e) => { L.DomEvent.stopPropagation(e); if (closureModeRef.current) toggleRoadClosure(pd, graph); });
        hitPolylinesRef.current.push(hit);
      }

      progressSet(100);
      const nc = graph.nodeIds.length, ec = countEdges(graph), sc = graph.signalNodes.size;
      setStats((s) => ({ ...s, nodes: fmtN(nc), edges: fmtN(ec), signals: sc > 0 ? fmtN(sc) : '0' }));

      if (nc < 3) { setStatus({ cls: 'error', msg: 'Too few nodes — zoom out or enable more road types' }); return; }

      simTimeRef.current = SIM_START_SECS;
      map._tsGraph = graph;
      setGraphReady(true);
      setStatus({ cls: 'active', msg: `${fmtN(nc)} nodes · ${fmtN(ec)} edges · ${sc} signals ready` });
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
  const syncCarCount = useCallback((graph: RoadGraph, target: number) => {
    while (carsRef.current.length < target) carsRef.current.push(new Car(graph));
    while (carsRef.current.length > target) { carsRef.current.pop()?.destroy(); }
  }, []);

  const startSim = useCallback(() => {
    if (!graphReady) { setShowModal(true); return; }
    const map = mapRef.current;
    if (!map?._tsGraph) return;
    const graph = map._tsGraph;

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

      const p   = paramsRef.current;
      const r   = realismRef.current;
      const mi  = mapRef.current!;
      const glr = glRendererRef.current;
      const tc  = trailCtxRef.current;
      const tcv = trailCanvasRef.current;

      // ── Sim clock — rushHour time scale ───────────────────────────────────
      simTimeRef.current   += (dt / 1000) * r.timeScale;
      if (simTimeRef.current >= 86400) simTimeRef.current -= 86400;

      // ── Signal clock — always real seconds ────────────────────────────────
      signalTimeRef.current += dt / 1000;

      // ── Rush hour car count scaling ────────────────────────────────────────
      let effectiveCarCount = p.carCount;
      let rushMult = getRushMultiplier(simTimeRef.current / 3600);

      if (r.rushHour) {
        effectiveCarCount = Math.max(1, Math.min(p.carCount, Math.round(p.carCount * rushMult)));
      } else {
        rushMult = 1;
      }

      syncCarCount(graph, effectiveCarCount);

      // ── Car update config ──────────────────────────────────────────────────
      const cfg: CarUpdateConfig = {
        speedMult:       p.speedMult,
        simTime:         simTimeRef.current,
        signalTime:      signalTimeRef.current,
        congestion:      r.congestion,
        weightedRouting: r.weightedRouting,
        signals:         r.signals,
      };

      const cars = carsRef.current;
      cars.forEach((car) => car.update(dt, cfg));

      // ── Grow buffer if needed ──────────────────────────────────────────────
      if (glBuf.length < cars.length * 5) glBuf = new Float32Array(cars.length * 5 * 2);

      // ── Trails ────────────────────────────────────────────────────────────
      const doTrails = p.trailLength > 0 && cars.length <= TRAIL_MAX_CARS;
      if (tc && tcv) tc.clearRect(0, 0, tcv.width, tcv.height);

      // ── Draw UK signal boxes on trail canvas ───────────────────────────────
      if (tc && r.signals && graph.signalNodes.size > 0 && mi.getZoom() >= 14) {
        graph.signalNodes.forEach((phaseOffset, nodeId) => {
          const node = graph.nodes[nodeId];
          if (!node) return;

          const pt    = mi.latLngToContainerPoint([node.lat, node.lng]);
          const phase = getSignalPhase(signalTimeRef.current, phaseOffset);
          const color = signalPhaseColor(phase);

          // Black housing
          const bw = 7, bh = 18, br = 2;
          const bx = pt.x - bw / 2, by = pt.y - bh / 2;
          tc.fillStyle = 'rgba(0,0,0,0.75)';
          tc.beginPath();
          tc.roundRect(bx, by, bw, bh, br);
          tc.fill();

          // Top pip — red (lit on red and red-amber)
          const litRed   = phase === 'red' || phase === 'red-amber';
          tc.beginPath();
          tc.arc(pt.x, by + 4, 2.2, 0, Math.PI * 2);
          tc.fillStyle = litRed ? '#ff2244' : '#330008';
          tc.fill();

          // Middle pip — amber (lit on red-amber and amber)
          const litAmber = phase === 'red-amber' || phase === 'amber';
          tc.beginPath();
          tc.arc(pt.x, pt.y, 2.2, 0, Math.PI * 2);
          tc.fillStyle = litAmber ? '#ffaa00' : '#332200';
          tc.fill();

          // Bottom pip — green (lit on green)
          tc.beginPath();
          tc.arc(pt.x, by + bh - 4, 2.2, 0, Math.PI * 2);
          tc.fillStyle = phase === 'green' ? '#00e840' : '#003310';
          tc.fill();

          // Outer glow on active colour
          tc.beginPath();
          tc.arc(pt.x, pt.y, 7, 0, Math.PI * 2);
          tc.fillStyle = color + '22';
          tc.fill();
        });
      }

      // ── Build GPU buffer + trails ──────────────────────────────────────────
      let idx = 0;
      cars.forEach((car) => {
        const pos = car.getLatLng();
        if (!pos) return;

        const pt = mi.latLngToContainerPoint([pos.lat, pos.lng]);
        const [cr, cg, cb] = r.colorBySpeed ? speedToRgb(car.speedFactor) : hexToRgb(car.color);

        glBuf[idx]     = pt.x;
        glBuf[idx + 1] = pt.y;
        glBuf[idx + 2] = cr;
        glBuf[idx + 3] = cg;
        glBuf[idx + 4] = cb;
        idx += 5;

        if (doTrails && tc) {
          car.trail.push({ x: pt.x, y: pt.y });
          if (car.trail.length > p.trailLength) car.trail.shift();
          const trailHead = car.trail[0];
          if (car.trail.length > 1 && trailHead) {
            tc.beginPath();
            tc.moveTo(trailHead.x, trailHead.y);
            for (let i = 1; i < car.trail.length; i++) { const tp = car.trail[i]; if (tp) tc.lineTo(tp.x, tp.y); }
            tc.strokeStyle = car.color + '55';
            tc.lineWidth   = Math.max(1, p.carSize - 1);
            tc.lineCap = 'round'; tc.lineJoin = 'round';
            tc.stroke();
          }
        } else {
          car.trail = [];
        }
      });

      if (glr) glr.draw(glBuf, idx / 5, p.carSize, p.glowRadius);

      // ── Stats update (every ~10 frames) ───────────────────────────────────
      if (Math.round(now / 160) !== Math.round((now - dt) / 160)) {
        const simHour = simTimeRef.current / 3600;
        setStats({
          cars:     cars.length,
          fps:      String(Math.round(fpsBufRef.current)),
          nodes:    fmtN(graph.nodeIds.length),
          edges:    fmtN(countEdges(graph)),
          signals:  fmtN(graph.signalNodes.size),
          simTime:  formatSimTime(simTimeRef.current),
          period:   getPeriodName(simHour),
          rushMult: r.rushHour ? rushMult : 1,
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

  // ── Opacity live update ───────────────────────────────────────────────────────
  useEffect(() => {
    polylineDataRef.current.forEach((pd) => { if (!pd.closed) pd.polyline.setStyle({ opacity: params.roadOpacity }); });
  }, [params.roadOpacity]);

  // ── Cursor ────────────────────────────────────────────────────────────────────
  useEffect(() => {
    const c = mapRef.current?.getContainer();
    if (c) c.style.cursor = closureMode ? 'crosshair' : '';
  }, [closureMode]);

  const handleParamChange = useCallback((key: keyof SimParams, value: number) => {
    setParams((prev) => ({ ...prev, [key]: value }));
  }, []);

  const handleRealismChange = useCallback((key: keyof RealismSettings, value: boolean | number) => {
    setRealism((prev) => ({ ...prev, [key]: value }));
  }, []);

  const handleRoadTypeToggle = useCallback((key: string, enabled: boolean) => {
    setRoadTypes((prev) => {
      const existing = prev[key];
      if (!existing) return prev;
      return { ...prev, [key]: { ...existing, enabled } };
    });
  }, []);

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <div className="layout">
      {showModal && <InfoModal onClose={() => setShowModal(false)} />}

      <header className="topbar">
        <span className="brand">Traffic<span className="brand-dim">Sim</span></span>
        <div className="topbar-sep" />
        <div className="search-wrap">
          <input className="loc-input" type="text" value={locInput}
            onChange={(e) => setLocInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            placeholder="City, street, or area…"
          />
          <button className="btn btn-locate" onClick={handleSearch}>Locate</button>
          <button className="btn btn-fetch"  onClick={handleFetchRoads}>Load Roads</button>
        </div>

        {graphReady && (
          <div className="closure-bar">
            <button className={`btn btn-closure${closureMode ? ' active' : ''}`}
              onClick={() => setClosureMode((m) => !m)}>
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
            <div className="closure-hint" style={{ bottom: closureMode ? 66 : 30, borderColor: '#2a3d50', color: '#4a6a80' }}>
              Trails disabled above {TRAIL_MAX_CARS} cars
            </div>
          )}
        </div>

        <ControlPanel
          status={status} simStatus={simStatus} stats={stats}
          params={params} realism={realism} roadTypes={roadTypes}
          progress={progress} closedCount={closedCount}
          onParamChange={handleParamChange}
          onRealismChange={handleRealismChange}
          onRoadTypeToggle={handleRoadTypeToggle}
          onStart={startSim} onStop={stopSim}
        />
      </div>
    </div>
  );
}
