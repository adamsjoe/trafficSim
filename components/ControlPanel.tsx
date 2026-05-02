'use client';

import type {
  LiveStats,
  RealismSettings,
  RoadTypesMap,
  SimParams,
  SimStatus,
  StatusState,
} from '@/lib/types';

// ── Sub-components ─────────────────────────────────────────────────────────────

function Slider({
  label, value, min, max, format, onChange,
}: {
  label: string; value: number; min: number; max: number;
  format: (v: number) => string; onChange: (v: number) => void;
}) {
  return (
    <div className="slider-item">
      <div className="slider-header">
        <span className="slider-name">{label}</span>
        <span className="slider-val">{format(value)}</span>
      </div>
      <input type="range" min={min} max={max} value={value}
        onChange={(e) => onChange(Number(e.target.value))} />
    </div>
  );
}

function ToggleRow({
  label, checked, onChange, dim,
}: {
  label: string; checked: boolean; onChange: (v: boolean) => void; dim?: string;
}) {
  return (
    <div className="rt-row">
      <span className="rt-label">
        {label}
        {dim && <span className="toggle-dim">{dim}</span>}
      </span>
      <label className="toggle">
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <span className="tslider" />
      </label>
    </div>
  );
}

function StatBox({ label, value, accent = 'cyan' }: {
  label: string; value: string | number; accent?: 'cyan' | 'green' | 'amber' | 'red';
}) {
  return (
    <div className="stat-box">
      <div className="stat-l">{label}</div>
      <div className={`stat-v stat-${accent}`}>{value}</div>
    </div>
  );
}

