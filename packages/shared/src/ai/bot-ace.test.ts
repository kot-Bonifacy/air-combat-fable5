import { describe, expect, it } from 'vitest';
import { Quaternion, Vector3 } from 'three';
import { FIXED_DT_S } from '../constants';
import { createPilotDemands } from '../instructor/instructor';
import { createPlaneState, type PlaneState } from '../physics/state';
import { createSimPlane, pilotStep } from '../physics/pilot-step';
import { validatePlaneState } from '../physics/nan-guard';
import { A6M2_ZERO, SPITFIRE_MK2 } from '../planes/loader';
import { Bot, type BotSituation, type BotWingOrders } from './bot';
import { BOT_CONFIG, type DifficultyLevel } from './difficulty';

// Poziom „as" (2026-07-12): świadomość sytuacyjna i antykolizja TYLKO na b.trudnym
// (decyzja usera) — każdy test zestawia asa z poziomem „trudny" jako kontrolą, że
// stare poziomy pozostają nietknięte (knoby 0 = zachowanie sprzed zmiany).

const ENV = { surfaceHeightM: 0 };

/** Samolot w locie poziomym: pozycja/kierunek nosa = kierunek prędkości (jednostkowy dir). */
function flyingState(x: number, y: number, z: number, dir: Vector3, speedMs: number): PlaneState {
  const s = createPlaneState();
  s.position.set(x, y, z);
  s.velocity.copy(dir).multiplyScalar(speedMs);
  s.orientation.copy(new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), dir));
  s.iasMs = speedMs;
  s.throttle = 1;
  s.life = 'alive';
  return s;
}

function makeBot(level: DifficultyLevel, seed = 0xace): Bot {
  return new Bot(BOT_CONFIG.tuning, BOT_CONFIG.levels[level], seed);
}

const FWD = new Vector3(0, 0, 1);
const BACK = new Vector3(0, 0, -1);

describe('as — check-six (wróg wchodzi na ogon, gdy gonię kogoś innego)', () => {
  /** Cel 500 m z przodu (ucieka), a INNY wróg 750 m za ogonem celuje we mnie. */
  function stateWithRearThreat(level: DifficultyLevel): string {
    const self = flyingState(0, 3000, 0, FWD, 130);
    const target = flyingState(0, 3000, 500, FWD, 130);
    const rear = flyingState(0, 3000, -750, FWD, 150); // nos +Z = celuje we mnie
    const bot = makeBot(level);
    bot.reset(self);
    const situation: BotSituation = { enemies: [target, rear], traffic: [target, rear] };
    const demands = createPilotDemands();
    return bot.update(self, SPITFIRE_MK2, target, ENV, FIXED_DT_S, demands, false, situation).state;
  }

  it('as zrywa (evade) — trudny ślepy na wroga z tyłu, bo patrzy tylko na CEL (engage)', () => {
    // wróg z tyłu (750 m < checkSixRangeM 800) NIE jest bieżącym celem (cel = bliższy,
    // 500 m z przodu), więc stara percepcja w ogóle go nie ocenia — niezależnie od dystansu;
    // dopiero skan asa przegląda pełną listę wrogów
    expect(stateWithRearThreat('as')).toBe('evade');
    expect(stateWithRearThreat('trudny')).toBe('engage');
  });

  it('bez situation (zgodność wstecz) as zachowuje się jak dotąd — engage', () => {
    const self = flyingState(0, 3000, 0, FWD, 130);
    const target = flyingState(0, 3000, 500, FWD, 130);
    const bot = makeBot('as');
    bot.reset(self);
    const demands = createPilotDemands();
    expect(bot.update(self, SPITFIRE_MK2, target, ENV, FIXED_DT_S, demands).state).toBe('engage');
  });
});

