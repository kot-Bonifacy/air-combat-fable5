// HP i obrażenia (faza-05.md krok 3): pula globalna na cel (strefy/moduły →
// faza 17). Czysty model danych + zdarzenie — efekty (wybuch, respawn, kill
// feed) robi caller na podstawie zwróconego wyniku.

export interface Health {
  hp: number;
  maxHp: number;
  /** false po zejściu HP do 0 — dopóki caller nie zresetuje (respawn). */
  alive: boolean;
}

export function createHealth(maxHp: number): Health {
  return { hp: maxHp, maxHp, alive: true };
}

/** Wynik aplikacji obrażeń — caller decyduje o efektach. */
export type DamageResult = 'absorbed' | 'destroyed' | 'ignored';

/**
 * Odejmuje obrażenia. Zwraca:
 * - 'ignored'  — cel już martwy albo amount ≤ 0 (nic się nie dzieje),
 * - 'destroyed'— to trafienie sprowadziło HP do 0 (kill credit należy do strzelca),
 * - 'absorbed' — cel oberwał, ale żyje dalej.
 * Tylko PIERWSZE trafienie zabijające zwraca 'destroyed' (kolejne → 'ignored'),
 * więc kill liczy się dokładnie raz.
 */
export function applyDamage(health: Health, amount: number): DamageResult {
  if (!health.alive || amount <= 0) return 'ignored';
  health.hp -= amount;
  if (health.hp <= 0) {
    health.hp = 0;
    health.alive = false;
    return 'destroyed';
  }
  return 'absorbed';
}

/** Pełne wyleczenie (respawn). Opcjonalnie zmienia maxHp. */
export function resetHealth(health: Health, maxHp = health.maxHp): void {
  health.maxHp = maxHp;
  health.hp = maxHp;
  health.alive = true;
}
