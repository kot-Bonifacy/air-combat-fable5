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

// --- integralność konstrukcji (dawne „globalne HP") jako OSOBNY kanał wizualny ---
//
// Strefy kolorują WNĘTRZE sylwetki (lokalne moduły, zielony→czerwony). Integralność konstrukcji =
// globalny backstop płatowca (serwerowe `health`): skumulowane obrażenia kadłuba/pożar, które i tak
// dobijają. Pokazujemy ją na RAMCE/obrysie całej sylwetki, by się NIE zlewała z kolorami stref —
// obrys stalowy przy 100% → bursztyn → pomarańcz → czerwień, i GRUBIEJE, gdy integralność spada
// (czytelne „narastające pęknięcia konstrukcji"). Pod sylwetką liczbowo „integr. NN%".

/** Progi i barwy obrysu integralności (osobny kanał od stref → stal przy pełnej, NIE zielony). */
const INTEGRITY_BANDS = [
  { min: 0.75, color: '#9fb0bd' }, // pełna — stalowy, neutralny
  { min: 0.5, color: '#e6b800' }, // nadwerężona — bursztyn
  { min: 0.25, color: '#e8741f' }, // poważna — pomarańcz
  { min: -Infinity, color: '#d0322f' }, // krytyczna — czerwień
] as const;

/** Barwa obrysu/odczytu integralności wg ułamka 0..1 (stal→bursztyn→pomarańcz→czerwień). */
export function integrityColor(frac: number): string {
  const f = frac < 0 ? 0 : frac > 1 ? 1 : frac;
  return INTEGRITY_BANDS.find((b) => f >= b.min)!.color;
}

