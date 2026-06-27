import { describe, expect, it } from 'vitest';
import { Quaternion, Vector3 } from 'three';
import {
  applyZoneHit,
  computeDamageModifiers,
  createDamageState,
  firstZoneHit,
  isCriticalDamage,
  maybeIgnite,
  NO_DAMAGE_MODIFIERS,
  quantizeZoneLevel,
  stepFire,
  zoneLevels,
  ZONE_COUNT,
  type DamageModifiers,
  type DamageTuning,
  type HitZone,
} from './damage-model';

const tuning: DamageTuning = {
  lightFrac: 0.66,
  heavyFrac: 0.33,
  enginePowerMid: 0.6,
  enginePowerLow: 0.3,
  wingClMaxLossFull: 0.4,
  wingCd0AddFull: 0.02,
  wingRollBiasFullRadS: 0.5,
  tailAuthorityFloor: 0.3,
  tankLeakDrainFactor: 3,
  fireIgniteChanceMg: 0.01,
  fireIgniteChanceCannon: 0.5,
  fireDotPerS: 5,
  fireSelfExtinguishS: 10,
};

const sphere = (r: number): HitZone['shape'] => ({ kind: 'sphere', center: [0, 0, 0], radius: r });

/** 6 stref w kolejności kanonicznej, każda maxHp 40 (HP strefy ≠ integralność). */
function makeZones(): HitZone[] {
  return [
    { role: 'engine', shape: sphere(1), maxHp: 40 },
    { role: 'cockpit', shape: sphere(1), maxHp: 40 },
    { role: 'tank', shape: sphere(1), maxHp: 40 },
    { role: 'wingL', shape: sphere(1), maxHp: 40 },
    { role: 'wingR', shape: sphere(1), maxHp: 40 },
    { role: 'tail', shape: sphere(1), maxHp: 40 },
  ];
}

/** Buduje wektor poziomów [engine, cockpit, tank, wingL, wingR, tail]. */
function lvl(engine = 0, cockpit = 0, tank = 0, wingL = 0, wingR = 0, tail = 0): number[] {
  return [engine, cockpit, tank, wingL, wingR, tail];
}

function mods(levels: number[]): DamageModifiers {
  const out: DamageModifiers = { ...NO_DAMAGE_MODIFIERS };
  return computeDamageModifiers(levels, tuning, out);
}

describe('quantizeZoneLevel', () => {
  it('mapuje ułamek HP na 4 poziomy wg progów', () => {
    expect(quantizeZoneLevel(1, tuning)).toBe(0);
    expect(quantizeZoneLevel(0.7, tuning)).toBe(0);
    expect(quantizeZoneLevel(0.66, tuning)).toBe(1);
    expect(quantizeZoneLevel(0.5, tuning)).toBe(1);
    expect(quantizeZoneLevel(0.33, tuning)).toBe(2);
    expect(quantizeZoneLevel(0.1, tuning)).toBe(2);
    expect(quantizeZoneLevel(0, tuning)).toBe(3);
  });
});

describe('computeDamageModifiers — tożsamość', () => {
  it('brak uszkodzeń → modyfikatory neutralne (złote testy fizyki nietknięte)', () => {
    expect(mods(lvl())).toEqual(NO_DAMAGE_MODIFIERS);
  });
});

describe('isCriticalDamage — sygnał ucieczki bota (faza 22 cz.3)', () => {
  it('sprawny → nie krytyczny; pożar → krytyczny mimo zerowych poziomów', () => {
    expect(isCriticalDamage(lvl(), false)).toBe(false);
    expect(isCriticalDamage(lvl(), true)).toBe(true);
  });

  it('lekkie (poziom 1) nie kwalifikuje; ciężkie/zniszczone (≥ 2) tak — dowolna strefa', () => {
    expect(isCriticalDamage(lvl(1, 1, 1, 1, 1, 1), false)).toBe(false);
    expect(isCriticalDamage(lvl(2), false)).toBe(true); // silnik ciężko
    expect(isCriticalDamage(lvl(0, 0, 0, 0, 0, 3), false)).toBe(true); // ogon zniszczony
  });
});

describe('computeDamageModifiers — silnik', () => {
  it('progi mocy 100/60/30/0 % wg poziomu', () => {
    expect(mods(lvl(0)).enginePowerFactor).toBe(1);
    expect(mods(lvl(1)).enginePowerFactor).toBe(0.6);
    expect(mods(lvl(2)).enginePowerFactor).toBe(0.3);
    expect(mods(lvl(3)).enginePowerFactor).toBe(0);
  });
});

