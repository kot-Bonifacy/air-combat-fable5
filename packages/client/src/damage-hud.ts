import { ZONE_ROLES, type EntityDamage, type ZoneRole } from '@air-combat/shared';

// HUD modułowych uszkodzeń (faza 22 cz.4): sylwetka własnego samolotu z góry, sześć stref
// kolorowanych poziomem uszkodzenia (0 zielony → 3 ciemnoczerwony) + wskaźniki pożaru / wycieku /
// rannego pilota. Źródło danych: poziomy stref ze snapshotu v8 (EntityDamage) lokalnej encji —
// te SAME, którymi fizyka liczy modyfikatory, więc HUD nie kłamie względem zachowania maszyny.
//
// Logika mapowania (poziom→kolor, flagi, etykieta śmierci) jest CZYSTA i testowalna bez DOM;
// klasa DamageHud tylko maluje SVG (jak Hud/ZoneBar — render bez logiki w testach Node).

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Barwa strefy wg poziomu 0..3 (0=ok zielony, 1=lekkie żółte, 2=ciężkie pomarańcz, 3=zniszczone). */
const ZONE_LEVEL_COLORS = ['#2f9e44', '#e6b800', '#e8741f', '#7a1010'] as const;

/** Kolor wypełnienia strefy dla danego poziomu uszkodzenia (clamp do 0..3). */
export function zoneLevelColor(level: number): string {
  const i = Math.round(level);
  return ZONE_LEVEL_COLORS[i < 0 ? 0 : i > 3 ? 3 : i]!;
}

const COCKPIT_IDX = ZONE_ROLES.indexOf('cockpit');
const TANK_IDX = ZONE_ROLES.indexOf('tank');

/** Flagi stanu do wskaźników HUD: pożar, wyciek paliwa (zbiornik ≥1), pilot ranny (kabina ≥2). */
export function damageFlags(damage: EntityDamage): { fire: boolean; leak: boolean; pilot: boolean } {
  const levels = damage.levels;
  return {
    fire: damage.onFire,
    leak: (levels[TANK_IDX] ?? 0) >= 1,
    pilot: (levels[COCKPIT_IDX] ?? 0) >= 2,
  };
}

/** Polska nazwa modułu (do komunikatu śmierci „ZESTRZELONY — SILNIK"). Wielkie litery jak nagłówek. */
const ZONE_DEATH_LABEL: Record<ZoneRole, string> = {
  engine: 'SILNIK',
  cockpit: 'PILOT',
  tank: 'ZBIORNIK',
  wingL: 'SKRZYDŁO',
  wingR: 'SKRZYDŁO',
  tail: 'OGON',
};

/** Priorytet przy remisie poziomów (co najpewniej dobiło): pilot > silnik > skrzydło > ogon > zbiornik. */
const ZONE_DEATH_PRIORITY: Record<ZoneRole, number> = {
  cockpit: 5,
  engine: 4,
  wingL: 3,
  wingR: 3,
  tail: 2,
  tank: 1,
};

/**
 * Najbardziej prawdopodobny moduł będący przyczyną śmierci (do wzbogacenia `deathLabel`): pożar ma
 * pierwszeństwo, dalej strefa o najwyższym poziomie (≥2), remis rozstrzyga priorytet roli. null, gdy
 * nic krytycznego (np. zwykłe dobicie kadłuba/integralności — wtedy zostaje samo „ZESTRZELONY").
 */
export function criticalZoneLabel(damage: EntityDamage): string | null {
  if (damage.onFire) return 'POŻAR';
  let bestRole: ZoneRole | null = null;
  let bestScore = -1;
  for (let i = 0; i < ZONE_ROLES.length; i++) {
    const level = damage.levels[i] ?? 0;
    if (level < 2) continue;
    const role = ZONE_ROLES[i]!;
    const score = level * 10 + ZONE_DEATH_PRIORITY[role];
    if (score > bestScore) {
      bestScore = score;
      bestRole = role;
    }
  }
  return bestRole ? ZONE_DEATH_LABEL[bestRole] : null;
}

