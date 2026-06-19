/** Częstotliwość symulacji fizyki (stały krok). Zmiana = decyzja w PLAN.md. */
export const PHYSICS_HZ = 60;

/** Częstotliwość snapshotów serwer → klient. */
export const SNAPSHOT_HZ = 30;

/** Częstotliwość ramek input klient → serwer. */
export const INPUT_HZ = 60;

/** Port WebSocket serwera gry (dev; na produkcji za reverse proxy). */
export const PORT = 3001;

/** Przyspieszenie ziemskie [m/s²]. */
export const GRAVITY_MS2 = 9.81;

/** Stały krok fizyki [s] — pochodna PHYSICS_HZ. */
export const FIXED_DT_S = 1 / PHYSICS_HZ;

/** Gęstość powietrza na poziomie morza wg ISA [kg/m³]. */
export const SEA_LEVEL_AIR_DENSITY_KGM3 = 1.225;

/** Współczynnik liniowy modelu gęstości ISA w troposferze [1/m] (fizyka-lotu.md rozdz. 4). */
export const ISA_DENSITY_LAPSE_PER_M = 2.2558e-5;

/** Wykładnik modelu gęstości ISA w troposferze. */
export const ISA_DENSITY_EXPONENT = 4.2559;

/**
 * Dolny próg prędkości w mianowniku T = η·P/V [m/s].
 * Razem z clampem ciągu statycznego usuwa osobliwość przy V→0 (fizyka-lotu.md rozdz. 5.3).
 */
export const THRUST_V_EPS_MS = 1;

/** Konwersja m/s → km/h (HUD i cele osiągów podawane w km/h). */
export const MS_TO_KMH = 3.6;

// --- świat (faza 4) ---

/** Bok kwadratowej areny [m] (PLAN.md: 20×20 km, bez streamingu mapy). */
export const ARENA_SIZE_M = 20_000;

/** Odległość do granicy areny, od której HUD ostrzega o nadchodzącym przeniesieniu (torus) [m]. */
export const ARENA_WARNING_DISTANCE_M = 1_000;

/** Seed heightmapy świata — identyczna mapa po obu stronach sieci (serwer od fazy 8). */
export const TERRAIN_SEED = 1940;

/** Poziom morza [m] — ocean jest płaszczyzną kolizji tam, gdzie teren jest niżej. */
export const SEA_LEVEL_M = 0;

/** Margines kolizji kadłuba z powierzchnią [m] (simcade: punkt + margines, bez hull mesh). */
export const CRASH_MARGIN_M = 2;

/** Czas od rozbicia do gotowości respawnu [s]. */
export const RESPAWN_DELAY_S = 3;

// --- walka (faza 5) ---

/**
 * Pojemność puli pocisków (zero alokacji w pętli — niezmiennik nr 6 ducha:
 * hot path bez GC). Spitfire: 8 luf × 1150 rpm ≈ 153 poc./s × 3 s życia ≈ 460
 * aktywnych w szczycie; 768 daje zapas także na pierwsze obce samoloty (faza 8+).
 */
export const BULLET_POOL_CAPACITY = 768;

/** Konwersja milliradianów (rozrzut w JSON) → radiany. */
export const MRAD_TO_RAD = 1e-3;

// --- mecz offline (faza 6) ---

/** Liczba zestrzeleń kończąca pojedynek 1v1 (punkty do N, z respawnami). */
export const MATCH_SCORE_TO_WIN = 3;

// --- wykrywanie wrogów / „spotting" (faza 7) ---

/**
 * Zasięg wizualnego wykrycia wroga [m]. Bliżej niż to: gracz dostaje marker HUD,
 * a bot pozyskuje cel. Dalej widać WYŁĄCZNIE goły mesh
 * (mała sylwetka na horyzoncie) — gracz i bot muszą najpierw wypatrzyć przeciwnika,
 * zamiast lecieć na gotowy znacznik od początku meczu. Próg twardy (bez histerezy):
 * za granicą bot natychmiast gubi cel. Jedna reguła dla gracza i botów (mgła zaczyna
 * się dopiero od 2,5 km, więc do 2 km cel jest w pełni czysty — patrz world.ts).
 */
