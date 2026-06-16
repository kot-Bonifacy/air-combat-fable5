import { Vector3 } from 'three';
import { keyboardDemands } from '../input/pilot-control';
import { Instructor, type PilotDemands } from '../instructor/instructor';
import { validatePlaneState } from '../physics/nan-guard';
import { pilotStep, type SimPlane } from '../physics/pilot-step';
import type { PlaneConfig } from '../planes/loader';
import { wrapToArena } from './arena';
import { updateLifecycle, type LifeEvent } from './lifecycle';
import type { Terrain } from './terrain';

// Autorytatywny tick JEDNEGO sterowanego samolotu (faza 9). Wyciągnięty z serwera
// (GameRoom.stepPlayer) do `shared`, bo używają go OBA autorytety: serwer (symulacja
// pokoju) i klient (predykcja własnego samolotu). Trzymanie tej ścieżki w jednym
// miejscu jest niezmiennikiem reconciliation: replay inputów po stronie klienta MUSI
// przechodzić DOKŁADNIE tym samym kodem co serwer (faza-09.md: krok fizyki = czysta
// funkcja (stan, input) → stan; rozjazd kodu = wieczne drganie korekty).

/**
 * Komendy sterowania jednym samolotem — podzbiór `InputFrame` (te same pola sterujące,
 * bez metadanych sieciowych: sequence/clientTimeMs/fire). `InputFrame` spełnia ten
 * interfejs strukturalnie, więc serwer podaje zdekodowaną ramkę wprost.
 */
export interface PilotCommand {
  /** Przepustnica 0..1. */
  throttle: number;
  /** Wychylenie steru wysokości −1..1 (+ = nos w górę). */
  pitchUp: number;
  /** Wychylenie lotek −1..1 (+ = w prawo). */
  rollRight: number;
  /** Wychylenie steru kierunku −1..1 (+ = nos w prawo). */
  yawRight: number;
  /** Kierunek celu instruktora w świecie (jednostkowy, renormalizowany u źródła). */
  aimX: number;
  aimY: number;
  aimZ: number;
}

const scratchAim = new Vector3();
const scratchWrap = new Vector3();

/**
 * Jeden autorytatywny krok ŻYWEGO samolotu: arbitraż wejścia (klawiatura omija
 * instruktora, mysz prowadzi nos na cel) → `pilotStep` (koperta + fizyka) →
 * zawinięcie torusa → strażnik NaN → cykl życia. `command === null` (chwila po
 * spawnie, zanim przyjdzie input) trzyma lot prosto neutralnymi żądaniami.
 * Mutuje `sim`, `instructor`, `demands`. Zwraca zdarzenie cyklu życia.
 *
 * Kontrakt jest IDENTYCZNY po obu stronach sieci — kolejność operacji to część
 * umowy (jak w pilotStep). Caller (serwer/predykcja) sam decyduje, co zrobić ze
 * zwróconym `LifeEvent` (serwer: respawn; klient: przerwij replay przy kolizji).
 */
export function stepPilotedPlane(
  sim: SimPlane,
  instructor: Instructor,
  plane: PlaneConfig,
  demands: PilotDemands,
  command: PilotCommand | null,
  terrain: Terrain,
  dtS: number,
  context: string,
): LifeEvent {
  const { state } = sim;

  if (command) {
    state.throttle = command.throttle;
    const hasKeyboard =
      command.pitchUp !== 0 || command.rollRight !== 0 || command.yawRight !== 0;
    if (hasKeyboard) {
      // niezerowe wychylenia omijają instruktora (bezpośrednie żądania przez kopertę);
      // instruktor zresetowany, by po powrocie myszy nie strzelił starym stanem filtra
      instructor.reset();
      keyboardDemands(
        state,
        plane,
        { pitchUp: command.pitchUp, rollRight: command.rollRight, yawRight: command.yawRight },
        demands,
      );
    } else {
      // mysz: instruktor prowadzi nos na kierunek celu (jednostkowy w świecie)
      scratchAim.set(command.aimX, command.aimY, command.aimZ).normalize();
      instructor.update(state, plane, scratchAim, dtS, demands);
    }
  } else {
    // brak inputu: trzymaj lot prosto, neutralne żądania
    instructor.reset();
    demands.nDemandG = 1;
    demands.rollRateRadS = 0;
    demands.yawRateRadS = 0;
  }

  pilotStep(sim, plane, demands, dtS);
  wrapToArena(state.position, scratchWrap);
  validatePlaneState(state, context);
  return updateLifecycle(state, terrain, dtS);
}
