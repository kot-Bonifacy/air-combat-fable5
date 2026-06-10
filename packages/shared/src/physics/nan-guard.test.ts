import { describe, expect, it } from 'vitest';
import { PhysicsError } from '../errors';
import { validatePlaneState } from './nan-guard';
import { createPlaneState } from './state';

describe('strażnik NaN', () => {
  it('przepuszcza poprawny stan', () => {
    expect(() => validatePlaneState(createPlaneState())).not.toThrow();
  });

  it('wstrzyknięty NaN → PhysicsError z nazwą pola i dumpem stanu', () => {
    const state = createPlaneState();
    state.position.x = Number.NaN;
    state.velocity.y = Number.POSITIVE_INFINITY;

    let caught: unknown;
    try {
      validatePlaneState(state, 'test wstrzyknięcia');
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(PhysicsError);
    const message = (caught as PhysicsError).message;
    expect(message).toContain('position.x');
    expect(message).toContain('velocity.y');
    expect(message).toContain('test wstrzyknięcia');
    expect(message).toContain('orientation='); // dump pełnego stanu
  });
});