// ── Rush hour mini-clock ───────────────────────────────────────────────────────
function RushClock({ simTime, period, rushMult }: {
  simTime: string; period: string; rushMult: number;
}) {
  const isRush = period.toLowerCase().includes('rush');
  const pct    = Math.min(100, Math.round((rushMult / 2.0) * 100));

  return (
    <div className="rush-clock">
      <div className="rush-time">{simTime}</div>
      <div className="rush-period" style={{ color: isRush ? '#ffb347' : '#5a7a9a' }}>
        {period}
      </div>
      <div className="rush-bar-wrap">
        <div className="rush-bar-fill" style={{
          width: `${pct}%`,
          background: isRush ? '#ffb347' : '#3d7aad',
        }} />
      </div>
      <div className="rush-bar-label">
        <span>Quiet</span>
        <span style={{ color: '#ffb347' }}>{rushMult.toFixed(2)}×</span>
        <span>Rush</span>
      </div>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

interface ControlPanelProps {
  status:             StatusState;
  simStatus:          SimStatus;
  stats:              LiveStats;
  params:             SimParams;
  realism:            RealismSettings;
  roadTypes:          RoadTypesMap;
  progress:           number;
  closedCount:        number;
  onParamChange:      (key: keyof SimParams, value: number) => void;
  onRealismChange:    (key: keyof RealismSettings, value: boolean | number) => void;
  onRoadTypeToggle:   (key: string, enabled: boolean) => void;
  onStart:            () => void;
  onStop:             () => void;
}

export default function ControlPanel({
  status, simStatus, stats, params, realism, roadTypes,
  progress, closedCount,
  onParamChange, onRealismChange, onRoadTypeToggle, onStart, onStop,
}: ControlPanelProps) {
  return (
    <aside className="panel">
      <div className="panel-scroll">

        {/* Sim buttons */}
        <div className="sim-btns">
          <button className="btn btn-start" onClick={onStart} disabled={simStatus === 'running'}>▶ Start</button>
          <button className="btn btn-stop"  onClick={onStop}  disabled={simStatus !== 'running'}>■ Stop</button>
        </div>

        {/* Parameters */}
        <section className="panel-section">
          <div className="sec-label">Parameters</div>
          <Slider
            label={`Cars${params.carCount > 400 ? ' (trails off)' : ''}`}
            value={params.carCount} min={1} max={100000}
            format={(v) => v >= 1000 ? (v / 1000).toFixed(1) + 'k' : String(v)}
            onChange={(v) => onParamChange('carCount', v)}
          />
          <Slider label="Speed" value={params.speedMult * 5} min={1} max={30}
            format={(v) => (v / 5).toFixed(1) + '×'}
            onChange={(v) => onParamChange('speedMult', v / 5)}
          />
          <Slider label="Trail Length" value={params.trailLength} min={0} max={40}
            format={(v) => String(v)}
            onChange={(v) => onParamChange('trailLength', v)}
          />
          <Slider label="Car Size" value={params.carSize} min={1} max={8}
            format={(v) => v + 'px'}
            onChange={(v) => onParamChange('carSize', v)}
          />
        </section>

        {/* Realism */}
        <section className="panel-section">
          <div className="sec-label">Realism</div>
          <div className="road-type-list">
            <ToggleRow label="Congestion"
              dim="cars slow on busy roads"
              checked={realism.congestion}
              onChange={(v) => onRealismChange('congestion', v)}
            />
            <ToggleRow label="Weighted Routing"
              dim="prefer faster road classes"
              checked={realism.weightedRouting}
              onChange={(v) => onRealismChange('weightedRouting', v)}
            />
            <ToggleRow label="Traffic Signals"
              dim="OSM signal nodes"
              checked={realism.signals}
              onChange={(v) => onRealismChange('signals', v)}
            />
            <ToggleRow label="Color by Speed"
              dim="red = slow, green = fast"
              checked={realism.colorBySpeed}
              onChange={(v) => onRealismChange('colorBySpeed', v)}
            />
          </div>
        </section>

        {/* Rush Hour */}
        <section className="panel-section">
          <div className="sec-label">Rush Hour</div>
          <div className="road-type-list" style={{ marginBottom: 10 }}>
            <ToggleRow label="Rush Hour Simulation"
              checked={realism.rushHour}
              onChange={(v) => onRealismChange('rushHour', v)}
            />
          </div>
          {realism.rushHour && (
            <>
              <RushClock simTime={stats.simTime} period={stats.period} rushMult={stats.rushMult} />
              <Slider label="Time Scale" value={realism.timeScale} min={1} max={300}
                format={(v) => v + '×'}
                onChange={(v) => onRealismChange('timeScale', v)}
              />
            </>
          )}
        </section>

        {/* Live Stats */}
        <section className="panel-section">
          <div className="sec-label">Live Stats</div>
          <div className="stats-grid">
            <StatBox label="Active Cars"   value={stats.cars}    accent="green" />
            <StatBox label="FPS"           value={stats.fps} />
            <StatBox label="Road Nodes"    value={stats.nodes} />
            <StatBox label="Road Edges"    value={stats.edges} />
            <StatBox label="Closed Roads"  value={closedCount > 0 ? closedCount : '—'} accent={closedCount > 0 ? 'amber' : 'cyan'} />
            <StatBox label="Signals"       value={stats.signals} accent="green" />
          </div>
          <div className="progress-wrap">
            <div className="progress-fill" style={{ width: `${progress}%` }} />
          </div>
        </section>

        {/* Roads to Load */}
        <section className="panel-section">
          <div className="sec-label">Roads to Load</div>
          <p style={{ fontSize: '10px', color: '#5a7a9a', marginBottom: 10, lineHeight: 1.5 }}>
            Toggle which OSM road classes are fetched. Re-click{' '}
            <strong style={{ color: '#7a9bbf' }}>Load Roads</strong> to apply.
          </p>
          <div className="road-type-list">
            {Object.entries(roadTypes).map(([key, cfg]) => (
              <div key={key} className="rt-row">
                <span className="rt-label">
                  <span className="rt-dot" style={{ background: cfg.color }} />
                  {cfg.label}
                </span>
                <label className="toggle">
                  <input type="checkbox" checked={cfg.enabled}
                    onChange={(e) => onRoadTypeToggle(key, e.target.checked)} />
                  <span className="tslider" />
                </label>
              </div>
            ))}
          </div>
        </section>

        {/* Rendering */}
        <section className="panel-section">
          <div className="sec-label">Rendering</div>
          <Slider label="Glow Radius" value={params.glowRadius} min={0} max={20}
            format={(v) => v + 'px'} onChange={(v) => onParamChange('glowRadius', v)} />
          <Slider label="Road Opacity" value={Math.round(params.roadOpacity * 100)} min={5} max={100}
            format={(v) => v + '%'} onChange={(v) => onParamChange('roadOpacity', v / 100)} />
        </section>

      </div>

      {/* Status */}
      <footer className="status-bar">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5, width: '100%' }}>
          <div style={{ fontSize: '9.5px', color: '#5a7a9a', lineHeight: 1.5 }}>
            <strong style={{ color: '#7a9bbf' }}>Car colours</strong> are random per vehicle — or enable Color by Speed above.
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className={`sdot ${status.cls}`} />
            <span className="stext">{status.msg}</span>
          </div>
        </div>
      </footer>
    </aside>
  );
}