describe('as — unik czołówki', () => {
  /** Czołówka idealnie kolinearna: obaj lecą na siebie 140 m/s. Cel skryptowany (prosto).
   *  Zwraca [minimalny dystans minięcia, czy padł strzał w fazie zbliżania]. */
  function headOnPass(level: DifficultyLevel): readonly [number, boolean] {
    const sim = createSimPlane(0xace);
    const self = sim.state;
    Object.assign(self, {}); // stan modyfikowany przez referencję niżej
    self.position.set(0, 3000, 0);
    self.velocity.set(0, 0, 140);
    self.orientation.copy(new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), FWD));
    self.iasMs = 140;
    self.throttle = 1;
    self.life = 'alive';
    const target = flyingState(0, 3000, 700, BACK, 140);
    const bot = makeBot(level);
    bot.reset(self);
    const demands = createPilotDemands();
    const situation: BotSituation = { enemies: [target], traffic: [target] };
    let minDist = Infinity;
    let firedWhileClosing = false;
    const ticks = Math.round(3.5 / FIXED_DT_S);
    for (let t = 0; t < ticks; t++) {
      const out = bot.update(self, SPITFIRE_MK2, target, ENV, FIXED_DT_S, demands, false, situation);
      self.throttle = out.throttle;
      pilotStep(sim, SPITFIRE_MK2, demands, FIXED_DT_S);
      target.position.addScaledVector(target.velocity, FIXED_DT_S);
      validatePlaneState(self, `head-on ${level} t${String(t)}`);
      const d = self.position.distanceTo(target.position);
      if (d < minDist) {
        minDist = d;
        if (out.fire) firedWhileClosing = true;
      }
    }
    return [minDist, firedWhileClosing];
  }

  it('as schodzi z osi czołówki (szerokie minięcie, bez strzału) — trudny prze na zderzenie', () => {
    const [asMin, asFired] = headOnPass('as');
    const [hardMin] = headOnPass('trudny');
    expect(asMin).toBeGreaterThan(40); // zamierzone minięcie bokiem
    expect(asFired).toBe(false); // as nie wymienia ognia w czołówce
    expect(hardMin).toBeLessThan(20); // kontrola: stary poziom gra w cykora do końca
    expect(asMin).toBeGreaterThan(hardMin * 2);
  });
});

describe('as — separacja antykolizyjna (sklejanie się skrzydłami)', () => {
  /** Sąsiad 40 m z boku na kursie ZBIEŻNYM (dryf 12 m/s w moją stronę), obaj bez celu.
   *  Zwraca minimalny dystans w 4 s — bez uniku sąsiad przechodzi przez moją pozycję. */
  function convergingPass(level: DifficultyLevel): number {
    const sim = createSimPlane(0xace);
    const self = sim.state;
    self.position.set(0, 3000, 0);
    self.velocity.set(0, 0, 150);
    self.orientation.copy(new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), FWD));
    self.iasMs = 150;
    self.throttle = 0.85;
    self.life = 'alive';
    const buddy = createPlaneState();
    buddy.position.set(40, 3000, 0);
    buddy.velocity.set(-12, 0, 150); // powolny dryf w moją stronę — jak w długim pościgu
    buddy.orientation.copy(new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), FWD));
    buddy.life = 'alive';
    const bot = makeBot(level);
    bot.reset(self);
    const demands = createPilotDemands();
    const situation: BotSituation = { enemies: [], traffic: [buddy] };
    let minDist = Infinity;
    const ticks = Math.round(4 / FIXED_DT_S);
    for (let t = 0; t < ticks; t++) {
      const out = bot.update(self, SPITFIRE_MK2, null, ENV, FIXED_DT_S, demands, false, situation);
      self.throttle = out.throttle;
      pilotStep(sim, SPITFIRE_MK2, demands, FIXED_DT_S);
      buddy.position.addScaledVector(buddy.velocity, FIXED_DT_S);
      validatePlaneState(self, `separacja ${level} t${String(t)}`);
      minDist = Math.min(minDist, self.position.distanceTo(buddy.position));
    }
    return minDist;
  }

  it('as utrzymuje separację — trudny pozwala się „skleić"', () => {
    expect(convergingPass('as')).toBeGreaterThan(25);
    expect(convergingPass('trudny')).toBeLessThan(15);
  });
});

