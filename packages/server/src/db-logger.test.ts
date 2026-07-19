import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDbLogger, formatWarsawDateTime } from './db-logger';

// Logowanie sesji do MySQL jest BEST-EFFORT i sterowane konfiguracją. Testy pilnują dwóch
// niezmienników bez dostępu do bazy: (1) brak konfiguracji → no-op, który NIGDY nie rzuca
// (gra nie może zależeć od bazy); (2) znaczniki czasu w Europe/Warsaw (czytelne w phpMyAdmin).

const silentLog = { info() {}, warn() {}, error() {} };

const DB_ENV = ['DB_LOG_HOST', 'DB_LOG_PORT', 'DB_LOG_USER', 'DB_LOG_PASSWORD', 'DB_LOG_DATABASE'] as const;

describe('createDbLogger — wyłączony bez konfiguracji', () => {
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    for (const k of DB_ENV) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });
  afterEach(() => {
    for (const k of DB_ENV) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it('bez zmiennych DB_LOG_* zwraca logger no-op, którego sesja się nie wywraca', () => {
    const logger = createDbLogger(silentLog);
    const session = logger.beginSession({ nick: 'Pilot', ip: '1.2.3.4', roomCode: 'ABCD', mode: 'ffa' });
    expect(() => session.end()).not.toThrow();
    expect(() => session.end()).not.toThrow(); // idempotentne
  });

  it('niekompletna konfiguracja (brak hasła) też wyłącza logowanie', () => {
    process.env.DB_LOG_HOST = 'portfolio_db';
    process.env.DB_LOG_USER = 'user';
    process.env.DB_LOG_DATABASE = 'db';
    // brak DB_LOG_PASSWORD → nie tworzymy puli, nie ładujemy mysql2
    const logger = createDbLogger(silentLog);
    const session = logger.beginSession({ nick: 'X', ip: '::1', roomCode: 'WXYZ', mode: 'teams' });
    expect(() => session.end()).not.toThrow();
  });
});

describe('formatWarsawDateTime', () => {
  it('formatuje jako YYYY-MM-DD HH:mm:ss w strefie Europe/Warsaw', () => {
    // 2026-07-19T12:00:00Z → w Warszawie (CEST, +2) to 14:00:00
    const d = new Date('2026-07-19T12:00:00.000Z');
    expect(formatWarsawDateTime(d)).toBe('2026-07-19 14:00:00');
  });

  it('uwzględnia czas zimowy (CET, +1)', () => {
    // 2026-01-15T12:00:00Z → w Warszawie (CET, +1) to 13:00:00
    const d = new Date('2026-01-15T12:00:00.000Z');
    expect(formatWarsawDateTime(d)).toBe('2026-01-15 13:00:00');
  });

  it('północ czasu warszawskiego to 00, nie 24', () => {
    // 2026-07-18T22:00:00Z → w Warszawie (CEST) to 2026-07-19 00:00:00
    const d = new Date('2026-07-18T22:00:00.000Z');
    expect(formatWarsawDateTime(d)).toBe('2026-07-19 00:00:00');
  });
});
