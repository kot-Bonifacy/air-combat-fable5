# Faza 21 — Dźwięk i efekty

**Zależy od:** Faza 20
**Cel:** gra brzmi i wygląda jak walka powietrzna — immersja, ale też informacja
(dźwięk silnika = prędkość/moc, świst = przeciągnięcie, trafienia słyszalne).

## Zakres

W tej fazie:
- Web Audio API (Three.js `AudioListener`/`PositionalAudio`):
  - silnik własny: pętla z pitch/gain od RPM proxy (throttle + V) — najważniejszy dźwięk w grze
  - silniki obcych: positional, tłumione odległością
  - broń: własna (pełna), obca (positional); osobne brzmienie 7.7 vs 20 mm
  - trafienia otrzymane (metaliczne), zadane (cichy „ding" potwierdzenia)
  - wiatr/świst rosnący z IAS + buffet przeciągnięcia (informacyjny!)
  - eksplozje, alarm przeciągnięcia, dźwięki UI lobby
- Efekty wizualne (particle, InstancedMesh): dym z trafionych, ogień krytycznych, smugi
  kondensacyjne na końcówkach skrzydeł przy wysokim G, lepszy wybuch (flash + dym + szczątki
  prymitywne), ślad dymny pocisków 20 mm
- Asset pipeline: dźwięki CC0 (freesound.org/sonniss GDC) → wpisy w LICENSES.md
- Ustawienia: master volume + mute w UI, zapamiętane w localStorage
- Autoplay policy: AudioContext odblokowany pierwszym kliknięciem (ekran lobby)

Poza zakresem: muzyka, voice lines, doppler (nice-to-have: backlog).

## Kroki

1. `client/src/audio/audio-manager.ts`: ładowanie, pule, kategorie głośności
2. Silnik własny (syntetyczna pętla parametryczna lub sample z pitch-shift — wybór po próbie)
3. Dźwięki positional obcych encji (podpięte pod eventy i snapshoty)
4. Particle system (jeden generyczny, konfigurowany per efekt)
5. Smuga kondensacyjna sprzężona z n z fizyki (czytelność manewrów przeciwnika!)
6. Przegląd głośności: sesja z botami, korekta miksu

## Kryteria ukończenia

- [ ] Z zamkniętymi oczami: słychać różnicę throttle 50% vs 100%, nurkowanie (świst),
  zbliżające się przeciągnięcie (buffet), trafienie otrzymane vs zadane
- [ ] Przeciwnik strzelający za plecami jest słyszalny kierunkowo
- [ ] Wszystkie sample wpisane w LICENSES.md
- [ ] Brak błędów autoplay w konsoli (Chrome/Firefox/Edge)
- [ ] 60 fps utrzymane przy pełnej walce 8 samolotów z efektami (GPU klasy NVIDIA RTX — cel sprzętowy
  od 2026-06-20, patrz PLAN.md ryzyko #7)
- [ ] typecheck + test + lint zielone; commit `faza-21`; memory zapisane

## Pułapki

- Dźwięk silnika z surowego sample'a w pętli ma słyszalny szew — crossfade dwóch instancji
  albo szukać sample przygotowanego do loopowania
- PositionalAudio na encji, która umiera → cleanup, inaczej wiszące źródła (wyciek)
- Miks: broń własna NIE może zagłuszać buffetu przeciągnięcia (informacja > efekciarstwo)

## Wynik

**Zakres AUDIO zrealizowany w całości** (474 testy/typecheck/lint/build zielone, commit `faza-21`). Część
WIZUALNA (smugi kondensacyjne, lepszy wybuch z prymitywnymi szczątkami, ślad dymny 20 mm) → **backlog**
(świadoma decyzja: efekty cząsteczkowe są nieweryfikowalne wzrokowo z tej sesji, a 60 fps jest kryterium —
nie wprowadzam ich „na ślepo"; do zrobienia z weryfikacją wzrokową usera). Hit detection/efekty bez zmian.

### Co zrobiono (audio)

- **`audio/audio-manager.ts`** — `THREE.AudioListener` na kamerze (3D pozycyjne obcych z grafu sceny),
  ładowanie 6 sampli OGG (~180 KB), master volume + mute przez `listener.setMasterVolume`
  (localStorage: `air-combat:audio-volume`/`-muted`), odblokowanie AudioContext pierwszym gestem
  (autoplay policy), pula 16 pozycyjnych jednostrzałów, syntezy „ding"/klik UI (oscylator).
- **`audio/voices.ts`** — `EngineVoice` (pętla, pitch+gain od RPM-proxy = gaz + drobny wkład prędkości,
  wygładzane), `GunVoice` (grzechot odświeżany eventami MUZZLE; Bf 109 dokłada dudnienie działka),
  `WindVoice` (świst z filtrowanego szumu rosnący kwadratowo z IAS + buffet przeciągnięcia — informacja).
- **Sample dobrane do KONKRETNYCH modeli** (życzenie usera): Merlin → Spitfire (`engine-spitfire`),
  **Daimler-Benz DB 601 → Bf 109** (autentyczny run-up, `engine-bf109`); broń: grzechot MG (ton
  różnicowany pitch'em per typ) + działko 20 mm dla Bf 109; wybuch, metaliczny łomot trafienia. Wszystkie
  z freesound (CC0/CC-BY), atrybucje w `assets/LICENSES.md`.
- **Integracja w `online-main.ts`**: głosy per encja w pętli renderu (silnik=throttle/prędkość, broń=MUZZLE),
  cleanup przy śmierci/usunięciu encji i resecie meczu (pułapka: wiszące źródła = wyciek); świst/buffet z
  własnej maszyny; eksplozja przy uderzeniu w powierzchnię; łomot (oberwałem) / „ding" (trafiłem); panel
  głośności w menu pauzy (Esc) + klawisz **M** (mute); klik UI w lobby.

### Kryteria

- [x] Różnica throttle 50/100% (pitch+gain silnika), nurkowanie (świst ∝ IAS²), buffet (pomruk ∝ intensywność),
  trafienie otrzymane (łomot) vs zadane (ding) — **zaimplementowane**; ⏳ user: odsłuch/playtest.
- [x] Przeciwnik strzelający za plecami słyszalny kierunkowo — `PositionalAudio` na meshu (panner z grafu sceny).
- [x] Wszystkie sample w `LICENSES.md` (2× CC-BY z pełną formułą, 4× CC0).
- [~] Brak błędów autoplay — kontekst odblokowywany pierwszym gestem; ⏳ user: weryfikacja Chrome/Firefox/Edge.
- [ ] 60 fps przy 8 samolotach — ⏳ user (cel sprzętowy RTX); audio = ~17 źródeł pętli + rzadkie jednostrzały.
- [x] typecheck + test (474) + lint + build zielone; commit `faza-21`; memory zapisane.

### Backlog (część wizualna fazy — do akceptacji/weryfikacji usera)

- Smugi kondensacyjne z końcówek skrzydeł sprzężone z przeciążeniem **n** (czytelność manewrów wroga; dla
  obcych **n** wyliczalne z krzywizny toru prędkości — bez zmiany protokołu). Plan gotowy, reużycie `SmokeTrails`.
- Lepszy wybuch (flash + prymitywne szczątki), ślad dymny pocisków 20 mm, smugi przy wysokim G na powierzchniach.
