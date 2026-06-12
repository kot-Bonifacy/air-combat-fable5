import { describe, expect, it } from 'vitest';
import { SPITFIRE_MK1 } from '../planes/loader';
import {
  playerDiveTest,
  playerImmelmannTest,
  playerLoopTest,
  playerRollTest,
  playerSplitSTest,
  playerStallRecoveryTest,
} from './player-maneuvers';

// Testy manewrów "jak gracz" — wirtualny pilot symuluje mysz (px przez
// MouseAimCore) i klawiaturę (wychylenia przez PilotControl), czyli DOKŁADNIE
// ścieżkę wejścia klienta. Prędkości wejściowe z Pilot's Notes Spitfire Mk I
// (research 2026-06-13): looping ~300 mph (483 km/h), rolling 180–300 mph,
// half roll off loop 320–350 mph, limit nurkowania 450 mph IAS (724 km/h).
// Pilot's Notes nie podają czasu/wysokości pętli — okna z fizyki (H≈2R,
// bilans energii), szerokie; ciasne kalibracje robią złote testy maneuvers.ts.

const VNE_KMH = 724; // 450 mph IAS — limit płatowca Mk I/II/V z Pilot's Notes

describe('manewry gracza — Spitfire Mk IA przez pełny pipeline myszy/klawiatury', () => {
  it('beczka @ 350 km/h (rolling 180–300 mph): czas z krzywej koperty, tor stabilny', () => {
    const r = playerRollTest(SPITFIRE_MK1, 350);
    // czas 360° zgodny z krzywą rollRate(IAS) ±25% (IAS pływa w trakcie beczki)
    expect(r.rollTimeS).toBeGreaterThan(r.envelopeTimeS * 0.8);
    expect(r.rollTimeS).toBeLessThan(r.envelopeTimeS * 1.25);
    // beczka bez ciągnięcia: tor opada (nośna nie pionowo), ale bez rozsypki
    expect(r.altitudeLossM).toBeGreaterThanOrEqual(0);
    expect(r.altitudeLossM).toBeLessThan(250);
    expect(Math.abs(r.headingDriftDeg)).toBeLessThan(25);
    expect(r.everStalled).toBe(false);
  });

  it('pętla myszą @ 483 km/h (looping ~300 mph): domyka się w pionowej płaszczyźnie', () => {
    const r = playerLoopTest(SPITFIRE_MK1);
    // czas i wysokość z fizyki (H≈2R przy ciągnięciu do 8 G): szerokie okna;
    // zmierzone 2026-06-13: ~9.7 s, +388 m, apex ~307 km/h IAS
    expect(r.loopTimeS).toBeGreaterThan(8);
    expect(r.loopTimeS).toBeLessThan(45);
    expect(r.altitudeGainM).toBeGreaterThan(250);
    expect(r.altitudeGainM).toBeLessThan(1000);
    // pilot dawkuje G wg HUD (clRatio 0.85) — przeciągnięcie = regresja modelu
    expect(r.everStalled).toBe(false);
    expect(r.maxNG).toBeLessThanOrEqual(SPITFIRE_MK1.nMaxG + 0.01);
    // nad szczytem wolno (balistycznie), ale nie zero — pętla, nie przewrót
    expect(r.minIasKmh).toBeGreaterThan(60);
    // pętla ma zostać w swojej pionowej płaszczyźnie i skończyć się po wyjściowym kursie
    expect(r.maxPlaneDeviationM).toBeLessThan(150);
    expect(Math.abs(r.exitHeadingDriftDeg)).toBeLessThan(30);
    expect(r.exitBankDeg).toBeLessThan(35);
  });

  it('nurkowanie z wyprowadzeniem (limit 450 mph IAS): pchnięcie bez przewrotu, G w kopercie', () => {
    const r = playerDiveTest(SPITFIRE_MK1);
    // stożek pushover instruktora: cel pod nosem = pchnięcie, NIE beczka na plecy
    expect(r.pushoverMinUpY).toBeGreaterThan(0.5);
    expect(r.minNG).toBeGreaterThanOrEqual(SPITFIRE_MK1.nMinG - 0.01);
    expect(r.maxNG).toBeLessThanOrEqual(SPITFIRE_MK1.nMaxG + 0.01);
    // rozpędzenie realistyczne i poniżej limitu płatowca z Pilot's Notes
    expect(r.maxIasKmh).toBeGreaterThan(500);
    expect(r.maxIasKmh).toBeLessThan(VNE_KMH);
    // wyprowadzenie: strata wysokości ograniczona (R = V²/(g·(n−1)) → ~150 m + opóźnienia)
    expect(r.pulloutAltitudeLossM).toBeLessThan(600);
    expect(r.minAltitudeM).toBeGreaterThan(700);
    expect(r.finalGammaDeg).toBeGreaterThanOrEqual(-2.5);
    // silnik zdławiony: energia całkowita nie ma prawa rosnąć w żadnym ticku
    expect(r.maxTickEnergyGainJ).toBeLessThanOrEqual(0);
    expect(r.everStalled).toBe(false);
  });

  it('split-S @ 400 km/h: półbeczka klawiaturą + dociągnięcie myszą, przejęcie bez szarpnięcia', () => {
    const r = playerSplitSTest(SPITFIRE_MK1);
    // po półbeczce naprawdę na plecach
    expect(r.invertedUpY).toBeLessThan(-0.7);
    // przejęcie klawiatura→mysz: żądanie n bez skoku (cel postawiony na nosie)
    expect(r.handoffJumpG).toBeLessThan(1);
    // odwrócenie kursu z utratą wysokości w fizycznym oknie (≈2R półpętli w dół)
    expect(Math.abs(r.exitHeadingDriftDeg)).toBeGreaterThan(150);
    expect(r.altitudeLossM).toBeGreaterThan(250);
    expect(r.altitudeLossM).toBeLessThan(1000);
    expect(r.exitUpY).toBeGreaterThan(0.6);
    expect(r.maxNG).toBeLessThanOrEqual(SPITFIRE_MK1.nMaxG + 0.01);
    expect(r.maxIasKmh).toBeLessThan(VNE_KMH);
    expect(r.everStalled).toBe(false);
  });

  it('immelmann @ 530 km/h (half roll off loop 320–350 mph): przez pion + renormalizacja myszy', () => {
    const r = playerImmelmannTest(SPITFIRE_MK1);
    // odwrócenie kursu z zyskiem wysokości (zamiana prędkości na wysokość)
    expect(Math.abs(r.exitHeadingDriftDeg)).toBeGreaterThan(150);
    expect(r.altitudeGainM).toBeGreaterThan(200);
    expect(r.altitudeGainM).toBeLessThan(900);
    expect(r.exitUpY).toBeGreaterThan(0.7);
    // nad szczytem zapas nad przeciągnięciem w locie poziomym (117 km/h)
    expect(r.exitIasKmh).toBeGreaterThan(117);
    expect(r.everStalled).toBe(false);
    // celownik przeszedł przez pion (pitch > 90° — pełna swoboda myszy)...
    expect(r.maxAimPitchDeg).toBeGreaterThan(90);
    // ...i po domknięciu wrócił do normalnej połówki (renormalizacja działa)
    expect(r.finalAimPitchCos).toBeGreaterThanOrEqual(0);
  });

  it('przeciągnięcie z wyprowadzeniem: szarpnięcie → stall + wing drop → klasyczna procedura działa', () => {
    const r = playerStallRecoveryTest(SPITFIRE_MK1);
    expect(r.sawStall).toBe(true);
    // wing drop po przetrzymaniu > wingDropDelayS: skrzydło naprawdę poszło
    expect(r.maxBankDeg).toBeGreaterThan(8);
    // oddanie drążka wychodzi z przeciągnięcia niemal natychmiast i bez nawrotów
    expect(r.timeToUnstallS).toBeLessThan(0.5);
    expect(r.stalledAfterReleaseS).toBeLessThanOrEqual(0.3);
    // wyprowadzenie kosztuje ograniczoną wysokość i kończy się w locie poziomym
    expect(r.altitudeLossM).toBeLessThan(600);
    expect(r.finalGammaDeg).toBeGreaterThanOrEqual(-3);
    expect(r.finalIasKmh).toBeGreaterThan(135);
  });
});
