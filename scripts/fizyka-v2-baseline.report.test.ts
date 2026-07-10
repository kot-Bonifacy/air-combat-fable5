import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'vitest';
import { MS_TO_KMH } from '../packages/shared/src/constants';
import {
  A6M2_ZERO,
  BF109_E,
  SPITFIRE_MK2,
  type PlaneConfig,
} from '../packages/shared/src/planes/loader';
import {
  loopTest,
  psBleedTest,
  rollBleedTest,
  rollTime360Test,
  timeToAltitudeTest,
  turn180Test,
} from '../packages/shared/src/testing/combat-maneuvers';
import {
  climbTest,
  diveSpeedTest,
  rollRateTest,
  stallTest,
  sustainedTurnTest,
  topSpeedTest,
  zoomClimbTest,
} from '../packages/shared/src/testing/maneuvers';

// Generator raportu bazowego rekalibracji v2 (docs/fizyka-v2-rekalibracja.md, etap R0):
// pełna macierz §8.4 dla trzech samolotów na BIEŻĄCEJ fizyce → docs/fizyka-v2-baseline.md.
// Celowo test vitest bramkowany zmienną środowiskową (BASELINE=1), a nie luźny skrypt:
// vitest daje rozwiązywanie TS/JSON identyczne z resztą repo bez dodatkowych zależności.
// Uruchomienie (R0 baza, R4 kolumna „po v2"):
//   BASELINE=1 npx vitest run scripts/fizyka-v2-baseline.report.test.ts
// Plik leży POZA packages/shared (niezmiennik nr 9: shared bez Node API) — fs tylko tutaj.

const PLANES: readonly { key: string; plane: PlaneConfig }[] = [
  { key: 'Spitfire Mk IIa', plane: SPITFIRE_MK2 },
  { key: 'Bf 109 E-3', plane: BF109_E },
  { key: 'A6M2 Zero', plane: A6M2_ZERO },
];

const ALTS_M = [100, 1500, 3000, 4500, 6000] as const;
const SPEEDS_KMH = [200, 250, 300, 350, 400, 450] as const;

const f = (v: number, digits = 1): string =>
  Number.isFinite(v) ? v.toFixed(digits) : '— (nie domyka)';
const mmss = (s: number): string => {
  const m = Math.floor(s / 60);
  const r = s - m * 60;
  return `${String(m)}'${r.toFixed(0).padStart(2, '0')}"`;
};