/** Grubość obrysu integralności: cienki gdy zdrowy, grubszy gdy nadwerężony (0.8 px @100% → 2.8 px @0%). */
export function integrityStrokeWidth(frac: number): number {
  const f = frac < 0 ? 0 : frac > 1 ? 1 : frac;
  return 0.8 + (1 - f) * 2.0;
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
//
// JEDNA uproszczona, ogólna sylwetka myśliwca dla OBU samolotów (decyzja usera 2026-06-27: porzucony
// wymóg dopasowania kształtu do konkretnego modelu — HUD ma czytać się naturalnie, nie udawać Spitfire
// vs Bf 109). Sześć stref to osobne ścieżki SVG kafelkujące obrys, więc czyta się jak jeden samolot
// pocięty na moduły (cienki obrys = linie podziału): smukły kadłub (silnik→kabina→zbiornik→ogon, układ
// jak na wzorcowym rzucie z góry od usera) + trapezowe skrzydło z zaokrągloną końcówką + zaokrąglone
// stateczniki poziome. Detale neutralne (śmigło, owiewka) NIE są strefami — tylko czytelność. Pod
// strefami leży neutralny obrys kadłuba (chroni przed szczelinami między ścieżkami). To SCHEMAT — strefy
// NIE odwzorowują realnych współrzędnych `zones` z JSON (kolor=poziom uszkodzenia, pozycja=czytelna;
// flagi/kolory liczą się po roli niezależnie od położenia). viewBox 120×120, oś x=60 = środek kadłuba,
// nos u góry (y≈10), ogon u dołu (y≈112).

interface ZonePath {
  role: ZoneRole;
  /** Atrybut `d` ścieżki SVG (jedna lub kilka podścieżek o wspólnym wypełnieniu, np. ogon + stateczniki). */
  d: string;
}

/** Łopaty śmigła — cienka pozioma elipsa u nosa (neutralna): [cx, cy, rx, ry]. */
const PROP: readonly [number, number, number, number] = [60, 12, 23, 3.3];

/** Neutralny obrys kadłuba pod strefami (smukłe wrzeciono nos→ogon) — chroni przed szczelinami. */
const FUSELAGE =
  'M60,10 C55,13 53,22 53,40 C53,60 55.5,90 58.5,104 L60,112 L61.5,104 C64.5,90 67,60 67,40 C67,22 65,13 60,10 Z';

/** Owiewka kabiny — neutralny kontur nad strefą `cockpit` (pod nią widać kolor strefy). */
const CANOPY =
  'M60,37 C56.5,37 55,40 55,44 C55,48 57.5,51 60,52 C62.5,51 65,48 65,44 C65,40 63.5,37 60,37 Z';

// Strefy w KOLEJNOŚCI RYSOWANIA: skrzydła pierwsze (ich korzenie chowają się pod segmenty kadłuba
// malowane później), potem pasma kadłuba od nosa do ogona; ogon niesie też dwa stateczniki poziome.
const ZONE_PATHS: readonly ZonePath[] = [
  // skrzydło proste (myśliwiec tłokowy): łagodny skos krawędzi natarcia (przód, mniejszy y) + krawędź
  // spływu (tył) zaginana DO PRZODU ku końcówce → końcówka na linii środkowej cięciwy, nie „skośna".
  { role: 'wingL', d: 'M53.2,35 C40,35 21,38 9,42 C6.5,43.5 6.5,49.5 8.5,51 C24,53 42,57 54,58 Z' },
  { role: 'wingR', d: 'M66.8,35 C80,35 99,38 111,42 C113.5,43.5 113.5,49.5 111.5,51 C96,53 78,57 66,58 Z' },
  { role: 'engine', d: 'M60,10 C55.5,13 53.5,22 53.2,34 L66.8,34 C66.5,22 64.5,13 60,10 Z' },
  { role: 'cockpit', d: 'M53.2,34 L66.8,34 L66.7,52 L53.3,52 Z' },
  { role: 'tank', d: 'M53.3,52 L66.7,52 L65.5,66 L54.5,66 Z' },
  {
    role: 'tail',
    d:
      'M54.5,66 C55.5,80 57,98 58.5,104 L60,112 L61.5,104 C63,98 64.5,80 65.5,66 Z' +
      'M57.5,88 C49,87.5 40,89 37,92.5 C40,96 49,96.5 58,99 Z' +
      'M62.5,88 C71,87.5 80,89 83,92.5 C80,96 71,96.5 62,99 Z',
  },
];

const FUSELAGE_FILL = '#33404d';
const PROP_FILL = '#465562';
const DETAIL_STROKE = 'rgba(12,18,26,0.9)';
const ZONE_STROKE = 'rgba(8,14,20,0.85)';

interface ZoneShape {
  role: ZoneRole;
  el: SVGPathElement;
}

export class DamageHud {
  private readonly root: HTMLElement;
  private readonly svg: SVGSVGElement;
  private readonly shapes: ZoneShape[] = [];
  /** Stroke-only nakładka obrysu integralności (kadłub+skrzydła+ogon) — kolor/grubość z update(). */
  private readonly integrityOutline: SVGPathElement[] = [];
  private readonly integrityReadout: HTMLElement;
  private readonly fireEl: HTMLElement;
  private readonly leakEl: HTMLElement;
  private readonly pilotEl: HTMLElement;

  constructor(container: HTMLElement) {
    this.root = container;
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 120 120');
    svg.setAttribute('width', '100%');
    this.svg = svg;
    this.root.appendChild(svg);
    this.buildSilhouette();

    // liczbowy odczyt integralności pod sylwetką (precyzyjny % — przeniesiony z dawnego wiersza „HP")
    const readout = document.createElement('div');
    readout.className = 'integrity-readout';
    this.integrityReadout = readout;
    this.root.appendChild(readout);

    const flags = document.createElement('div');
    flags.className = 'damage-flags';
    this.fireEl = DamageHud.makeFlag(flags, '🔥 POŻAR', 'fire');
    this.leakEl = DamageHud.makeFlag(flags, '⛽ WYCIEK', 'leak');
    this.pilotEl = DamageHud.makeFlag(flags, '✚ PILOT', 'pilot');
    this.root.appendChild(flags);

    this.setVisible(false);
  }

  private makePath(d: string, fill: string, stroke: string, strokeWidth: string): SVGPathElement {
    const el = document.createElementNS(SVG_NS, 'path');
    el.setAttribute('d', d);
    el.setAttribute('fill', fill);
    el.setAttribute('stroke', stroke);
    el.setAttribute('stroke-width', strokeWidth);
    el.setAttribute('stroke-linejoin', 'round');
    this.svg.appendChild(el);
    return el;
  }

  /**
   * Buduje raz całą sylwetkę SVG (jedna wspólna dla obu samolotów). Kolejność warstw: śmigło
   * (neutralne) → kadłub (neutralny) → strefy (kolorowane) → owiewka (neutralna, na wierzchu).
   * Strefy `shapes` trzymamy do kolorowania; resztę traktujemy jako stałe dekoracje.
   */
  private buildSilhouette(): void {
    // śmigło — cienka pozioma elipsa u nosa, pod kadłubem (łopaty wystają poza spinner)
    const prop = document.createElementNS(SVG_NS, 'ellipse');
    prop.setAttribute('cx', String(PROP[0]));
    prop.setAttribute('cy', String(PROP[1]));
    prop.setAttribute('rx', String(PROP[2]));
    prop.setAttribute('ry', String(PROP[3]));
    prop.setAttribute('fill', PROP_FILL);
    prop.setAttribute('stroke', DETAIL_STROKE);
    prop.setAttribute('stroke-width', '0.8');
    this.svg.appendChild(prop);

    // neutralny obrys kadłuba pod strefami (chroni przed szczelinami)
    this.makePath(FUSELAGE, FUSELAGE_FILL, ZONE_STROKE, '0.8');

    // strefy (kolorowane poziomem) — skrzydła pierwsze, korzenie chowają się pod segmenty kadłuba
    for (const z of ZONE_PATHS) {
      const el = this.makePath(z.d, ZONE_LEVEL_COLORS[0], ZONE_STROKE, '1.2');
      this.shapes.push({ role: z.role, el });
    }

    // owiewka (sam kontur — pod spodem widać kolor strefy `cockpit`)
    this.makePath(CANOPY, 'none', DETAIL_STROKE, '1');

    // obrys integralności konstrukcji (osobny kanał) — stroke-only nakładka na obwód płatowca, NAD
    // strefami; reużywa geometrii kadłuba/skrzydeł/ogona. Kolor i grubość ustawia update() z `health`.
    const wingL = ZONE_PATHS.find((z) => z.role === 'wingL')!.d;
    const wingR = ZONE_PATHS.find((z) => z.role === 'wingR')!.d;
    const tail = ZONE_PATHS.find((z) => z.role === 'tail')!.d;
    for (const d of [FUSELAGE, wingL, wingR, tail]) {
      this.integrityOutline.push(
        this.makePath(d, 'none', integrityColor(1), String(integrityStrokeWidth(1))),
      );
    }
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

  /**
   * Maluje sylwetkę ze stanu uszkodzeń lokalnej encji. `null` → ukrycie (martwy / brak danych).
   * Sylwetka jest wspólna dla obu samolotów — strefy kolorujemy wg poziomów, a obrys (ramka) +
   * odczyt liczbowy wg `integrityFrac` (ułamek `health` 0..1 = integralność konstrukcji).
   */
  update(damage: EntityDamage | null, integrityFrac = 1): void {
    if (!damage) {
      this.setVisible(false);
      return;
    }
    this.setVisible(true);
    for (const shape of this.shapes) {
      const idx = ZONE_ROLES.indexOf(shape.role);
      shape.el.setAttribute('fill', zoneLevelColor(damage.levels[idx] ?? 0));
    }
    // integralność konstrukcji (osobny kanał): obrys czerwienieje + grubieje, liczba pod sylwetką
    const integrityCol = integrityColor(integrityFrac);
    const integrityW = String(integrityStrokeWidth(integrityFrac));
    for (const el of this.integrityOutline) {
      el.setAttribute('stroke', integrityCol);
      el.setAttribute('stroke-width', integrityW);
    }
    this.integrityReadout.textContent = `integr. ${Math.round(integrityFrac * 100)}%`;
    this.integrityReadout.style.color = integrityCol;
    const flags = damageFlags(damage);
    this.fireEl.style.display = flags.fire ? 'inline' : 'none';
    this.leakEl.style.display = flags.leak ? 'inline' : 'none';
    this.pilotEl.style.display = flags.pilot ? 'inline' : 'none';
  }
}
