import { Pane } from 'tweakpane';
import type { PlaneConfig } from '@air-combat/shared';

/**
 * Panel strojenia na żywo (fizyka-lotu.md rozdz. 11.3, TYLKO dev build —
 * main.ts importuje ten moduł dynamicznie za bramką import.meta.env.DEV).
 * Bindowanie mutuje obiekt PlaneConfig w miejscu — pilotStep czyta parametry
 * co tick, więc zmiany działają natychmiast. Eksport presetu → JSON 1:1
 * ze schematem planes/*.json (diffowalny z plikiem źródłowym).
 */
export interface TuningPanelHooks {
  onExportCsv: () => void;
  onOpenTelemetry: () => void;
}

export function createTuningPanel(plane: PlaneConfig, hooks: TuningPanelHooks): void {
  const pane = new Pane({ title: `Strojenie — ${plane.name}` });
  (pane.element.parentElement as HTMLElement).style.zIndex = '20';

  const aero = pane.addFolder({ title: 'Aerodynamika / napęd', expanded: false });
  aero.addBinding(plane, 'clMax', { min: 0.8, max: 2.5, step: 0.01 });
  aero.addBinding(plane, 'cd0', { min: 0.01, max: 0.06, step: 0.0005 });
  aero.addBinding(plane, 'oswaldE', { min: 0.5, max: 1, step: 0.01 });
  aero.addBinding(plane, 'enginePowerW', { min: 300_000, max: 1_500_000, step: 1000 });
  aero.addBinding(plane, 'staticThrustN', { min: 2000, max: 20_000, step: 100 });
  aero.addBinding(plane, 'propEfficiency', { min: 0.5, max: 1, step: 0.01 });

  const envelope = pane.addFolder({ title: 'Koperta', expanded: true });
  envelope.addBinding(plane, 'nMaxG', { min: 2, max: 12, step: 0.1 });
  envelope.addBinding(plane, 'nMinG', { min: -8, max: -1, step: 0.1 });
  envelope.addBinding(plane, 'alignTauS', { min: 0.1, max: 2, step: 0.05 });
  envelope.addBinding(plane, 'sideslipDampingS', { min: 0.1, max: 2, step: 0.05 });
  envelope.addBinding(plane, 'sideslipMaxAccelG', { min: 0.05, max: 1, step: 0.05 });

  const rollFolder = pane.addFolder({ title: 'rollRate(IAS) [km/h → °/s]', expanded: true });
  // any: adapter Tweakpane — bindujemy punkty krzywej przez obiekty pośrednie,
  // bo readonly krotki z PlaneConfig nie są bindowalne wprost
  const curve = plane.rollRateCurve as unknown as [number, number][];
  curve.forEach((point, i) => {
    const proxy = { iasKmh: point[0], degS: point[1] };
    rollFolder
      .addBinding(proxy, 'iasKmh', { label: `P${String(i)} IAS`, min: 50, max: 800, step: 5 })
      .on('change', (ev) => {
        point[0] = ev.value;
      });
    rollFolder
      .addBinding(proxy, 'degS', { label: `P${String(i)} °/s`, min: 0, max: 180, step: 1 })
      .on('change', (ev) => {
        point[1] = ev.value;
      });
  });

  const stall = pane.addFolder({ title: 'Przeciągnięcie', expanded: false });
  stall.addBinding(plane.stall, 'buffetOnsetRatio', { min: 0.6, max: 0.99, step: 0.01 });
  stall.addBinding(plane.stall, 'noseDropRateDegS', { min: 2, max: 40, step: 1 });
  stall.addBinding(plane.stall, 'aileronEffectiveness', { min: 0, max: 1, step: 0.05 });
  stall.addBinding(plane.stall, 'wingDropDelayS', { min: 0.2, max: 5, step: 0.1 });
  stall.addBinding(plane.stall, 'wingDropRateDegS', { min: 5, max: 120, step: 1 });

  const instructor = pane.addFolder({ title: 'Instruktor (mysz)', expanded: true });
  instructor.addBinding(plane.instructor, 'aggressivenessRoll', { min: 0.5, max: 15, step: 0.1 });
  instructor.addBinding(plane.instructor, 'aggressivenessPitch', { min: 0.5, max: 15, step: 0.1 });
  instructor.addBinding(plane.instructor, 'bankThresholdDeg', { min: 5, max: 60, step: 1 });
  instructor.addBinding(plane.instructor, 'pushoverConeDeg', { min: 0, max: 60, step: 1 });
  instructor.addBinding(plane.instructor, 'smoothingTauS', { min: 0.02, max: 0.6, step: 0.01 });
  instructor.addBinding(plane.instructor, 'yawGain', { min: 0, max: 3, step: 0.05 });
  instructor.addBinding(plane.instructor, 'maxYawRateDegS', { min: 0, max: 30, step: 0.5 });

  pane.addButton({ title: 'Eksportuj preset (schowek + plik)' }).on('click', () => {
    const json = JSON.stringify(plane, null, 2) + '\n';
    void navigator.clipboard.writeText(json).catch(() => {
      /* schowek niedostępny bez fokusu — plik i tak się pobierze */
    });
    const blob = new Blob([json], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'preset.json';
    a.click();
    URL.revokeObjectURL(a.href);
  });

  const rec = pane.addFolder({ title: 'Rejestrator lotu', expanded: true });
  rec.addButton({ title: 'Eksport CSV' }).on('click', hooks.onExportCsv);
  rec.addButton({ title: 'Otwórz /telemetry' }).on('click', hooks.onOpenTelemetry);
}
