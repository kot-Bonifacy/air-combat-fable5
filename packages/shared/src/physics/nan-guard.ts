import { PhysicsError } from '../errors';
import type { PlaneState } from './state';

/** Czytelny zrzut stanu do komunikatów błędów i logów debug. */
export function dumpPlaneState(state: PlaneState): string {
  const v = (n: number): string => (Number.isFinite(n) ? n.toPrecision(6) : String(n));
  return [
    `position=(${v(state.position.x)}, ${v(state.position.y)}, ${v(state.position.z)})`,
    `velocity=(${v(state.velocity.x)}, ${v(state.velocity.y)}, ${v(state.velocity.z)})`,
    `orientation=(${v(state.orientation.x)}, ${v(state.orientation.y)}, ${v(state.orientation.z)}, ${v(state.orientation.w)})`,
    `angularRates=(pitch ${v(state.angularRates.pitch)}, roll ${v(state.angularRates.roll)}, yaw ${v(state.angularRates.yaw)})`,
    `throttle=${v(state.throttle)} iasMs=${v(state.iasMs)} loadFactor=${v(state.loadFactor)} stalled=${String(state.stalled)}`,
  ].join('\n');
}

/**
 * Strażnik NaN (niezmiennik nr 7): walidacja stanu po każdym ticku w dev.
 * NaN/Infinity = natychmiastowy wyjątek z dumpem — nigdy nie maskować clampem.
 */
export function validatePlaneState(state: PlaneState, context = ''): void {
  const fields: Record<string, number> = {
    'position.x': state.position.x,
    'position.y': state.position.y,
    'position.z': state.position.z,
    'velocity.x': state.velocity.x,
    'velocity.y': state.velocity.y,
    'velocity.z': state.velocity.z,
    'orientation.x': state.orientation.x,
    'orientation.y': state.orientation.y,
    'orientation.z': state.orientation.z,
    'orientation.w': state.orientation.w,
    'angularRates.pitch': state.angularRates.pitch,
    'angularRates.roll': state.angularRates.roll,
    'angularRates.yaw': state.angularRates.yaw,
    throttle: state.throttle,
    iasMs: state.iasMs,
    loadFactor: state.loadFactor,
  };
  const broken = Object.entries(fields)
    .filter(([, value]) => !Number.isFinite(value))
    .map(([key]) => key);
  if (broken.length > 0) {
    throw new PhysicsError(
      `NaN/Infinity w stanie fizyki${context ? ` (${context})` : ''}: [${broken.join(', ')}]\n${dumpPlaneState(state)}`,
    );
  }
}