describe('as — WEP bez limitu (user 2026-07-12: boty-asy nie przegrzewają silników)', () => {
  /** Jeden tick engage (cel 500 m na wprost, przede mną) przy zadanym cieple silnika. */
  function wepAt(level: DifficultyLevel, heatFrac: number): boolean {
    const self = flyingState(0, 3000, 0, FWD, 130);
    self.engineHeatFrac = heatFrac;
    const target = flyingState(0, 3000, 500, FWD, 130);
    const bot = makeBot(level);
    bot.reset(self);
    const demands = createPilotDemands();
    const situation: BotSituation = { enemies: [target], traffic: [target] };
    return bot.update(self, SPITFIRE_MK2, target, ENV, FIXED_DT_S, demands, false, situation).wep;
  }

  it('as: WEP w walce NIEZALEŻNIE od ciepła silnika; stare poziomy nigdy', () => {
    expect(wepAt('as', 0.5)).toBe(true);
    expect(wepAt('as', 1.1)).toBe(true); // ponad czerwoną linią — as i tak jedzie na WEP
    expect(wepAt('trudny', 0.2)).toBe(false); // stare poziomy nie znają WEP
    expect(wepAt('latwy', 0.2)).toBe(false);
  });

  it('as w patrolu (gaz przelotowy < 1) nie zgłasza WEP', () => {
    const self = flyingState(0, 3000, 0, FWD, 130);
    self.engineHeatFrac = 0.3;
    const bot = makeBot('as');
    bot.reset(self);
    const demands = createPilotDemands();
    expect(bot.update(self, SPITFIRE_MK2, null, ENV, FIXED_DT_S, demands).wep).toBe(false);
  });
});

describe('as — prędkość bojowa per samolot (autorytet lotek z rollRateCurve)', () => {
  /** Jeden tick engage w Zero przy IAS w „betonie" lotek; kąt do celu steruje decyzją. */
  function zeroThrottle(level: DifficultyLevel, targetToSide: boolean): number {
    const self = flyingState(0, 3000, 0, FWD, 130); // 130 m/s = 468 km/h — beton lotek Zera
    const target = targetToSide
      ? flyingState(600, 3000, 0, FWD, 100) // 90° w bok → walka manewrowa
      : flyingState(0, 3000, 600, FWD, 100); // na wprost → pościg prosty
    const bot = makeBot(level);
    bot.reset(self);
    const demands = createPilotDemands();
    const situation: BotSituation = { enemies: [target], traffic: [target] };
    return bot.update(self, A6M2_ZERO, target, ENV, FIXED_DT_S, demands, false, situation).throttle;
  }

  it('as w Zero schodzi z gazu w ciasnym manewrze (odzysk lotek), pościg prosty = pełny gaz', () => {
    expect(zeroThrottle('as', true)).toBeLessThan(0.7);
    expect(zeroThrottle('as', false)).toBe(1);
    expect(zeroThrottle('trudny', true)).toBe(1); // stary poziom: zawsze pełny gaz
  });

  it('as w Spitfire przy tej samej IAS NIE redukuje gazu (jego lotki jeszcze pracują)', () => {
    const self = flyingState(600, 3000, 0, new Vector3(0, 0, 1), 130);
    const target = flyingState(0, 3000, 0, FWD, 100); // 90° w bok
    const bot = makeBot('as');
    bot.reset(self);
    const demands = createPilotDemands();
    const situation: BotSituation = { enemies: [target], traffic: [target] };
    const out = bot.update(self, SPITFIRE_MK2, target, ENV, FIXED_DT_S, demands, false, situation);
    expect(out.throttle).toBe(1);
  });
});

