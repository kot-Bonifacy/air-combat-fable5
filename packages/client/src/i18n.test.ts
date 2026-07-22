import { afterEach, describe, expect, it } from 'vitest';
import { getLang, onLangChange, setLang, t } from './i18n';

// i18n: domyślny język to PL (bez zapisu w localStorage), przełącznik daje EN, interpolacja `{param}`.
// Singleton języka jest współdzielony w obrębie pliku testowego → po każdym teście wracamy do 'pl'.

afterEach(() => setLang('pl'));

describe('i18n', () => {
  it('domyślnie polski', () => {
    expect(getLang()).toBe('pl');
    expect(t('hud.big.stall')).toBe('PRZECIĄGNIĘCIE');
  });

  it('setLang przełącza na angielski i wraca', () => {
    setLang('en');
    expect(getLang()).toBe('en');
    expect(t('hud.big.stall')).toBe('STALL');
    setLang('pl');
    expect(t('hud.big.stall')).toBe('PRZECIĄGNIĘCIE');
  });

  it('interpolacja podmienia parametry {klucz}', () => {
    expect(t('info.botLevel', { level: 'trudny' })).toBe('poziom: trudny');
    setLang('en');
    expect(t('info.botLevel', { level: 'hard' })).toBe('level: hard');
  });

  it('interpolacja obsługuje wiele wystąpień i liczby', () => {
    expect(t('waiting.startCount', { ready: 2, total: 3 })).toContain('2/3');
  });

  it('onLangChange powiadamia o zmianie języka', () => {
    let fired = 0;
    onLangChange(() => fired++);
    setLang('en');
    expect(fired).toBe(1);
    setLang('en'); // ta sama wartość → bez powiadomienia
    expect(fired).toBe(1);
  });

  it('etykiety trudności „as" i „trudny" mają angielskie odpowiedniki', () => {
    setLang('en');
    expect(t('diff.as')).toBe('ace');
    expect(t('diff.trudny')).toBe('hard');
  });
});
