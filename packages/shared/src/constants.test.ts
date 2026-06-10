import { describe, expect, it } from 'vitest';
import { INPUT_HZ, PHYSICS_HZ, PORT, SNAPSHOT_HZ } from './constants';

describe('constants', () => {
  it('trzyma uzgodnione tick rates (zmiana wymaga aktualizacji PLAN.md)', () => {
    expect(PHYSICS_HZ).toBe(60);
    expect(SNAPSHOT_HZ).toBe(30);
    expect(INPUT_HZ).toBe(60);
  });

  it('snapshot dzieli równo tick fizyki (interpolacja zakłada stały stosunek)', () => {
    expect(PHYSICS_HZ % SNAPSHOT_HZ).toBe(0);
  });

  it('port serwera dev', () => {
    expect(PORT).toBe(3001);
  });
});