describe('as — kontrola przestrzelenia (nie wyprzedza wolnego celu, gdy jest z nim sam)', () => {
  /** As tuż za wolniejszym celem (dogania szybko, closure ~60 m/s > próg 55). Zwraca
   *  {throttle, wep, state}. `otherEnemyNear` dokłada drugiego wroga 500 m (< 1 km) → guard OFF. */
  function overshoot(level: DifficultyLevel, otherEnemyNear: boolean): {
    throttle: number;
    wep: boolean;
    state: string;
  } {
    const self = flyingState(0, 3000, 0, FWD, 160); // dogania
    const target = flyingState(0, 3000, 200, FWD, 100); // wolny cel 200 m z przodu
    const enemies = [target];
    if (otherEnemyNear) enemies.push(flyingState(500, 3000, 0, FWD, 130));
    const bot = makeBot(level);
    bot.reset(self);
    const demands = createPilotDemands();
    const situation: BotSituation = { enemies, traffic: enemies };
    const out = bot.update(self, SPITFIRE_MK2, target, ENV, FIXED_DT_S, demands, false, situation);
    return { throttle: out.throttle, wep: out.wep, state: out.state };
  }

  it('as SAM z wolnym celem: zdejmuje gaz (i WEP), by nie przelecieć', () => {
    const r = overshoot('as', false);
    expect(r.state).toBe('engage');
    expect(r.throttle).toBeLessThan(1); // guard dopasowuje prędkość
    expect(r.wep).toBe(false); // zejście gazu < 1 gasi WEP
  });

  it('as z INNYM wrogiem < 1 km: guard OFF — pełny gaz i WEP (energia w kłębowisku)', () => {
    const r = overshoot('as', true);
    expect(r.throttle).toBe(1);
    expect(r.wep).toBe(true);
  });

  it('trudny (brak knoba) nie zna guardu — pełny gaz nawet dogania­jąc wolny cel', () => {
    expect(overshoot('trudny', false).throttle).toBe(1);
  });
});

describe('as — separacja w walce: ciaśniejsza bańka (strzela mimo luźnego tłoku)', () => {
  /** As celuje w cel na wprost (300 m, w stożku → strzela). Sąsiad-ruch z boku na `sideM`.
   *  Zwraca, czy padł strzał. */
  function fireWithNeighbor(level: DifficultyLevel, sideM: number): boolean {
    const self = flyingState(0, 3000, 0, FWD, 130);
    const target = flyingState(0, 3000, 300, FWD, 120); // na wprost, w zasięgu
    const neighbor = flyingState(sideM, 3000, 0, FWD, 130); // sojusznik/ruch z boku
    const bot = makeBot(level);
    bot.reset(self);
    const demands = createPilotDemands();
    const situation: BotSituation = { enemies: [target], traffic: [target, neighbor] };
    return bot.update(self, SPITFIRE_MK2, target, ENV, FIXED_DT_S, demands, false, situation).fire;
  }

  it('luźny sąsiad 60 m obok — as NADAL strzela (poza ciaśniejszą bańką walki)', () => {
    expect(fireWithNeighbor('as', 60)).toBe(true);
  });

  it('sąsiad w kolizyjnej odległości 8 m — as wstrzymuje ogień (antykolizja)', () => {
    expect(fireWithNeighbor('as', 8)).toBe(false);
  });

  it('trudny bez separacji — strzela nawet z sąsiadem 8 m obok (kontrola)', () => {
    expect(fireWithNeighbor('trudny', 8)).toBe(true);
  });
});

describe('as — krótkie serie na dalekim dystansie (oszczędza amunicję > 400 m)', () => {
  /** Cel statyczny na wprost (w stożku/zasięgu ognia) na `rangeM`; zwraca ułamek ticków w 3 s,
   *  w których as trzyma spust. Bot nie jest integrowany (self stały) — mierzymy sam cykl serii. */
  function fireRatio(level: DifficultyLevel, rangeM: number): number {
    const self = flyingState(0, 3000, 0, FWD, 130);
    const target = flyingState(0, 3000, rangeM, FWD, 130);
    const bot = makeBot(level);
    bot.reset(self);
    const demands = createPilotDemands();
    const situation: BotSituation = { enemies: [target], traffic: [target] };
    let fireTicks = 0;
    const ticks = Math.round(3 / FIXED_DT_S);
    for (let t = 0; t < ticks; t++) {
      if (bot.update(self, SPITFIRE_MK2, target, ENV, FIXED_DT_S, demands, false, situation).fire) fireTicks++;
    }
    return fireTicks / ticks;
  }

  it('as > 400 m pulsuje ogniem (przerwy), < 400 m strzela ciągle', () => {
    const far = fireRatio('as', 500);
    expect(far).toBeGreaterThan(0.1); // seriami — jednak strzela
    expect(far).toBeLessThan(0.85); // ...ale z wyraźnymi przerwami (nie ciągiem)
    expect(fireRatio('as', 300)).toBe(1); // blisko = pewny strzał → ogień ciągły
  });

  it('trudny (brak knoba serii) strzela ciągle także z 500 m', () => {
    expect(fireRatio('trudny', 500)).toBe(1);
  });
});

