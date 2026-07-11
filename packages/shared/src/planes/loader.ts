import { PlaneConfigError } from '../errors';
import { ZONE_ROLES, type DamageTuning, type HitZone } from '../combat/damage-model';
import spitfireMk2Raw from './spitfire-mk2.json';
import bf109Raw from './bf109-e.json';
import a6m2Raw from './a6m2-zero.json';

/**
 * Parametry samolotu — schemat z docs/fizyka-lotu.md rozdz. 9.
 * Liczby żyją WYŁĄCZNIE w JSON (niezmiennik nr 3). Jednostki w JSON są
 * "ludzkie" tam, gdzie służą strojeniu (km/h, °/s, °) — konwersja do SI
 * następuje w modułach, które ich używają (envelope/stall/instructor).
 */
export interface PlaneConfig {
  name: string;
  massKg: number;
  wingAreaM2: number;
  aspectRatio: number;
  oswaldE: number;
  cd0: number;
  /**
   * Współczynnik zagięcia biegunowej przy wysokim Cl: człon dragHighClK·Cl⁴ dodany
   * do Cd. Znikomy przy małym Cl (V_max/wznoszenie nietknięte), istotny w ciasnym
   * zakręcie — koryguje zaniżenie oporu wysokiego Cl przez stałe K (drag.ts).
   */
  dragHighClK: number;
  /**
   * Współczynnik oporu oderwania: człon dragStallK·(|Cl_wym|−Cl_max)²₊ dodany do Cd,
   * gdy żądany Cl przekracza Cl_max (over-pull w buffet/przeciągnięciu). Karze energetycznie
   * szarpanie za drążek na granicy koperty; 0 = brak kary (stary model). Patrz drag.ts.
   */
  dragStallK: number;
  clMax: number;
  clAlphaPerRad: number;
  enginePowerW: number;
  /**
   * Ułamek dodatkowej mocy przy WEP/boost (fizyka v2 R2, §6.3): moc WEP = enginePowerW·(1+wepBoostFrac).
   * `enginePowerW` to moc BOJOWA (military). 0 = brak WEP (A6M2 Zero — Sakae 12 bez overboostu). Rekalibracja
   * Vmax na WEP → R4 (na razie WEP daje bonus ponad złote Vmax, które mierzą się bez WEP).
   */
  wepBoostFrac: number;
  fullThrottleHeightM: number;
  propEfficiency: number;
  staticThrustN: number;
  /**
   * Prędkość nieprzekraczalna Vne [km/h IAS] (fizyka v2 R2, §6.2): powyżej narasta flutter — strukturalne
   * obrażenia skrzydeł ∝ przekroczeniu; wyrwane skrzydło = rozpad konstrukcji (śmierć). Kanoniczna słabość
   * A6M2 (630 km/h) vs mocne Spitfire/Bf 109 (720/750). Serwer autorytatywnie (jak przegrzanie), HUD ostrzega.
   */
  vneKmh: number;
  /**
   * Tempo flutteru: obrażenia [HP/s] KAŻDEGO skrzydła na jednostkę WZGLĘDNEGO przekroczenia Vne
   * (max(0, IAS/Vne − 1)). Lekkie przekroczenie → powolne uszkodzenie (ostrzeżenie, odwracalne po zwolnieniu);
   * duże → szybkie wyrwanie skrzydeł. 0 = brak kary (samolot bez limitu — nieużywane w grze).
   */
  flutterDamagePerS: number;
  /** Ułamek Vne, od którego HUD ostrzega (żółto) przed flutterem (np. 0.95). Powyżej Vne (100%) —
   *  czerwony alert i realne obrażenia. Tylko prezentacja klienta; obrażenia liczy serwer od Vne. */
  flutterWarnFrac: number;
  /**
   * Wytrzymałość pełnego baku przy 100% gazu [s] — czas do wyczerpania paliwa lecąc
   * na pełnym gazie (zużycie jest proporcjonalne do gazu, więc 50% gazu = 2× dłużej).
   * Po wyczerpaniu silnik gaśnie (T=0). 900 = 15 min na pełnym gazie.
   */
  fuelEnduranceFullThrottleS: number;
  /** Model termiczny silnika (przegrzewanie na wysokim gazie) — patrz physics/engine-heat.ts. */
  engineThermal: EngineThermalConfig;
  /**
   * Prędkość na spawnie/respawnie [m/s TAS] — punkt pracy startowy per samolot (2026-07-09).
   * Wspólna stała 120 m/s (432 km/h) wpychała A6M2 w reżim zabetonowanych lotek
   * (rollRateCurve ~15°/s) od pierwszej sekundy meczu; typ o niskiej Vmax spawnuje wolniej.
   */
  spawnSpeedMs: number;
  /** Limit strukturalny przeciążenia dodatniego [G]. */
  nMaxG: number;
  /** Limit strukturalny przeciążenia ujemnego [G] (liczba ujemna). */
  nMinG: number;
  /**
   * Krzywa roll rate vs IAS: punkty [IAS km/h, °/s], interpolacja liniowa,
   * poza zakresem wartości brzegowe (fizyka-lotu.md rozdz. 6.2).
   */
  rollRateCurve: readonly (readonly [iasKmh: number, rollRateDegS: number])[];
  /**
   * Autorytet steru wysokości vs IAS (fizyka v2 R1, §6.2): punkty [IAS km/h, frac 0.05..1],
   * interpolacja jak rollRateCurve. Mnożnik maksymalnego ŻĄDANEGO n (pilotStep nasyca
   * cap do ≥1 G / ≤−1 G, żeby lot poziomy normalny i odwrócony był zawsze osiągalny).
   * Historyczna asymetria: Spitfire ster lekki (cap dopiero przy Vne), Bf 109 ciężki
   * od ~420 km/h („obie ręce"), Zero najcięższy od ~400 km/h.
   */
  pitchAuthorityCurve: readonly (readonly [iasKmh: number, frac: number])[];
  /**
   * Opór manewrowy sterów (fizyka v2 R1, §6.1): dodatkowy człon biegunowej
   * Cd_ctrl = aileron·δa + rudder·δr, gdzie δa/δr = znormalizowane REALNE wychylenie
   * (lotki: |roll żądany po kopercie| / szczyt krzywej rolla — sztywnienie przy dużej
   * IAS samo redukuje wychylenie, więc Zero nie płaci podwójnie). Kalibracja `aileron`:
   * 3 pełne beczki z 400 km/h zjadają ~40–60 km/h IAS-ekwiwalentu (§6.1).
   */
  ctrlDragK: ControlDragConfig;
  /**
   * Klapy (fizyka v2 R3, §6.4): dyskretne pozycje per samolot + tempo urwania. Pozycja 0 = schowane
   * (bez wpływu na aero). Wysunięcie zwiększa clMax (ciaśniejszy zakręt / niższe przeciągnięcie) kosztem
   * cd0; przekroczenie ripIasKmh urywa je (obrażenia skrzydeł → poziom ≥ FLAP_DISABLE_WING_LEVEL = trwałe).
   */
  flaps: FlapsConfig;
  /**
   * Szczątkowe efekty śmigła (fizyka v2 R3, §6.5): moment/P-factor odchylająco-przechylający, aktywny
   * TYLKO przy małej prędkości i dużym gazie (zanika kwadratowo do zera powyżej fadeKmh). Kierunek
   * historyczny: Merlin/Sakae (prawoskrętne) ściągają nos w lewo (ujemny yaw), DB 601 odwrotnie (dodatni).
   */
  propEffect: PropEffectConfig;
  /**
   * OPCJONALNA krzywa mocy vs wysokość (fizyka v2 R1 infrastruktura, §6.6): punkty
   * [h m, frac 0..1.5], moc = enginePowerW·frac(h). Brak pola = prosty model sprężarki
   * (pełna moc do fullThrottleHeightM, wyżej ∝ ρ). Kalibracja liczbowa per silnik → R4.
   */
  powerCurve?: readonly (readonly [altitudeM: number, frac: number])[];
  /** Stała czasowa weathervaningu nosa do toru lotu [s] (rozdz. 6.4). */
  alignTauS: number;
  /**
   * Limit tempa weathervaningu [°/s] — przy dużym błędzie nos↔tor (tailslide,
   * błąd ~180°) kąt/τ dawałby setki °/s; limit robi z tego płynny przewrót.
   */
  weathervaneMaxRateDegS: number;
  /** Stała czasowa wygaszania ślizgu bocznego [s] (rozdz. 6.3). */
  sideslipDampingS: number;
  /** Limit przyspieszenia bocznego od siły kadłuba gaszącej ślizg [G]. */
  sideslipMaxAccelG: number;
  /**
   * Globalna „integralność" strukturalna [HP] — backstop hybrydowego modelu uszkodzeń
   * (faza 22): skumulowane obrażenia kadłuba/pożar nadal zabijają, obok krytycznych skutków
   * stref. To wciąż `Health` w snapshocie (healthFrac). Nazwa `hpPool` historyczna (faza 5).
   */
  hpPool: number;
  /**
   * Promień sfery trafień płatowca [m]. Od fazy 22 = BROAD-PHASE (zgrubne odrzucenie): pocisk
   * poza tą sferą na pewno nie trafia żadnej strefy; wewnątrz serwer iteruje strefy (zones).
   */
  hitRadiusM: number;
  /**
   * Promień sfery KOLIZJI płatowiec↔płatowiec [m]. Dwa samoloty zderzają się, gdy
   * odległość ich środków spadnie poniżej sumy promieni (dwa Spitfire'y: 3+3 = 6 m).
   * Osobny od hitRadiusM (sfera trafień pociskami) — fizyczny obrys kadłuba jest
   * ciaśniejszy niż kula, w którą „liczą się" pociski.
   */
  collisionRadiusM: number;
  stall: StallConfig;
  gTolerance: GToleranceConfig;
  instructor: InstructorConfig;
  armament: Armament;
  wreck: WreckConfig;
  /** Strefy trafień (faza 22): 6 brył (kapsuły+sfery) per płatowiec, kanoniczne role ZONE_ROLES. */
  zones: readonly HitZone[];
  /** Parametry strojeniowe skutków uszkodzeń (faza 22) — magnitudy/progi poza kodem (niezm. nr 3). */
  damage: DamageTuning;
}

