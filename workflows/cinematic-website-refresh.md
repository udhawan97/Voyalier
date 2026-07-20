# Cinematic website refresh

Status: ready for implementation

## Trigger

A deliberate request to materially raise Voyalier's public-site design quality and ship the result.

## Outcome

Deliver a visually exceptional, production-ready Voyalier website that makes the local-first product immediately understandable, rewards exploration with dimensional craft, and drives visitors toward the appropriate download path.

## Confirmed direction

- Audience: privacy-conscious travelers, open-source evaluators, and experienced product or frontend practitioners.
- Primary action: download Voyalier for macOS or Windows.
- Creative direction: `Quiet Wonder`—a cinematic evolution of the existing `Quiet Journey` system.
- Preserve the folded-route mark, indigo structure, vermilion waypoint, evidence-first language, and local-first product contract.
- Introduce dimensional folded-paper or route artifacts, SVG craft, scroll-directed depth, restrained parallax, and filmic product-image transitions.
- Treat “Apple-level” as a quality bar, not a request to imitate protected layouts, assets, or copy.
- Apply the cinematic treatment to the marketing homepage, download handoff, and shared public-site navigation/footer.
- Keep documentation article bodies calm and reading-focused.
- Do not redesign the desktop application UI as part of this workflow.
- Use existing real product screenshots plus hand-built SVG and CSS artifacts.
- Do not add GIF or video payloads in this pass; create cinematic zoom, depth, and sequencing in the page itself.
- Concentrate motion into three signature moments: a dimensional folded-route hero, a sticky screenshot story, and a closing mark-to-download resolution.
- Keep all other motion to short transform/opacity reveals, stop work when content is off-screen, and collapse spatial motion to restrained fades when reduced motion is requested.
- Keep Shippori Mincho + Zen Kaku Gothic New and the indigo/vermilion identity authoritative; extend them into cinematic light and dark chapters rather than replacing them.
- Update the root README so its public-site links and design language match the shipped experience.

## Non-negotiable boundaries

- No fabricated metrics, testimonials, endorsements, availability, or product capabilities.
- No implication that GitHub Pages hosts the local application backend.
- No gratuitous autoplay media, infinite decorative animation, or animation that obscures product understanding.
- All essential content and interactions work with reduced motion, keyboard navigation, screen readers, 200% zoom, and widths from 320 px upward.
- Prefer lightweight CSS and hand-built SVG artifacts over new runtime dependencies.
- Preserve unrelated working-tree changes and keep the implementation commit scoped.

## Delivery loop

1. Inspect the current rendered homepage, shared documentation chrome, assets, performance envelope, and responsive behavior.
2. Resolve scope, storytelling, asset, and motion decisions with the owner.
3. Write and commit the implementation plan before production edits.
4. Implement at testable seams, running focused type and build checks throughout.
5. Review the rendered result at desktop and mobile widths, including reduced motion and keyboard behavior.
6. Run the complete repository gate and a code review; correct every material finding.
7. Commit the scoped change, merge to `main`, push, and verify the live GitHub Pages surface if deployment runs.

## Checkpoint

No additional visual checkpoint is required. The owner delegated all remaining choices to the recommended direction and explicitly authorized implementation and merge to `main`. Push the checkpoint right through automated checks, rendered browser QA, and code review; stop only for a genuine blocker or a product-contract conflict.

## Definition of done

An implementer can execute without further creative or operational questions; the site is responsive, accessible, fast, honest, fully verified, committed, merged to `main`, pushed, and checked on the deployed public URL.
