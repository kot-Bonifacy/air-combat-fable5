# Fizyka v2 — raport bazowy (R0, stara fizyka)

Wygenerowano: 2026-07-10 przez
`BASELINE=1 npx vitest run scripts/fizyka-v2-baseline.report.test.ts`.

Baseline PRZED rekalibracją (etap R0, docs/fizyka-v2-rekalibracja.md §8.4) — wartości
z harnessu `testing/maneuvers.ts` + `testing/combat-maneuvers.ts` na fizyce sprzed v2.
Kolumna „po v2 (R4)" zostanie wypełniona ponownym przebiegiem w etapie R4.

Metodologia: testy czasowe idą przez pełny pipeline pilota (`pilotStep` — koperta,
G-LOC, maszyna przeciągnięcia); Ps i czas wznoszenia liczone analitycznie z bilansu
sił/mocy (bez artefaktów regulatorów). „SL" = 100 m. IAS wejściowe manewrów ustawiane
bezpośrednio (także powyżej Vmax poziomej — manewr chwilowy).

## Spitfire Mk IIa (`Spitfire Mk IIa (Merlin XII, +12 lb boost)`)

### Prędkość maksymalna pozioma (TAS)

| Wysokość | Vmax [km/h TAS] | po v2 (R4) |
|---|---|---|
| 100 m | 504.8 | — |
| 1500 m | 527.8 | — |
| 3000 m | 554.3 | — |
| 4500 m | 559.4 | — |
| 6000 m | 555.1 | — |

### Przeciągnięcie i wznoszenie

| Metryka | Wartość | po v2 (R4) |
|---|---|---|
| Stall czysty (100 m) | 118.1 km/h IAS | — |
| Wznoszenie @ 100 m | 16.8 m/s (bilans 16.8, V 360 km/h TAS) | — |
| Wznoszenie @ 1500 m | 17.9 m/s (bilans 17.9, V 360 km/h TAS) | — |
| Wznoszenie @ 3000 m | 18.9 m/s (bilans 18.9, V 360 km/h TAS) | — |
| Czas 100 m → 3000 m | 2'42" (162 s) | — |
| Czas 100 m → 6000 m | 5'28" (328 s) | — |

### Zakręt ustalony 360° (pełny pipeline)

| Wysokość | Czas 360° [s] | Bank [°] | V [km/h TAS] | Dryf wys. [m] | po v2 (R4) |
|---|---|---|---|---|---|
| 300 m | 17.5 | 69 | 245 | -22 | — |
| 1000 m | 18.0 | 69 | 254 | -22 | — |
| 3000 m | 19.5 | 69 | 281 | -20 | — |

### Zawrócenie 180° max-rate (pełny pipeline)

| Wejście IAS | Wysokość | Czas [s] | IAS wyjścia [km/h] | Δwys. [m] (+ = zysk) | po v2 (R4) |
|---|---|---|---|---|---|
| 250 km/h | 100 m | 7.2 | 208 | 37 | — |
| 350 km/h | 100 m | 5.5 | 262 | 63 | — |
| 450 km/h | 100 m | 7.1 | 370 | 108 | — |
| 250 km/h | 3000 m | 8.2 | 209 | 44 | — |
| 350 km/h | 3000 m | 6.3 | 262 | 74 | — |
| 450 km/h | 3000 m | 8.2 | 368 | 121 | — |

### Roll: tempo ustalone i czas pełnej beczki (pełny pipeline)

| IAS [km/h] | Roll rate @ 100 m [°/s] | Beczka 360° @ 1000 m [s] | po v2 (R4) |
|---|---|---|---|
| 200 | 66.0 | 5.3 | — |
| 250 | 79.1 | 4.6 | — |
| 300 | 76.1 | 4.8 | — |
| 350 | 68.0 | 5.4 | — |
| 400 | 57.3 | 6.5 | — |
| 450 | 46.5 | 8.3 | — |

Bleed beczek (10 s pełnych lotek @ 400 km/h, 1000 m, 1.5 obrotu): koszt energetyczny **5.3 km/h IAS-ekwiwalentu** (E-height −18 m; surowa IAS 400 → 462 km/h — beczkujący samolot nurkuje, stąd metryka energetyczna). Stara fizyka: roll kinematyczny — baseline dla §6.1.

### Mapa energetyczna Ps (analitycznie, 1000 m)

| IAS [km/h] | Ps @ 3 G [m/s] | Ps @ 5 G [m/s] | Ps @ max n [m/s] (n) | po v2 (R4) |
|---|---|---|---|---|
| 250 | -1.8 | -27.8 | -27.8 (4.5 G) | — |
| 350 | 6.0 | -17.8 | -81.2 (8.0 G) | — |
| 450 | -2.0 | -19.8 | -64.9 (8.0 G) | — |

### Pętla z lotu poziomego (pełny pipeline, start 500 m)

