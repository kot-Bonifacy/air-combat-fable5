import { BoxGeometry, ConeGeometry, Group, Mesh, MeshStandardMaterial } from 'three';

/**
 * Bryła zastępcza samolotu z prymitywów (faza 2) — stożek kadłuba + skrzydła
 * + usterzenie. Zbudowana w body frame: +Z nos, +Y góra, +X lewe skrzydło.
 * Wymiary tylko wizualne (≈ sylwetka myśliwca), bez znaczenia dla fizyki.
 */
export function createPlaneMesh(): Group {
  const group = new Group();
  const fuselageMat = new MeshStandardMaterial({ color: 0x5a7d4a });
  const wingMat = new MeshStandardMaterial({ color: 0x6e8e5e });

  const fuselage = new Mesh(new ConeGeometry(0.55, 7, 12), fuselageMat);
  fuselage.geometry.rotateX(Math.PI / 2); // stożek domyślnie celuje w +Y → nos w +Z
  group.add(fuselage);

  const wings = new Mesh(new BoxGeometry(11, 0.16, 1.9), wingMat);
  wings.position.set(0, -0.1, 0.4);
  group.add(wings);

  const tailplane = new Mesh(new BoxGeometry(4, 0.12, 1.1), wingMat);
  tailplane.position.set(0, 0, -3);
  group.add(tailplane);

  const fin = new Mesh(new BoxGeometry(0.12, 1.3, 1.1), wingMat);
  fin.position.set(0, 0.65, -3);
  group.add(fin);

  return group;
}
