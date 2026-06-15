import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { createPlaneState, type PlaneState } from '../physics/state';
import { SPOT_RANGE_M } from '../constants';
import { selectNearestTarget } from './bot';

// Bramka zasięgu wykrycia (faza 7: oznaczanie wrogów dopiero ≤ SPOT_RANGE_M).
// selectNearestTarget czyta tylko `position` i `life` — budujemy minimalne stany.
function planeAt(x: number, z: number, life: PlaneState['life'] = 'alive'): PlaneState {
  const s = createPlaneState();
  s.position.set(x, 0, z);
  s.life = life;
  return s;
}

describe('selectNearestTarget — bramka zasięgu wykrycia', () => {
  const self = new Vector3(0, 0, 0);

  it('pomija cel poza zasięgiem, wybiera ten w zasięgu', () => {
    const near = planeAt(0, SPOT_RANGE_M - 100);
    const far = planeAt(0, SPOT_RANGE_M + 100);
    expect(selectNearestTarget(self, [far, near], SPOT_RANGE_M)).toBe(near);
  });

  it('zwraca null, gdy wszystkie cele są poza zasięgiem (twardy próg)', () => {
    const far1 = planeAt(0, SPOT_RANGE_M + 1);
    const far2 = planeAt(SPOT_RANGE_M + 500, 0);
    expect(selectNearestTarget(self, [far1, far2], SPOT_RANGE_M)).toBeNull();
  });

  it('spośród celów w zasięgu wybiera najbliższy', () => {
    const closer = planeAt(300, 0);
    const farther = planeAt(0, 1500);
    expect(selectNearestTarget(self, [farther, closer], SPOT_RANGE_M)).toBe(closer);
  });

  it('pomija cel martwy mimo bliskości', () => {
    const deadClose = planeAt(100, 0, 'dead');
    const aliveFar = planeAt(0, 1500);
    expect(selectNearestTarget(self, [deadClose, aliveFar], SPOT_RANGE_M)).toBe(aliveFar);
  });

  it('bez limitu (domyślnie) wybiera nawet cel daleko poza zasięgiem', () => {
    const far = planeAt(0, SPOT_RANGE_M + 3000);
    expect(selectNearestTarget(self, [far])).toBe(far);
  });
});
