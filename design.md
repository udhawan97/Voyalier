# Voyalier cockpit design system

Status: locked for the v0.12 concierge cockpit.

## Direction

- **Genre:** atmospheric, interpreted through Voyalier's quiet travel-atlas voice.
- **Macrostructure:** Narrative Workflow. The trip itself is the working surface; controls follow the traveler's next decision.
- **Theme:** the existing Voyalier warm paper, ink, indigo, vermilion and moss system. Dark mode uses the same semantic roles.
- **Type:** Shippori Mincho for place and trip display; Zen Kaku Gothic New for interface and reading text. No additional face.
- **Motion:** fade changing panels, move the selected map/route mark, and press controls by one pixel. Reduced motion keeps opacity changes at 150 ms or less.

## Principles

1. Put the next useful action in the first viewport.
2. Keep authority, source age and handoff limits beside the action they qualify.
3. Let maps, documents and dates carry the visual identity; decoration must not compete with them.
4. Use one continuous surface with strong typographic zones instead of a grid of interchangeable cards.
5. Keep every task available with keyboard, screen reader, 200% zoom, reduced motion and without WebGL.

## Tokens

The canonical variables remain the `--voy-*` tokens in `packages/ui/src/tokens.css`. New cockpit CSS must use them. Vermilion marks an action or warning, moss marks traveler-completed work, indigo marks navigation and sourced information, and silver marks unknown or unavailable states. State always has a text or icon label as well as color.

Use the existing spacing rhythm and radii. Large working surfaces use `--voy-radius-lg`; compact controls use `--voy-radius-sm` or a pill only where the content is a short status or mode choice.

## Layout

- The global shell remains centered and bounded, with an edge-to-edge trip atlas inside it.
- The trip cockpit uses a sticky horizontal task rail and a two-column overview from 60rem upward.
- Below 60rem the overview is one column; action labels stay on one line and rows wrap around them.
- Every grid track that can hold long destination or document content uses `minmax(0, 1fr)`.
- `html` and `body` clip horizontal overflow and preserve a 320px minimum layout.

## Components

- **Route ribbon:** origin, destination, dates and party context in one dark atlas surface.
- **Next-action stack:** ordered tasks with reason, authority class and explicit traveler progress.
- **Traveler strip:** named local profiles; document country and status are descriptive context, never authorization.
- **Provider handoff:** provider, why it fits, verified scope, transferred fields, fields to enter, copyable search brief and ordinary external link.
- **Preparation step:** applicability statement, official portal, prerequisite, linked document and traveler-owned progress.
- **Wallet row:** document label, category, people, expiry and link to the existing imported source. Private identifiers never appear in summaries.
- **Money ledger:** exact amounts grouped by currency and by estimate, commitment or refund. No silent currency conversion.

## Copy

Use direct verbs: Choose an island, Compare stays, Add a traveler, Review the official route, Import confirmation. Say “You marked prepared” for traveler progress. Say “Explore” when a provider link does not carry live inventory. Never use ready, approved, safe, cheapest or best as an authority claim.

## States

Every panel has loading, empty, unavailable, validation, offline and success behavior. Provider handoffs disclose that prices and availability are checked on the provider. An unknown source or missing destination match becomes link-only; it does not disappear.
