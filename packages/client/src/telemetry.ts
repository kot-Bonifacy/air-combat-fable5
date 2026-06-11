import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import { loadRecording, RECORDER_CHANNELS } from './recording-codec';

// Strona /telemetry (fizyka-lotu.md rozdz. 11.4): wykresy uPlot z nagrania
// rejestratora przekazanego przez localStorage. Procedura debugowania
// rozdz. 12 pkt 3: "nagraj 30 s → wykresy: co dokładnie się dzieje z V/h/n".

const CHANNELS = RECORDER_CHANNELS.length;

interface ChartSpec {
  title: string;
  series: { channel: (typeof RECORDER_CHANNELS)[number]; label: string; color: string }[];
}

const CHARTS: ChartSpec[] = [
  {
    title: 'Prędkość [km/h]',
    series: [
      { channel: 'tas_kmh', label: 'TAS', color: '#6cf' },
      { channel: 'ias_kmh', label: 'IAS', color: '#fc6' },
    ],
  },
  {
    title: 'Wysokość [m] / prędkość pionowa [m/s]',
    series: [
      { channel: 'alt_m', label: 'h', color: '#9f9' },
      { channel: 'vy_ms', label: 'vy', color: '#f99' },
    ],
  },
  {
    title: 'Przeciążenie [G] (z fazą przeciągnięcia 0/1/2)',
    series: [
      { channel: 'n_g', label: 'n', color: '#f6c' },
      { channel: 'n_avail_g', label: 'n dostępne', color: '#999' },
      { channel: 'faza_stall', label: 'faza stall', color: '#fa3' },
    ],
  },
  {
    title: 'Energia całkowita [MJ] / siły [kN]',
    series: [
      { channel: 'energia_MJ', label: 'E', color: '#cf6' },
      { channel: 'nosna_N', label: 'nośna [kN]', color: '#6cf' },
      { channel: 'opor_N', label: 'opór [kN]', color: '#f96' },
      { channel: 'ciag_N', label: 'ciąg [kN]', color: '#9f6' },
    ],
  },
];

function column(rows: Float32Array, channel: string): number[] {
  const idx = (RECORDER_CHANNELS as readonly string[]).indexOf(channel);
  const n = rows.length / CHANNELS;
  const out = new Array<number>(n);
  const scale = channel.endsWith('_N') ? 1e-3 : 1; // siły w kN dla czytelności
  for (let r = 0; r < n; r++) out[r] = (rows[r * CHANNELS + idx] ?? 0) * scale;
  return out;
}

const recording = loadRecording();
const chartsEl = document.getElementById('charts');
const emptyEl = document.getElementById('empty');
if (!chartsEl || !emptyEl) throw new Error('brak elementów strony telemetrii');

if (recording === null || recording.rows.length === 0) {
  emptyEl.hidden = false;
} else {
  const time = column(recording.rows, 't_s');
  for (const spec of CHARTS) {
    const wrap = document.createElement('div');
    wrap.className = 'chart';
    const h2 = document.createElement('h2');
    h2.textContent = spec.title;
    wrap.appendChild(h2);
    chartsEl.appendChild(wrap);

    const data: uPlot.AlignedData = [
      time,
      ...spec.series.map((s) => column(recording.rows, s.channel)),
    ];
    new uPlot(
      {
        width: Math.min(1400, window.innerWidth - 48),
        height: 260,
        series: [
          { label: 't [s]' },
          ...spec.series.map((s) => ({ label: s.label, stroke: s.color, width: 1.5 })),
        ],
        axes: [
          { stroke: '#9bc', grid: { stroke: '#223' } },
          { stroke: '#9bc', grid: { stroke: '#223' } },
        ],
      },
      data,
      wrap,
    );
  }
}
