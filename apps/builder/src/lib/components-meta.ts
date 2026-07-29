import meta from "./components-meta.json";

export interface ComponentMeta {
  slug: string;
  title: string;
  description: string;
  category: string;
  dependencies: string[];
}

/**
 * Single source of truth for the docs site and the shadcn registry
 * (scripts/build-registry.mjs reads the same JSON).
 */
export const componentsMeta = meta as ComponentMeta[];

export const categories = [
  "Backgrounds",
  "Text",
  "Buttons",
  "Cards & Layout",
  "Effects",
  "Mockups",
] as const;

