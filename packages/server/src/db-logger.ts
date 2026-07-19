import type { Pool } from 'mysql2/promise';
import type { Logger } from './connection';

// Logowanie sesji graczy do MySQL (baza portfolio `39790326_temp`, widoczna w phpMyAdmin :8081).
// Cel: „kto i kiedy gra na serwerze". Jeden wiersz na sesję (= jedno wejście do pokoju):
// nick, IP, pokój, tryb, czas wejścia/wyjścia i długość gry.
//
// ZASADY (świadome, nie przypadek):
//  - BEST-EFFORT: żaden błąd bazy nie może wywrócić gry. Wszystkie zapisy fire-and-forget,
//    wyjątki połykane (ostrzeżenie throttlowane, nie spam). Serwer autorytatywny działa dalej.
//  - WYŁĄCZANE KONFIGURACJĄ: brak kompletu DB_LOG_* → DisabledDbLogger (no-op). Dzięki temu
//    testy i dev lokalny nie potrzebują bazy, a mysql2 NIE jest wtedy nawet ładowany (dynamiczny import).
//  - CZAS LOKALNY: znaczniki czasu formatowane w Europe/Warsaw (kontener MySQL zwykle w UTC),
//    żeby w phpMyAdmin od razu było widać polską godzinę bez konwersji.

export interface SessionInfo {
  nick: string;
  ip: string;
  roomCode: string;
  mode: string;
}

/** Uchwyt otwartej sesji — `end()` domyka wiersz (left_at + duration_s). Idempotentne. */
export interface DbSession {
  end(): void;
}

export interface DbLogger {
  /** Otwiera wiersz sesji (INSERT w tle). Zwraca uchwyt do domknięcia przy wyjściu/rozłączeniu. */
  beginSession(info: SessionInfo): DbSession;
  close(): Promise<void>;
}

const NOOP_SESSION: DbSession = { end() {} };

const CREATE_TABLE_SQL = `CREATE TABLE IF NOT EXISTS dogfight_sessions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  nick VARCHAR(64) NOT NULL,
  ip VARCHAR(64) DEFAULT NULL,
  room_code VARCHAR(16) DEFAULT NULL,
  mode VARCHAR(16) DEFAULT NULL,
  joined_at DATETIME NOT NULL,
  left_at DATETIME DEFAULT NULL,
  duration_s INT UNSIGNED DEFAULT NULL,
  PRIMARY KEY (id),
  KEY idx_joined_at (joined_at),
  KEY idx_nick (nick)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`;

/** Odczyt konfiguracji ze środowiska. Wszystkie 4 pola wymagane, inaczej logowanie wyłączone. */
export function createDbLogger(log: Logger): DbLogger {
  const host = (process.env.DB_LOG_HOST ?? '').trim();
  const user = (process.env.DB_LOG_USER ?? '').trim();
  const password = process.env.DB_LOG_PASSWORD ?? '';
  const database = (process.env.DB_LOG_DATABASE ?? '').trim();
  const port = Number(process.env.DB_LOG_PORT ?? 3306) || 3306;

  if (!host || !user || !password || !database) {
    log.info({ ctx: 'db-log' }, 'logowanie sesji do MySQL WYŁĄCZONE (brak kompletu zmiennych DB_LOG_*)');
    return new DisabledDbLogger();
  }
  return new MysqlDbLogger({ host, user, password, database, port }, log);
}

class DisabledDbLogger implements DbLogger {
  beginSession(): DbSession {
    return NOOP_SESSION;
  }
  async close(): Promise<void> {
    /* no-op */
  }
}

interface DbConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

/** Ile najwyżej razy na minutę zgłaszać błąd bazy — inaczej padnięta baza zalałaby logi. */
const WARN_THROTTLE_MS = 60_000;

class MysqlDbLogger implements DbLogger {
  private pool: Pool | null = null;
  private readonly ready: Promise<void>;
  private lastWarnMs = 0;

  constructor(
    private readonly cfg: DbConfig,
    private readonly log: Logger,
  ) {
    this.ready = this.init();
  }

