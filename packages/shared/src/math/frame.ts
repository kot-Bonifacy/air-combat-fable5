import { Quaternion, Vector3 } from 'three';

// Body frame (niezmiennik nr 1, docs/fizyka-lotu.md rozdz. 3):
// +Z = nos, +Y = góra kadłuba, +X = LEWE skrzydło (zgodnie z glTF).
// Dostęp do osi samolotu WYŁĄCZNIE przez te helpery.

/** Wektor nosa (body +Z) w układzie świata. */
export function getForward(q: Quaternion, target = new Vector3()): Vector3 {
  return target.set(0, 0, 1).applyQuaternion(q);
}

/** Wektor góry kadłuba (body +Y) w układzie świata. */
export function getUp(q: Quaternion, target = new Vector3()): Vector3 {
  return target.set(0, 1, 0).applyQuaternion(q);
}

/** Wektor PRAWEGO skrzydła (body −X) w układzie świata. */
export function getRight(q: Quaternion, target = new Vector3()): Vector3 {
  return target.set(-1, 0, 0).applyQuaternion(q);
}
