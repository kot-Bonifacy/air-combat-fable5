# Faza 20 — Teren v2 (TWARDY TIMEBOX: jedna sesja)

**Zależy od:** Faza 19
**Cel:** ładniejszy świat bez regresji wydajności. To faza „nice to have" — gra jest już
kompletna; tu wolno TYLKO ulepszać, nigdy przebudowywać.

## ⚠️ Reguły specjalne tej fazy

Poprzedni projekt (opus4-7) umarł dokładnie na tym etapie (LOD + splatting + chmury).
Dlatego:
1. **Timebox: jedna sesja.** Co nie weszło — zostaje w backlogu bez żalu.
2. Każdy punkt zakresu to OSOBNY commit — przerwanie w dowolnym momencie zostawia projekt zdrowym.
3. Kolejność od najtańszego efektu wizualnego do najdroższego.
4. `terrainHeight()` w `shared` NIE ZMIENIA SIĘ (kolizje i boty od niej zależą) —
   upiększanie jest wyłącznie po stronie renderera.

## Zakres (w kolejności wykonywania)

1. **Tani wygrany efekt**: lepsza paleta vertex colors + delikatny noise koloru, poprawione
   światło (godzina złota), mocniejsza mgła dystansowa, prosty efekt słońca (lens flare/glow)
2. **Chmury billboardowe**: 50–150 sprite'ów na 2 warstwach wysokości (taktycznie ważne —
   można się w nich chować! widoczność encji przez chmurę ograniczona po stronie klienta)
3. **Woda v2**: normal map scrollowana + odbicie nieba (bez planar reflections!)
4. **Geometria w 2 poziomach**: pełna siatka < 8 km, rzadsza dalej (JEDEN przeskok,
   nie system LOD; granica ukryta we mgle)
5. (tylko jeśli został czas) Druga wyspa mała / skały przybrzeżne z prymitywów

Poza zakresem NA ZAWSZE w tej fazie: streaming chunków, splatting tekstur, drzewa,
chmury wolumetryczne, dynamiczna pogoda.

## Kryteria ukończenia

- [ ] 60 fps na zintegrowanej grafice — zmierzone PRZED i PO (brak regresji > 5%)
- [ ] Zero zmian w `shared/world/terrain.ts` (git diff pusty dla tego pliku)
- [ ] Wszystkie testy zielone bez modyfikacji
- [ ] Chmury: schowanie się w chmurze utrudnia namiar (znacznik HUD przygasa)
- [ ] Każdy podpunkt zakresu = osobny commit; sesja zakończona o czasie niezależnie od postępu
- [ ] typecheck + test + lint zielone; memory zapisane (w tym: co poszło do backlogu)

## Pułapki

- Przezroczystość chmur × sortowanie = klasyczne artefakty Three.js; sprite'y sortowane
  ręcznie po dystansie albo `depthWrite: false` i akceptacja niedoskonałości
- „Jeszcze tylko dodam shadery wody" — NIE. Timebox. Backlog.

## Wynik (uzupełnić po zakończeniu)

—