| Wejście IAS | Domyka? | Czas [s] | Min TAS [km/h] | Apex [m nad wejściem] | po v2 (R4) |
|---|---|---|---|---|---|
| 250 km/h | TAK | 15.4 | 79 | 230 | — |
| 300 km/h | TAK | 13.3 | 137 | 252 | — |
| 350 km/h | TAK | 11.6 | 187 | 260 | — |
| 400 km/h | TAK | 10.8 | 234 | 296 | — |

### Nurkowanie i zoom (scenariusze asymetrii)

| Metryka | Wartość | po v2 (R4) |
|---|---|---|
| Nurkowanie −35° z 4500 m, V po 25 s | 838 km/h TAS | — |
| Zoom climb 45° bez ciągu (180→90 m/s) | 1008 m | — |

## Bf 109 E-3 (`Bf 109 E-3 (DB 601A)`)

### Prędkość maksymalna pozioma (TAS)

| Wysokość | Vmax [km/h TAS] | po v2 (R4) |
|---|---|---|
| 100 m | 500.4 | — |
| 1500 m | 522.4 | — |
| 3000 m | 547.8 | — |
| 4500 m | 575.3 | — |
| 6000 m | 567.0 | — |

### Przeciągnięcie i wznoszenie

| Metryka | Wartość | po v2 (R4) |
|---|---|---|
| Stall czysty (100 m) | 129.5 km/h IAS | — |
| Wznoszenie @ 100 m | 15.4 m/s (bilans 15.4, V 331 km/h TAS) | — |
| Wznoszenie @ 1500 m | 15.9 m/s (bilans 15.9, V 331 km/h TAS) | — |
| Wznoszenie @ 3000 m | 16.2 m/s (bilans 16.2, V 331 km/h TAS) | — |
| Czas 100 m → 3000 m | 3'03" (183 s) | — |
| Czas 100 m → 6000 m | 6'16" (376 s) | — |

### Zakręt ustalony 360° (pełny pipeline)

| Wysokość | Czas 360° [s] | Bank [°] | V [km/h TAS] | Dryf wys. [m] | po v2 (R4) |
|---|---|---|---|---|---|
| 300 m | 23.3 | 65 | 286 | 1 | — |
| 1000 m | 24.0 | 65 | 295 | 3 | — |
| 3000 m | 26.2 | 65 | 328 | 12 | — |

### Zawrócenie 180° max-rate (pełny pipeline)

| Wejście IAS | Wysokość | Czas [s] | IAS wyjścia [km/h] | Δwys. [m] (+ = zysk) | po v2 (R4) |
|---|---|---|---|---|---|
| 250 km/h | 100 m | 9.4 | 186 | 29 | — |
| 350 km/h | 100 m | 7.0 | 229 | 49 | — |
| 450 km/h | 100 m | 6.4 | 294 | 83 | — |
| 250 km/h | 3000 m | 10.8 | 187 | 34 | — |
| 350 km/h | 3000 m | 8.0 | 229 | 57 | — |
| 450 km/h | 3000 m | 7.5 | 294 | 95 | — |

### Roll: tempo ustalone i czas pełnej beczki (pełny pipeline)

| IAS [km/h] | Roll rate @ 100 m [°/s] | Beczka 360° @ 1000 m [s] | po v2 (R4) |
|---|---|---|---|
| 200 | 73.5 | 4.8 | — |
| 250 | 91.7 | 3.9 | — |
| 300 | 88.3 | 4.1 | — |
| 350 | 84.3 | 4.3 | — |
| 400 | 69.2 | 5.3 | — |
| 450 | 54.1 | 7.0 | — |

Bleed beczek (10 s pełnych lotek @ 400 km/h, 1000 m, 1.8 obrotu): koszt energetyczny **2.9 km/h IAS-ekwiwalentu** (E-height −10 m; surowa IAS 400 → 460 km/h — beczkujący samolot nurkuje, stąd metryka energetyczna). Stara fizyka: roll kinematyczny — baseline dla §6.1.

### Mapa energetyczna Ps (analitycznie, 1000 m)

| IAS [km/h] | Ps @ 3 G [m/s] | Ps @ 5 G [m/s] | Ps @ max n [m/s] (n) | po v2 (R4) |
|---|---|---|---|---|
| 250 | -18.8 | -41.8 | -41.8 (3.7 G) | — |
| 350 | -6.5 | -51.1 | -143.4 (7.3 G) | — |
| 450 | -10.3 | -42.2 | -126.2 (8.0 G) | — |

### Pętla z lotu poziomego (pełny pipeline, start 500 m)

| Wejście IAS | Domyka? | Czas [s] | Min TAS [km/h] | Apex [m nad wejściem] | po v2 (R4) |
|---|---|---|---|---|---|
| 250 km/h | NIE | 45.0 | 19 | 227 | — |
| 300 km/h | TAK | 33.0 | 77 | 268 | — |
| 350 km/h | TAK | 15.3 | 125 | 293 | — |
| 400 km/h | TAK | 13.9 | 169 | 306 | — |