export const SPOT_RANGE_M = 2_000;

// --- tryby multi (faza 7: FFA i drużynowy) ---

/**
 * Liczba żyć (samolotów) na uczestnika w trybach eliminacyjnych. Frakcja odpada,
 * gdy wszyscy jej uczestnicy wyczerpią życia; ostatnia frakcja wygrywa. Jedno =
 * jedna śmierć eliminuje uczestnika (brak respawnów w meczu).
 */
export const MATCH_LIVES = 1;

/** Maksymalna liczba botów obok gracza w trybach multi (budżet wydajności/HUD). */
export const MAX_BOTS = 5;

// --- kontrola strefy (faza 7: główny cel — „przeciąganie liny" nad górą) ---

/**
 * Środek strefy kontroli = szczyt góry w centrum wyspy. Teren ma radialną maskę
 * wokół (0,0) (terrain.ts), więc rdzeń góry leży dokładnie w origin — strefa jest
 * z nim współśrodkowa, bez osobnego „landmarku" do utrzymania w synchronizacji.
 */
export const ZONE_CENTER_X_M = 0;
export const ZONE_CENTER_Z_M = 0;

/** Promień strefy kontroli [m] — POZIOMY walec bez limitu wysokości (liczy się nad górą). */
export const ZONE_RADIUS_M = 3_000;

/**
 * Sekundy WYŁĄCZNEJ kontroli (jedna frakcja sama w strefie) potrzebne do przejęcia
 * strefy = zwycięstwo. 180 s = 3 min (decyzja briefingu). Model KotH bez cofania:
 * sporna/pusta strefa pauzuje liczniki, nic nie zanika (patrz world/zone.ts).
 */
export const ZONE_CAPTURE_SECONDS = 180;

/**
 * Pułap krążenia botów nad strefą [m] — bezpiecznie nad szczytem (rdzeń ~1010 m
 * + szum do ~400 m), z zapasem ponad margines unikania ziemi bota. To waypoint
 * „patrolu" botów: bez pilnego celu ciążą ku temu punktowi (kontestują strefę).
 */
export const ZONE_LOITER_ALT_M = 2_000;

// --- punktacja tabeli wyników (faza 7) ---

/** Punkty za zestrzelenie WROGA w tabeli końcowej. Teamkill/samobójstwo = 0 pkt. */
export const KILL_POINTS = 100;

/**
 * Punkty za ASYSTĘ: wcześniejsze trafienie WROGA, który ginie później (dobity przez
 * innego, kolizja albo rozbicie o ziemię). Zabójca dostaje zestrzelenie, nie asystę;
 * trafienie sojusznika nie liczy się (jak teamkill). Połowa wartości zestrzelenia.
 */
export const ASSIST_POINTS = 50;

/**
 * Punkty za każdą sekundę WYŁĄCZNEJ kontroli strefy (akumulowane per frakcja).
 * Pełne przejęcie (ZONE_CAPTURE_SECONDS = 180 s) = 180 pkt ≈ 1,8 zestrzelenia —
 * walka i strefa mniej więcej równoważne (decyzja briefingu 2026-06-14).
 */
export const ZONE_POINTS_PER_SECOND = 1;

// --- pętla meczu sieciowego (faza 13: scoreboard + respawn; P1 2026-06-19: oba tryby
//     eliminacyjne jak SP — bez limitu zestrzeleń i czasu, last-man-standing / ostatnia drużyna) ---

/**
 * Czas wyświetlania ekranu wyników w stanie 'ended', zanim pokój sam wróci do
 * poczekalni [s]. Host może w tym czasie zagrać rewanż (od razu 'playing'); po upływie
 * pokój staje się znów dołączalny (state 'waiting').
 */
export const MATCH_RESULTS_LINGER_S = 15;

