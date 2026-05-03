/**
 * UK traffic light sequence (90s total cycle):
 *   0–44  RED        (45s) — stop
 *  45–47  RED+AMBER  ( 3s) — prepare to go, still stop
 *  48–86  GREEN      (39s) — go
 *  87–89  AMBER      ( 3s) — stop (or clear junction if already crossing)
 */
export type SignalPhase = 'red' | 'red-amber' | 'green' | 'amber';

export const SIGNAL_CYCLE = 90; // seconds

export function getSignalPhase(simTime: number, phaseOffset: number): SignalPhase {
  const t = ((simTime + phaseOffset) % SIGNAL_CYCLE + SIGNAL_CYCLE) % SIGNAL_CYCLE;
  if (t < 45) return 'red';
  if (t < 48) return 'red-amber';
  if (t < 87) return 'green';
  return 'amber';
}

/** True only during green phase — cars may proceed */
export function isSignalGreen(simTime: number, phaseOffset: number): boolean {
  return getSignalPhase(simTime, phaseOffset) === 'green';
}

/** Canvas fill colour for each UK phase */
export function signalPhaseColor(phase: SignalPhase): string {
  switch (phase) {
    case 'red':       return '#ff2244';
    case 'red-amber': return '#ff7700';
    case 'green':     return '#00e840';
    case 'amber':     return '#ffaa00';
  }
}


const CURVE: [hour: number, mult: number][] = [
  [0,  0.12],
  [5,  0.22],
  [7,  1.0],
  [8,  1.9],   // morning peak
  [9,  1.4],
  [10, 0.8],
  [12, 0.9],   // lunch bump
  [13, 0.82],
  [16, 1.25],
  [17, 2.0],   // evening peak
  [18, 1.65],
  [19, 0.9],
  [21, 0.42],
  [24, 0.12],
];

export function getRushMultiplier(hour: number): number {
  for (let i = 1; i < CURVE.length; i++) {
    const [h0, m0] = CURVE[i - 1];
    const [h1, m1] = CURVE[i];
    if (hour <= h1) {
      const t = (hour - h0) / (h1 - h0);
      return m0 + (m1 - m0) * t;
    }
  }
  return 0.12;
}

export function formatSimTime(seconds: number): string {
  const total = Math.floor(seconds / 60) % (24 * 60);
  const h = Math.floor(total / 60);
  const m = total % 60;
  const ampm = h < 12 ? 'AM' : 'PM';
  const h12  = h % 12 === 0 ? 12 : h % 12;
  return `${String(h12).padStart(2, '0')}:${String(m).padStart(2, '0')} ${ampm}`;
}

export function getPeriodName(hour: number): string {
  if (hour < 5)  return 'Night';
  if (hour < 7)  return 'Early Morning';
  if (hour < 9)  return 'Morning Rush';
  if (hour < 11) return 'Morning';
  if (hour < 13) return 'Midday';
  if (hour < 16) return 'Afternoon';
  if (hour < 19) return 'Evening Rush';
  if (hour < 21) return 'Evening';
  return 'Night';
}

/** Speed factor 0–1 → [r, g, b] floats.  Red = stopped, green = full speed. */
export function speedToRgb(factor: number): [number, number, number] {
  const f = Math.max(0, Math.min(1, factor));
  if (f < 0.5) {
    const t = f * 2;
    return [1.0, 0.18 + t * 0.64, 0.08]; // red → amber
  }
  const t = (f - 0.5) * 2;
  return [1.0 - t * 0.75, 0.82, 0.08 + t * 0.1]; // amber → green
}
