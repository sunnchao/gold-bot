# Figma Cover Page Design

## Context

The `web/dashboard` project is a static-exported Next.js 15 + React 19 + Tailwind CSS frontend currently used for the internal Gold Bolt dashboard. The user wants to evaluate Figma MCP node-reading fidelity and the practicality of reproducing a design node in the current stack.

The supplied Figma file does not contain a complete homepage design. It contains a single visible cover node:

- File: `ctzs1kmQcbFP5X4q6zSiAa`
- Node: `402:71392`
- Page: `📚 封面`

That node is effectively a flattened cover composition rather than a reusable layered page design. The work therefore focuses on a single-screen presentation page that reproduces the supplied node as faithfully as possible inside the existing web app.

## Goal

Add a standalone page at `/figma-cover/` that presents the Figma cover node `402:71392` with high visual fidelity in the existing Next.js application, so the user can assess:

- how well Figma MCP can read a design node,
- how directly that output can be carried into the current frontend stack,
- and how closely the rendered result matches the original cover artwork.

## Non-Goals

- Replacing the current dashboard root route `/`
- Designing a new marketing homepage beyond the supplied node
- Reconstructing missing internal Figma layers with hand-authored approximations
- Refactoring the dashboard shell or navigation model
- Building a multi-section landing page

## Design Summary

### Route

Create a new static-export-friendly route at `/figma-cover/`.

This route will exist independently from the current dashboard routes:

- `/`
- `/accounts/`
- `/audit/`

No existing route behavior changes.

### Rendering Strategy

Use the Figma-derived cover image itself as the primary visual source of truth.

The implementation should not attempt a full CSS rebuild of the internal cover composition because the Figma node exposed through MCP is effectively a flat visual artifact. A hand-rebuilt version would measure developer reconstruction skill, not MCP reading fidelity.

The page should instead:

- render the cover asset inside a dedicated stage container,
- preserve the original 1440x900 composition ratio,
- center the artwork within the viewport,
- and use minimal surrounding chrome so the comparison stays focused on the Figma output.

### Layout

The page is a single-screen experience built from three layers:

1. Page background
   A subdued neutral backdrop that frames the artwork without competing with it.

2. Stage container
   A centered responsive frame that constrains width, maintains the artwork aspect ratio, and provides subtle shadow/depth.

3. Cover artwork
   The Figma asset rendered edge-to-edge inside the stage container.

No dashboard header, metric cards, or marketing sections are added to this page.

### Responsive Behavior

Desktop is fidelity-first:

- prioritize a presentation size that feels close to the original design,
- keep the full artwork visible when practical,
- avoid cropping core content.

Tablet and mobile are containment-first:

- scale the artwork down proportionally,
- preserve the full composition,
- maintain generous viewport padding,
- avoid reflowing or reinterpreting the internal cover text.

The artwork remains a single scaled visual rather than a rearranged mobile layout.

## Asset Strategy

The initial implementation should use the Figma-generated asset URL returned by MCP in order to directly validate the Figma-to-app path.

Because that asset is time-limited, the implementation should isolate asset usage behind a small local constant or page-local configuration so it can later be swapped to a checked-in static file without structural changes.

Default implementation choice:

- use the direct Figma MCP asset URL first,
- keep the code organized so a future local asset fallback is trivial.

## Accessibility and Semantics

Even though the page is primarily visual, it should still provide minimal semantic structure:

- a page-level heading describing the view,
- a meaningful `alt` description for the artwork,
- layout that remains readable and navigable without dashboard-specific controls.

If the visible heading is omitted for design purity, the page should still include an accessible equivalent.

## Testing

Add a minimal automated test covering the new route/page component behavior. The test should verify:

- the page renders without dashboard-shell dependencies,
- the core visual container exists,
- and the cover image is present with accessible text/metadata sufficient for regression checks.

Testing should stay lightweight and aligned with the current Vitest + Testing Library setup.

## Implementation Notes

- Reuse the existing app routing conventions in `web/dashboard/app`
- Keep styling within the existing Tailwind/CSS approach already used by the project
- Avoid introducing new dependencies
- Avoid coupling the page to dashboard live data APIs
- Keep the implementation isolated so it can later be removed or expanded without affecting the dashboard

## Risks and Mitigations

### Risk: Remote asset expiry

The Figma-hosted asset is temporary.

Mitigation:

- centralize the asset reference,
- keep replacement with a checked-in static asset straightforward.

### Risk: False expectations about MCP “reconstruction”

Because the source node is effectively flat, this page validates node capture/rendering fidelity, not fine-grained code reconstruction of design layers.

Mitigation:

- keep the implementation explicit about using the supplied cover asset as the source of truth,
- avoid overstating the result as a full design-to-code conversion.

### Risk: Visual mismatch caused by viewport framing rather than artwork fidelity

If the outer page chrome is too strong, it may distort the perceived comparison.

Mitigation:

- use restrained framing,
- keep attention on the artwork,
- and avoid extra decorative sections.

## Acceptance Criteria

The work is complete when:

- `/figma-cover/` is reachable in the Next.js app
- the page presents a single-screen cover-stage layout
- the main artwork is the Figma-derived node asset for `402:71392`
- the composition remains visually stable across desktop and mobile widths
- existing dashboard routes remain unchanged
- a lightweight test covers the new page render path

