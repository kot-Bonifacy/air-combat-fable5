import { Group, Quaternion, Vector3 } from 'three';
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
// (mesh/model glTF, bufory) i przestawiany `configure()` na początku
// meczu — zmiana trybu/liczby botów nie reparsuje modelu ani nie wycieka meshami
// (wzorzec „alokuj raz", jak pojedynczy enemyMesh w fazie 6).

/** Konfiguracja uczestnika na dany mecz (frakcja, życia, sterowanie). */
export interface CombatantConfig {
  faction: number;
  lives: number;
  name: string;
  /** null = gracz (sterowanie z klawiatury/myszy); Bot = sojusznik/przeciwnik. */
  bot: Bot | null;
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

  /** Stan poprzedni — źródło interpolacji renderu (przesuwany przy zawinięciu torusa). */
  readonly prevPos = new Vector3();
  readonly prevOrient = new Quaternion();

  /** Zapamiętany punkt startu (miejsce respawnu po utracie życia). */
  readonly spawnPos = new Vector3();
  readonly spawnDir = new Vector3(0, 0, 1);

  faction = 0;
  livesLeft = 0;
  /** Zestrzelenia WROGÓW w bieżącym meczu (kredyt; teamkill/samobójstwo nie liczą się). */
  kills = 0;
  /** Asysty: trafienia WROGÓW, którzy zginęli później (dobici przez innego/kolizja/ziemia). */
  assists = 0;
  /**
   * Id strzelców, którzy trafili TĘ maszynę w bieżącym życiu — źródło kredytu asyst,
   * gdy zginie (filtr „wróg, nie zabójca" rozstrzyga caller). Czyszczone przy (re)spawnie.
   */
  readonly damagedBy = new Set<number>();
  name = '';
  bot: Bot | null = null;
  /** false = slot nieużywany w bieżącym meczu (pomijany w pętlach). */
  active = false;
  /** Akumulator czasu między kłębami dymu [s] — wrak ('dying') i trafiona, żywa maszyna. */
  smokeAccumS = 0;
  /**
   * Zwęglony wrak leżący na lądzie po uderzeniu (life 'dead'): mesh ZOSTAJE widoczny,
   * zamrożony w miejscu rozbicia, i lekko dymi do końca meczu. Czyszczone przy (re)spawnie
   * wraz z przywróceniem oryginalnych materiałów (caller). Uderzenie w wodę go NIE ustawia
   * (samolot znika pod taflą).
   */
  burningWreck = false;

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
    // SP lata wyłącznie Spitfire'em (drugi samolot dotyczy multiplayera, faza 19b).
    this.model = createPlaneMesh('spitfire', wingspanM);
    this.mesh = this.model.object;
    this.mesh.visible = false;
  }

  get state(): PlaneState {
    return this.sim.state;
  }

  /** Ustawia slot na bieżący mecz (frakcja/życia/bot). */
  configure(cfg: CombatantConfig): void {
    this.faction = cfg.faction;
    this.livesLeft = cfg.lives;
    this.kills = 0;
    this.assists = 0;
    this.damagedBy.clear();
    this.name = cfg.name;
    this.bot = cfg.bot;
    this.active = true;
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
    const phase = this.state.life;
    // wrak ('dying') zostaje widoczny i spada — chowamy dopiero po uderzeniu o ziemię ('dead');
    // zwęglony wrak na lądzie ('dead' + burningWreck) zostaje widoczny, zamrożony w miejscu rozbicia
    const visible = this.active && (phase === 'alive' || phase === 'dying' || this.burningWreck);
    this.mesh.visible = visible;
    if (!visible) return;
    this.mesh.position.lerpVectors(this.prevPos, this.state.position, alpha);
    this.mesh.quaternion.slerpQuaternions(this.prevOrient, this.state.orientation, alpha);
    // wrak ma martwy silnik → śmigło wytraca obroty i staje
    this.model.update(frameDtS, this.state.throttle, phase === 'alive');
  }
}
