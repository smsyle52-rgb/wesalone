export interface ThemeModeTokens {
  primary: string;
  primaryForeground: string;
  from: string;
  via: string;
  to: string;
}

export interface ThemePreset {
  id: string;
  name: string;
  description: string;
  light: ThemeModeTokens;
  dark: ThemeModeTokens;
}

const white = "oklch(0.985 0 0)";
const ink = "oklch(0.145 0 0)";

/**
 * Brand ramp presets. Each writes the same seven variables the default
 * theme uses in globals.css — copy the generated block to retheme a project.
 */
export const themePresets: ThemePreset[] = [
  {
    id: "velora-blue",
    name: "Velora Blue",
    description: "The default. A restrained blue-to-sky ramp that reads as a brand, not a template.",
    light: {
      primary: "oklch(0.546 0.245 263)",
      primaryForeground: white,
      from: "oklch(0.546 0.245 263)",
      via: "oklch(0.623 0.214 260)",
      to: "oklch(0.685 0.169 237)",
    },
    dark: {
      primary: "oklch(0.623 0.214 260)",
      primaryForeground: white,
      from: "oklch(0.623 0.214 260)",
      via: "oklch(0.707 0.165 255)",
      to: "oklch(0.746 0.16 233)",
    },
  },
  {
    id: "aurora-violet",
    name: "Aurora Violet",
    description: "The classic wide sweep — violet through fuchsia to cyan. Maximum aurora energy.",
    light: {
      primary: "oklch(0.541 0.247 287)",
      primaryForeground: white,
      from: "oklch(0.541 0.247 287)",
      via: "oklch(0.667 0.295 322)",
      to: "oklch(0.715 0.143 215)",
    },
    dark: {
      primary: "oklch(0.673 0.226 287)",
      primaryForeground: white,
      from: "oklch(0.673 0.226 287)",
      via: "oklch(0.74 0.24 322)",
      to: "oklch(0.789 0.122 215)",
    },
  },
  {
    id: "emerald",
    name: "Emerald",
    description: "Green-to-teal. Calm, financial, trustworthy — great for fintech and dev tools.",
    light: {
      primary: "oklch(0.596 0.145 163.225)",
      primaryForeground: white,
      from: "oklch(0.596 0.145 163.225)",
      via: "oklch(0.696 0.17 162.48)",
      to: "oklch(0.704 0.14 182.503)",
    },
    dark: {
      primary: "oklch(0.696 0.17 162.48)",
      primaryForeground: ink,
      from: "oklch(0.696 0.17 162.48)",
      via: "oklch(0.765 0.177 163.223)",
      to: "oklch(0.777 0.152 181.912)",
    },
  },
  {
    id: "rose",
    name: "Rose",
    description: "Rose-to-pink. Warm and confident — consumer apps and creative tools.",
    light: {
      primary: "oklch(0.586 0.253 17.585)",
      primaryForeground: white,
      from: "oklch(0.586 0.253 17.585)",
      via: "oklch(0.645 0.246 16.439)",
      to: "oklch(0.656 0.241 354.308)",
    },
    dark: {
      primary: "oklch(0.645 0.246 16.439)",
      primaryForeground: white,
      from: "oklch(0.645 0.246 16.439)",
      via: "oklch(0.712 0.194 13.428)",
      to: "oklch(0.718 0.202 349.761)",
    },
  },
  {
    id: "amber",
    name: "Amber",
    description: "Amber-to-gold. High energy — launches, waitlists and anything that ships fast.",
    light: {
      primary: "oklch(0.666 0.179 58.318)",
      primaryForeground: white,
      from: "oklch(0.666 0.179 58.318)",
      via: "oklch(0.769 0.188 70.08)",
      to: "oklch(0.795 0.184 86.047)",
    },
    dark: {
      primary: "oklch(0.828 0.189 84.429)",
      primaryForeground: ink,
      from: "oklch(0.769 0.188 70.08)",
      via: "oklch(0.828 0.189 84.429)",
      to: "oklch(0.852 0.199 91.936)",
    },
  },
  {
    id: "slate-mono",
    name: "Slate Mono",
    description: "No hue at all. Monochrome slate for brands that let the typography talk.",
    light: {
      primary: "oklch(0.208 0.042 265.755)",
      primaryForeground: white,
      from: "oklch(0.372 0.044 257.287)",
      via: "oklch(0.554 0.046 257.417)",
      to: "oklch(0.704 0.04 256.788)",
    },
    dark: {
      primary: "oklch(0.929 0.013 255.508)",
      primaryForeground: ink,
      from: "oklch(0.869 0.022 252.894)",
      via: "oklch(0.704 0.04 256.788)",
      to: "oklch(0.554 0.046 257.417)",
    },
  },
];

/** Renders a preset as the CSS block you paste into globals.css. */
export function presetToCss(preset: ThemePreset): string {
  const block = (t: ThemeModeTokens) =>
    [
      `  --primary: ${t.primary};`,
      `  --primary-foreground: ${t.primaryForeground};`,
      `  --brand: ${t.primary};`,
      `  --brand-foreground: ${t.primaryForeground};`,
      `  --brand-from: ${t.from};`,
      `  --brand-via: ${t.via};`,
      `  --brand-to: ${t.to};`,
    ].join("\n");
  return `:root {\n${block(preset.light)}\n}\n\n.dark {\n${block(preset.dark)}\n}`;
}

