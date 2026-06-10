# Faza 17 — Modułowe uszkodzenia („zaawansowana fizyka walki")

**Zależy od:** Faza 16
**Cel:** trafienia mają konsekwencje taktyczne — uszkodzony samolot lata gorzej w konkretny,
czytelny sposób. Zwieńczenie projektu: fizyka walki na poziomie obiecanym w założeniach.

## Zakres

W tej fazie:
- Strefy trafień zamiast jednej sfery: 5–7 prostych brył per samolot (nos/silnik, kabina,
  zbiornik, skrzydło L/P, ogon) — definicje w JSON samolotu; hit detection serwerowy
  iteruje strefy (nadal odcinek vs bryła, tylko więcej brył)
- Skutki uszkodzeń — KAŻDY przez modyfikację parametrów istniejącej fizyki (nie nowe systemy):
  - **silnik**: degradacja `enginePowerW` progowo (100/60/30/0%), dym narastający, możliwy pożar
  - **skrzydło**: spadek `clMax` i wzrost `cd0` po stronie; asymetria = stały bias roll rate
    (gracz musi kontrować lotką — czuć to!); utrata końcówki przy 0 HP strefy
  - **ogon**: degradacja autorytetu pitch/yaw (mnożnik na zadane rate'y)
  - **zbiornik**: wyciek (utrata „paliwa" = timer do zgaśnięcia silnika) lub pożar (DoT do HP)
  - **kabina**: pilot ranny (okresowe zaburzenia inputu) lub kill (natychmiastowy)
- Pożar: szansa zależna od kalibru (20 mm >> 7.7 mm), gaśnie sam po X s albo dobija
- Destrukcja skrzydła = uproszczony korkociąg: autorotacja + brak kontroli + spirala w dół
  (kinematyczna sekwencja, nie nowa fizyka)
- HUD uszkodzeń: sylwetka samolotu z kolorami stref (zielony/żółty/czerwony)
- Protokół: stan stref w snapshot (kilka bitów per strefa); wizualizacja uszkodzeń obcych
  (dym, ogień, brakująca końcówka skrzydła)
- Balans: globalne HP znika — śmierć wyłącznie przez: pilot kill / silnik+przymusowe wodowanie /
  destrukcja strukturalna / pożar. Re-tuning dmg w sesjach testowych

Poza zakresem: oderwane powierzchnie jako fizyczne obiekty, naprawy, lotniska.

## Kroki

1. `shared/src/combat/damage-model.ts`: strefy, stany, skutki jako modyfikatory configu + testy
   (np. „skrzydło L 50% → roll w lewo wolniejszy o X")
2. Definicje brył stref w JSON obu samolotów (zgrubne dopasowanie do modeli 3D)
3. Serwerowy hit detection po strefach + przeniesienie skutków do symulacji
4. Korkociąg destrukcji + pilot kill + pożar/wyciek (maszyna stanów per encja + testy)
5. HUD sylwetki + efekty wizualne obcych uszkodzeń
6. Sesje balansowe (czas do killa 20 mm vs 7.7 mm — notatki w memory)

## Kryteria ukończenia

- [ ] Testy modyfikatorów: każda strefa × każdy próg ma test wpływu na parametry fizyki
- [ ] Odstrzelone skrzydło → korkociąg → krater; trafiony silnik → dym, utrata mocy, da się
  szybować i spróbować dolecieć nad wodę
- [ ] Asymetrię skrzydła CZUĆ na drążku (bias roll wymaga kontry) — test subiektywny
- [ ] Boty reagują sensownie na uszkodzenia (uciekają przy krytycznych — rozszerzenie FSM o warunek)
- [ ] Złote testy fizyki (nieuszkodzony samolot) bez zmian — model uszkodzeń niczego nie psuje
- [ ] Sesja online: śmierci czytelne („wiem, co mnie zabiło") — feedback z testerów w memory
- [ ] typecheck + test + lint zielone; commit + tag `1.0`; memory zapisane

## Pułapki

- Skutki uszkodzeń jako MODYFIKATORY istniejących parametrów JSON — jeśli jakiś skutek wymaga
  nowego mechanizmu w rdzeniu fizyki, to sygnał przeprojektowania skutku, nie fizyki
- Pilot kill frustruje przy zbyt wysokiej szansie — historycznie rzadki, w grze ma być rzadki
  (< 5% killi); zaczynać od zera szansy i podnosić
- Stan stref w snapshot: bity, nie bajty — rozmiar pakietu pilnowany od fazy 8

## Wynik (uzupełnić po zakończeniu)

—
