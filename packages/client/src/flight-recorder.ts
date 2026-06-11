import {
  GRAVITY_MS2,
  MS_TO_KMH,
  PHYSICS_HZ,
  type PilotTickResult,
  type PlaneConfig,
  type PlaneState,
} from '@air-combat/shared';

import { RECORDER_CHANNELS, saveRecording } from './recording-codec';

// Rejestrator lotu (fizyka-lotu.md rozdz. 11.4): ring buffer 60 Hz × 5 min
// pełnego stanu + sił. Eksport CSV i przekazanie do /telemetry przez
// localStorage (kodek w recording-codec.ts).

const CHANNELS = RECORDER_CHANNELS.length;
const CAPACITY_TICKS = 5 * 60 * PHYSICS_HZ;
const STALL_PHASE_CODE = { normal: 0, buffet: 1, stalled: 2 } as const;

export class FlightRecorder {
  private readonly data = new Float32Array(CAPACITY_TICKS * CHANNELS);
  private writeIdx = 0;
  private count = 0;
  private timeS = 0;

  record(state: PlaneState, tick: PilotTickResult, plane: PlaneConfig, dtS: number): void {
    this.timeS += dtS;
    const tas = state.velocity.length();
    const force = (name: string): number => {
      const c = tick.contributions.find((cc) => cc.name === name);
      return c ? c.force.length() : 0;
    };
    const base = this.writeIdx * CHANNELS;
    this.data[base] = this.timeS;
    this.data[base + 1] = state.iasMs * MS_TO_KMH;
    this.data[base + 2] = tas * MS_TO_KMH;
    this.data[base + 3] = state.position.y;
    this.data[base + 4] = state.loadFactor;
    this.data[base + 5] = tick.nAvailG;
    this.data[base + 6] = (tick.lift.alphaImpliedRad * 180) / Math.PI;
    this.data[base + 7] =
      (0.5 * plane.massKg * tas * tas + plane.massKg * GRAVITY_MS2 * state.position.y) / 1e6;
    this.data[base + 8] = state.throttle;
    this.data[base + 9] = STALL_PHASE_CODE[tick.stall.phase];
    this.data[base + 10] = force('siła nośna');
    this.data[base + 11] = force('opór');
    this.data[base + 12] = force('ciąg');
    this.data[base + 13] = state.velocity.y;

    this.writeIdx = (this.writeIdx + 1) % CAPACITY_TICKS;
    if (this.count < CAPACITY_TICKS) this.count += 1;
  }

  /** Kopia danych w porządku chronologicznym (najstarszy wiersz pierwszy). */
  snapshot(): Float32Array {
    const out = new Float32Array(this.count * CHANNELS);
    if (this.count < CAPACITY_TICKS) {
      out.set(this.data.subarray(0, this.count * CHANNELS));
    } else {
      const tail = this.data.subarray(this.writeIdx * CHANNELS);
      out.set(tail);
      out.set(this.data.subarray(0, this.writeIdx * CHANNELS), tail.length);
    }
    return out;
  }

  exportCsv(): void {
    const rows = this.snapshot();
    const lines: string[] = [RECORDER_CHANNELS.join(';')];
    for (let r = 0; r < rows.length / CHANNELS; r++) {
      const cells: string[] = [];
      for (let c = 0; c < CHANNELS; c++) cells.push(String(rows[r * CHANNELS + c]));
      lines.push(cells.join(';'));
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `lot-${new Date().toISOString().replace(/[:.]/g, '-')}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  /** Zapis do localStorage dla strony /telemetry. Zwraca false przy braku miejsca. */
  saveForTelemetry(): boolean {
    return saveRecording(this.snapshot());
  }
}