describe('computeDamageModifiers — skrzydła', () => {
  it('zniszczone lewe skrzydło: clMax↓, cd0↑, bias roll w LEWO, korkociąg', () => {
    const m = mods(lvl(0, 0, 0, 3, 0, 0));
    expect(m.clMaxFactor).toBeCloseTo(0.6, 6); // 1 − 0.4
    expect(m.cd0Add).toBeCloseTo(0.02, 6);
    expect(m.rollBiasRadS).toBeCloseTo(-0.5, 6); // przewala się w stronę uszkodzonego (lewego)
    expect(m.spin).toBe(true);
  });

  it('zniszczone prawe skrzydło: bias roll w PRAWO', () => {
    expect(mods(lvl(0, 0, 0, 0, 3, 0)).rollBiasRadS).toBeCloseTo(0.5, 6);
  });

  it('oba skrzydła zniszczone: bias znosi się, clMax = gorsze, cd0 = suma', () => {
    const m = mods(lvl(0, 0, 0, 3, 0, 0).map((_, i) => (i === 3 || i === 4 ? 3 : 0)));
    expect(m.rollBiasRadS).toBeCloseTo(0, 6);
    expect(m.clMaxFactor).toBeCloseTo(0.6, 6);
    expect(m.cd0Add).toBeCloseTo(0.04, 6);
    expect(m.spin).toBe(true);
  });

  it('lekkie uszkodzenie skrzydła skaluje skutek liniowo (poziom/3)', () => {
    const m = mods(lvl(0, 0, 0, 0, 1, 0)); // prawe, poziom 1
    expect(m.clMaxFactor).toBeCloseTo(1 - 0.4 / 3, 6);
    expect(m.rollBiasRadS).toBeCloseTo(0.5 / 3, 6);
    expect(m.spin).toBe(false);
  });
});

describe('computeDamageModifiers — ogon i zbiornik i kabina', () => {
  it('ogon zniszczony → autorytet pitch/yaw spada do podłogi', () => {
    const m = mods(lvl(0, 0, 0, 0, 0, 3));
    expect(m.pitchAuthorityFactor).toBeCloseTo(0.3, 6);
    expect(m.yawAuthorityFactor).toBeCloseTo(0.3, 6);
  });

  it('zbiornik uszkodzony → wyciek (mnożnik zużycia paliwa)', () => {
    expect(mods(lvl(0, 0, 1)).fuelDrainFactor).toBe(3);
    expect(mods(lvl(0, 0, 0)).fuelDrainFactor).toBe(1);
  });

  it('kabina ciężko uszkodzona → pilot ranny', () => {
    expect(mods(lvl(0, 1)).pilotWounded).toBe(false);
    expect(mods(lvl(0, 2)).pilotWounded).toBe(true);
  });
});

describe('applyZoneHit — HP strefy (integralność = health, osobno)', () => {
  it('trafienie ujmuje HP strefy', () => {
    const zones = makeZones();
    const state = createDamageState(zones);
    const r = applyZoneHit(zones, state, 0, 10);
    expect(state.zoneHp[0]).toBe(30);
    expect(r.role).toBe('engine');
    expect(r.zoneDestroyed).toBe(false);
  });

  it('dobicie strefy zgłasza zoneDestroyed dokładnie raz', () => {
    const zones = makeZones();
    const state = createDamageState(zones);
    expect(applyZoneHit(zones, state, 1, 40).zoneDestroyed).toBe(true); // kabina → 0
    expect(state.zoneHp[1]).toBe(0);
    expect(applyZoneHit(zones, state, 1, 10).zoneDestroyed).toBe(false); // już martwa, no-op
  });
});

describe('zoneLevels — mapowanie na role kanoniczne', () => {
  it('liczy poziomy niezależnie od kolejności stref w JSON', () => {
    // strefy w ODWROTNEJ kolejności — mapowanie po roli, nie po indeksie
    const zones: HitZone[] = makeZones().reverse();
    const state = createDamageState(zones);
    // znajdź indeks tanku w tej (odwróconej) tablicy i uszkodź go do poziomu 2
    const tankIdx = zones.findIndex((z) => z.role === 'tank');
    state.zoneHp[tankIdx] = 40 * 0.2; // frac 0.2 → poziom 2
    const out = new Array<number>(ZONE_COUNT).fill(0);
    zoneLevels(zones, state, tuning, out);
    expect(out[2]).toBe(2); // kanoniczny indeks tank = 2
    expect(out.filter((v) => v !== 0)).toHaveLength(1);
  });
});