/**
 * Model termiczny silnika (physics/engine-heat.ts): fizyka v2 R2 (§6.3) — 100% gazu mocy BOJOWEJ jest
 * TRWAŁE (nie przegrzewa), przegrzewa się dopiero WEP. Temperatura (engineHeatFrac) relaksuje do
 * equilibrium zależnego od gazu (∝ gaz²), WEP (·wepHeatMul) i chłodzenia chłodnicą (∝ IAS); 1.0 =
 * czerwona linia (powyżej silnik bierze obrażenia). Kalibracja do realnych limitów WEP: Spitfire/Merlin
 * ~5 min WEP, Bf 109/DB 601 ~1 min (Notleistung) i z gorszym chłodzeniem (marginalne chłodnice).
 */
export interface EngineThermalConfig {
  /**
   * Czas przejścia od ustalonej temperatury BOJOWEJ (equilibrium przy 100% gazu bez WEP) do czerwonej
   * linii NA WEP, przy 100% gazu i prędkości referencyjnej [s]. Nagłówkowa liczba historyczna (Spitfire
   * 300 ≈ 5 min WEP; Bf 60 ≈ 1 min Notleistung). Wewnętrzna stała czasowa grzania jest z niej wyprowadzana
   * (engine-heat.ts), więc to realny, mierzalny limit WEP.
   */
  wepTimeToRedlineS: number;
  /** Czas schłodzenia od czerwonej linii do ~zimnego na biegu jałowym i prędkości referencyjnej [s]. */
  coolTimeS: number;
  /**
   * Temperatura równowagi przy 100% gazu MOCY BOJOWEJ (bez WEP) i prędkości referencyjnej. MUSI być < 1
   * (poniżej czerwonej linii) — lot na maksie mocy bojowej bez limitu. WEP mnoży ją przez wepHeatMul (patrz
   * niżej) i wtedy przekracza próg. Większa (przy tym samym chłodzeniu) = cieplejszy silnik w locie bojowym.
   */
  militaryEqHeat: number;
  /**
   * Mnożnik temperatury równowagi przy AKTYWNYM WEP (fizyka v2 R2, §6.3). militaryEqHeat·wepHeatMul MUSI
   * być > 1 (WEP przebija czerwoną linię) — loader to waliduje. Wraz z wepTimeToRedlineS wyznacza, jak
   * szybko WEP dochodzi do przegrzania (Bf agresywniejszy niż Spitfire).
   */
  wepHeatMul: number;
  /** Czułość chłodzenia na opływ: mnożnik chłodzenia = 1 + tym·(IAS/referencja − 1). 0 = niezależne od prędkości. */
  speedCoolingK: number;
  /** Prędkość referencyjna chłodzenia [km/h IAS], przy której mnożnik chłodzenia = 1 (kalibracja overheatTimeFullS). */
  speedCoolingRefKmh: number;
  /** Obrażenia strefy 'silnik' [HP/s] na jednostkę przekroczenia czerwonej linii (serwer aplikuje, gdy heat>1). */
  overheatDamagePerS: number;
  /** Temperatura wskazywana przy zimnym silniku (engineHeatFrac=0) [°C] — dolna kotwica skali HUD. */
  coldTempC: number;
  /** Temperatura wskazywana na czerwonej linii (engineHeatFrac=1) [°C] — próg przegrzania na skali HUD. */
  redlineTempC: number;
}