  private async init(): Promise<void> {
    try {
      // Dynamiczny import: mysql2 ładowany TYLKO gdy logowanie włączone (tester/dev bez bazy go nie tknie).
      const mysql = await import('mysql2/promise');
      this.pool = mysql.createPool({
        host: this.cfg.host,
        port: this.cfg.port,
        user: this.cfg.user,
        password: this.cfg.password,
        database: this.cfg.database,
        connectionLimit: 3, // logowanie jest lekkie i rzadkie — mała pula wystarcza
        waitForConnections: true,
        connectTimeout: 8000,
      });
      await this.pool.query(CREATE_TABLE_SQL);
      this.log.info({ ctx: 'db-log', host: this.cfg.host, db: this.cfg.database }, 'logowanie sesji do MySQL włączone');
    } catch (err) {
      this.pool = null;
      this.warn(err, 'nie udało się zainicjować logowania do MySQL — logowanie nieaktywne');
    }
  }

  beginSession(info: SessionInfo): DbSession {
    const startMs = Date.now();
    const idPromise = this.insertSession(info, startMs);
    let ended = false;
    return {
      end: () => {
        if (ended) return;
        ended = true;
        void this.closeSession(idPromise, startMs);
      },
    };
  }

  private async insertSession(info: SessionInfo, startMs: number): Promise<number | null> {
    try {
      await this.ready;
      if (!this.pool) return null;
      const [res] = await this.pool.execute(
        'INSERT INTO dogfight_sessions (nick, ip, room_code, mode, joined_at) VALUES (?, ?, ?, ?, ?)',
        [trunc(info.nick, 64), trunc(info.ip, 64), trunc(info.roomCode, 16), trunc(info.mode, 16), formatWarsawDateTime(new Date(startMs))],
      );
      // mysql2 zwraca ResultSetHeader dla INSERT; typ z biblioteki jest szeroki, zawężamy do insertId.
      const insertId = (res as { insertId?: number }).insertId; // any-free: pole opisane w typach mysql2
      return typeof insertId === 'number' && insertId > 0 ? insertId : null;
    } catch (err) {
      this.warn(err, 'INSERT sesji nie powiódł się');
      return null;
    }
  }

  private async closeSession(idPromise: Promise<number | null>, startMs: number): Promise<void> {
    try {
      const id = await idPromise;
      if (id === null || !this.pool) return;
      const durationS = Math.max(0, Math.round((Date.now() - startMs) / 1000));
      await this.pool.execute('UPDATE dogfight_sessions SET left_at = ?, duration_s = ? WHERE id = ?', [
        formatWarsawDateTime(new Date()),
        durationS,
        id,
      ]);
    } catch (err) {
      this.warn(err, 'UPDATE domknięcia sesji nie powiódł się');
    }
  }

  async close(): Promise<void> {
    if (this.pool) {
      const pool = this.pool;
      this.pool = null;
      try {
        await pool.end();
      } catch {
        /* zamknięcie puli best-effort */
      }
    }
  }

  /** Ostrzeżenie throttlowane: padnięta baza nie może zalać logów serwera. */
  private warn(err: unknown, msg: string): void {
    const now = Date.now();
    if (now - this.lastWarnMs < WARN_THROTTLE_MS) return;
    this.lastWarnMs = now;
    this.log.warn({ ctx: 'db-log', err: err instanceof Error ? err.message : String(err) }, msg);
  }
}

function trunc(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) : s;
}

/**
 * Formatuje datę jako 'YYYY-MM-DD HH:mm:ss' w strefie Europe/Warsaw (format DATETIME MySQL).
 * Składane z części Intl — niezależne od strefy procesu i wersji Node.
 */
export function formatWarsawDateTime(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Warsaw',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? '00';
  // 'en-GB' bywa zwraca godzinę '24' o północy — normalizujemy do '00'.
  const hour = get('hour') === '24' ? '00' : get('hour');
  return `${get('year')}-${get('month')}-${get('day')} ${hour}:${get('minute')}:${get('second')}`;
}
