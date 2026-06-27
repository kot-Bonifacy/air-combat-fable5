import { describe, expect, it } from 'vitest';
import { BF109_E, SPITFIRE_MK2, type PlaneConfig, type WeaponGroup } from '../planes/loader';
import { CANNON_DAMAGE_THRESHOLD } from '../constants';
import type { ZoneRole } from './damage-model';

// =============================== TTK / balans uzbrojenia (faza 22 cz.5) ===============================
//
// Analityczny pomiar „czasu do killa" działko 20 mm vs kaem 7,7 mm — dokumentacja + LOCK regresji.
// Czyta WYŁĄCZNIE realne dane z JSON (loader), więc liczby tu = liczby w grze. Mechanika (zweryfikowana
// w kodzie serwera/shared, faza 22 cz.2):
//   • każde trafienie: applyDamage(health, damagePerHit)  ORAZ  applyZoneHit(strefa, damagePerHit),
//   • kadencja grupy = muzzles.length × fireRateRpmPerGun / 60  [pocisków/s] (wszystkie lufy naraz),
//   • śmierć: integralność (health) ≤ 0  LUB  strefa krytyczna (skrzydło/kabina) → 0 HP (natychmiast).
//
// Metryki są DETERMINISTYCZNE i niezależne od umiejętności pilota:
//   • „integralność" = trafienia/czas do zera health (rozproszony ogień — realny dolny próg),
//   • „skrzydło/kabina" = trafienia do zniszczenia strefy (ogień SKUPIONY — najlepszy przypadek).
// Realny kill leży między nimi. Czas @100% = teoretyczne podłoże (ciągły ogień, każdy pocisk trafia).
//
// Asercje kodują INTENCJĘ PROJEKTOWĄ w tolerancyjnych pasmach (działko decydujące, kaem = długa seria,
// pożar dobija a nie zabija pełnego, asymetria skrzydła odczuwalna lecz opanowalna). Strojenie balansu
// (knoby w sekcji `damage` / `armament` JSON) MOŻE ruszać liczby — wyjście poza pasmo to świadomy sygnał
// „zaktualizuj ten test", nie cichy regres. Subiektywne odczucie (asymetria na drążku, sesja z testerami)
// jest po stronie usera — patrz docs/phases/faza-22.md, Część 5.

const RAD2DEG = 180 / Math.PI;

/** Działko = grupa o damagePerHit ≥ progu kalibru; kaem = poniżej (ten sam podział co serwer). */
const spit303 = SPITFIRE_MK2.armament.groups.find((g) => g.damagePerHit < CANNON_DAMAGE_THRESHOLD)!;
const bfMg17 = BF109_E.armament.groups.find((g) => g.damagePerHit < CANNON_DAMAGE_THRESHOLD)!;
const bfCannon = BF109_E.armament.groups.find((g) => g.damagePerHit >= CANNON_DAMAGE_THRESHOLD)!;

function roundsPerSec(group: WeaponGroup): number {
  return (group.muzzles.length * group.fireRateRpmPerGun) / 60;
}

/** Trafienia do sprowadzenia integralności (health) do zera — rozproszony ogień (realny próg). */
function integrityHtk(group: WeaponGroup, target: PlaneConfig): number {
  return Math.ceil(target.hpPool / group.damagePerHit);
}

/** Czas do killa integralnością przy ciągłym ogniu i 100% trafień [s] — teoretyczne podłoże. */
function integrityTtkS(group: WeaponGroup, target: PlaneConfig): number {
  return target.hpPool / (group.damagePerHit * roundsPerSec(group));
}

function zoneMaxHp(target: PlaneConfig, role: ZoneRole): number {
  const z = target.zones.find((zone) => zone.role === role);
  if (!z) throw new Error(`brak strefy ${role} w ${target.name}`);
  return z.maxHp;
}

/** Trafienia do zniszczenia strefy (skupiony ogień w jedną bryłę) — najlepszy przypadek. */
function zoneHtk(group: WeaponGroup, target: PlaneConfig, role: ZoneRole): number {
  return Math.ceil(zoneMaxHp(target, role) / group.damagePerHit);
}

/** P(zapłon) w serii n trafień: 1 − (1 − szansa)^n (szansa per trafienie wg kalibru). */
function igniteProbInBurst(target: PlaneConfig, cannon: boolean, hits: number): number {
  const chance = cannon ? target.damage.fireIgniteChanceCannon : target.damage.fireIgniteChanceMg;
  return 1 - Math.pow(1 - chance, hits);
}

function peakRollRateDegS(plane: PlaneConfig): number {
  return Math.max(...plane.rollRateCurve.map(([, rate]) => rate));
}

/** Bias przechyłu przy CIĘŻKO uszkodzonym jednym skrzydle (poziom 2, drugie 0) [°/s]. */
function heavyWingBiasDegS(plane: PlaneConfig): number {
  return (2 / 3) * plane.damage.wingRollBiasFullRadS * RAD2DEG;
}

interface Shooter {
  label: string;
  group: WeaponGroup;
  cannon: boolean;
}