/**
 * Czas nietykalności po (re)spawnie [s] — chroni przed spawn-killem (faza-13.md).
 * Ochrona wygasa po tym czasie ALBO gdy gracz sam otworzy ogień (oddanie ochrony za
 * możliwość ataku — standardowy wzorzec, eliminuje „nieśmiertelnego napastnika").
 */
export const SPAWN_PROTECTION_S = 3;

/**
 * Pożądany minimalny dystans świeżego spawnu od najbliższego żywego wroga [m]
 * (kryterium fazy 13: „spawn nigdy < 1,5 km od wroga, jeśli to możliwe"). Wybór spawnu
 * maksymalizuje prześwit; ten próg służy tylko testom/diagnostyce (gdy areny nie da się
 * spełnić przy pełnym pokoju, bierzemy najlepszy dostępny — patrz world/spawn.ts).
 */
export const MIN_SPAWN_CLEARANCE_M = 1_500;

/** Częstotliwość rozsyłki tabeli wyników (standings) — poza hot pathem, JSON. */
export const STANDINGS_BROADCAST_HZ = 2;

// --- multiplayer cz.2 (faza 9): predykcja, reconciliation, interpolacja ---

/**
 * Opóźnienie bufora interpolacji obcych encji [ms]. Render obcych „w przeszłości"
 * o tyle, by dwa kolejne snapshoty (30 Hz → 33 ms odstępu) prawie zawsze
 * bracketowały czas renderu mimo jitteru — bez tego jitter daje teleporty.
 * 100 ms to start, nie dogmat (faza-09.md): pole celowania (faza 11) może je obniżyć.
 */
export const INTERP_DELAY_MS = 100;

/**
 * Maksymalna ekstrapolacja obcej encji, gdy bufor się opróżni (zgubiony snapshot) [ms].
 * Powyżej tego trzymamy ostatnią pozycję, zamiast wystrzelić samolot po stycznej.
 */
export const INTERP_EXTRAPOLATION_MAX_MS = 100;

/**
 * Próg „snap" korekty reconciliation [m]. Błąd predykcji własnego samolotu PONIŻEJ
 * tej wartości wygładzamy zanikającym offsetem renderu (bez szarpnięcia); POWYŻEJ —
 * render przeskakuje wprost na stan serwera (respawn, duży rozjazd po stracie pakietów).
 */
export const RECONCILE_SNAP_DIST_M = 50;

/**
 * Stała czasowa zaniku offsetu wygładzania korekty [s]. Mała korekta znika wizualnie
 * w ~tej skali czasu; za duża = obcy „guma", za mała = widoczne mikro-szarpnięcia.
 */
export const RECONCILE_SMOOTH_TAU_S = 0.1;

// --- walka sieciowa (faza 11): serwerowy hit detection + lag compensation ---

/**
 * Pojemność historii pozycji do lag-compensation [ticki]. ~333 ms @ 60 Hz — z zapasem
 * nad capem rewindu (250 ms = 15 ticków), żeby potrzebna klatka nigdy nie była nadpisana
 * (margines pokrywa też tick tuż po zawinięciu u32). Patrz shared/combat/lag-comp.ts.
 */
export const LAGCOMP_HISTORY_TICKS = 20;

/**
 * Górny limit rewindu celów przy hit-detekcji [ms] (faza-11.md, decyzja designerska):
 * gracze z bardzo wysokim pingiem muszą wyprzedzać, ale dla pozostałych nie istnieje
 * „śmierć zza ściany czasu". Łączny rewind liczymy DOKŁADNIE z echa ticku (server/game-room.ts
 * computeRewindTicks): rewind = (tick − ostatni potwierdzony tick) + bufor interpolacji =
 * RTT + bufor (wierne odtworzenie tego, co strzelec WIDZIAŁ — nie przybliżenie ping/2).
 * 250 ms pokrywa w pełni ping ≤ 150 ms przy buforze 100 ms (kryterium fazy „co widzę, to trafiam").
 */
export const LAGCOMP_MAX_REWIND_MS = 250;
