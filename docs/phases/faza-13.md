# Faza 13 — Pętla meczu: FFA + scoreboard + deploy multiplayer

**Zależy od:** Faza 12
**Cel:** KAMIEŃ MILOWY — kompletna, publiczna gra multiplayer: wejście → mecz → wynik →
rewanż, dostępna pod publicznym adresem.

## Zakres

W tej fazie:
- Tryb FFA: mecz do N killi (host wybiera: 5/10/20) lub limit czasu 15 min — co pierwsze
- Scoreboard (Tab): killi / śmierci / ping, sortowanie, podświetlenie własnego wiersza
- Respawn z ochroną: 3 s nieśmiertelności + spawn z dala od wrogów (heurystyka odległości)
- Koniec meczu: ekran wyników (zwycięzca, tabela) → powrót do poczekalni (rewanż jednym kliknięciem)
- **Deploy pełnego stacku na VPS**: backend Node w docker-compose (drugi serwis), nginx proxy
  `/ws` → backend (odkomentowanie przygotowane w fazie 7), zmienne w `.env`,
  healthcheck `/health`, limity zasobów kontenera (`mem_limit`, `cpus`)
- Graceful shutdown serwera: SIGTERM → powiadomienie graczy → zapis logu meczu (konsola)
- Smoke test produkcji: mecz 2 graczy + 2 boty przez `wss://`

Poza zakresem: TDM/drużyny (backlog), statystyki trwałe (backlog), spectator (backlog).

## Kroki

1. Serwer: maszyna stanów meczu (`waiting → playing → ended → waiting`) + liczniki + testy
2. Klient: scoreboard, ekran końca, przepływ rewanżu
3. Spawn-selection + ochrona respawnu (testy: spawn nigdy < 1.5 km od wroga jeśli to możliwe)
4. `deploy/`: Dockerfile.backend (multi-stage), aktualizacja compose + nginx.conf, `.env.example`
5. Deploy na VPS wg procedury z PLAN.md; **Websockets ON w NPM** (włączone w fazie 7 — zweryfikować)
6. Pomiar na produkcji: CPU/RAM kontenera przy pełnym pokoju (`docker stats`) → memory;
   decyzja czy interest management potrzebny (PLAN.md, otwarte decyzje)
7. Aktualizacja `C:\AI\vps_home_pl_konfiguracja.md` (drugi serwis w opisie)

## Kryteria ukończenia

- [ ] Pełny cykl na produkcji: 2 osoby przez internet + 2 boty → mecz do 5 killi → wyniki → rewanż
- [ ] Scoreboard i kill feed spójne z faktycznym przebiegiem (w tym killi botów)
- [ ] Spawn-kill niemożliwy w typowej sytuacji (ochrona + dystans działają)
- [ ] `docker stats` przy pełnym pokoju zapisane w memory; brak wpływu na inne aplikacje VPS
- [ ] Restart kontenera backendu → klienci dostają komunikat (nie wieczny spinner), pokój odtwarzalny ręcznie
- [ ] typecheck + test + lint zielone; commit + tag `mp-1`; memory zapisane

## Pułapki

- `proxy_read_timeout 86400` w nginx dla `/ws` (lekcja z Tetrisa — bez tego WS zrywa się po 60 s)
- Współdzielony VPS: ustaw limity kontenera ZANIM coś pójdzie nie tak (OOM killer wybiera ofiary
  nieprzewidywalnie — może zabić CRM klienta zamiast gry)
- Zegar meczu liczony na serwerze; klient tylko wyświetla (nigdy nie kończy meczu lokalnie)

## Wynik (uzupełnić po zakończeniu)

—
