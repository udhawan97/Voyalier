# ADR-0015 — The workspace answers the Back button

## Status

Accepted, 2026-08-02. Reverses an explicit non-goal recorded in
`docs/product/APP_AUDIT_AND_POLISH_PLAN.md:302`.

## Context

A browser audit of 0.9.0 measured what the platform's own Back affordance does
in this workspace: nothing. Opening a trip from the list left `history.length`
unchanged; two Back presses moved only a leftover section hash and left the
traveler in the same trip. `App.tsx` holds `view` in `useState`, nothing calls
`pushState`, and nothing listens for `popstate`. The section nav writes its hash
with `replaceState` and calls `preventDefault`, so even anchor clicks add no
entry.

That is not an oversight. `APP_AUDIT_AND_POLISH_PLAN.md:302` says, in as many
words:

> **Explicit non-goal:** URL routing / deep links. It would change refresh/back
> behavior and is listed under deferred flows (Lane 6 tail).

and line 536 repeats "URL routing/deep links" in the explicitly-deferred,
don't-start list. The audit's first draft reported that no such record existed;
that was wrong, and it is worth writing down that it was wrong, because the
deferral is the reason this is a considered reversal rather than a bug fix.

Two things changed since that list was written.

**The list is provably stale.** "Global cross-trip search" sits on the same
don't-start line and has since shipped — it is `searchWorkspace`, and the audit
exercised it in four separate reproductions. A list that already describes the
product incorrectly in one entry is not a decision to defer to silently.

**The product now supports a phone-width viewport**, where the back swipe is
the primary back affordance rather than a secondary one. On a desktop a dead
Back is a papercut, because every non-list view ships its own Back control —
`SettingsView.tsx:30`, `TripDetailView.tsx:931` and `:983`,
`WorkspaceSearch.tsx:75`. Nobody is trapped. But an affordance the platform
guarantees, that silently does nothing, teaches the traveler that the app is
not quite a real one.

## Decision

The view is represented in the URL and restored from it, and `popstate` moves
the view rather than leaving the page.

Three constraints shape the form it takes.

**A query string, not a path.** Path routing needs a history fallback on every
host that serves the app. This one is served by a loopback Axum process today
and by Tauri's asset protocol on the desktop, so a path-based route would need
each of them to learn the same rewrite rule. `?trip=…`, `?view=settings` and
`?view=search` need nothing from either.

**The section hash keeps its own job.** `#section-visa` and its siblings
continue to address a section within the current trip, written with
`replaceState` exactly as before. The query string says which view; the hash
says where inside it. They do not compete.

**The search query stays out of the URL.** It would be the natural fourth
parameter, and it is deliberately not there: a query over a personal trip
workspace is the traveler's own text, and the address bar is the one place in
this product where such text would persist into browser history, screenshots
and screen shares. It rides in view state instead, which already survives a
Settings detour.

## Consequences

Reload and deep links now resolve from the URL, with the existing
`sessionStorage` active-trip restore as the fallback when the URL says nothing —
so an address bar with no query keeps the pre-0.9.1 behavior of returning the
traveler to their last trip.

Back and Forward now traverse in-app navigation. The in-app Back controls stay
where they are: they express "up", which is not always the same as "back", and
removing them would trade one missing affordance for another.

This is reversible in one commit. The URL is written by one effect and parsed by
one function — though that function is called from two places (the initial view
and the `popstate` handler), and `clearTripSectionHash` and the test setup also
touch `window.location`.

Two consequences are worth naming because they are not obvious from the
decision. Leaving a trip for a detour has to carry the section hash, or Back
returns the traveler to the top of a trip they had scrolled halfway through —
so every view except the list keeps it. And because the search query is
deliberately absent from the URL, a Back into the search view would rebuild it
empty; the query is held in a ref so the gesture restores what the traveler
typed. Both were regressions this ADR introduced before they were closed, and
both now carry tests.

What this ADR does **not** do: it does not make every panel addressable, and it
does not put record ids in the URL. A search result still opens a trip and
scrolls to a record by way of view state, not a URL that names the record.
Those remain deferred, and this time the deferral is written where the work is
rather than in a plan document that outlived its own accuracy.

## Amendment — nested detours and focus, 2026-08-13

The first implementation made the URL durable but kept an ephemeral
`returnView` slot for the in-app Back controls. That slot could remember only
one parent: Trip → Search → Settings overwrote the Trip parent with Search, so
the second Back visibly returned Search to itself. Replacing one return slot
with a stack beside browser history would create two navigation models that
could drift. Search and Settings now unwind the app-owned history entries that
already represent those transitions instead.

Each entry carries a private, monotonic index in `history.state`. The index is
not a product contract and never appears in the URL; it only lets an in-app
Back control distinguish an app-owned predecessor from a pasted or reloaded
detour URL. An owned predecessor uses `history.back()`. A direct
`?view=search` or `?view=settings` entry has no owned predecessor, so Back
returns safely to All Trips without leaving the workspace. Browser Back and
Forward therefore remain the single traversal model, while a direct URL still
has a deterministic "up" destination.

Top-level transitions also carry a one-shot focus intent. After an explicit
move to All Trips, a trip, Search, or Settings, the destination `h1` receives
programmatic focus; an observer covers the trip heading's asynchronous load.
Initial mount does not steal focus. Section-hash changes do not move it, and a
Search result continues to focus the exact record it opened. The heading
marker is presentation-neutral and the intent is consumed once, so restoring
history does not turn every render into a focus reset.
