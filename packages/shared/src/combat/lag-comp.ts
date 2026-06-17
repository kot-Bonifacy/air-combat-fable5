import { Vector3 } from 'three';

// Historia pozycji do lag-compensation (faza-11.md krok 1). Serwer co tick zapisuje
// pozycje żywych encji; przy hit-detekcji cofa CEL do ticku, który strzelec widział
// (now − ping/2 − bufor interpolacji, cap 200 ms). Sfera trafień jest izotropowa
// (promień hitRadiusM), więc historia trzyma TYLKO pozycję — orientacja nie zmienia
// testu segment↔sfera. Bufor pierścieniowy o stałej pojemności (zero alokacji w pętli):
// klatka dla ticku siedzi na slocie `tick % capacity`. Tick poza oknem (już nadpisany)
// = brak danych → caller pomija rewind dla tego pocisku.
//
// Zawijanie u32 ticku jest bezpieczne: porównujemy DOKŁADNĄ wartość ticku, a okno
// rewindu (≤ ~12 ticków) jest mniejsze niż pojemność (16), więc potrzebna klatka nie
// zdąży zostać nadpisana — także tuż po przekroczeniu 2³².

interface HistoryFrame {
  /** Który tick reprezentuje ta klatka; -1 = jeszcze nieużywana. */
  tick: number;
  count: number;
  readonly ids: number[];
  readonly positions: Vector3[];
}

export class PositionHistory {
  private readonly frames: HistoryFrame[];
  private current: HistoryFrame | null = null;

  constructor(
    private readonly capacityTicks: number,
    private readonly maxEntities: number,
  ) {
    this.frames = [];
    for (let i = 0; i < capacityTicks; i++) {
      const positions: Vector3[] = [];
      const ids: number[] = [];
      for (let j = 0; j < maxEntities; j++) {
        positions.push(new Vector3());
        ids.push(-1);
      }
      this.frames.push({ tick: -1, count: 0, ids, positions });
    }
  }

  private slot(tick: number): HistoryFrame {
    const i = ((tick % this.capacityTicks) + this.capacityTicks) % this.capacityTicks;
    return this.frames[i]!;
  }

  /** Otwiera (czyści) klatkę dla `tick`, nadpisując slot pierścienia. Raz na tick fizyki. */
  beginTick(tick: number): void {
    const frame = this.slot(tick);
    frame.tick = tick;
    frame.count = 0;
    this.current = frame;
  }

  /** Dopisuje pozycję encji do bieżącej klatki (po beginTick). Nadmiar ponad maxEntities pomijany. */
  record(id: number, position: Vector3): void {
    const f = this.current;
    if (!f || f.count >= this.maxEntities) return;
    f.ids[f.count] = id;
    f.positions[f.count]!.copy(position);
    f.count++;
  }

  /**
   * Wpisuje do `out` pozycję encji `id` w ticku `tick`. Zwraca false, gdy tick wypadł
   * z okna (slot nadpisany nowszym tickiem) albo encji w tej klatce nie było.
   */
  sample(id: number, tick: number, out: Vector3): boolean {
    const frame = this.slot(tick);
    if (frame.tick !== tick) return false;
    for (let i = 0; i < frame.count; i++) {
      if (frame.ids[i] === id) {
        out.copy(frame.positions[i]!);
        return true;
      }
    }
    return false;
  }
}