/**
 * Współczynniki oporu manewrowego sterów (fizyka v2 R1, §6.1) — Cd dodawany do
 * biegunowej przy PEŁNYM znormalizowanym wychyleniu danej powierzchni. Rząd wielkości:
 * pełna lotka ≈ +kilkadziesiąt % Cd0 (dokładna wartość z kalibracji celu §6.1);
 * ster kierunku kosmetyczny (max yaw 10°/s). 0 = powierzchnia bez oporu (stary model).
 */
export interface ControlDragConfig {
  /** Cd przy pełnym realnym wychyleniu lotek. */
  aileron: number;
  /** Cd przy pełnym wychyleniu steru kierunku. */
  rudder: number;
}

/**
 * Jedna pozycja klap (fizyka v2 R3, §6.4). Wartości `clMaxAdd`/`cd0Add` są ADDYTYWNE do bazowej
 * biegunowej (nie mnożniki), więc pozycja 0 = schowane ma oba 0. `ripIasKmh` to prędkość [km/h IAS],
 * powyżej której naciąg zrywa klapy — patrz `physics/flaps.ts` (obrażenia skrzydeł ∝ przekroczeniu).
 * Pozycja 0 nigdy się nie urywa (schowane), więc jej ripIasKmh jest umownie duże (nieużywane).
 */
export interface FlapPosition {
  /** Nazwa do HUD (np. „schowane", „bojowe", „pełne"). */
  name: string;
  /** Przyrost clMax (wyższy = ciaśniejszy zakręt / niższe przeciągnięcie). 0 = schowane. */
  clMaxAdd: number;
  /** Przyrost cd0 (opór wysuniętych klap). 0 = schowane. */
  cd0Add: number;
  /** Prędkość graniczna wysunięcia [km/h IAS] — powyżej klapy się urywają (obrażenia skrzydeł). */
  ripIasKmh: number;
}

/**
 * Konfiguracja klap samolotu (fizyka v2 R3, §6.4): lista pozycji (indeks 0 = schowane) i tempo urwania.
 * Historyczna różnorodność: Spitfire 2 pozycje (schowane/pełne 85°), Bf 109 3 (schowane/bojowe/pełne),
 * A6M2 2 (schowane/pełne). Indeks pozycji jedzie 2 bitami w INPUT (v10), więc ≤ 4 pozycji.
 */
export interface FlapsConfig {
  /** Pozycje klap; positions[0] = schowane (clMaxAdd/cd0Add = 0). 2..4 pozycji (2 bity w INPUT). */
  positions: readonly FlapPosition[];
  /** Obrażenia [HP/s] KAŻDEGO skrzydła na jednostkę względnego przekroczenia ripIasKmh (jak flutter). */
  ripDamagePerS: number;
}

/**
 * Szczątkowe efekty śmigła (fizyka v2 R3, §6.5) — moment reakcyjny + P-factor + strumień zaśmigłowy
 * na sterze, ODCZUWALNE tylko przy małej prędkości i dużym gazie. Wartości znakowane (kierunek
 * historyczny obrotu śmigła): dodatni yaw = nos w prawo. Merlin/Sakae → ujemny (nos w lewo), DB 601 →
 * dodatni. Instruktor tego NIE kontruje (gracz musi) — boty mają efekt wyłączony (kompensacja aim).
 */
export interface PropEffectConfig {
  /** Maks. bias yaw [rad/s] przy IAS→0 i pełnym gazie (znak = kierunek ściągania nosa). */
  yawBiasMaxRadS: number;
  /** Maks. bias roll [rad/s] przy IAS→0 i pełnym gazie (moment reakcyjny; ten sam znak co yaw). */
  rollBiasMaxRadS: number;
  /** Prędkość [km/h IAS], powyżej której efekt = 0 (zanik ∝ (1 − IAS/fadeKmh)²). */
  fadeKmh: number;
}

/** Parametry tolerancji przeciążenia pilota / G-LOC (physics/g-load.ts). */
export interface GToleranceConfig {
  /** Próg [G], powyżej którego ubywa rezerwy i zaczyna się szarzenie; poniżej rezerwa wraca. */
  onsetG: number;
  /** Budżet [G·s nadwyżki ponad onsetG] na pełne wyczerpanie rezerwy (mniejszy = szybsze zaciemnienie). */
  toleranceGS: number;
  /** Tempo odbudowy rezerwy poniżej onsetG [1/s] (wzrok wraca po odpuszczeniu). */
  recoveryRatePerS: number;
  /** Poziom rezerwy [0..1], od którego (w dół) narasta zaciemnienie obrazu. */
  greyoutReserve: number;
}

/** Parametry zachowania zestrzelonego wraku (zniszczenie w powietrzu). */
export interface WreckConfig {
  /**
   * Bazowe przeciążenie wraku bez inputu pilota [G]. MUSI być < 1, inaczej wrak
   * utrzymywałby lot poziomy (szybowanie) zamiast opadać. 0 = brak siły nośnej
   * (czysty opad balistyczny + opór), ~0.35 = łagodny, narastający opad.
   */
  baseLoadG: number;
  /**
   * Sterowność wysokości spadającego wraku [0..1]: ułamek, o jaki ster wysokości
   * gracza odchyla żądane n od baseLoadG. 0 = ster wysokości martwy (gracz nie
   * wyprowadza), 1 = pełny. Lotki działają zawsze w pełni (niezależnie od tej wartości).
   */
  pitchAuthority: number;
}

/**
 * Jedna GRUPA broni (faza 5; faza 19: wiele typów uzbrojenia na samolocie).
 * Grupa = zestaw luf tego samego typu (np. wszystkie .303, albo 2× MG FF 20 mm)
 * o wspólnej balistyce, kadencji i zapasie. Samolot ma ≥1 grupę (Spitfire: jedna
 * z 8 kaemami; Bf 109 E-3: MG 17 + MG FF). Każda grupa strzela niezależnie własną
 * kadencją i wytwarza pociski o własnej balistyce (prędkość/opór/dmg/czas życia).
 */
