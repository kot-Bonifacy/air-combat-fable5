import { describe, expect, it } from 'vitest';
import { Quaternion, Vector3 } from 'three';
import {
  Instructor,
  SPITFIRE_MK2,
  createPilotDemands,
  createSimPlane,
  createTerrain,
  stepPilotedPlane,
  stepWreckPiloted,
  surfaceHeightM,
  type EntitySnapshot,
  type PilotCommand,
  type PlaneState,
  type SimPlane,
} from '@air-combat/shared';
import { Predictor } from './prediction';

// Reconciliation (faza-09.md krok 5): zadany dryf → po reconcile stan klienta = stan
// serwera + nowsze inputy; przy zgodnej fizyce korekty zostają poniżej progu snap.
// „Serwer" to drugi sim prowadzony tą samą stepPilotedPlane (autorytet).

const terrain = createTerrain();
const FORWARD_Z = new Vector3(0, 0, 1);
const DT = 1 / 60;

function spawnState(s: PlaneState): void {
  // nos na +Z, by domyślny aim komendy (0,0,1) znaczył „prosto przed siebie"
  const dir = new Vector3(0, 0, 1);
  s.position.set(8000, 1500, 0);
  s.velocity.copy(dir).multiplyScalar(140);
  s.orientation.copy(new Quaternion().setFromUnitVectors(FORWARD_Z, dir));
  s.throttle = 0.85;
  s.iasMs = 140;
  s.life = 'alive';
  s.stalled = false;
}

function entityOf(
  s: PlaneState,
  damage: { levels: number[]; onFire: boolean } = { levels: [0, 0, 0, 0, 0, 0], onFire: false },
): EntitySnapshot {
  return {
    id: 0,
    life: s.life,
    stalled: s.stalled,
    isLocal: true,
    position: s.position.clone(),
    orientation: s.orientation.clone(),
    velocity: s.velocity.clone(),
    throttle: s.throttle,
    healthFrac: 1,
    ammoFrac: 1,
    ammoSecondaryFrac: 1,
    fuelFrac: s.fuelFrac,
    planeType: 'spitfire',
    damage,
  };
}

function cmd(over: Partial<PilotCommand> = {}): PilotCommand {
  return { throttle: 0.85, pitchUp: 0, rollRight: 0, yawRight: 0, aimX: 0, aimY: 0, aimZ: 1, ...over };
}

function makeServer() {
  const sim: SimPlane = createSimPlane(2);
  spawnState(sim.state);
  const instructor = new Instructor();
  const demands = createPilotDemands();
  return {
    sim,
    step(c: PilotCommand): void {
      stepPilotedPlane(sim, instructor, SPITFIRE_MK2, demands, c, terrain, DT, 'srv');
    },
    // zestrzelenie: serwer czyni z samolotu spadający wrak (faza 15) — life 'dying'
    enterWreck(): void {
      sim.state.life = 'dying';
      sim.state.lifeTimerS = 0;
    },
    stepWreck(c: PilotCommand): void {
      stepWreckPiloted(sim, SPITFIRE_MK2, demands, c, terrain, DT, 'srv-wrak');
    },
    entity(): EntitySnapshot {
      // snapshot niesie autorytatywne poziomy uszkodzeń serwera (v8) — predyktor je przyjmuje
      return entityOf(sim.state, { levels: sim.damageLevels ?? [0, 0, 0, 0, 0, 0], onFire: false });
    },
  };
}