// --- geometria sylwetki (widok z góry, nos u góry; +X = lewe skrzydło = lewa strona ekranu) ---
// Każda strefa to jeden element SVG kolorowany poziomem. Spine (neutralny) spina nos z ogonem,
// żeby drobne szczeliny między strefami czytały się jak linie podziału płatowca, nie dziury.

interface ZoneShape {
  role: ZoneRole;
  el: SVGElement;
}

/** Tworzy element SVG strefy (polygon/ellipse) z atrybutami i wstępnym kolorem. */
function makeShape(tag: 'polygon' | 'ellipse', attrs: Record<string, string>): SVGElement {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  el.setAttribute('stroke', 'rgba(8,14,20,0.85)');
  el.setAttribute('stroke-width', '1.2');
  return el;
}

export class DamageHud {
  private readonly root: HTMLElement;
  private readonly shapes: ZoneShape[] = [];
  private readonly fireEl: HTMLElement;
  private readonly leakEl: HTMLElement;
  private readonly pilotEl: HTMLElement;

  constructor(container: HTMLElement) {
    this.root = container;
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 100 108');
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', '100%');

    // neutralny grzbiet kadłuba (nos→ogon) pod strefami
    const spine = document.createElementNS(SVG_NS, 'polygon');
    spine.setAttribute('points', '50,8 56,30 53,86 47,86 44,30');
    spine.setAttribute('fill', '#33404d');
    svg.appendChild(spine);

    // strefy (kolejność rysowania: skrzydła i ogon pod, silnik/zbiornik/kabina na wierzchu)
    const defs: { role: ZoneRole; tag: 'polygon' | 'ellipse'; attrs: Record<string, string> }[] = [
      { role: 'wingL', tag: 'polygon', attrs: { points: '46,32 6,47 11,54 46,44' } },
      { role: 'wingR', tag: 'polygon', attrs: { points: '54,32 94,47 89,54 54,44' } },
      { role: 'tail', tag: 'polygon', attrs: { points: '45,60 55,60 58,84 72,94 72,99 28,99 28,94 42,84' } },
      { role: 'engine', tag: 'polygon', attrs: { points: '50,6 59,27 41,27' } },
      { role: 'tank', tag: 'ellipse', attrs: { cx: '50', cy: '36', rx: '8', ry: '9.5' } },
      { role: 'cockpit', tag: 'ellipse', attrs: { cx: '50', cy: '52', rx: '6.5', ry: '8.5' } },
    ];
    for (const d of defs) {
      const el = makeShape(d.tag, d.attrs);
      el.setAttribute('fill', ZONE_LEVEL_COLORS[0]);
      svg.appendChild(el);
      this.shapes.push({ role: d.role, el });
    }
    this.root.appendChild(svg);

    const flags = document.createElement('div');
    flags.className = 'damage-flags';
    this.fireEl = DamageHud.makeFlag(flags, '🔥 POŻAR', 'fire');
    this.leakEl = DamageHud.makeFlag(flags, '⛽ WYCIEK', 'leak');
    this.pilotEl = DamageHud.makeFlag(flags, '✚ PILOT', 'pilot');
    this.root.appendChild(flags);

    this.setVisible(false);
  }

  private static makeFlag(parent: HTMLElement, text: string, cls: string): HTMLElement {
    const el = document.createElement('span');
    el.className = `damage-flag ${cls}`;
    el.textContent = text;
    el.style.display = 'none';
    parent.appendChild(el);
    return el;
  }

  setVisible(visible: boolean): void {
    this.root.style.display = visible ? 'block' : 'none';
  }

  /** Maluje sylwetkę ze stanu uszkodzeń lokalnej encji. `null` → ukrycie (martwy / brak danych). */
  update(damage: EntityDamage | null): void {
    if (!damage) {
      this.setVisible(false);
      return;
    }
    this.setVisible(true);
    for (const shape of this.shapes) {
      const idx = ZONE_ROLES.indexOf(shape.role);
      shape.el.setAttribute('fill', zoneLevelColor(damage.levels[idx] ?? 0));
    }
    const flags = damageFlags(damage);
    this.fireEl.style.display = flags.fire ? 'inline' : 'none';
    this.leakEl.style.display = flags.leak ? 'inline' : 'none';
    this.pilotEl.style.display = flags.pilot ? 'inline' : 'none';
  }
}