export interface WeaponGroup {
  /** Nazwa typu broni do HUD/debug (np. ".303 Browning", "MG 17", "MG FF"). */
  name: string;
  /** Prędkość wylotowa pocisku względem samolotu [m/s] (.303 ≈ 744, MG FF ≈ 600). */
  muzzleVelocityMs: number;
  /** Odległość konwergencji luf [m] — punkt, w którym schodzą się strumienie. */
  convergenceM: number;
  /**
   * Podniesienie punktu celowania nad oś [m] — kompensacja opadu grawitacyjnego
   * na dystansie zbieżności (≈ opad pocisku na convergenceM), żeby trafienia
   * siadały NA linii celownika, nie pod nią. 0 = brak kompensacji.
   */
  convergenceRiseM: number;
  /** Kadencja POJEDYNCZEJ lufy [pocisków/min]; salwa = wszystkie lufy grupy naraz. */
  fireRateRpmPerGun: number;
  /** Zapas amunicji na lufę [szt.]. */
  ammoPerGun: number;
  /** Rozrzut: promień stożka losowego odchylenia kierunku [milliradiany]. */
  dispersionMrad: number;
  /** Obrażenia jednego trafienia [HP]. */
  damagePerHit: number;
  /** Współczynnik oporu kwadratowego pocisku k [1/m] (a = −k·|v|·v). */
  bulletDragK: number;
  /** Czas życia pocisku [s] — po nim gaśnie (cap zasięgu). */
  bulletLifetimeS: number;
  /**
   * Pozycje wylotów luf w body frame [m] (+Z nos, +Y góra, +X LEWE skrzydło).
   * Liczba pozycji = liczba luf w grupie. Kierunek każdego pocisku: do punktu konwergencji.
   */
  muzzles: readonly (readonly [x: number, y: number, z: number])[];
}

/**
 * Uzbrojenie samolotu = lista grup broni (faza 19). Pierwsza grupa jest „główna"
 * (primaryGroup) — używana tam, gdzie potrzeba jednej reprezentatywnej broni
 * (wyprzedzenie bota, kosmetyczne smugacze online). Strzelają WSZYSTKIE grupy.
 */
export interface Armament {
  groups: readonly WeaponGroup[];
}

/** Parametry przeciągnięcia (fizyka-lotu.md rozdz. 6.5). */
export interface StallConfig {
  /** Udział |Cl wymaganego|/clMax, od którego zaczyna się buffet (~0.9 = 10% przed progiem). */
  buffetOnsetRatio: number;
  /** Mnożnik sterowności lotek w przeciągnięciu (~0.3). */
  aileronEffectiveness: number;
  /** Czas trzymania przeciągnięcia do wing dropu [s]. */
  wingDropDelayS: number;
  /** Tempo przewrotu wing dropu [°/s]. */
  wingDropRateDegS: number;
}

/** Parametry instruktora mouse-aim (fizyka-lotu.md rozdz. 7). */
export interface InstructorConfig {
  /** Wzmocnienie P pętli roll [1/s]: rad/s żądania na rad błędu przechylenia. */
  aggressivenessRoll: number;
  /** Wzmocnienie P ciągnięcia [G/rad]: żądane n ponad bazę na rad błędu w płaszczyźnie symetrii. */
  aggressivenessPitch: number;
  /**
   * Bank-and-pull [°]: poniżej tego błędu przechylenia ciągnięcie pełne,
   * powyżej wygaszane liniowo do zera przy 2× progu.
   */
  bankThresholdDeg: number;
  /** Stożek wokół nosa [°], w którym cel poniżej toru koryguje się pchnięciem zamiast beczki. */
  pushoverConeDeg: number;
  /** Stała czasowa wygładzania żądań (filtr 1. rzędu) [s]. */
  smoothingTauS: number;
  /** Wzmocnienie P doważania yaw [1/s]. */
  yawGain: number;
  /** Limit żądania yaw [°/s]. */
  maxYawRateDegS: number;
  /**
   * Siła krzywej wykładniczej reakcji celownika (boost ciągnięcia przy dużym
   * oddaleniu kursora od nosa). 0 = liniowo jak dawniej; 1 = do 2× przy
   * `aimExpoRefDeg`. Małe oddalenie kursora pozostaje ~bez zmian.
   */
  aimExpo: number;
  /** Oddalenie kursora [°], przy którym boost krzywej osiąga pełnię (1 + aimExpo). */
  aimExpoRefDeg: number;
  /**
   * Martwa strefa rolla [°]: błąd celownika bliżej nosa niż ta wartość NIE wywołuje
   * przechylenia (osobliwość atan2 przy nosie przesterowywała roll przy mikro-błędzie —
   * gwałtowny zamach skrzydłami od drgnięcia kursora / reconcile w locie prostym).
   * Pełny autorytet rolla wraca przy 2× tej wartości. 0 = wyłączone (jak dawniej).
   */
  aimRollDeadzoneDeg: number;
}

type NumericKey = Exclude<
  keyof PlaneConfig,
  | 'name'
  | 'rollRateCurve'
  | 'pitchAuthorityCurve'
  | 'powerCurve'
  | 'ctrlDragK'
  | 'flaps'
  | 'propEffect'
  | 'stall'
  | 'gTolerance'
  | 'instructor'
  | 'armament'
  | 'wreck'
  | 'zones'
  | 'damage'
  | 'engineThermal'
>;

/** Pola skalarne grupy broni (bez `name`/`muzzles`, walidowanych osobno). */
type WeaponGroupNumericKey = Exclude<keyof WeaponGroup, 'name' | 'muzzles'>;

// Zakresy sanity per pole — łapią literówki i pomyłki jednostek
// (np. moc w kW zamiast W wypada poniżej minimum).
const NUMERIC_RANGES: Record<NumericKey, readonly [min: number, max: number]> = {
  massKg: [100, 200_000],
  wingAreaM2: [1, 1000],
  aspectRatio: [1, 20],
  oswaldE: [0.1, 1],
  cd0: [0.001, 0.2],
  dragHighClK: [0, 0.1],
  dragStallK: [0, 3],
  clMax: [0.5, 5],
  clAlphaPerRad: [1, 10],
  enginePowerW: [10_000, 100_000_000],
  wepBoostFrac: [0, 0.5], // 0 = brak WEP (Zero); myśliwiec z boostem ~0.1–0.15 (+12 lb vs +9 lb)
  fullThrottleHeightM: [0, 20_000],
  propEfficiency: [0.1, 1],
  staticThrustN: [100, 10_000_000],
  vneKmh: [300, 1200], // Vne IAS; Zero 630 (słaby) … Bf 750 (mocny)
  flutterDamagePerS: [0, 200], // HP/s skrzydła na jednostkę względnego przekroczenia Vne
  flutterWarnFrac: [0.5, 1], // od tego ułamka Vne HUD ostrzega
  fuelEnduranceFullThrottleS: [60, 36_000],
  spawnSpeedMs: [40, 250],
  nMaxG: [1, 20],
  nMinG: [-10, 0],
  alignTauS: [0.05, 5],
  weathervaneMaxRateDegS: [10, 720],
  sideslipDampingS: [0.05, 5],
  sideslipMaxAccelG: [0.05, 2],
  hpPool: [1, 100_000],
  hitRadiusM: [1, 50],
  collisionRadiusM: [0.5, 30],
};