function planeSection(key: string, plane: PlaneConfig): string {
  const lines: string[] = [`## ${key} (\`${plane.name}\`)`, ''];

  lines.push('### Prędkość maksymalna pozioma (TAS)', '');
  lines.push('| Wysokość | Vmax [km/h TAS] | po v2 (R4) |', '|---|---|---|');
  for (const altM of ALTS_M) {
    lines.push(`| ${String(altM)} m | ${f(topSpeedTest(plane, altM) * MS_TO_KMH)} | — |`);
  }
  lines.push('');

  lines.push('### Przeciągnięcie i wznoszenie', '');
  lines.push('| Metryka | Wartość | po v2 (R4) |', '|---|---|---|');
  lines.push(`| Stall czysty (100 m) | ${f(stallTest(plane) * MS_TO_KMH)} km/h IAS | — |`);
  for (const altM of [100, 1500, 3000]) {
    const c = climbTest(plane, altM);
    lines.push(
      `| Wznoszenie @ ${String(altM)} m | ${f(c.rocMs)} m/s (bilans ${f(c.analyticRocMs)}, ` +
        `V ${f(c.bestSpeedMs * MS_TO_KMH, 0)} km/h TAS) | — |`,
    );
  }
  for (const targetM of [3000, 6000]) {
    const t = timeToAltitudeTest(plane, targetM);
    lines.push(`| Czas 100 m → ${String(targetM)} m | ${mmss(t)} (${f(t, 0)} s) | — |`);
  }
  lines.push('');

  lines.push('### Zakręt ustalony 360° (pełny pipeline)', '');
  lines.push(
    '| Wysokość | Czas 360° [s] | Bank [°] | V [km/h TAS] | Dryf wys. [m] | po v2 (R4) |',
    '|---|---|---|---|---|---|',
  );
  for (const altM of [300, 1000, 3000]) {
    const r = sustainedTurnTest(plane, altM);
    lines.push(
      `| ${String(altM)} m | ${f(r.turnTimeS)} | ${f(r.bankDeg, 0)} | ` +
        `${f(r.tasMs * MS_TO_KMH, 0)} | ${f(r.altitudeDriftM, 0)} | — |`,
    );
  }
  lines.push('');

  lines.push('### Zawrócenie 180° max-rate (pełny pipeline)', '');
  lines.push(
    '| Wejście IAS | Wysokość | Czas [s] | IAS wyjścia [km/h] | Δwys. [m] (+ = zysk) | po v2 (R4) |',
    '|---|---|---|---|---|---|',
  );
  for (const altM of [100, 3000]) {
    for (const iasKmh of [250, 350, 450]) {
      const r = turn180Test(plane, iasKmh, altM);
      lines.push(
        `| ${String(iasKmh)} km/h | ${String(altM)} m | ${f(r.timeS)} | ` +
          `${f(r.exitIasKmh, 0)} | ${f(r.altitudeDeltaM, 0)} | — |`,
      );
    }
  }
  lines.push('');

  lines.push('### Roll: tempo ustalone i czas pełnej beczki (pełny pipeline)', '');
  lines.push(
    '| IAS [km/h] | Roll rate @ 100 m [°/s] | Beczka 360° @ 1000 m [s] | po v2 (R4) |',
    '|---|---|---|---|',
  );
  for (const iasKmh of SPEEDS_KMH) {
    lines.push(
      `| ${String(iasKmh)} | ${f(rollRateTest(plane, iasKmh))} | ` +
        `${f(rollTime360Test(plane, iasKmh))} | — |`,
    );
  }
  const rb = rollBleedTest(plane);
  lines.push('');
  lines.push(
    `Bleed beczek (10 s pełnych lotek @ 400 km/h, 1000 m, ${f(rb.rolledTurns)} obrotu): ` +
      `koszt energetyczny **${f(rb.iasEquivDropKmh)} km/h IAS-ekwiwalentu** ` +
      `(E-height −${f(rb.energyDropM, 0)} m; surowa IAS ${f(rb.iasStartKmh, 0)} → ` +
      `${f(rb.iasEndKmh, 0)} km/h — beczkujący samolot nurkuje, stąd metryka energetyczna). ` +
      `Stara fizyka: roll kinematyczny — baseline dla §6.1.`,
    '',
  );

  lines.push('### Mapa energetyczna Ps (analitycznie, 1000 m)', '');
  lines.push(
    '| IAS [km/h] | Ps @ 3 G [m/s] | Ps @ 5 G [m/s] | Ps @ max n [m/s] (n) | po v2 (R4) |',
    '|---|---|---|---|---|',
  );
  for (const iasKmh of [250, 350, 450]) {
    const p3 = psBleedTest(plane, 3, iasKmh);
    const p5 = psBleedTest(plane, 5, iasKmh);
    const pMax = psBleedTest(plane, 99, iasKmh);
    lines.push(
      `| ${String(iasKmh)} | ${f(p3.psMs)} | ${f(p5.psMs)} | ` +
        `${f(pMax.psMs)} (${f(pMax.nEffectiveG)} G) | — |`,
    );
  }
  lines.push('');

  lines.push('### Pętla z lotu poziomego (pełny pipeline, start 500 m)', '');
  lines.push(
    '| Wejście IAS | Domyka? | Czas [s] | Min TAS [km/h] | Apex [m nad wejściem] | po v2 (R4) |',
    '|---|---|---|---|---|---|',
  );
  for (const iasKmh of [250, 300, 350, 400]) {
    const r = loopTest(plane, iasKmh);
    lines.push(
      `| ${String(iasKmh)} km/h | ${r.completed ? 'TAK' : 'NIE'} | ${f(r.timeS)} | ` +
        `${f(r.minTasMs * MS_TO_KMH, 0)} | ${f(r.apexGainM, 0)} | — |`,
    );
  }
  lines.push('');

  lines.push('### Nurkowanie i zoom (scenariusze asymetrii)', '');
  lines.push('| Metryka | Wartość | po v2 (R4) |', '|---|---|---|');
  lines.push(
    `| Nurkowanie −35° z 4500 m, V po 25 s | ${f(diveSpeedTest(plane) * MS_TO_KMH, 0)} km/h TAS | — |`,
  );
  lines.push(
    `| Zoom climb 45° bez ciągu (180→90 m/s) | ${f(zoomClimbTest(plane), 0)} m | — |`,
  );
  lines.push('');
  return lines.join('\n');
}

describe.runIf(process.env.BASELINE === '1')('raport bazowy fizyki v2 (R0)', () => {
  it('generuje docs/fizyka-v2-baseline.md (pełna macierz §8.4, 3 samoloty)', () => {
    const sections = PLANES.map(({ key, plane }) => planeSection(key, plane));
    const header = [
      '# Fizyka v2 — raport bazowy (R0, stara fizyka)',
      '',
      `Wygenerowano: ${new Date().toISOString().slice(0, 10)} przez`,
      '`BASELINE=1 npx vitest run scripts/fizyka-v2-baseline.report.test.ts`.',
      '',
      'Baseline PRZED rekalibracją (etap R0, docs/fizyka-v2-rekalibracja.md §8.4) — wartości',
      'z harnessu `testing/maneuvers.ts` + `testing/combat-maneuvers.ts` na fizyce sprzed v2.',
      'Kolumna „po v2 (R4)" zostanie wypełniona ponownym przebiegiem w etapie R4.',
      '',
      'Metodologia: testy czasowe idą przez pełny pipeline pilota (`pilotStep` — koperta,',
      'G-LOC, maszyna przeciągnięcia); Ps i czas wznoszenia liczone analitycznie z bilansu',
      'sił/mocy (bez artefaktów regulatorów). „SL" = 100 m. IAS wejściowe manewrów ustawiane',
      'bezpośrednio (także powyżej Vmax poziomej — manewr chwilowy).',
      '',
    ].join('\n');

    const thisDir = dirname(fileURLToPath(import.meta.url));
    const outPath = join(thisDir, '..', 'docs', 'fizyka-v2-baseline.md');
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, `${header}\n${sections.join('\n')}`, 'utf8');
  }, 600_000);
});
