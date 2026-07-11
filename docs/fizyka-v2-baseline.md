# Fizyka v2 — raport bazowy (R0, stara fizyka)

Wygenerowano: 2026-07-10 przez
`BASELINE=1 npx vitest run scripts/fizyka-v2-baseline.report.test.ts`.

Baseline PRZED rekalibracją (etap R0, docs/fizyka-v2-rekalibracja.md §8.4) — wartości
z harnessu `testing/maneuvers.ts` + `testing/combat-maneuvers.ts` na fizyce sprzed v2.
Kolumna „po v2 (R4)" wypełniona w etapie R4 (2026-07-12) — bieżąca fizyka po kalibracji.
Zmiany R4: krzywe mocy §6.6 (moc BOJOWA — Vmax SL do historycznych ~467/467/440;
WEP przywraca szczyt osobno), oswaldE Spitfire 0.87→0.78 (zakręt 18.5 s), Bf clMax 2.0→2.1 +
miękkie knoby buffet (sloty; stall 123), krzywe mocy wydłużyły czas do 6000 m ku historii.

Metodologia: testy czasowe idą przez pełny pipeline pilota (`pilotStep` — koperta,
G-LOC, maszyna przeciągnięcia); Ps i czas wznoszenia liczone analitycznie z bilansu
sił/mocy (bez artefaktów regulatorów). „SL" = 100 m. IAS wejściowe manewrów ustawiane
bezpośrednio (także powyżej Vmax poziomej — manewr chwilowy).

## Spitfire Mk IIa (`Spitfire Mk IIa (Merlin XII, +12 lb boost)`)

### Prędkość maksymalna pozioma (TAS)

| Wysokość | Vmax [km/h TAS] | po v2 (R4) |
|---|---|---|
| 100 m | 504.8 | 464.3 |
| 1500 m | 527.8 | 493.6 |
| 3000 m | 554.3 | 528.0 |
| 4500 m | 559.4 | 563.1 |
| 6000 m | 555.1 | 543.2 |

### Przeciągnięcie i wznoszenie

| Metryka | Wartość | po v2 (R4) |
|---|---|---|
| Stall czysty (100 m) | 118.1 km/h IAS | 118.1 km/h IAS |
| Wznoszenie @ 100 m | 16.8 m/s (bilans 16.8, V 360 km/h TAS) | 15.6 m/s (bilans 15.6) |
| Wznoszenie @ 1500 m | 17.9 m/s (bilans 17.9, V 360 km/h TAS) | 16.5 m/s (bilans 16.5) |
| Wznoszenie @ 3000 m | 18.9 m/s (bilans 18.9, V 360 km/h TAS) | 17.5 m/s (bilans 17.5) |
| Czas 100 m → 3000 m | 2'42" (162 s) | 2'56" (176 s) |
| Czas 100 m → 6000 m | 5'28" (328 s) | 5'45" (345 s) |

### Zakręt ustalony 360° (pełny pipeline)

| Wysokość | Czas 360° [s] | Bank [°] | V [km/h TAS] | Dryf wys. [m] | po v2 (R4) |
|---|---|---|---|---|---|
| 300 m | 17.5 | 69 | 245 | -22 | 18.3 s (bank 68, V 247, dryf -18) |
| 1000 m | 18.0 | 69 | 254 | -22 | 18.8 s (bank 68, V 256, dryf -17) |
| 3000 m | 19.5 | 69 | 281 | -20 | 20.4 s (bank 68, V 283, dryf -14) |

### Zawrócenie 180° max-rate (pełny pipeline)

| Wejście IAS | Wysokość | Czas [s] | IAS wyjścia [km/h] | Δwys. [m] (+ = zysk) | po v2 (R4) |
|---|---|---|---|---|---|
| 250 km/h | 100 m | 7.2 | 208 | 37 | 7.3 s (IAS 202, Δ 36) |
| 350 km/h | 100 m | 5.5 | 262 | 63 | 5.7 s (IAS 252, Δ 61) |
| 450 km/h | 100 m | 7.1 | 370 | 108 | 6.9 s (IAS 349, Δ 102) |
| 250 km/h | 3000 m | 8.2 | 209 | 44 | 8.4 s (IAS 203, Δ 43) |
| 350 km/h | 3000 m | 6.3 | 262 | 74 | 6.5 s (IAS 252, Δ 73) |
| 450 km/h | 3000 m | 8.2 | 368 | 121 | 8.0 s (IAS 352, Δ 116) |

### Roll: tempo ustalone i czas pełnej beczki (pełny pipeline)