const WEAPON_GROUP_RANGES: Record<WeaponGroupNumericKey, readonly [min: number, max: number]> = {
  muzzleVelocityMs: [100, 1500],
  convergenceM: [50, 1000],
  convergenceRiseM: [0, 5],
  fireRateRpmPerGun: [100, 2000],
  ammoPerGun: [10, 5000],
  dispersionMrad: [0, 50],
  damagePerHit: [0.1, 1000],
  bulletDragK: [0, 0.02],
  bulletLifetimeS: [0.5, 10],
};

const STALL_RANGES: Record<keyof StallConfig, readonly [min: number, max: number]> = {
  buffetOnsetRatio: [0.5, 1],
  aileronEffectiveness: [0, 1],
  wingDropDelayS: [0.1, 10],
  wingDropRateDegS: [1, 180],
};

const G_TOLERANCE_RANGES: Record<keyof GToleranceConfig, readonly [min: number, max: number]> = {
  onsetG: [1, 12],
  toleranceGS: [0.5, 60],
  recoveryRatePerS: [0.01, 5],
  greyoutReserve: [0, 1],
};

const WRECK_RANGES: Record<keyof WreckConfig, readonly [min: number, max: number]> = {
  baseLoadG: [0, 1],
  pitchAuthority: [0, 1],
};

// Górny 0.05 = +250% cd0 typowego myśliwca przy pełnym wychyleniu — z dużym zapasem
// ponad kalibrację §6.1; więcej to niemal na pewno pomyłka rzędu wielkości.
const CTRL_DRAG_RANGES: Record<keyof ControlDragConfig, readonly [min: number, max: number]> = {
  aileron: [0, 0.05],
  rudder: [0, 0.05],
};

// Efekty śmigła (R3, §6.5): yaw/roll znakowane (kierunek obrotu śmigła), fade w km/h IAS.
const PROP_EFFECT_RANGES: Record<keyof PropEffectConfig, readonly [min: number, max: number]> = {
  yawBiasMaxRadS: [-3, 3],
  rollBiasMaxRadS: [-3, 3],
  fadeKmh: [50, 500],
};

// Pola pozycji klap (R3, §6.4). clMaxAdd do 1.5 (klapa lądowaniowa mocno podnosi clMax); cd0Add do
// 0.3 (split-flapy Spitfire'a dają duży opór); ripIasKmh w [50, 3000] (pozycja 0 schowana → wartość
// umowna, byle w zakresie).
const FLAP_POSITION_RANGES: Record<Exclude<keyof FlapPosition, 'name'>, readonly [min: number, max: number]> = {
  clMaxAdd: [0, 1.5],
  cd0Add: [0, 0.3],
  ripIasKmh: [50, 3000],
};

const FLAP_KNOWN_KEYS = new Set<string>(['name', ...Object.keys(FLAP_POSITION_RANGES)]);
/** Obrażenia urwania klap [HP/s skrzydła na jednostkę względnego przekroczenia] — zakres jak flutter. */
const FLAP_RIP_DAMAGE_RANGE: readonly [number, number] = [0, 200];

const ENGINE_THERMAL_RANGES: Record<keyof EngineThermalConfig, readonly [min: number, max: number]> = {
  wepTimeToRedlineS: [30, 1800],
  coolTimeS: [10, 1800],
  // < 1 wymagane: equilibrium 100% gazu BOJOWEGO musi zostać PONIŻEJ czerwonej linii (lot bez limitu);
  // WEP (·wepHeatMul) przekracza próg — walidacja krzyżowa niżej pilnuje militaryEqHeat·wepHeatMul > 1.
  militaryEqHeat: [0.3, 0.95],
  // > 1: WEP podnosi equilibrium; górny 3 z zapasem. Iloczyn z militaryEqHeat sprawdzany krzyżowo.
  wepHeatMul: [1, 3],
  speedCoolingK: [0, 2],
  speedCoolingRefKmh: [50, 1000],
  overheatDamagePerS: [0, 50],
  // skala °C wskaźnika: zimny < czerwona linia; górne granice z zapasem na realistyczne chłodziwo
  // (Merlin ~120 °C, DB 601 podobnie) i ekstrapolację przy głębokim przegrzaniu.
  coldTempC: [-40, 100],
  redlineTempC: [60, 250],
};

const DAMAGE_RANGES: Record<keyof DamageTuning, readonly [min: number, max: number]> = {
  lightFrac: [0.3, 0.95],
  heavyFrac: [0.05, 0.6],
  enginePowerMid: [0.2, 0.95],
  enginePowerLow: [0, 0.6],
  wingClMaxLossFull: [0, 0.8],
  wingCd0AddFull: [0, 0.2],
  wingRollBiasFullRadS: [0, 3],
  tailAuthorityFloor: [0.05, 1],
  tankLeakDrainFactor: [1, 10],
  fireIgniteChanceMg: [0, 0.2],
  fireIgniteChanceCannon: [0, 1],
  fireDotPerS: [0, 50],
  fireSelfExtinguishS: [1, 60],
};

/** Zakres sanity HP strefy [HP] i promienia bryły [m]. */
const ZONE_MAX_HP_RANGE: readonly [number, number] = [1, 1000];
const ZONE_RADIUS_RANGE: readonly [number, number] = [0.1, 12];
const ZONE_COORD_RANGE: readonly [number, number] = [-15, 15];

const INSTRUCTOR_RANGES: Record<keyof InstructorConfig, readonly [min: number, max: number]> = {
  aggressivenessRoll: [0.1, 30],
  aggressivenessPitch: [0.1, 30],
  bankThresholdDeg: [1, 90],
  pushoverConeDeg: [0, 90],
  smoothingTauS: [0.01, 2],
  aimExpo: [0, 4],
  aimExpoRefDeg: [5, 120],
  aimRollDeadzoneDeg: [0, 5],
  yawGain: [0, 10],
  maxYawRateDegS: [0, 45],
};

