# Lessons Learned

> Append-only register of recurring rules and patterns. Re-read at start by /10x-frame, /10x-research, /10x-plan, /10x-plan-review, /10x-implement, /10x-impl-review.

## Treat "how to X" as explain-only — never execute

- **Context**: Każda faza sesji, gdy użytkownik zadaje pytanie wyjaśniające ("jak X", "co robi X", "jak działa X") bez jawnego polecenia wykonania.
- **Problem**: Agent wdrożył aplikację na Cloudflare Workers zamiast wyjaśnić jak to zrobić — prompt "jak uruchomić i jak wdrożyć" został zinterpretowany jako polecenie wykonania, wywołując niezamierzone zmiany.
- **Rule**: When the user asks "how to X" or "explain how X works", respond with explanation only — do not execute commands or make changes unless the user explicitly says "do it" or "execute".
- **Applies to**: all