| IAS [km/h] | Roll rate @ 100 m [°/s] | Beczka 360° @ 1000 m [s] | po v2 (R4) |
|---|---|---|---|
| 200 | 66.0 | 5.3 | 65.9 / 5.3 |
| 250 | 79.1 | 4.6 | 79.2 / 4.6 |
| 300 | 76.1 | 4.8 | 76.1 / 4.8 |
| 350 | 68.0 | 5.4 | 68.2 / 5.4 |
| 400 | 57.3 | 6.5 | 57.5 / 6.5 |
| 450 | 46.5 | 8.3 | 46.7 / 8.2 |

Bleed beczek (10 s pełnych lotek @ 400 km/h, 1000 m, 1.5 obrotu): koszt energetyczny **5.3 km/h IAS-ekwiwalentu** (E-height −18 m; surowa IAS 400 → 462 km/h — beczkujący samolot nurkuje, stąd metryka energetyczna). Stara fizyka: roll kinematyczny — baseline dla §6.1.

### Mapa energetyczna Ps (analitycznie, 1000 m)

| IAS [km/h] | Ps @ 3 G [m/s] | Ps @ 5 G [m/s] | Ps @ max n [m/s] (n) | po v2 (R4) |
|---|---|---|---|---|
| 250 | -1.8 | -27.8 | -27.8 (4.5 G) | -3.9 / -32.4 / -32.4 (4.5 G) |
| 350 | 6.0 | -17.8 | -81.2 (8.0 G) | -0.7 / -27.1 / -96.7 (8.0 G) |
| 450 | -2.0 | -19.8 | -64.9 (8.0 G) | -8.3 / -28.2 / -78.1 (8.0 G) |

### Pętla z lotu poziomego (pełny pipeline, start 500 m)

| Wejście IAS | Domyka? | Czas [s] | Min TAS [km/h] | Apex [m nad wejściem] | po v2 (R4) |
|---|---|---|---|---|---|
| 250 km/h | TAK | 15.4 | 79 | 230 | TAK 40.3 s (min 67, apex 263) |
| 300 km/h | TAK | 13.3 | 137 | 252 | TAK 13.5 s (min 129, apex 250) |
| 350 km/h | TAK | 11.6 | 187 | 260 | TAK 11.9 s (min 176, apex 259) |
| 400 km/h | TAK | 10.8 | 234 | 296 | TAK 11.1 s (min 222, apex 288) |

### Nurkowanie i zoom (scenariusze asymetrii)

| Metryka | Wartość | po v2 (R4) |
|---|---|---|
| Nurkowanie −35° z 4500 m, V po 25 s | 838 km/h TAS | 830 km/h TAS |
| Zoom climb 45° bez ciągu (180→90 m/s) | 1008 m | 1008 m |

## Bf 109 E-3 (`Bf 109 E-3 (DB 601A)`)

### Prędkość maksymalna pozioma (TAS)

| Wysokość | Vmax [km/h TAS] | po v2 (R4) |
|---|---|---|
| 100 m | 500.4 | 473.7 |
| 1500 m | 522.4 | 504.4 |
| 3000 m | 547.8 | 539.4 |
| 4500 m | 575.3 | 557.0 |
| 6000 m | 567.0 | 494.2 |

### Przeciągnięcie i wznoszenie

| Metryka | Wartość | po v2 (R4) |
|---|---|---|
| Stall czysty (100 m) | 129.5 km/h IAS | 126.3 km/h IAS |
| Wznoszenie @ 100 m | 15.4 m/s (bilans 15.4, V 331 km/h TAS) | 14.0 m/s (bilans 13.9) |
| Wznoszenie @ 1500 m | 15.9 m/s (bilans 15.9, V 331 km/h TAS) | 14.8 m/s (bilans 14.8) |
| Wznoszenie @ 3000 m | 16.2 m/s (bilans 16.2, V 331 km/h TAS) | 15.7 m/s (bilans 15.7) |
| Czas 100 m → 3000 m | 3'03" (183 s) | 3'16" (196 s) |
| Czas 100 m → 6000 m | 6'16" (376 s) | 7'13" (433 s) |

### Zakręt ustalony 360° (pełny pipeline)

| Wysokość | Czas 360° [s] | Bank [°] | V [km/h TAS] | Dryf wys. [m] | po v2 (R4) |
|---|---|---|---|---|---|
| 300 m | 23.3 | 65 | 286 | 1 | 23.1 s (bank 65, V 286, dryf 0) |
| 1000 m | 24.0 | 65 | 295 | 3 | 23.8 s (bank 65, V 293, dryf 3) |
| 3000 m | 26.2 | 65 | 328 | 12 | 25.8 s (bank 64, V 317, dryf 11) |

### Zawrócenie 180° max-rate (pełny pipeline)