describe('firstZoneHit — narrow-phase: wybór strefy (body→world)', () => {
  // strefy w pozycjach na osi Z (centerline) + skrzydła na osi X — łatwe do trafienia odcinkiem
  function geomZones(): HitZone[] {
    return [
      { role: 'engine', shape: { kind: 'sphere', center: [0, 0, 5], radius: 1 }, maxHp: 40 },
      { role: 'cockpit', shape: { kind: 'sphere', center: [0, 0, 0], radius: 1 }, maxHp: 40 },
      { role: 'tank', shape: { kind: 'sphere', center: [0, 0, -3], radius: 1 }, maxHp: 40 },
      { role: 'wingL', shape: { kind: 'capsule', a: [1, 0, 0], b: [6, 0, 0], radius: 0.5 }, maxHp: 40 },
      { role: 'wingR', shape: { kind: 'capsule', a: [-1, 0, 0], b: [-6, 0, 0], radius: 0.5 }, maxHp: 40 },
      { role: 'tail', shape: { kind: 'sphere', center: [0, 0, -8], radius: 1 }, maxHp: 40 },
    ];
  }
  const ID = new Quaternion();
  const ORIGIN = new Vector3();

  it('pocisk z TYŁU (−Z→+Z) na osi trafia najpierw OGON (najwcześniej na torze)', () => {
    const idx = firstZoneHit(geomZones(), ORIGIN, ID, new Vector3(0, 0, -12), new Vector3(0, 0, 12));
    expect(idx).toBe(5); // tail (z=−8) jest najbliżej startu pocisku
  });

  it('pocisk z PRZODU (+Z→−Z) na osi trafia najpierw SILNIK', () => {
    const idx = firstZoneHit(geomZones(), ORIGIN, ID, new Vector3(0, 0, 12), new Vector3(0, 0, -12));
    expect(idx).toBe(0); // engine (z=5) najbliżej startu
  });

  it('kapsuła skrzydła trafiona torem równoległym do Z przy x=3', () => {
    const idx = firstZoneHit(geomZones(), ORIGIN, ID, new Vector3(3, 0, 5), new Vector3(3, 0, -5));
    expect(idx).toBe(3); // wingL (oś x∈[1,6]) — sfery centerline (x=0,r1) są poza zasięgiem przy x=3
  });

  it('pocisk mijający obrys → −1 (żadnej strefy)', () => {
    const idx = firstZoneHit(geomZones(), ORIGIN, ID, new Vector3(20, 20, 5), new Vector3(20, 20, -5));
    expect(idx).toBe(-1);
  });

  it('orientacja ma znaczenie: obrót 180° wokół Y zamienia przód↔tył', () => {
    const q = new Quaternion(0, 1, 0, 0); // 180° wokół Y: [x,y,z]→[−x,y,−z]
    // ten sam pocisk z przodu (+Z→−Z) — po obrocie silnik jest z TYŁU, więc najpierw OGON (z=8 w świecie)
    const idx = firstZoneHit(geomZones(), ORIGIN, q, new Vector3(0, 0, 12), new Vector3(0, 0, -12));
    expect(idx).toBe(5); // tail
  });

  it('przesunięcie celu (center) transluje strefy', () => {
    const center = new Vector3(100, 50, 0);
    const idx = firstZoneHit(
      geomZones(),
      center,
      ID,
      new Vector3(100, 50, 12),
      new Vector3(100, 50, -12),
    );
    expect(idx).toBe(0); // engine — strefy poszły za center
  });
});

describe('pożar — zapłon, DoT, samowygaszenie', () => {
  it('zapłon: szansa działka >> karabinu', () => {
    const zones = makeZones();
    const s1 = createDamageState(zones);
    const s2 = createDamageState(zones);
    const rng = () => 0.4;
    expect(maybeIgnite(s1, tuning, true, rng)).toBe(true); // 0.4 < 0.5 (działko)
    expect(maybeIgnite(s2, tuning, false, rng)).toBe(false); // 0.4 > 0.01 (kaem)
  });

  it('DoT zwraca obrażenia/tick i pożar gaśnie po fireSelfExtinguishS', () => {
    const zones = makeZones();
    const state = createDamageState(zones);
    maybeIgnite(state, tuning, true, () => 0); // pewny zapłon
    let total = 0;
    for (let i = 0; i < 5; i++) total += stepFire(state, tuning, 1);
    expect(total).toBe(5 * 5); // 5 s × 5 HP/s
    expect(state.onFire).toBe(true);
    for (let i = 0; i < 5; i++) stepFire(state, tuning, 1); // łącznie 10 s
    expect(state.onFire).toBe(false); // wygasł sam
    expect(stepFire(state, tuning, 1)).toBe(0); // po wygaśnięciu brak obrażeń
  });
});
