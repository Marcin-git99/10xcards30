---
change_id: lint-debt-cleanup
title: Lint debt cleanup
status: new
created: 2026-06-11
updated: 2026-06-11
archived_at: null
---

## Notes

<!-- Free-form notes for this change: links, ad-hoc context, decisions that don't belong in research/frame/plan. -->

Otwarte jako fix F4 z impl-review zmiany `db-schema-mvp` ([raport](../db-schema-mvp/reviews/impl-review.md)): `npm run lint` failuje repo-wide (CRLF + dług scaffold, nic z F-01), przez co bramka lint w kryteriach sukcesu jest martwa i kolejne slice'y dziedziczą descope. Cel: doprowadzić `npm run lint` do zera błędów, żeby bramka znów działała.
