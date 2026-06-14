import { Group, Mesh, MeshBasicMaterial, Quaternion, SphereGeometry, Vector3 } from 'three';
import {
  Bot,
  createFireControl,
  createHealth,
  createPilotDemands,
  createRng,
  createSimPlane,
  type FireControl,
  type Health,
  type PilotDemands,
  type PlaneConfig,
  type PlaneState,
  type SimPlane,
} from '@air-combat/shared';
import { createPlaneMesh, type PlaneModel } from './plane-mesh';

// Jeden uczestnik walki (gracz albo bot): fizyka + walka + cykl życia + wizual
// w jednym obiekcie (faza 7: tryby multi). Slot alokowany RAZ przy starcie
// (mesh/model glTF, beacon, bufory) i przestawiany `configure()` na początku
// meczu — zmiana trybu/liczby botów nie reparsuje modelu ani nie wycieka meshami
// (wzorzec „alokuj raz", jak pojedynczy enemyMesh w fazie 6).

/** Ukryty beacon (gracz nie potrzebuje znacznika nad własnym samolotem). */
export const BEACON_HIDDEN = -1;

/** Konfiguracja uczestnika na dany mecz (frakcja, życia, sterowanie, kolor). */
export interface CombatantConfig {
  faction: number;
  lives: number;
  name: string;
  /** null = gracz (sterowanie z klawiatury/myszy); Bot = sojusznik/przeciwnik. */
  bot: Bot | null;
  /** Kolor beacona nad samolotem; BEACON_HIDDEN = bez beacona (gracz). */
  beaconColor: number;
}

export class Combatant {
  readonly sim: SimPlane;
  readonly health: Health;
  readonly fire: FireControl;
  readonly demands: PilotDemands;
  /** RNG rozrzutu ognia (osobny strumień per uczestnik → niezależny od innych). */
  readonly rng: () => number;
  readonly model: PlaneModel;
  readonly mesh: Group;
  private readonly beacon: Mesh;
  private readonly beaconMat: MeshBasicMaterial;

  /** Stan poprzedni — źródło interpolacji renderu (przesuwany przy zawinięciu torusa). */
  readonly prevPos = new Vector3();
  readonly prevOrient = new Quaternion();

  /** Zapamiętany punkt startu (miejsce respawnu po utracie życia). */
  readonly spawnPos = new Vector3();
  readonly spawnDir = new Vector3(0, 0, 1);

  faction = 0;
  livesLeft = 0;
  name = '';
  bot: Bot | null = null;
  /** false = slot nieużywany w bieżącym meczu (pomijany w pętlach). */
  active = false;

  constructor(
    /** Stabilny identyfikator = ownerId pocisków (kill credit). Gracz = 0. */
    readonly id: number,
    readonly isPlayer: boolean,
    plane: PlaneConfig,
    wingspanM: number,
    /** Seed (stallMachine + rozrzut) — rozróżnia strumienie losowe slotów. */
    seed: number,
  ) {
    this.sim = createSimPlane(seed);
    this.health = createHealth(plane.hpPool);
    this.fire = createFireControl(plane.armament);
    this.demands = createPilotDemands();
    this.rng = createRng(seed ^ 0x9e37);
    this.model = createPlaneMesh(wingspanM);
    this.mesh = this.model.object;
    this.beaconMat = new MeshBasicMaterial({ color: 0xffffff });
    this.beacon = new Mesh(new SphereGeometry(1.6, 12, 10), this.beaconMat);
    this.beacon.position.set(0, 4, 0);
    this.beacon.visible = false;
    this.mesh.add(this.beacon);
    this.mesh.visible = false;
  }

  get state(): PlaneState {
    return this.sim.state;
  }

  /** Ustawia slot na bieżący mecz (frakcja/życia/bot/kolor beacona). */
  configure(cfg: CombatantConfig): void {
    this.faction = cfg.faction;
    this.livesLeft = cfg.lives;
    this.name = cfg.name;
    this.bot = cfg.bot;
    this.active = true;
    if (cfg.beaconColor === BEACON_HIDDEN) {
      this.beacon.visible = false;
    } else {
      this.beaconMat.color.setHex(cfg.beaconColor);
      this.beacon.visible = true;
    }
  }

  deactivate(): void {
    this.active = false;
    this.mesh.visible = false;
  }

  /** prev = bieżący stan (po (re)spawnie i zawinięciu torusa — bez smugi interpolacji). */
  syncPrev(): void {
    this.prevPos.copy(this.state.position);
    this.prevOrient.copy(this.state.orientation);
  }

  /**
   * Render jednej klatki: widoczność wg stanu życia, interpolacja prev→curr
   * zadaną alfą oraz animacja modelu (śmigło wg gazu). Pozycję/orientację
   * gracza ustawia wołający tym samym wzorem — render() obejmuje boty i wizualnie
   * jest spójny z graczem.
   */
  render(alpha: number, frameDtS: number): void {
    const visible = this.active && this.state.life === 'alive';
    this.mesh.visible = visible;
    if (!visible) return;
    this.mesh.position.lerpVectors(this.prevPos, this.state.position, alpha);
    this.mesh.quaternion.slerpQuaternions(this.prevOrient, this.state.orientation, alpha);
    this.model.update(frameDtS, this.state.throttle);
  }
}
