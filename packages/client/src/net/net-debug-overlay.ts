import type { NetConditionsConfig } from './net-conditions';
import type { ReconcileMetrics } from './prediction';

// Network debug overlay (faza-09.md krok 4). Bez tego nie da się ZMIERZYĆ kryterium
// fazy 9 (korekty < próg snap w ≥ 99% ticków). Pokazuje ping, rozmiar korekt
// reconciliation (śr./maks/percent < snap), utracone snapshoty i zajętość bufora
// interpolacji. Czysty DOM, przełączany klawiszem (domyślnie ukryty).

export interface NetDebugData {
  status: string;
  rttMs: number;
  conditions: NetConditionsConfig;
  reconcile: ReconcileMetrics;
  bufferMs: number;
  lostSnapshots: number;
  remoteCount: number;
  extrapolatingCount: number;
}

export class NetDebugOverlay {
  private readonly el: HTMLDivElement;
  private shown = false;

  constructor() {
    this.el = document.createElement('div');
    this.el.style.cssText = [
      'position:fixed',
      'top:12px',
      'right:12px',
      'z-index:30',
      'padding:10px 14px',
      'background:rgba(7,13,21,0.78)',
      'color:#bfe3ff',
      'font:12px/1.5 monospace',
      'white-space:pre',
      'border:1px solid #2c4a66',
      'border-radius:6px',
      'pointer-events:none',
      'display:none',
    ].join(';');
    document.body.appendChild(this.el);
  }

  toggle(): void {
    this.shown = !this.shown;
    this.el.style.display = this.shown ? 'block' : 'none';
  }

  get visible(): boolean {
    return this.shown;
  }

  update(d: NetDebugData): void {
    if (!this.shown) return;
    const r = d.reconcile;
    const pct = (r.belowSnapFraction * 100).toFixed(2);
    const sim = d.conditions.enabled
      ? `${String(d.conditions.latencyMs)}ms ±${String(d.conditions.jitterMs)} / ${(d.conditions.loss * 100).toFixed(0)}% loss`
      : 'wył.';
    this.el.textContent = [
      'NET DEBUG  [N] ukryj  [P] panel sieci',
      `status        ${d.status}`,
      `ping (RTT)    ${String(d.rttMs)} ms`,
      `symulator     ${sim}`,
      '— reconciliation (własny samolot) —',
      `korekty       ${String(r.count)}`,
      `ostatnia      ${r.lastM.toFixed(2)} m`,
      `średnia/maks  ${r.avgM.toFixed(2)} / ${r.maxM.toFixed(2)} m`,
      `< próg snap   ${pct} %`,
      '— interpolacja (obce samoloty) —',
      `obcych        ${String(d.remoteCount)}  (ekstrapolacja: ${String(d.extrapolatingCount)})`,
      `bufor         ${d.bufferMs.toFixed(0)} ms`,
      `utracone snap ${String(d.lostSnapshots)}`,
    ].join('\n');
  }
}