| Wejście IAS | Wysokość | Czas [s] | IAS wyjścia [km/h] | Δwys. [m] (+ = zysk) | po v2 (R4) |
|---|---|---|---|---|---|
| 250 km/h | 100 m | 9.4 | 186 | 29 | 9.1 s (IAS 180, Δ 27) |
| 350 km/h | 100 m | 7.0 | 229 | 49 | 6.8 s (IAS 220, Δ 47) |
| 450 km/h | 100 m | 6.4 | 294 | 83 | 6.3 s (IAS 285, Δ 80) |
| 250 km/h | 3000 m | 10.8 | 187 | 34 | 10.5 s (IAS 180, Δ 32) |
| 350 km/h | 3000 m | 8.0 | 229 | 57 | 7.8 s (IAS 221, Δ 55) |
| 450 km/h | 3000 m | 7.5 | 294 | 95 | 7.4 s (IAS 290, Δ 92) |

### Roll: tempo ustalone i czas pełnej beczki (pełny pipeline)

| IAS [km/h] | Roll rate @ 100 m [°/s] | Beczka 360° @ 1000 m [s] | po v2 (R4) |
|---|---|---|---|
| 200 | 73.5 | 4.8 | 73.4 / 4.8 |
| 250 | 91.7 | 3.9 | 91.8 / 3.9 |
| 300 | 88.3 | 4.1 | 88.4 / 4.1 |
| 350 | 84.3 | 4.3 | 84.6 / 4.3 |
| 400 | 69.2 | 5.3 | 69.6 / 5.3 |
| 450 | 54.1 | 7.0 | 54.4 / 7.0 |

Bleed beczek (10 s pełnych lotek @ 400 km/h, 1000 m, 1.8 obrotu): koszt energetyczny **2.9 km/h IAS-ekwiwalentu** (E-height −10 m; surowa IAS 400 → 460 km/h — beczkujący samolot nurkuje, stąd metryka energetyczna). Stara fizyka: roll kinematyczny — baseline dla §6.1.

### Mapa energetyczna Ps (analitycznie, 1000 m)

| IAS [km/h] | Ps @ 3 G [m/s] | Ps @ 5 G [m/s] | Ps @ max n [m/s] (n) | po v2 (R4) |
|---|---|---|---|---|
| 250 | -18.8 | -41.8 | -41.8 (3.7 G) | -18.8 / -49.0 / -49.0 (3.9 G) |
| 350 | -6.5 | -51.1 | -143.4 (7.3 G) | -9.1 / -53.7 / -165.7 (7.7 G) |
| 450 | -10.3 | -42.2 | -126.2 (8.0 G) | -12.9 / -44.8 / -128.8 (8.0 G) |

### Pętla z lotu poziomego (pełny pipeline, start 500 m)

| Wejście IAS | Domyka? | Czas [s] | Min TAS [km/h] | Apex [m nad wejściem] | po v2 (R4) |
|---|---|---|---|---|---|
| 250 km/h | NIE | 45.0 | 19 | 227 | TAK 34.7 s (min 20, apex 218) |
| 300 km/h | TAK | 33.0 | 77 | 268 | TAK 16.1 s (min 77, apex 256) |
| 350 km/h | TAK | 15.3 | 125 | 293 | TAK 14.9 s (min 122, apex 278) |
| 400 km/h | TAK | 13.9 | 169 | 306 | TAK 13.6 s (min 165, apex 292) |

### Nurkowanie i zoom (scenariusze asymetrii)

| Metryka | Wartość | po v2 (R4) |
|---|---|---|
| Nurkowanie −35° z 4500 m, V po 25 s | 852 km/h TAS | 848 km/h TAS |
| Zoom climb 45° bez ciągu (180→90 m/s) | 1032 m | 1032 m |

## A6M2 Zero (`A6M2 Zero model 21 (Sakae 12)`)

### Prędkość maksymalna pozioma (TAS)

| Wysokość | Vmax [km/h TAS] | po v2 (R4) |
|---|---|---|
| 100 m | 454.9 | 440.6 |
| 1500 m | 475.6 | 467.7 |
| 3000 m | 499.6 | 498.9 |
| 4500 m | 525.9 | 532.9 |
| 6000 m | 523.7 | 451.2 |

### Przeciągnięcie i wznoszenie

| Metryka | Wartość | po v2 (R4) |
|---|---|---|
| Stall czysty (100 m) | 104.4 km/h IAS | 104.4 km/h IAS |
| Wznoszenie @ 100 m | 15.0 m/s (bilans 14.9, V 317 km/h TAS) | 14.8 m/s (bilans 14.8) |
| Wznoszenie @ 1500 m | 15.9 m/s (bilans 15.9, V 324 km/h TAS) | 15.8 m/s (bilans 15.8) |
| Wznoszenie @ 3000 m | 16.9 m/s (bilans 16.9, V 331 km/h TAS) | 16.8 m/s (bilans 16.8) |
| Czas 100 m → 3000 m | 3'02" (182 s) | 3'03" (183 s) |
| Czas 100 m → 6000 m | 5'57" (357 s) | 6'15" (375 s) |

