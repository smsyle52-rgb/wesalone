# UI Foundation Architecture

Wesal One uses one shared workspace package, `@workspace/ui`, under `lib/ui`.

- Interactive primitives: Base UI.
- Component source convention: shadcn/ui `base-nova`, checked into the repository.
- Styling: host-owned Tailwind CSS v4; hosts import the central token stylesheet and scan `lib/ui/src`.
- Direction: `DirectionProvider` defaults to RTL and the web app supplies the active locale direction.
- Exports: explicit component subpaths support tree-shaking and make ownership visible.

Existing Radix-backed files under application folders are legacy consumers. They remain until each screen is intentionally migrated.

The package contains presentation and interaction behavior only. It must not import API clients, authentication, database code, routes, or product business logic.

To add a component, run the shadcn CLI with `--cwd lib/ui` and the checked-in Base UI configuration. Convert generated internal aliases to relative imports, add an explicit package export, use semantic tokens, and add interaction tests.