const KNOWN_KEYS = new Set<string>([
  'name',
  'rollRateCurve',
  'pitchAuthorityCurve',
  'powerCurve',
  'ctrlDragK',
  'flaps',
  'propEffect',
  'stall',
  'gTolerance',
  'instructor',
  'armament',
  'wreck',
  'zones',
  'damage',
  'engineThermal',
  ...Object.keys(NUMERIC_RANGES),
]);

const WEAPON_GROUP_KNOWN_KEYS = new Set<string>([
  'name',
  'muzzles',
  ...Object.keys(WEAPON_GROUP_RANGES),
]);

function checkNumericFields(
  obj: Record<string, unknown>,
  ranges: Record<string, readonly [number, number]>,
  prefix: string,
  problems: string[],
): void {
  for (const [key, [min, max]] of Object.entries(ranges)) {
    const value = obj[key];
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      problems.push(`${prefix}${key}: oczekiwano skończonej liczby, jest ${JSON.stringify(value)}`);
    } else if (value < min || value > max) {
      problems.push(
        `${prefix}${key}: ${String(value)} poza zakresem sanity [${String(min)}, ${String(max)}]`,
      );
    }
  }
}

function checkSection(
  obj: Record<string, unknown>,
  key: 'stall' | 'gTolerance' | 'instructor' | 'wreck' | 'damage' | 'engineThermal' | 'ctrlDragK' | 'propEffect',
  ranges: Record<string, readonly [number, number]>,
  problems: string[],
): void {
  const section = obj[key];
  if (typeof section !== 'object' || section === null || Array.isArray(section)) {
    problems.push(`${key}: oczekiwano obiektu`);
    return;
  }
  const sectionObj = section as Record<string, unknown>;
  checkNumericFields(sectionObj, ranges, `${key}.`, problems);
  for (const subKey of Object.keys(sectionObj)) {
    if (!(subKey in ranges)) problems.push(`${key}.${subKey}: nieznane pole (literówka?)`);
  }
}

/** Specyfikacja walidacji krzywej strojeniowej [[x, y]…] — wspólna dla trzech krzywych (R1). */
interface CurveSpec {
  /** Etykieta osi X do komunikatów (np. 'IAS'). */
  xLabel: string;
  xUnit: string;
  xRange: readonly [number, number];
  /** Etykieta osi Y do komunikatów (np. 'rate'). */
  yLabel: string;
  yUnit: string;
  yRange: readonly [number, number];
}

/** Walidacja krzywej: tablica ≥2 punktów [x, y], x rosnące monotonicznie, zakresy sanity. */
function checkCurve(
  obj: Record<string, unknown>,
  key: 'rollRateCurve' | 'pitchAuthorityCurve' | 'powerCurve',
  spec: CurveSpec,
  problems: string[],
): void {
  const curve = obj[key];
  if (!Array.isArray(curve) || curve.length < 2) {
    problems.push(`${key}: oczekiwano tablicy ≥2 punktów [${spec.xLabel} ${spec.xUnit}, ${spec.yUnit}]`);
    return;
  }
  let prevX = -Infinity;
  curve.forEach((point, i) => {
    if (!Array.isArray(point) || point.length !== 2) {
      problems.push(`${key}[${String(i)}]: oczekiwano pary [${spec.xLabel} ${spec.xUnit}, ${spec.yUnit}]`);
      return;
    }
    const [x, y] = point as [unknown, unknown];
    const [xMin, xMax] = spec.xRange;
    const [yMin, yMax] = spec.yRange;
    if (typeof x !== 'number' || !Number.isFinite(x) || x < xMin || x > xMax) {
      problems.push(
        `${key}[${String(i)}][0]: ${spec.xLabel} ${JSON.stringify(x)} poza [${String(xMin)}, ${String(xMax)}] ${spec.xUnit}`,
      );
    } else if (x <= prevX) {
      problems.push(`${key}[${String(i)}][0]: ${spec.xLabel} musi rosnąć monotonicznie`);
    } else {
      prevX = x;
    }
    if (typeof y !== 'number' || !Number.isFinite(y) || y < yMin || y > yMax) {
      problems.push(
        `${key}[${String(i)}][1]: ${spec.yLabel} ${JSON.stringify(y)} poza [${String(yMin)}, ${String(yMax)}] ${spec.yUnit}`,
      );
    }
  });
}

const ROLL_RATE_CURVE_SPEC: CurveSpec = {
  xLabel: 'IAS', xUnit: 'km/h', xRange: [0, 1500],
  yLabel: 'rate', yUnit: '°/s', yRange: [0, 720],
};

// frac ≥ 0.05: ster nigdy całkiem martwy (zawsze da się powoli wyprowadzić z nurkowania).
const PITCH_AUTHORITY_CURVE_SPEC: CurveSpec = {
  xLabel: 'IAS', xUnit: 'km/h', xRange: [0, 1500],
  yLabel: 'frac', yUnit: 'frac', yRange: [0.05, 1],
};

// frac do 1.5: RAM/overboost może chwilowo przekraczać moc nominalną enginePowerW.
const POWER_CURVE_SPEC: CurveSpec = {
  xLabel: 'h', xUnit: 'm', xRange: [0, 20_000],
  yLabel: 'frac', yUnit: 'frac', yRange: [0, 1.5],
};

function checkMuzzles(group: Record<string, unknown>, prefix: string, problems: string[]): void {
  const muzzles = group['muzzles'];
  if (!Array.isArray(muzzles) || muzzles.length < 1) {
    problems.push(`${prefix}muzzles: oczekiwano tablicy ≥1 pozycji [x,y,z] w body frame [m]`);
    return;
  }
  muzzles.forEach((m, i) => {
    if (!Array.isArray(m) || m.length !== 3) {
      problems.push(`${prefix}muzzles[${String(i)}]: oczekiwano trójki [x,y,z]`);
      return;
    }
    (m as unknown[]).forEach((v, axis) => {
      if (typeof v !== 'number' || !Number.isFinite(v) || v < -15 || v > 15) {
        problems.push(
          `${prefix}muzzles[${String(i)}][${String(axis)}]: ${JSON.stringify(v)} poza [−15, 15] m`,
        );
      }
    });
  });
}

function checkWeaponGroup(raw: unknown, prefix: string, problems: string[]): void {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    problems.push(`${prefix.slice(0, -1)}: oczekiwano obiektu grupy broni`);
    return;
  }
  const group = raw as Record<string, unknown>;
  const name = group['name'];
  if (typeof name !== 'string' || name.trim() === '') {
    problems.push(`${prefix}name: oczekiwano niepustego stringa, jest ${JSON.stringify(name)}`);
  }
  checkNumericFields(group, WEAPON_GROUP_RANGES, prefix, problems);
  checkMuzzles(group, prefix, problems);
  for (const key of Object.keys(group)) {
    if (!WEAPON_GROUP_KNOWN_KEYS.has(key)) problems.push(`${prefix}${key}: nieznane pole (literówka?)`);
  }
}