describe('as — koordynacja skrzydłowego (lider atakuje, skrzydłowy ubezpiecza)', () => {
  it('skrzydłowy bez zagrożenia lidera NIE strzela do wspólnego celu; jako lider strzelałby', () => {
    // wspólny wróg na wprost w zasięgu (350 m), lider między nami a wrogiem, wróg leci od lidera
    // (nie zagraża mu) → skrzydłowy trzyma dystans i ogień. Bez roli (lider) as strzela normalnie.
    function fire(withWing: boolean): boolean {
      const self = flyingState(0, 3000, 0, FWD, 130);
      const leader = flyingState(0, 3000, 200, FWD, 130);
      const enemy = flyingState(0, 3000, 350, FWD, 120);
      const bot = makeBot('as');
      bot.reset(self);
      const situation: BotSituation = { enemies: [enemy], traffic: [enemy, leader] };
      const wing: BotWingOrders | undefined = withWing ? { role: 'wingman', leader } : undefined;
      return bot.update(self, SPITFIRE_MK2, enemy, ENV, FIXED_DT_S, createPilotDemands(), false, situation, wing)
        .fire;
    }
    expect(fire(true)).toBe(false); // skrzydłowy trzyma ogień dla lidera
    expect(fire(false)).toBe(true); // ten sam as bez roli — strzela do wspólnego celu
  });

  it('skrzydłowy broni lidera — przełącza cel na wroga wchodzącego liderowi na ogon i atakuje', () => {
    const self = flyingState(0, 3000, 0, FWD, 130);
    const leader = flyingState(0, 3000, 400, FWD, 130);
    // napastnik 200 m za ogonem lidera, nosem +Z ku niemu (celuje w lidera); to nie wspólny cel
    const attacker = flyingState(0, 3000, 200, FWD, 130);
    const commonEnemy = flyingState(0, 3000, 1200, FWD, 120); // „wspólny" cel daleko z przodu
    const bot = makeBot('as');
    bot.reset(self);
    const situation: BotSituation = {
      enemies: [commonEnemy, attacker],
      traffic: [commonEnemy, attacker, leader],
    };
    const wing: BotWingOrders = { role: 'wingman', leader };
    const out = bot.update(self, SPITFIRE_MK2, commonEnemy, ENV, FIXED_DT_S, createPilotDemands(), false, situation, wing);
    expect(out.state).toBe('engage'); // broni: podejmuje walkę z napastnikiem lidera
    expect(out.fire).toBe(true); // strzela do napastnika (200 m na wprost), nie trzyma ognia
  });
});

describe('as — priorytet strefy (wróg dalej niż 1000 m → patrol = lot do strefy)', () => {
  function stateAtRange(level: DifficultyLevel, rangeM: number): string {
    const self = flyingState(0, 3000, 0, FWD, 130);
    const target = flyingState(0, 3000, rangeM, FWD, 130);
    const bot = makeBot(level);
    bot.reset(self);
    const demands = createPilotDemands();
    return bot.update(self, SPITFIRE_MK2, target, ENV, FIXED_DT_S, demands).state;
  }

  it('as ignoruje wroga w 1500 m (leci do strefy), trudny go goni', () => {
    expect(stateAtRange('as', 1500)).toBe('patrol');
    expect(stateAtRange('trudny', 1500)).toBe('engage');
  });

  it('as podejmuje walkę poniżej 1000 m', () => {
    expect(stateAtRange('as', 800)).toBe('engage');
  });
});
