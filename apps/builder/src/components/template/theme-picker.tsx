"use client";

import { useEffect, useState } from "react";
import { CheckIcon, RotateCcwIcon, RocketIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/docs/copy-button";
import { AnimatedGradientText } from "@/components/velora/animated-gradient-text";
import { AuroraBackground } from "@/components/velora/aurora-background";
import { BorderBeam } from "@/components/velora/border-beam";
import { ShimmerButton } from "@/components/velora/shimmer-button";
import {
  presetToCss,
  themePresets,
  type ThemePreset,
} from "@/lib/theme-presets";

const STYLE_ID = "velora-theme-preview";

function applyPreset(preset: ThemePreset) {
  let el = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement("style");
    el.id = STYLE_ID;
    document.head.appendChild(el);
  }
  el.textContent = presetToCss(preset);
}

function clearPreset() {
  document.getElementById(STYLE_ID)?.remove();
}

export function ThemePicker() {
  const [active, setActive] = useState(themePresets[0].id);
  const activePreset =
    themePresets.find((p) => p.id === active) ?? themePresets[0];

  useEffect(() => () => clearPreset(), []);

  const select = (preset: ThemePreset) => {
    setActive(preset.id);
    if (preset.id === themePresets[0].id) {
      clearPreset();
    } else {
      applyPreset(preset);
    }
  };

  return (
    <div>
      {/* Preset cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {themePresets.map((preset) => (
          <button
            key={preset.id}
            type="button"
            onClick={() => select(preset)}
            aria-pressed={active === preset.id}
            className={cn(
              "rounded-2xl border bg-card p-5 text-left transition-colors hover:border-primary/50",
              active === preset.id && "border-primary ring-1 ring-primary"
            )}
          >
            <div className="flex items-center justify-between">
              <span className="flex gap-1.5">
                {[preset.light.from, preset.light.via, preset.light.to].map(
                  (c, i) => (
                    <span
                      key={i}
                      className="size-5 rounded-full border border-black/10"
                      style={{ backgroundColor: c }}
                    />
                  )
                )}
              </span>
              {active === preset.id && (
                <span className="flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
                  <CheckIcon className="size-3" />
                </span>
              )}
            </div>
            <h3 className="mt-3 font-semibold">{preset.name}</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              {preset.description}
            </p>
          </button>
        ))}
      </div>

      {/* Live sample */}
      <div className="relative mt-10 overflow-hidden rounded-2xl border">
        <AuroraBackground intensity="subtle" />
        <div className="relative px-6 py-14 text-center">
          <h2 className="text-3xl font-semibold tracking-tight lg:text-4xl">
            Every effect follows{" "}
            <AnimatedGradientText>your ramp</AnimatedGradientText>
          </h2>
          <p className="mx-auto mt-3 max-w-md text-sm text-muted-foreground">
            Aurora, gradient text, beams and buttons — all reading the same
            seven variables. This panel updates live as you switch presets.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
            <ShimmerButton>
              <RocketIcon className="size-4" />
              Primary action
            </ShimmerButton>
            <Button variant="outline" className="rounded-full">
              Secondary
            </Button>
          </div>
          <div className="relative mx-auto mt-10 max-w-sm rounded-xl border bg-card/70 p-5 text-left backdrop-blur">
            <BorderBeam size={60} duration={7} />
            <p className="text-sm font-medium">Border beam</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Even the traveling beam samples the ramp.
            </p>
          </div>
        </div>
      </div>

      {/* CSS output */}
      <div className="mt-10">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">
            Copy the {activePreset.name} tokens
          </h2>
          <div className="flex items-center gap-2">
            {active !== themePresets[0].id && (
              <Button variant="ghost" size="sm" onClick={() => select(themePresets[0])}>
                <RotateCcwIcon className="size-4" />
                Reset
              </Button>
            )}
            <CopyButton text={presetToCss(activePreset)} />
          </div>
        </div>
        <pre className="mt-3 overflow-x-auto rounded-xl border bg-neutral-950 p-5 font-mono text-sm text-neutral-200">
          {presetToCss(activePreset)}
        </pre>
        <p className="mt-3 text-sm text-muted-foreground">
          Paste the block into your <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">globals.css</code>{" "}
          after the default tokens — that&apos;s the whole rebrand.
        </p>
      </div>
    </div>
  );
}

