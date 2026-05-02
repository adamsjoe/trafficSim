'use client';

import type { SimParams, RoadTypesMap, LiveStats, StatusState, SimStatus } from '@/lib/types';

// ── Sub-components ────────────────────────────────────────────────────────────

interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
}

function Slider({ label, value, min, max, format, onChange }: SliderProps) {
  return (
    <div className="slider-item">
      <div className="slider-header">
        <span className="slider-name">{label}</span>
        <span className="slider-val">{format(value)}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
}

interface StatBoxProps {
  label: string;
  value: string | number;
  accent?: 'cyan' | 'green' | 'amber';
}

function StatBox({ label, value, accent = 'cyan' }: StatBoxProps) {
  return (
    <div className="stat-box">
      <div className="stat-l">{label}</div>
      <div className={`stat-v stat-${accent}`}>{value}</div>
    </div>
  );
}

// ── Main Panel ────────────────────────────────────────────────────────────────

interface ControlPanelProps {
  status: StatusState;
  simStatus: SimStatus;
  stats: LiveStats;
  params: SimParams;
  roadTypes: RoadTypesMap;
  progress: number;
  closedCount: number;
  onParamChange: (key: keyof SimParams, value: number) => void;
  onRoadTypeToggle: (key: string, enabled: boolean) => void;
  onStart: () => void;
  onStop: () => void;
}

export default function ControlPanel({
  status,
  simStatus,
  stats,
  params,
  roadTypes,
  progress,
  closedCount,
  onParamChange,
  onRoadTypeToggle,
  onStart,
  onStop,
}: ControlPanelProps) {
  return (
    <aside className="panel">
      <div className="panel-scroll">

        {/* Sim controls */}
        <div className="sim-btns">
          <button
            className="btn btn-start"
            onClick={onStart}
            disabled={simStatus === 'running'}
          >
            ▶ Start
          </button>
          <button
            className="btn btn-stop"
            onClick={onStop}
            disabled={simStatus !== 'running'}
          >
            ■ Stop
          </button>
        </div>

        {/* Parameters */}
        <section className="panel-section">
          <div className="sec-label">Parameters</div>
          <Slider
            label={`Cars${params.carCount > 400 ? ' (trails off)' : ''}`}
            value={params.carCount}
            min={1} max={100000}
            format={(v) => v >= 1000 ? (v/1000).toFixed(1)+'k' : String(v)}
            onChange={(v) => onParamChange('carCount', v)}
          />
          <Slider
            label="Speed"
            value={params.speedMult * 5}
            min={1} max={30}
            format={(v) => (v / 5).toFixed(1) + '×'}
            onChange={(v) => onParamChange('speedMult', v / 5)}
          />
          <Slider
            label="Trail Length"
            value={params.trailLength}
            min={0} max={40}
            format={(v) => String(v)}
            onChange={(v) => onParamChange('trailLength', v)}
          />
          <Slider
            label="Car Size"
            value={params.carSize}
            min={1} max={8}
            format={(v) => v + 'px'}
            onChange={(v) => onParamChange('carSize', v)}
          />
        </section>

        {/* Live Stats */}
        <section className="panel-section">
          <div className="sec-label">Live Stats</div>
          <div className="stats-grid">
            <StatBox label="Active Cars" value={stats.cars} accent="green" />
            <StatBox label="FPS"         value={stats.fps} />
            <StatBox label="Road Nodes"  value={stats.nodes} />
            <StatBox label="Road Edges"  value={stats.edges} />
            <StatBox label="Closed Roads" value={closedCount > 0 ? closedCount : '—'} accent={closedCount > 0 ? 'amber' : 'cyan'} />
          </div>
          <div className="progress-wrap">
            <div className="progress-fill" style={{ width: `${progress}%` }} />
          </div>
        </section>

        {/* Road Types */}
        <section className="panel-section">
          <div className="sec-label">Roads to Load</div>
          <p style={{ fontSize: '10px', color: '#5a7a9a', marginBottom: '10px', lineHeight: 1.5 }}>
            Toggle which OSM road classes are fetched and drawn. Re-click <strong style={{ color: '#7a9bbf' }}>Load Roads</strong> to apply changes.
          </p>
          <div className="road-type-list">
            {Object.entries(roadTypes).map(([key, cfg]) => (
              <div key={key} className="rt-row">
                <span className="rt-label">
                  <span className="rt-dot" style={{ background: cfg.color }} />
                  {cfg.label}
                </span>
                <label className="toggle">
                  <input
                    type="checkbox"
                    checked={cfg.enabled}
                    onChange={(e) => onRoadTypeToggle(key, e.target.checked)}
                  />
                  <span className="tslider" />
                </label>
              </div>
            ))}
          </div>
        </section>

        {/* Rendering */}
        <section className="panel-section">
          <div className="sec-label">Rendering</div>
          <Slider
            label="Glow Radius"
            value={params.glowRadius}
            min={0} max={20}
            format={(v) => v + 'px'}
            onChange={(v) => onParamChange('glowRadius', v)}
          />
          <Slider
            label="Road Opacity"
            value={Math.round(params.roadOpacity * 100)}
            min={5} max={100}
            format={(v) => v + '%'}
            onChange={(v) => onParamChange('roadOpacity', v / 100)}
          />
        </section>

      </div>

      {/* Status bar */}
      <footer className="status-bar">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', width: '100%' }}>
          <div style={{ fontSize: '9.5px', color: '#5a7a9a', lineHeight: 1.5 }}>
            <strong style={{ color: '#7a9bbf' }}>Car colours</strong> are random per vehicle — they don&apos;t indicate road type or speed.
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span className={`sdot ${status.cls}`} />
            <span className="stext">{status.msg}</span>
          </div>
        </div>
      </footer>
    </aside>
  );
}