const SHOOTERS: readonly Shooter[] = [
  { label: 'Spitfire .303×8', group: spit303, cannon: false },
  { label: 'Bf 109 MG 17×2', group: bfMg17, cannon: false },
  { label: 'Bf 109 MG FF 20mm×2', group: bfCannon, cannon: true },
];

const TARGETS: readonly { label: string; plane: PlaneConfig }[] = [
  { label: 'Spitfire', plane: SPITFIRE_MK2 },
  { label: 'Bf 109', plane: BF109_E },
];

describe('TTK — działko 20 mm vs kaem 7,7 mm (dokumentacja + lock regresji)', () => {
  it('loguje tabelę czasu do killa (do notatki balansowej memory)', () => {
    for (const s of SHOOTERS) {
      const rps = roundsPerSec(s.group);
      console.info(
        `[TTK] ${s.label}: ${s.group.damagePerHit} HP/trafienie, ${rps.toFixed(1)} poc./s` +
          ` (${s.group.muzzles.length} luf × ${String(s.group.fireRateRpmPerGun)} RPM)`,
      );
      for (const t of TARGETS) {
        const htk = integrityHtk(s.group, t.plane);
        console.info(
          `       → ${t.label}: integralność ${String(htk)} traf (${integrityTtkS(s.group, t.plane).toFixed(2)} s @100%),` +
            ` skrzydło ${String(zoneHtk(s.group, t.plane, 'wingL'))} traf, kabina ${String(zoneHtk(s.group, t.plane, 'cockpit'))} traf,` +
            ` P(pożar w serii do killa)=${(igniteProbInBurst(t.plane, s.cannon, htk) * 100).toFixed(0)}%`,
        );
      }
    }
    for (const t of TARGETS) {
      console.info(
        `[asymetria skrzydła] ${t.label}: bias ciężkiego skrzydła ${heavyWingBiasDegS(t.plane).toFixed(0)}°/s` +
          ` (szczyt roll ${String(peakRollRateDegS(t.plane))}°/s → ${((heavyWingBiasDegS(t.plane) / peakRollRateDegS(t.plane)) * 100).toFixed(0)}% szczytu)`,
      );
    }
    expect(true).toBe(true); // test służy logowaniu + jest bramą dla asercji niżej
  });

  it('działko jest decydujące: ≤ 4 trafienia integralnością, ≤ 1 s ciągłego ognia', () => {
    for (const t of TARGETS) {
      expect(integrityHtk(bfCannon, t.plane)).toBeLessThanOrEqual(4);
      expect(integrityTtkS(bfCannon, t.plane)).toBeLessThanOrEqual(1.0);
    }
  });

  it('działko skupione urywa skrzydło/kabinę w ≤ 3 trafieniach (kill krytyczny)', () => {
    for (const t of TARGETS) {
      expect(zoneHtk(bfCannon, t.plane, 'wingL')).toBeLessThanOrEqual(3);
      expect(zoneHtk(bfCannon, t.plane, 'cockpit')).toBeLessThanOrEqual(3);
    }
  });

  it('kaem 7,7 mm wymaga długiej serii (≥ 20 trafień integralnością — „peashooter")', () => {
    expect(integrityHtk(spit303, BF109_E)).toBeGreaterThanOrEqual(20);
    expect(integrityHtk(spit303, SPITFIRE_MK2)).toBeGreaterThanOrEqual(20);
    expect(integrityHtk(bfMg17, SPITFIRE_MK2)).toBeGreaterThanOrEqual(20);
    expect(integrityHtk(bfMg17, BF109_E)).toBeGreaterThanOrEqual(20);
  });

  it('asymetria kalibru: działko ≥ 15× obrażeń na trafienie względem kaemu', () => {
    const minMg = Math.min(spit303.damagePerHit, bfMg17.damagePerHit);
    expect(bfCannon.damagePerHit).toBeGreaterThanOrEqual(15 * minMg);
  });

  it('pożar DOBIJA, nie zabija pełnego: maks. obrażenia ognia < najmniejsza pula HP', () => {
    const minHp = Math.min(SPITFIRE_MK2.hpPool, BF109_E.hpPool);
    for (const t of TARGETS) {
      const fireMax = t.plane.damage.fireDotPerS * t.plane.damage.fireSelfExtinguishS;
      expect(fireMax).toBeLessThan(minHp);
    }
  });

  it('działko zapala znacznie częściej niż kaem (≥ 3× szansa na trafienie)', () => {
    for (const t of TARGETS) {
      expect(t.plane.damage.fireIgniteChanceCannon).toBeGreaterThanOrEqual(
        3 * t.plane.damage.fireIgniteChanceMg,
      );
    }
  });

  it('asymetria skrzydła ODCZUWALNA lecz opanowalna: bias ciężkiego skrzydła 8–60% szczytu roll', () => {
    for (const t of TARGETS) {
      const frac = heavyWingBiasDegS(t.plane) / peakRollRateDegS(t.plane);
      expect(frac).toBeGreaterThanOrEqual(0.08);
      expect(frac).toBeLessThanOrEqual(0.6);
    }
  });
});