### Nurkowanie i zoom (scenariusze asymetrii)

| Metryka | Wartość | po v2 (R4) |
|---|---|---|
| Nurkowanie −35° z 4500 m, V po 25 s | 852 km/h TAS | — |
| Zoom climb 45° bez ciągu (180→90 m/s) | 1032 m | — |

## A6M2 Zero (`A6M2 Zero model 21 (Sakae 12)`)

### Prędkość maksymalna pozioma (TAS)

| Wysokość | Vmax [km/h TAS] | po v2 (R4) |
|---|---|---|
| 100 m | 454.9 | — |
| 1500 m | 475.6 | — |
| 3000 m | 499.6 | — |
| 4500 m | 525.9 | — |
| 6000 m | 523.7 | — |

### Przeciągnięcie i wznoszenie

| Metryka | Wartość | po v2 (R4) |
|---|---|---|
| Stall czysty (100 m) | 104.4 km/h IAS | — |
| Wznoszenie @ 100 m | 15.0 m/s (bilans 14.9, V 317 km/h TAS) | — |
| Wznoszenie @ 1500 m | 15.9 m/s (bilans 15.9, V 324 km/h TAS) | — |
| Wznoszenie @ 3000 m | 16.9 m/s (bilans 16.9, V 331 km/h TAS) | — |
| Czas 100 m → 3000 m | 3'02" (182 s) | — |
| Czas 100 m → 6000 m | 5'57" (357 s) | — |

### Zakręt ustalony 360° (pełny pipeline)

| Wysokość | Czas 360° [s] | Bank [°] | V [km/h TAS] | Dryf wys. [m] | po v2 (R4) |
|---|---|---|---|---|---|
| 300 m | 14.9 | 69 | 203 | -31 | — |
| 1000 m | 15.3 | 69 | 211 | -31 | — |
| 3000 m | 16.4 | 69 | 234 | -31 | — |

### Zawrócenie 180° max-rate (pełny pipeline)

| Wejście IAS | Wysokość | Czas [s] | IAS wyjścia [km/h] | Δwys. [m] (+ = zysk) | po v2 (R4) |
|---|---|---|---|---|---|
| 250 km/h | 100 m | 5.7 | 208 | 36 | — |
| 350 km/h | 100 m | 5.7 | 287 | 79 | — |
| 450 km/h | 100 m | 8.3 | 329 | 272 | — |
| 250 km/h | 3000 m | 6.4 | 209 | 43 | — |
| 350 km/h | 3000 m | 6.5 | 286 | 91 | — |
| 450 km/h | 3000 m | 9.4 | 326 | 332 | — |

### Roll: tempo ustalone i czas pełnej beczki (pełny pipeline)

| IAS [km/h] | Roll rate @ 100 m [°/s] | Beczka 360° @ 1000 m [s] | po v2 (R4) |
|---|---|---|---|
| 200 | 78.7 | 4.5 | — |
| 250 | 84.2 | 4.3 | — |
| 300 | 73.7 | 5.0 | — |
| 350 | 46.3 | 10.9 | — |
| 400 | 24.3 | 35.4 | — |
| 450 | 11.8 | 50.6 | — |

Bleed beczek (10 s pełnych lotek @ 400 km/h, 1000 m, 0.5 obrotu): koszt energetyczny **7.6 km/h IAS-ekwiwalentu** (E-height −26 m; surowa IAS 400 → 464 km/h — beczkujący samolot nurkuje, stąd metryka energetyczna). Stara fizyka: roll kinematyczny — baseline dla §6.1.

### Mapa energetyczna Ps (analitycznie, 1000 m)

| IAS [km/h] | Ps @ 3 G [m/s] | Ps @ 5 G [m/s] | Ps @ max n [m/s] (n) | po v2 (R4) |
|---|---|---|---|---|
| 250 | 3.3 | -19.9 | -31.6 (5.7 G) | — |
| 350 | 4.6 | -11.3 | -35.5 (7.0 G) | — |
| 450 | -6.7 | -18.9 | -37.3 (7.0 G) | — |

### Pętla z lotu poziomego (pełny pipeline, start 500 m)

| Wejście IAS | Domyka? | Czas [s] | Min TAS [km/h] | Apex [m nad wejściem] | po v2 (R4) |
|---|---|---|---|---|---|
| 250 km/h | TAK | 11.9 | 114 | 195 | — |
| 300 km/h | TAK | 10.2 | 168 | 203 | — |
| 350 km/h | TAK | 9.4 | 217 | 237 | — |
| 400 km/h | TAK | 10.4 | 255 | 306 | — |

### Nurkowanie i zoom (scenariusze asymetrii)

| Metryka | Wartość | po v2 (R4) |
|---|---|---|
| Nurkowanie −35° z 4500 m, V po 25 s | 798 km/h TAS | — |
| Zoom climb 45° bez ciągu (180→90 m/s) | 972 m | — |