### Zakręt ustalony 360° (pełny pipeline)

| Wysokość | Czas 360° [s] | Bank [°] | V [km/h TAS] | Dryf wys. [m] | po v2 (R4) |
|---|---|---|---|---|---|
| 300 m | 14.9 | 69 | 203 | -31 | 14.8 s (bank 69, V 203, dryf -31) |
| 1000 m | 15.3 | 69 | 211 | -31 | 15.2 s (bank 69, V 211, dryf -31) |
| 3000 m | 16.4 | 69 | 234 | -31 | 16.4 s (bank 69, V 234, dryf -32) |

### Zawrócenie 180° max-rate (pełny pipeline)

| Wejście IAS | Wysokość | Czas [s] | IAS wyjścia [km/h] | Δwys. [m] (+ = zysk) | po v2 (R4) |
|---|---|---|---|---|---|
| 250 km/h | 100 m | 5.7 | 208 | 36 | 5.7 s (IAS 208, Δ 36) |
| 350 km/h | 100 m | 5.7 | 287 | 79 | 5.7 s (IAS 284, Δ 77) |
| 450 km/h | 100 m | 8.3 | 329 | 272 | 8.3 s (IAS 324, Δ 263) |
| 250 km/h | 3000 m | 6.4 | 209 | 43 | 6.5 s (IAS 209, Δ 43) |
| 350 km/h | 3000 m | 6.5 | 286 | 91 | 6.5 s (IAS 285, Δ 90) |
| 450 km/h | 3000 m | 9.4 | 326 | 332 | 9.4 s (IAS 325, Δ 329) |

### Roll: tempo ustalone i czas pełnej beczki (pełny pipeline)

| IAS [km/h] | Roll rate @ 100 m [°/s] | Beczka 360° @ 1000 m [s] | po v2 (R4) |
|---|---|---|---|
| 200 | 78.7 | 4.5 | 78.6 / 4.6 |
| 250 | 84.2 | 4.3 | 84.4 / 4.3 |
| 300 | 73.7 | 5.0 | 74.0 / 4.9 |
| 350 | 46.3 | 10.9 | 47.1 / 10.4 |
| 400 | 24.3 | 35.4 | 24.4 / 34.6 |
| 450 | 11.8 | 50.6 | 11.9 / 50.2 |

Bleed beczek (10 s pełnych lotek @ 400 km/h, 1000 m, 0.5 obrotu): koszt energetyczny **7.6 km/h IAS-ekwiwalentu** (E-height −26 m; surowa IAS 400 → 464 km/h — beczkujący samolot nurkuje, stąd metryka energetyczna). Stara fizyka: roll kinematyczny — baseline dla §6.1.

### Mapa energetyczna Ps (analitycznie, 1000 m)

| IAS [km/h] | Ps @ 3 G [m/s] | Ps @ 5 G [m/s] | Ps @ max n [m/s] (n) | po v2 (R4) |
|---|---|---|---|---|
| 250 | 3.3 | -19.9 | -31.6 (5.7 G) | 3.3 / -19.9 / -31.6 (5.7 G) |
| 350 | 4.6 | -11.3 | -35.5 (7.0 G) | 3.1 / -12.8 / -37.0 (7.0 G) |
| 450 | -6.7 | -18.9 | -37.3 (7.0 G) | -8.2 / -20.4 / -38.9 (7.0 G) |

### Pętla z lotu poziomego (pełny pipeline, start 500 m)

| Wejście IAS | Domyka? | Czas [s] | Min TAS [km/h] | Apex [m nad wejściem] | po v2 (R4) |
|---|---|---|---|---|---|
| 250 km/h | TAK | 11.9 | 114 | 195 | TAK 11.9 s (min 114, apex 195) |
| 300 km/h | TAK | 10.2 | 168 | 203 | TAK 10.2 s (min 168, apex 203) |
| 350 km/h | TAK | 9.4 | 217 | 237 | TAK 9.4 s (min 216, apex 236) |
| 400 km/h | TAK | 10.4 | 255 | 306 | TAK 10.3 s (min 254, apex 304) |

### Nurkowanie i zoom (scenariusze asymetrii)

| Metryka | Wartość | po v2 (R4) |
|---|---|---|
| Nurkowanie −35° z 4500 m, V po 25 s | 798 km/h TAS | 798 km/h TAS |
| Zoom climb 45° bez ciągu (180→90 m/s) | 972 m | 972 m |
