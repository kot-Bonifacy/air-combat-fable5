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
- [ ] 60 fps utrzymane przy pełnej walce 8 samolotów z efektami
- [ ] typecheck + test + lint zielone; commit `faza-21`; memory zapisane

## Pułapki

- Dźwięk silnika z surowego sample'a w pętli ma słyszalny szew — crossfade dwóch instancji
  albo szukać sample przygotowanego do loopowania
- PositionalAudio na encji, która umiera → cleanup, inaczej wiszące źródła (wyciek)
- Miks: broń własna NIE może zagłuszać buffetu przeciągnięcia (informacja > efekciarstwo)

## Wynik (uzupełnić po zakończeniu)

—