function checkArmament(obj: Record<string, unknown>, problems: string[]): void {
  const section = obj['armament'];
  if (typeof section !== 'object' || section === null || Array.isArray(section)) {
    problems.push('armament: oczekiwano obiektu z polem groups');
    return;
  }
  const groups = (section as Record<string, unknown>)['groups'];
  if (!Array.isArray(groups) || groups.length < 1) {
    problems.push('armament.groups: oczekiwano tablicy ≥1 grupy broni');
    return;
  }
  groups.forEach((g, i) => checkWeaponGroup(g, `armament.groups[${String(i)}].`, problems));
  for (const key of Object.keys(section as Record<string, unknown>)) {
    if (key !== 'groups') problems.push(`armament.${key}: nieznane pole (literówka?)`);
  }
}

/** Waliduje trójkę współrzędnych [x,y,z] w body frame [m]. */
function checkCoordTriple(value: unknown, label: string, problems: string[]): void {
  if (!Array.isArray(value) || value.length !== 3) {
    problems.push(`${label}: oczekiwano trójki [x,y,z]`);
    return;
  }
  (value as unknown[]).forEach((v, axis) => {
    if (typeof v !== 'number' || !Number.isFinite(v) || v < ZONE_COORD_RANGE[0] || v > ZONE_COORD_RANGE[1]) {
      problems.push(`${label}[${String(axis)}]: ${JSON.stringify(v)} poza [${String(ZONE_COORD_RANGE[0])}, ${String(ZONE_COORD_RANGE[1])}] m`);
    }
  });
}

function checkInRange(value: unknown, range: readonly [number, number], label: string, problems: string[]): void {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    problems.push(`${label}: oczekiwano skończonej liczby, jest ${JSON.stringify(value)}`);
  } else if (value < range[0] || value > range[1]) {
    problems.push(`${label}: ${String(value)} poza zakresem sanity [${String(range[0])}, ${String(range[1])}]`);
  }
}

function checkZoneShape(shape: unknown, prefix: string, problems: string[]): void {
  if (typeof shape !== 'object' || shape === null || Array.isArray(shape)) {
    problems.push(`${prefix}shape: oczekiwano obiektu bryły (sphere/capsule)`);
    return;
  }
  const s = shape as Record<string, unknown>;
  const kind = s['kind'];
  if (kind === 'sphere') {
    checkCoordTriple(s['center'], `${prefix}shape.center`, problems);
    checkInRange(s['radius'], ZONE_RADIUS_RANGE, `${prefix}shape.radius`, problems);
    for (const k of Object.keys(s)) {
      if (k !== 'kind' && k !== 'center' && k !== 'radius') problems.push(`${prefix}shape.${k}: nieznane pole (sphere)`);
    }
  } else if (kind === 'capsule') {
    checkCoordTriple(s['a'], `${prefix}shape.a`, problems);
    checkCoordTriple(s['b'], `${prefix}shape.b`, problems);
    checkInRange(s['radius'], ZONE_RADIUS_RANGE, `${prefix}shape.radius`, problems);
    for (const k of Object.keys(s)) {
      if (k !== 'kind' && k !== 'a' && k !== 'b' && k !== 'radius') problems.push(`${prefix}shape.${k}: nieznane pole (capsule)`);
    }
  } else {
    problems.push(`${prefix}shape.kind: oczekiwano 'sphere' albo 'capsule', jest ${JSON.stringify(kind)}`);
  }
}

/**
 * Walidacja stref trafień (faza 22): dokładnie ZONE_ROLES.length stref, każda rola obecna raz,
 * poprawna bryła i maxHp. Komplet ról wymagany — model uszkodzeń i bity snapshotu zakładają 6 stref.
 */
function checkZones(obj: Record<string, unknown>, problems: string[]): void {
  const zones = obj['zones'];
  if (!Array.isArray(zones)) {
    problems.push('zones: oczekiwano tablicy stref trafień');
    return;
  }
  const seen = new Set<string>();
  zones.forEach((z, i) => {
    const prefix = `zones[${String(i)}].`;
    if (typeof z !== 'object' || z === null || Array.isArray(z)) {
      problems.push(`${prefix.slice(0, -1)}: oczekiwano obiektu strefy`);
      return;
    }
    const zone = z as Record<string, unknown>;
    const role = zone['role'];
    if (typeof role !== 'string' || !(ZONE_ROLES as readonly string[]).includes(role)) {
      problems.push(`${prefix}role: oczekiwano jednej z [${ZONE_ROLES.join(', ')}], jest ${JSON.stringify(role)}`);
    } else if (seen.has(role)) {
      problems.push(`${prefix}role: powtórzona rola '${role}'`);
    } else {
      seen.add(role);
    }
    checkZoneShape(zone['shape'], prefix, problems);
    checkInRange(zone['maxHp'], ZONE_MAX_HP_RANGE, `${prefix}maxHp`, problems);
    for (const k of Object.keys(zone)) {
      if (k !== 'role' && k !== 'shape' && k !== 'maxHp') problems.push(`${prefix}${k}: nieznane pole (literówka?)`);
    }
  });
  for (const role of ZONE_ROLES) {
    if (!seen.has(role)) problems.push(`zones: brak wymaganej strefy '${role}'`);
  }
}

/**
 * Walidacja klap (R3, §6.4): sekcja `flaps` z tablicą pozycji (2..4 — indeks jedzie 2 bitami w INPUT),
 * pozycja 0 = schowane (clMaxAdd/cd0Add MUSZĄ być 0), każda pozycja z poprawnymi polami, `ripDamagePerS`
 * w zakresie. 2 pozycje minimum (schowane + ≥1 wysunięta), inaczej klapy nie miałyby czego przełączać.
 */
