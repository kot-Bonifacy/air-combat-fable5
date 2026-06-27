import { describe, expect, it } from 'vitest';
import { ZONE_ROLES, type EntityDamage, type ZoneRole } from '@air-combat/shared';
import { zoneLevelColor, damageFlags, criticalZoneLabel } from './damage-hud';
import { damageSmokeTier, livingSmokeTier, zoneSmokeTier, FIRE_TIER } from './smoke';

/** Buduje EntityDamage z poziomami per rola (brakujące = 0). */
function dmg(levels: Partial<Record<ZoneRole, number>>, onFire = false): EntityDamage {
  return { levels: ZONE_ROLES.map((r) => levels[r] ?? 0), onFire };
}

describe('damage-hud: kolor strefy', () => {
  it('mapuje poziomy 0..3 na 4 barwy', () => {
    expect(zoneLevelColor(0)).toBe('#2f9e44');
    expect(zoneLevelColor(1)).toBe('#e6b800');
    expect(zoneLevelColor(2)).toBe('#e8741f');
    expect(zoneLevelColor(3)).toBe('#7a1010');
  });

  it('clampuje poza zakres i zaokrągla', () => {
    expect(zoneLevelColor(-1)).toBe('#2f9e44');
    expect(zoneLevelColor(5)).toBe('#7a1010');
    expect(zoneLevelColor(1.4)).toBe('#e6b800'); // round → 1
  });
});

describe('damage-hud: flagi wskaźników', () => {
  it('sprawny samolot → bez flag', () => {
    expect(damageFlags(dmg({}))).toEqual({ fire: false, leak: false, pilot: false });
  });

  it('wyciek od JAKIEGOKOLWIEK uszkodzenia zbiornika (≥1)', () => {
    expect(damageFlags(dmg({ tank: 1 })).leak).toBe(true);
    expect(damageFlags(dmg({ tank: 0 })).leak).toBe(false);
  });

  it('pilot ranny dopiero przy ciężkim uszkodzeniu kabiny (≥2)', () => {
    expect(damageFlags(dmg({ cockpit: 1 })).pilot).toBe(false);
    expect(damageFlags(dmg({ cockpit: 2 })).pilot).toBe(true);
  });

  it('pożar bierze się z onFire, nie z poziomów', () => {
    expect(damageFlags(dmg({}, true)).fire).toBe(true);
    expect(damageFlags(dmg({ engine: 3 })).fire).toBe(false);
  });
});

describe('damage-hud: moduł krytyczny (przyczyna śmierci)', () => {
  it('pożar ma pierwszeństwo nad strefami', () => {
    expect(criticalZoneLabel(dmg({ engine: 3 }, true))).toBe('POŻAR');
  });

  it('wybiera strefę o najwyższym poziomie ≥2', () => {
    expect(criticalZoneLabel(dmg({ engine: 3 }))).toBe('SILNIK');
    expect(criticalZoneLabel(dmg({ wingR: 2 }))).toBe('SKRZYDŁO');
    expect(criticalZoneLabel(dmg({ tail: 2 }))).toBe('OGON');
  });

  it('remis poziomów rozstrzyga priorytet roli (pilot > silnik)', () => {
    expect(criticalZoneLabel(dmg({ engine: 2, cockpit: 2 }))).toBe('PILOT');
  });

  it('same lekkie uszkodzenia (<2) → null (zostaje „ZESTRZELONY")', () => {
    expect(criticalZoneLabel(dmg({ engine: 1, tank: 1 }))).toBeNull();
    expect(criticalZoneLabel(dmg({}))).toBeNull();
  });
});

describe('smoke: tiery dymu/ognia sterowane poziomami', () => {
  it('sprawna integralność nie dymi; uszkodzona dymi', () => {
    expect(damageSmokeTier(1, 1)).toBeNull();
    expect(damageSmokeTier(0.4, 1)).not.toBeNull();
  });

  it('livingSmokeTier bierze GORSZY z (HP, silnik)', () => {
    // sprawny HP, ale uszkodzony silnik → mimo wszystko dymi
    expect(livingSmokeTier(1, 1)).not.toBeNull();
    expect(livingSmokeTier(1, 0)).toBeNull();
    // niskie HP dominuje nad sprawnym silnikiem (gęstszy dym = krótszy interwał)
    const heavyHp = livingSmokeTier(0.1, 0);
    const lightEngine = livingSmokeTier(1, 1);
    expect(heavyHp).not.toBeNull();
    expect(lightEngine).not.toBeNull();
    expect(heavyHp!.intervalS).toBeLessThan(lightEngine!.intervalS);
    // pożar (caller podaje silnik=3) i niskie HP zbiegają do tego samego, ciężkiego tieru
    expect(livingSmokeTier(1, 3)!.intervalS).toBe(livingSmokeTier(0.1, 0)!.intervalS);
  });

  it('zoneSmokeTier: drobne uszkodzenie końcówki (<2) nie dymi; ciężkie/zniszczone tak', () => {
    expect(zoneSmokeTier(0)).toBeNull();
    expect(zoneSmokeTier(1)).toBeNull();
    expect(zoneSmokeTier(2)).not.toBeNull();
    // zniszczona (3) dymi gęściej niż ciężko uszkodzona (2)
    expect(zoneSmokeTier(3)!.intervalS).toBeLessThan(zoneSmokeTier(2)!.intervalS);
  });

  it('ogień jest addytywny (jasny), dym nie', () => {
    expect(FIRE_TIER.profile.additive).toBe(true);
    expect(zoneSmokeTier(3)!.profile.additive).toBeFalsy();
  });
});
