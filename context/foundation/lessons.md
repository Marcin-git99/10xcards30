# Lessons Learned

> Append-only register of recurring rules and patterns. Re-read at start by /10x-frame, /10x-research, /10x-plan, /10x-plan-review, /10x-implement, /10x-impl-review.

## Treat "how to X" as explain-only — never execute

- **Context**: Każda faza sesji, gdy użytkownik zadaje pytanie wyjaśniające ("jak X", "co robi X", "jak działa X") bez jawnego polecenia wykonania.
- **Problem**: Agent wdrożył aplikację na Cloudflare Workers zamiast wyjaśnić jak to zrobić — prompt "jak uruchomić i jak wdrożyć" został zinterpretowany jako polecenie wykonania, wywołując niezamierzone zmiany.
- **Rule**: When the user asks "how to X" or "explain how X works", respond with explanation only — do not execute commands or make changes unless the user explicitly says "do it" or "execute".
- **Applies to**: all

## Install deps from inside the worktree, never via `--prefix` from the dispatcher

- **Context**: Konfiguracja linked worktree do pracy równoległej (wzorzec m2l5) — instalacja zależności node w świeżo dodanym worktree.
- **Problem**: `npm install --prefix <worktree>` z katalogu dyspozytora zatruł `package.json` worktree self-referencyjną zależnością `file:../<repo>`, która groziła zacommitowaniem.
- **Rule**: Never run `npm install --prefix <worktree>` from another package's directory. Install from INSIDE the worktree (cd in) or use `npm ci` there. Inspect the `package.json` diff before committing worktree setup.
- **Applies to**: implement

## Run worktree verification/commit from the dispatcher, not sub-agents

- **Context**: Delegowanie równoległych slice'ów do background sub-agentów (Agent tool) pracujących w linked worktrees.
- **Problem**: Sub-agentom odmówiono dostępu do shella (Bash/git) w worktree — napisały kod, ale nie odpaliły lint/build/commit; praca utknęła na weryfikacji.
- **Rule**: When sub-agents work in linked worktrees, treat them as Read/Write/Edit only. Run lint, build, and commits for each worktree from the dispatcher (main) session.
- **Applies to**: implement, impl-review

## Scrub root-committed tooling before the first push to an empty remote

- **Context**: Pierwsza publikacja repo z pustym remote, gdy niechciane pliki (kursowe `.claude/skills`, `prompts`, `manifest`) były zacommitowane w commicie-korzeniu.
- **Problem**: Push na pusty remote wypycha CAŁĄ historię łącznie z korzeniem; zwykły commit „usuwający" zostawia bloby w przodkach i one i tak trafiają na remote.
- **Rule**: Before the first push, rewrite history (`git filter-branch -- --branches`) to purge the paths from all commits; keep backup tags OUTSIDE the rewrite scope, detach linked worktree HEADs first so their branch refs can be rewritten, and verify zero blobs remain before pushing.
- **Applies to**: implement
