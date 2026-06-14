import { describe, expect, it } from 'vitest';
import { ZONE_CAPTURE_SECONDS, ZONE_RADIUS_M } from '../constants';
import { ZoneControl, isInZone, zoneOccupancy, type ZoneOccupant } from './zone';

// Kontrola strefy (faza 7): KotH bez cofania. Wyłączna obecność jednej frakcji
// nabija jej czas; sporna/pusta = pauza (bez zaniku); pierwsza do progu wygrywa.

/** Okupant w danej frakcji, na promieniu r od środka strefy (domyślnie środek, żywy). */
const occ = (faction: number, rM = 0, alive = true): ZoneOccupant => ({
  faction,
  alive,
  xM: rM,
  zM: 0,
});

describe('isInZone', () => {
  it('środek i wnętrze należą do strefy', () => {
    expect(isInZone(0, 0)).toBe(true);
    expect(isInZone(ZONE_RADIUS_M - 1, 0)).toBe(true);
    expect(isInZone(0, -(ZONE_RADIUS_M - 1))).toBe(true);
  });

  it('poza promieniem — nie', () => {
    expect(isInZone(ZONE_RADIUS_M + 1, 0)).toBe(false);
    expect(isInZone(ZONE_RADIUS_M, ZONE_RADIUS_M)).toBe(false); // przekątna > r
  });
});

describe('zoneOccupancy', () => {
  it('pusta strefa → brak kontroli, nieobsadzona', () => {
    expect(zoneOccupancy([])).toEqual({ controlling: null, occupied: false });
  });

  it('jedna frakcja sama → kontroluje', () => {
    expect(zoneOccupancy([occ(2), occ(2, 100)])).toEqual({ controlling: 2, occupied: true });
  });

  it('dwie frakcje obecne → sporna (controlling null, ale occupied)', () => {
    expect(zoneOccupancy([occ(0), occ(1)])).toEqual({ controlling: null, occupied: true });
  });

  it('samoloty poza promieniem nie liczą się', () => {
    expect(zoneOccupancy([occ(1, ZONE_RADIUS_M + 500)])).toEqual({
      controlling: null,
      occupied: false,
    });
  });

  it('martwy w strefie nie kontroluje', () => {
    expect(zoneOccupancy([occ(1, 0, false)])).toEqual({ controlling: null, occupied: false });
  });

  it('count przycina bufor wielokrotnego użytku (ignoruje ogon)', () => {
    const buf = [occ(3), occ(9, ZONE_RADIUS_M + 1)]; // drugi to „stary" wpis spoza count
    expect(zoneOccupancy(buf, 1)).toEqual({ controlling: 3, occupied: true });
  });
});

describe('ZoneControl', () => {
  it('akumuluje czas wyłącznej kontroli i przejmuje po progu', () => {
    const z = new ZoneControl();
    let captured: number | null = null;
    // 1 s kroki przez cały próg + 1
    for (let s = 0; s < ZONE_CAPTURE_SECONDS; s++) {
      const tick = z.update([occ(0)], 1);
      captured = tick.captured;
    }
    expect(z.seconds(0)).toBeCloseTo(ZONE_CAPTURE_SECONDS, 6);
    expect(captured).toBe(0);
    expect(z.progress(0)).toBe(1);
  });

  it('sporna strefa pauzuje (żaden licznik nie rośnie)', () => {
    const z = new ZoneControl();
    z.update([occ(0), occ(1)], 5);
    expect(z.seconds(0)).toBe(0);
    expect(z.seconds(1)).toBe(0);
  });

  it('pusta strefa trzyma postęp bez zaniku (KotH bez cofania)', () => {
    const z = new ZoneControl();
    z.update([occ(0)], 30);
    z.update([], 30); // strefa opuszczona
    z.update([], 30);
    expect(z.seconds(0)).toBe(30); // nic nie spadło
  });

  it('liczniki frakcji niezależne (FFA)', () => {
    const z = new ZoneControl();
    z.update([occ(0)], 10);
    z.update([occ(1)], 4);
    z.update([occ(0)], 6);
    expect(z.seconds(0)).toBe(16);
    expect(z.seconds(1)).toBe(4);
  });

  it('po przejęciu liczniki zamrożone (mecz rozstrzygnięty)', () => {
    const z = new ZoneControl();
    z.update([occ(1)], ZONE_CAPTURE_SECONDS); // frakcja 1 przejmuje
    expect(z.captured).toBe(1);
    const after = z.update([occ(0)], 100); // ktoś inny w strefie — bez efektu
    expect(after.captured).toBe(1);
    expect(z.seconds(0)).toBe(0);
  });

  it('reset czyści liczniki i przejęcie', () => {
    const z = new ZoneControl();
    z.update([occ(0)], ZONE_CAPTURE_SECONDS);
    z.reset();
    expect(z.captured).toBeNull();
    expect(z.seconds(0)).toBe(0);
  });
});
