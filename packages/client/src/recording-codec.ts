// Kodek nagrania rejestratora: Float32 ↔ base64 w localStorage.
// Celowo BEZ importów z @air-combat/shared — strona /telemetry nie ma
// powodu ładować three.js i całej fizyki.

export const RECORDING_STORAGE_KEY = 'air-combat:recording';

export const RECORDER_CHANNELS = [
  't_s',
  'ias_kmh',
  'tas_kmh',
  'alt_m',
  'n_g',
  'n_avail_g',
  'alpha_deg',
  'energia_MJ',
  'throttle',
  'faza_stall',
  'nosna_N',
  'opor_N',
  'ciag_N',
  'vy_ms',
] as const;

/** Zapis do localStorage dla /telemetry. Zwraca false przy braku miejsca. */
export function saveRecording(rows: Float32Array): boolean {
  const bytes = new Uint8Array(rows.buffer, rows.byteOffset, rows.byteLength);
  let binary = '';
  const CHUNK = 0x8000; // String.fromCharCode ze spreadem całości przepełnia stos
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  try {
    localStorage.setItem(
      RECORDING_STORAGE_KEY,
      JSON.stringify({ channels: RECORDER_CHANNELS, base64: btoa(binary) }),
    );
    return true;
  } catch {
    return false; // przekroczony limit localStorage
  }
}

/** Dekodowanie nagrania z localStorage (strona /telemetry). */
export function loadRecording(): { channels: string[]; rows: Float32Array } | null {
  const raw = localStorage.getItem(RECORDING_STORAGE_KEY);
  if (raw === null) return null;
  const parsed = JSON.parse(raw) as { channels: string[]; base64: string };
  const binary = atob(parsed.base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return { channels: parsed.channels, rows: new Float32Array(bytes.buffer) };
}
