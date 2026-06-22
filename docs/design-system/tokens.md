# Design Tokens

`@workspace/ui/styles/tokens.css` is the single source for new Wesal One UI values. The tokens preserve the current navy/teal identity; they are placeholders for a later brand phase, not a redesign.

## Groups

- `--wo-brand-*`: stable brand anchors.
- `--wo-background`, `--wo-surface`, `--wo-foreground`, `--wo-muted-*`, `--wo-border`: semantic surfaces and text.
- `--wo-primary`, `--wo-secondary`, `--wo-accent`: interactive hierarchy.
- `--wo-success`, `--wo-warning`, `--wo-error`, `--wo-info`: status semantics. Never infer status from color alone.
- `--wo-focus-ring`: keyboard focus indicator.
- `--wo-radius-*`, `--wo-space-*`, `--wo-text-*`, `--wo-leading-*`: geometry and typography scales.
- `--wo-shadow-*`, `--wo-z-*`: elevation and layer order.
- `--wo-motion-*`, `--wo-ease-*`: motion values. Reduced-motion preferences collapse durations to 1ms.
- `--wo-breakpoint-*`: documented viewport thresholds. CSS custom properties cannot be used directly in standard media query conditions, so host Tailwind configuration remains authoritative.
- `--wo-touch-target`: minimum interactive target size for mobile controls.

## Rules

1. Use semantic tokens rather than literal colors in new shared components.
2. Do not duplicate a token in an application stylesheet.
3. Add a token only when an existing semantic token cannot express the requirement.
4. Test every token in light and dark mode, RTL and LTR, and at 320px.
5. Product pages remain visually frozen until their explicit migration phase.