describe('Predictor — predykcja i reconciliation', () => {
  it('pusty bufor (wszystko potwierdzone): klient przyjmuje stan serwera 1:1', () => {
    const server = makeServer();
    const p = new Predictor(SPITFIRE_MK2, terrain);
    p.reconcile(server.entity(), 0);

    for (let t = 1; t <= 30; t++) {
      const c = cmd({ rollRight: 0.3 });
      p.predict(c, t);
      server.step(c);
    }
    p.reconcile(server.entity(), 30); // ack = ostatni → bufor pusty, brak replay

    expect(p.sim.state.position.distanceTo(server.sim.state.position)).toBeLessThan(1e-6);
    expect(p.sim.state.orientation.angleTo(server.sim.state.orientation)).toBeLessThan(1e-6);
  });

  it('uszkodzony lot (v8): predykcja z poziomów serwera spójna po replay', () => {
    const server = makeServer();
    // serwer leci uszkodzony: silnik ciężko (poziom 2), prawe skrzydło lekko (1), ogon lekko (1)
    server.sim.damageLevels = [2, 0, 0, 0, 1, 1];
    const p = new Predictor(SPITFIRE_MK2, terrain);
    p.reconcile(server.entity(), 0); // klient przyjmuje poziomy + stan
    expect(p.sim.damageLevels).toEqual([2, 0, 0, 0, 1, 1]);

    // klient predykuje 20 inputów do przodu; serwer potwierdza tylko 12 → replay 13..20 z uszkodzeniami
    for (let t = 1; t <= 20; t++) p.predict(cmd({ pitchUp: 0.4, rollRight: 0.2 }), t);
    for (let t = 1; t <= 12; t++) server.step(cmd({ pitchUp: 0.4, rollRight: 0.2 }));
    p.reconcile(server.entity(), 12);

    // serwer dokańcza — przy spójnych poziomach (te same modyfikatory) klient zbiega do autorytetu 1:1
    for (let t = 13; t <= 20; t++) server.step(cmd({ pitchUp: 0.4, rollRight: 0.2 }));
    p.reconcile(server.entity(), 20);
    expect(p.sim.state.position.distanceTo(server.sim.state.position)).toBeLessThan(1e-6);
    expect(p.sim.damageLevels).toEqual([2, 0, 0, 0, 1, 1]);
  });

  it('przyjmuje brak uszkodzeń jako tożsamość (damageLevels=null gdy wszystkie poziomy 0)', () => {
    const server = makeServer();
    const p = new Predictor(SPITFIRE_MK2, terrain);
    p.reconcile(server.entity(), 0);
    expect(p.sim.damageLevels).toBeNull(); // sprawny → null (ścieżka złotych testów fizyki)
  });

  it('zamknięta pętla z lagiem 100 ms: korekty < próg snap, klient nadąża za serwerem', () => {
    const server = makeServer();
    const p = new Predictor(SPITFIRE_MK2, terrain);
    p.reconcile(server.entity(), 0);

    const L = 6; // ~100 ms @ 60 Hz
    const delayed: { ack: number; entity: EntitySnapshot }[] = [];
    for (let t = 1; t <= 300; t++) {
      const c = cmd({ rollRight: Math.sin(t / 25) * 0.5, pitchUp: Math.sin(t / 40) * 0.2 });
      p.predict(c, t); // klient: natychmiast
      server.step(c); // autorytet
      delayed.push({ ack: t, entity: server.entity() });
      if (delayed.length > L) {
        const past = delayed.shift();
        if (past) p.reconcile(past.entity, past.ack); // snapshot sprzed L ticków
      }
    }

    // wszystkie korekty poniżej progu snap (kryterium fazy 9: ≥ 99% — tu 100%)
    expect(p.metrics.count).toBeGreaterThan(200);
    expect(p.metrics.belowSnapFraction).toBe(1);
    expect(p.metrics.maxM).toBeLessThan(10);
    // klient zreplayowany do „teraz" pokrywa się z serwerem „teraz"
    expect(p.sim.state.position.distanceTo(server.sim.state.position)).toBeLessThan(10);
  });

  it('zadany dryf jest korygowany: po reconcile stan zbiega do serwera', () => {
    const server = makeServer();
    const p = new Predictor(SPITFIRE_MK2, terrain);
    p.reconcile(server.entity(), 0);
    // wstrzyknij dryf: klient ostro ciągnie ster, serwer leci prosto (30 ticków = 0,5 s,
    // dość, by tor predykcji wyraźnie odjechał od autorytetu)
    for (let t = 1; t <= 30; t++) {
      p.predict(cmd({ pitchUp: 1 }), t); // klient zadziera nos…
      server.step(cmd()); // …a serwer leci prosto
    }
    const errBefore = p.sim.state.position.distanceTo(server.sim.state.position);
    p.reconcile(server.entity(), 30); // ack = 30 → bufor pusty, przyjmij autorytet
    const errAfter = p.sim.state.position.distanceTo(server.sim.state.position);
    expect(errBefore).toBeGreaterThan(5); // tor predykcji wyraźnie odjechał
    expect(errAfter).toBeLessThan(1e-6); // zbiegł dokładnie do serwera
  });

  it('duży błąd → twardy snap: render zrównany ze stanem fizyki (zerowy offset)', () => {
    const server = makeServer();
    const p = new Predictor(SPITFIRE_MK2, terrain);
    p.reconcile(server.entity(), 0);
    for (let t = 1; t <= 10; t++) {
      const c = cmd();
      p.predict(c, t);
      server.step(c);
    }
    const far = server.entity();
    far.position.set(-5000, 2000, 3000); // „teleport" serwera (duży rozjazd)
    p.reconcile(far, 5);
    p.updateRender(DT);
    expect(p.renderPosition.distanceTo(p.sim.state.position)).toBeLessThan(1e-6);
  });

  it('mała korekta: offset renderu obecny, potem zanika do zera', () => {
    const server = makeServer();
    const p = new Predictor(SPITFIRE_MK2, terrain);
    p.reconcile(server.entity(), 0);
    for (let t = 1; t <= 8; t++) {
      const c = cmd();
      p.predict(c, t);
      server.step(c);
    }
    const e = server.entity();
    e.position.x += 4; // 4 m rozjazd (poniżej progu snap)
    p.reconcile(e, 8);

    p.updateRender(DT);
    expect(p.renderPosition.distanceTo(p.sim.state.position)).toBeGreaterThan(0.5); // offset jest
    for (let i = 0; i < 60; i++) p.updateRender(DT); // ~1 s wygładzania
    expect(p.renderPosition.distanceTo(p.sim.state.position)).toBeLessThan(0.05); // zanikł
  });

  it('render interpoluje pozę między tickami (fps > 60 Hz nie schodkuje)', () => {
    const server = makeServer();
    const p = new Predictor(SPITFIRE_MK2, terrain);
    p.reconcile(server.entity(), 0); // pierwszy autorytet → snap (offset = 0)
    for (let t = 1; t <= 10; t++) p.predict(cmd(), t); // nabierz prędkości

    const before = p.sim.state.position.clone(); // poza SPRZED ostatniego kroku (prev)
    p.predict(cmd(), 11);
    const after = p.sim.state.position.clone(); // poza po kroku (bieżący tick)
    expect(before.distanceTo(after)).toBeGreaterThan(1); // tick faktycznie przesunął samolot

    // offset rekonsyliacji = 0 (zgodna fizyka, pierwszy snap), więc render = czysta interpolacja prev→cur
    p.updateRender(DT, 0);
    expect(p.renderPosition.distanceTo(before)).toBeLessThan(1e-6); // alpha=0 → poprzedni tick
    p.updateRender(DT, 1);
    expect(p.renderPosition.distanceTo(after)).toBeLessThan(1e-6); // alpha=1 → bieżący tick
    p.updateRender(DT, 0.5);
    const mid = before.clone().lerp(after, 0.5);
    expect(p.renderPosition.distanceTo(mid)).toBeLessThan(1e-6); // alpha=0,5 → w pół drogi (brak schodka)
  });

  // --- faza 16: predykcja spadającego wraku gracza (life 'dying') ---

  it('zestrzelenie: reconcile przyjmuje „dying", a predykcja steruje spadającym wrakiem', () => {
    const server = makeServer();
    const p = new Predictor(SPITFIRE_MK2, terrain);
    p.reconcile(server.entity(), 0);
    server.enterWreck();
    p.reconcile(server.entity(), 0); // alive→dying = nieciągłość: przyjmij stan, wyczyść bufor
    expect(p.sim.state.life).toBe('dying');

    const altStart = p.sim.state.position.y;
    const L = 6;
    const delayed: { ack: number; entity: EntitySnapshot }[] = [];
    for (let t = 1; t <= 150; t++) {
      const c = cmd({ rollRight: 0.4 }); // gracz steruje wrakiem (lotki); silnik martwy → opada
      p.predict(c, t);
      server.stepWreck(c);
      delayed.push({ ack: t, entity: server.entity() });
      if (delayed.length > L) {
        const past = delayed.shift();
        if (past) p.reconcile(past.entity, past.ack); // wrak→wrak = ciągłość: replay wraku
      }
    }
    expect(p.sim.state.life).toBe('dying');
    expect(p.sim.state.position.y).toBeLessThan(altStart); // wrak opadł
    // klient zreplayowany do „teraz" pokrywa się z serwerem (mała korekta — ta sama fizyka wraku)
    expect(p.sim.state.position.distanceTo(server.sim.state.position)).toBeLessThan(15);
  });

  it('wrak gracza: po uderzeniu w ziemię predykcja przechodzi w „dead" i przestaje liczyć', () => {
    const server = makeServer();
    const surf = surfaceHeightM(terrain, server.sim.state.position.x, server.sim.state.position.z);
    server.sim.state.position.y = surf + 60; // nisko → wrak szybko uderzy
    const p = new Predictor(SPITFIRE_MK2, terrain);
    p.reconcile(server.entity(), 0);
    server.enterWreck();
    p.reconcile(server.entity(), 0);

    let deadAt = -1;
    for (let t = 1; t <= 600 && deadAt < 0; t++) {
      p.predict(cmd(), t);
      if (p.sim.state.life === 'dead') deadAt = t;
    }
    expect(deadAt).toBeGreaterThan(0);
    // po 'dead' predykcja jest no-op (stan autorytatywny serwera — czekamy na respawn)
    const before = p.sim.state.position.clone();
    p.predict(cmd(), deadAt + 1);
    expect(p.sim.state.position.distanceTo(before)).toBeLessThan(1e-9);
  });
});
