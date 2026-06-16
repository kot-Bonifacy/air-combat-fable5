import { Pane } from 'tweakpane';
import { NET_CONDITION_PRESETS, type NetConditionsConfig } from './net-conditions';

// Panel symulatora warunków sieci (faza-09.md krok 1, TYLKO dev build — online-main
// importuje go dynamicznie za bramką import.meta.env.DEV). Bindowanie mutuje obiekt
// `conditions` NetClienta w miejscu — sendInput/onMessage czytają go per pakiet, więc
// zmiany działają natychmiast. Produkcyjny build nie ma panelu i nie symuluje lagu.

export interface NetConditionsPanel {
  dispose(): void;
  toggle(): void;
}

export function createNetConditionsPanel(conditions: NetConditionsConfig): NetConditionsPanel {
  const pane = new Pane({ title: 'Sieć (dev) — [P]' });
  const container = pane.element.parentElement as HTMLElement;
  container.style.zIndex = '31';
  // panel pod overlay debug (top-right): przesuń niżej, by się nie nakładały
  container.style.top = '260px';

  pane.addBinding(conditions, 'enabled', { label: 'symuluj' });
  pane.addBinding(conditions, 'latencyMs', { label: 'opóźnienie 1-kier.', min: 0, max: 300, step: 5 });
  pane.addBinding(conditions, 'jitterMs', { label: 'jitter ±', min: 0, max: 100, step: 5 });
  pane.addBinding(conditions, 'loss', { label: 'strata', min: 0, max: 0.3, step: 0.01 });

  const presets = pane.addFolder({ title: 'Presety', expanded: true });
  for (const [name, cfg] of Object.entries(NET_CONDITION_PRESETS)) {
    presets.addButton({ title: name }).on('click', () => {
      Object.assign(conditions, cfg);
      pane.refresh();
    });
  }

  let shown = true;
  return {
    dispose: () => pane.dispose(),
    toggle: () => {
      shown = !shown;
      container.style.display = shown ? '' : 'none';
    },
  };
}