function checkFlaps(obj: Record<string, unknown>, problems: string[]): void {
  const section = obj['flaps'];
  if (typeof section !== 'object' || section === null || Array.isArray(section)) {
    problems.push('flaps: oczekiwano obiektu z polami positions i ripDamagePerS');
    return;
  }
  const flaps = section as Record<string, unknown>;
  checkInRange(flaps['ripDamagePerS'], FLAP_RIP_DAMAGE_RANGE, 'flaps.ripDamagePerS', problems);
  const positions = flaps['positions'];
  if (!Array.isArray(positions) || positions.length < 2 || positions.length > 4) {
    problems.push('flaps.positions: oczekiwano tablicy 2..4 pozycji (indeks jedzie 2 bitami INPUT)');
  } else {
    positions.forEach((p, i) => {
      const prefix = `flaps.positions[${String(i)}].`;
      if (typeof p !== 'object' || p === null || Array.isArray(p)) {
        problems.push(`${prefix.slice(0, -1)}: oczekiwano obiektu pozycji klap`);
        return;
      }
      const pos = p as Record<string, unknown>;
      if (typeof pos['name'] !== 'string' || (pos['name'] as string).trim() === '') {
        problems.push(`${prefix}name: oczekiwano niepustego stringa`);
      }
      checkNumericFields(pos, FLAP_POSITION_RANGES, prefix, problems);
      for (const k of Object.keys(pos)) {
        if (!FLAP_KNOWN_KEYS.has(k)) problems.push(`${prefix}${k}: nieznane pole (literówka?)`);
      }
      // pozycja 0 = schowane: brak wpływu na aero (inaczej złote testy „czyste" nie startowałyby czyste)
      if (i === 0 && (pos['clMaxAdd'] !== 0 || pos['cd0Add'] !== 0)) {
        problems.push('flaps.positions[0]: pozycja schowana musi mieć clMaxAdd=0 i cd0Add=0');
      }
    });
  }
  for (const key of Object.keys(flaps)) {
    if (key !== 'positions' && key !== 'ripDamagePerS') problems.push(`flaps.${key}: nieznane pole (literówka?)`);
  }
}

/**
 * Walidacja schematu przy ładowaniu: wymagane pola, typy, zakresy sanity,
 * brak nieznanych kluczy. Wszystkie problemy zbierane do jednego wyjątku.
 */
export function loadPlaneConfig(raw: unknown, source = 'konfiguracja samolotu'): PlaneConfig {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new PlaneConfigError(`${source}: oczekiwano obiektu JSON`);
  }
  const obj = raw as Record<string, unknown>;
  const problems: string[] = [];

  const name = obj['name'];
  if (typeof name !== 'string' || name.trim() === '') {
    problems.push(`name: oczekiwano niepustego stringa, jest ${JSON.stringify(name)}`);
  }

  checkNumericFields(obj, NUMERIC_RANGES, '', problems);
  checkCurve(obj, 'rollRateCurve', ROLL_RATE_CURVE_SPEC, problems);
  checkCurve(obj, 'pitchAuthorityCurve', PITCH_AUTHORITY_CURVE_SPEC, problems);
  if (obj['powerCurve'] !== undefined) {
    // opcjonalna (R1 = infrastruktura §6.6; JSON-y dostaną krzywe w kalibracji R4)
    checkCurve(obj, 'powerCurve', POWER_CURVE_SPEC, problems);
  }
  checkSection(obj, 'ctrlDragK', CTRL_DRAG_RANGES, problems);
  checkSection(obj, 'propEffect', PROP_EFFECT_RANGES, problems);
  checkFlaps(obj, problems);
  checkSection(obj, 'stall', STALL_RANGES, problems);
  checkSection(obj, 'gTolerance', G_TOLERANCE_RANGES, problems);
  checkSection(obj, 'instructor', INSTRUCTOR_RANGES, problems);
  checkSection(obj, 'wreck', WRECK_RANGES, problems);
  checkSection(obj, 'damage', DAMAGE_RANGES, problems);
  checkSection(obj, 'engineThermal', ENGINE_THERMAL_RANGES, problems);
  checkArmament(obj, problems);
  checkZones(obj, problems);

  const nMin = obj['nMinG'];
  if (typeof nMin === 'number' && nMin >= 0) {
    problems.push(`nMinG: ${String(nMin)} — limit ujemny musi być < 0`);
  }

  // walidacja krzyżowa termiki (R2): WEP MUSI przebić czerwoną linię (militaryEqHeat·wepHeatMul > 1),
  // inaczej engine-heat.ts liczyłby log z liczby ≤ 0 (NaN) i WEP nigdy by się nie przegrzał.
  const thermal = obj['engineThermal'];
  if (typeof thermal === 'object' && thermal !== null && !Array.isArray(thermal)) {
    const th = thermal as Record<string, unknown>;
    const mil = th['militaryEqHeat'];
    const mul = th['wepHeatMul'];
    if (typeof mil === 'number' && typeof mul === 'number' && Number.isFinite(mil) && Number.isFinite(mul)) {
      if (mil * mul <= 1) {
        problems.push(
          `engineThermal: militaryEqHeat·wepHeatMul = ${(mil * mul).toFixed(3)} musi być > 1 (WEP przebija czerwoną linię)`,
        );
      }
    }
  }

  for (const key of Object.keys(obj)) {
    if (!KNOWN_KEYS.has(key)) problems.push(`${key}: nieznane pole (literówka?)`);
  }

  if (problems.length > 0) {
    throw new PlaneConfigError(`${source}: niepoprawna konfiguracja:\n- ${problems.join('\n- ')}`);
  }
  // po walidacji obiekt spełnia strukturę PlaneConfig
  return obj as unknown as PlaneConfig;
}

/** Spitfire Mk IIa — walidowany przy imporcie modułu (fail fast). */
export const SPITFIRE_MK2: PlaneConfig = loadPlaneConfig(spitfireMk2Raw, 'spitfire-mk2.json');

/** Bf 109 E-3 (DB 601A) — energy-fighter (faza 19), walidowany przy imporcie. */
export const BF109_E: PlaneConfig = loadPlaneConfig(bf109Raw, 'bf109-e.json');

/** A6M2 Zero model 21 (Sakae 12) — król wirażu, kruchy i łatwopalny (trzeci samolot), walidowany przy imporcie. */
export const A6M2_ZERO: PlaneConfig = loadPlaneConfig(a6m2Raw, 'a6m2-zero.json');

/** Współczynnik oporu indukowanego K = 1/(π·e·AR) z biegunowej Cd = Cd0 + K·Cl². */
export function inducedDragFactor(plane: PlaneConfig): number {
  return 1 / (Math.PI * plane.oswaldE * plane.aspectRatio);
}

/**
 * Rozpiętość skrzydeł [m] z geometrii: b = √(AR·S) (definicja wydłużenia AR = b²/S).
 * Jedyne źródło prawdy do auto-skalowania modelu 3D w kliencie (Spitfire ≈ 11,2 m,
 * Bf 109 E ≈ 9,9 m) — bez osobnego pola w JSON, które mogłoby się rozjechać z aerodynamiką.
 */
export function wingspanM(plane: PlaneConfig): number {
  return Math.sqrt(plane.aspectRatio * plane.wingAreaM2);
}
