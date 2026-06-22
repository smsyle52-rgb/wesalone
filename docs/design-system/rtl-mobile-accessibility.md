# RTL, Mobile, and Accessibility

- Arabic/RTL is the default. Wrap consumers with `DirectionProvider`.
- Prefer `start`, `end`, `ms`, `me`, `ps`, `pe`, and logical borders.
- Physical sides are allowed only when physical placement is intentional.
- Commands require accessible names and visible focus; placeholders are not labels.
- Keep Base UI focus trapping, Escape dismissal, and focus restoration behavior.
- Interactive targets should be at least `--wo-touch-target` in touch-heavy layouts.
- Start at 320px and add wider layouts progressively without accidental horizontal scrolling.
- Motion consumes central durations, which collapse under `prefers-reduced-motion`.
- Test RTL/LTR, keyboard operation, disabled, loading, and error states.
