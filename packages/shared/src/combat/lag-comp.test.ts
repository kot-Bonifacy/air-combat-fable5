import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { segmentSphereHit } from './hit';
import { PositionHistory } from './lag-comp';

describe('PositionHistory (lag-compensation)', () => {
  it('odtwarza pozycję encji sprzed N ticków', () => {
    const hist = new PositionHistory(16, 8);
    // encja 1 leci po osi X: pozycja = tick * 10
    for (let tick = 0; tick < 12; tick++) {
      hist.beginTick(tick);
      hist.record(1, new Vector3(tick * 10, 0, 0));
    }
    const out = new Vector3();
    // przy ticku bieżącym 11 cofnięcie o 5 → tick 6 → x = 60 (pozycja historyczna)
    expect(hist.sample(1, 6, out)).toBe(true);
    expect(out.x).toBe(60);
    // tick bieżący zwraca bieżącą pozycję
    expect(hist.sample(1, 11, out)).toBe(true);
    expect(out.x).toBe(110);
  });

  it('zwraca false dla ticku poza oknem (slot nadpisany)', () => {
    const hist = new PositionHistory(16, 8);
    for (let tick = 0; tick < 40; tick++) {
      hist.beginTick(tick);
      hist.record(1, new Vector3(tick, 0, 0));
    }
    const out = new Vector3();
    expect(hist.sample(1, 39, out)).toBe(true); // bieżący
    expect(hist.sample(1, 39 - 15, out)).toBe(true); // ostatni w oknie (16 klatek)
    expect(hist.sample(1, 39 - 16, out)).toBe(false); // tuż za oknem — nadpisany
  });

  it('rozróżnia wiele encji w jednej klatce', () => {
    const hist = new PositionHistory(16, 8);
    hist.beginTick(5);
    hist.record(1, new Vector3(1, 0, 0));
    hist.record(2, new Vector3(2, 0, 0));
    const out = new Vector3();
    expect(hist.sample(2, 5, out) && out.x).toBe(2);
    expect(hist.sample(1, 5, out) && out.x).toBe(1);
    expect(hist.sample(3, 5, out)).toBe(false); // encji nie było w tej klatce
  });

  it('lag comp: pocisk trafia w pozycję CELU SPRZED rewindu, nie w bieżącą', () => {
    // cel przelatuje wzdłuż osi X: w ticku k jest w (k·10, 0, 0)
    const hist = new PositionHistory(16, 8);
    const targetId = 1;
    for (let tick = 0; tick <= 15; tick++) {
      hist.beginTick(tick);
      hist.record(targetId, new Vector3(tick * 10, 0, 0));
    }
    const currentTick = 15; // cel TERAZ w (150, 0, 0)
    const rewindTicks = 6; // strzelec z lagiem widział cel w ticku 9 → (90, 0, 0)

    // pocisk strzelca przeszedł w tym ticku przez x=90 (tam, gdzie cel BYŁ na jego ekranie)
    const prev = new Vector3(90, -5, 0);
    const pos = new Vector3(90, 5, 0);
    const hitRadius = 6;

    const rewound = new Vector3();
    expect(hist.sample(targetId, (currentTick - rewindTicks) >>> 0, rewound)).toBe(true);
    expect(rewound.x).toBe(90);

    const current = new Vector3();
    expect(hist.sample(targetId, currentTick, current)).toBe(true);

    // z rewindem: trafienie (cel BYŁ tam); bez rewindu (pozycja bieżąca): pudło
    expect(segmentSphereHit(prev, pos, rewound, hitRadius)).toBe(true);
    expect(segmentSphereHit(prev, pos, current, hitRadius)).toBe(false);
  });

  it('obsługuje zawijanie ticku u32 bez utraty trafień w oknie', () => {
    const hist = new PositionHistory(16, 8);
    const base = 0xffffffff - 5; // kilka ticków przed przepełnieniem
    for (let i = 0; i < 12; i++) {
      const tick = (base + i) >>> 0; // zawija się przez 0
      hist.beginTick(tick);
      hist.record(1, new Vector3(i, 0, 0));
    }
    const out = new Vector3();
    const curTick = (base + 11) >>> 0;
    const pastTick = (curTick - 4) >>> 0; // i = 7 → x = 7
    expect(hist.sample(1, pastTick, out)).toBe(true);
    expect(out.x).toBe(7);
  });
});
