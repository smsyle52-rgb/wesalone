import {
  GaugeIcon,
  LayersIcon,
  MoonIcon,
  PaletteIcon,
  RocketIcon,
  SparklesIcon,
  ZapIcon,
} from "lucide-react";

import { IntegrationsBeam } from "@/components/demo/integrations-beam";
import { AnimatedGradientText } from "@/components/velora/animated-gradient-text";
import { AnimatedList } from "@/components/velora/animated-list";
import { AnimatedTooltip } from "@/components/velora/animated-tooltip";
import { AuroraBackground } from "@/components/velora/aurora-background";
import { AvatarCircles } from "@/components/velora/avatar-circles";
import { BackgroundBeams } from "@/components/velora/background-beams";
import { BentoCard, BentoGrid } from "@/components/velora/bento-grid";
import { BlurFade } from "@/components/velora/blur-fade";
import { BorderBeam } from "@/components/velora/border-beam";
import { BrowserMockup } from "@/components/velora/browser-mockup";
import { ConfettiButton } from "@/components/velora/confetti";
import { Dock, DockIcon } from "@/components/velora/dock";
import { FlipWords } from "@/components/velora/flip-words";
import { DotPattern, GridPattern } from "@/components/velora/grid-pattern";
import { IphoneMockup } from "@/components/velora/iphone-mockup";
import { Lamp } from "@/components/velora/lamp";
import { Marquee } from "@/components/velora/marquee";
import { Meteors } from "@/components/velora/meteors";
import { NumberTicker } from "@/components/velora/number-ticker";
import { OrbitingCircles } from "@/components/velora/orbiting-circles";
import { Particles } from "@/components/velora/particles";
import { RetroGrid } from "@/components/velora/retro-grid";
import { ShimmerButton } from "@/components/velora/shimmer-button";
import { SparklesText } from "@/components/velora/sparkles-text";
import { SpotlightCard } from "@/components/velora/spotlight-card";
import { Terminal } from "@/components/velora/terminal";
import { TextReveal } from "@/components/velora/text-reveal";
import { TextShimmer } from "@/components/velora/text-shimmer";
import { TiltCard } from "@/components/velora/tilt-card";
import { Typewriter } from "@/components/velora/typewriter";

const chips = ["Astro", "Next.js", "Remix", "Vite", "Nuxt", "SvelteKit"];

export const componentDemos: Record<string, React.ReactNode> = {
  "aurora-background": (
    <div className="relative flex h-full min-h-64 w-full items-center justify-center overflow-hidden rounded-lg">
      <AuroraBackground intensity="vivid" />
      <p className="relative text-xl font-semibold">Aurora</p>
    </div>
  ),
  "grid-pattern": (
    <div className="relative flex h-full min-h-64 w-full items-center justify-center overflow-hidden rounded-lg">
      <GridPattern
        width={36}
        height={36}
        className="fill-transparent stroke-border [mask-image:radial-gradient(ellipse_at_center,black,transparent_80%)]"
      />
      <DotPattern className="[mask-image:radial-gradient(ellipse_at_center,black,transparent_55%)]" />
      <p className="relative text-xl font-semibold">Patterns</p>
    </div>
  ),
  "retro-grid": (
    <div className="relative flex h-full min-h-64 w-full items-center justify-center overflow-hidden rounded-lg">
      <RetroGrid opacity={0.6} />
      <p className="relative text-xl font-semibold">Retro Grid</p>
    </div>
  ),
  particles: (
    <div className="relative flex h-full min-h-64 w-full items-center justify-center overflow-hidden rounded-lg bg-neutral-950 text-white">
      <Particles quantity={80} />
      <p className="relative text-xl font-semibold">Particles</p>
    </div>
  ),
  meteors: (
    <div className="relative flex h-full min-h-64 w-full items-center justify-center overflow-hidden rounded-lg bg-neutral-950 text-white">
      <Meteors number={12} className="bg-white/70 before:from-white/60" />
      <p className="relative text-xl font-semibold">Meteors</p>
    </div>
  ),
  "background-beams": (
    <div className="relative flex h-full min-h-64 w-full items-center justify-center overflow-hidden rounded-lg">
      <BackgroundBeams />
      <p className="relative text-xl font-semibold">Beams</p>
    </div>
  ),
  lamp: (
    <div className="w-full overflow-hidden rounded-lg [&_[data-slot=lamp]]:py-12">
      <Lamp className="[&>div:first-child]:min-h-44">
        <h3 className="text-2xl font-semibold">Lit from above</h3>
      </Lamp>
    </div>
  ),
  "animated-gradient-text": (
    <p className="text-3xl font-semibold">
      Ship <AnimatedGradientText>beautiful</AnimatedGradientText> pages
    </p>
  ),
  "text-reveal": (
    <TextReveal
      text="Every word arrives exactly when it should"
      className="max-w-sm text-center text-2xl font-semibold"
    />
  ),
  typewriter: (
    <p className="text-2xl font-semibold">
      Build it{" "}
      <AnimatedGradientText>
        <Typewriter words={["faster.", "smoother.", "free."]} />
      </AnimatedGradientText>
    </p>
  ),
  "flip-words": (
    <p className="text-2xl font-semibold">
      Make it <FlipWords words={["modern", "animated", "accessible"]} className="text-primary" />
    </p>
  ),
  "sparkles-text": (
    <SparklesText className="text-3xl font-semibold">Magic moments</SparklesText>
  ),
  "text-shimmer": (
    <TextShimmer className="text-2xl font-semibold">
      Generating your page…
    </TextShimmer>
  ),
  "number-ticker": (
    <p className="text-5xl font-semibold tracking-tight">
      <NumberTicker value={12480} suffix="+" />
    </p>
  ),
  "shimmer-button": (
    <ShimmerButton>
      <RocketIcon className="size-4" />
      Get started
    </ShimmerButton>
  ),
  confetti: <ConfettiButton>🎉 Click me</ConfettiButton>,
  "bento-grid": (
    <BentoGrid className="w-full auto-rows-[11rem] grid-cols-2 gap-3">
      <BentoCard
        name="Patterns"
        description="Maskable backdrops."
        background={
          <DotPattern className="[mask-image:radial-gradient(ellipse_at_center,black,transparent_75%)]" />
        }
      />
      <BentoCard
        name="Meteors"
        description="Streaks of light."
        background={<Meteors number={6} />}
      />
    </BentoGrid>
  ),
  "spotlight-card": (
    <SpotlightCard className="w-full max-w-sm p-8">
      <h3 className="font-semibold">Move your cursor here</h3>
      <p className="mt-2 text-sm text-muted-foreground">
        The glow follows the pointer across the card surface.
      </p>
    </SpotlightCard>
  ),
  "tilt-card": (
    <TiltCard className="w-full max-w-sm">
      <div className="rounded-2xl border bg-card p-8">
        <h3 className="font-semibold">Tilt me</h3>
        <p className="mt-2 text-sm text-muted-foreground">
          3D perspective that tracks your cursor.
        </p>
      </div>
    </TiltCard>
  ),
  marquee: (
    <Marquee pauseOnHover className="w-full [--duration:18s]">
      {chips.map((chip) => (
        <span
          key={chip}
          className="mx-2 rounded-full border bg-card px-4 py-1.5 text-sm font-medium"
        >
          {chip}
        </span>
      ))}
    </Marquee>
  ),
  "animated-list": (
    <div className="h-56 w-full max-w-sm overflow-hidden [mask-image:linear-gradient(to_bottom,black_60%,transparent)]">
      <AnimatedList delay={1500}>
        {["Deploy succeeded", "New signup", "Payment received", "New review"].map(
          (title) => (
            <div
              key={title}
              className="flex items-center gap-3 rounded-xl border bg-card p-3 text-sm shadow-sm"
            >
              <span className="flex size-8 items-center justify-center rounded-lg bg-primary/15 text-primary">
                <ZapIcon className="size-4" />
              </span>
              {title}
            </div>
          )
        )}
      </AnimatedList>
    </div>
  ),
  "orbiting-circles": (
    <div className="relative flex h-64 w-full items-center justify-center">
      <SparklesIcon className="size-7 text-primary" />
      <OrbitingCircles radius={80} iconSize={26} duration={18}>
        <LayersIcon className="size-4 text-muted-foreground" />
        <PaletteIcon className="size-4 text-muted-foreground" />
        <GaugeIcon className="size-4 text-muted-foreground" />
        <MoonIcon className="size-4 text-muted-foreground" />
      </OrbitingCircles>
    </div>
  ),
  "avatar-circles": (
    <AvatarCircles
      people={["Maya Chen", "Tom Okafor", "Sofia Lindqvist", "Dan Romero"]}
      extra={2400}
    />
  ),
  "animated-tooltip": (
    <AnimatedTooltip
      items={[
        { name: "Maya Chen", role: "Design engineer" },
        { name: "Tom Okafor", role: "Frontend lead" },
        { name: "Sofia Lindqvist", role: "Indie hacker" },
        { name: "Dan Romero", role: "CTO" },
      ]}
    />
  ),
  dock: (
    <Dock>
      <DockIcon label="Layers">
        <LayersIcon className="size-5" />
      </DockIcon>
      <DockIcon label="Palette">
        <PaletteIcon className="size-5" />
      </DockIcon>
      <DockIcon label="Speed">
        <GaugeIcon className="size-5" />
      </DockIcon>
      <DockIcon label="Energy">
        <ZapIcon className="size-5" />
      </DockIcon>
      <DockIcon label="Launch">
        <RocketIcon className="size-5" />
      </DockIcon>
    </Dock>
  ),
  "border-beam": (
    <div className="relative flex h-40 w-full max-w-sm items-center justify-center rounded-2xl border bg-card">
      <BorderBeam size={64} duration={6} />
      <p className="text-sm text-muted-foreground">&lt;BorderBeam /&gt;</p>
    </div>
  ),
  "animated-beam": <IntegrationsBeam className="h-72" />,
  "blur-fade": (
    <div className="flex gap-3">
      {[0, 0.15, 0.3].map((delay) => (
        <BlurFade key={delay} delay={delay} once={false}>
          <div className="flex size-20 items-center justify-center rounded-xl border bg-card text-sm font-medium">
            {delay}s
          </div>
        </BlurFade>
      ))}
    </div>
  ),
  "scroll-progress": (
    <div className="w-full max-w-sm space-y-3">
      <div className="h-1 w-2/3 rounded-full bg-gradient-to-r from-brand-from via-brand-via to-brand-to" />
      <p className="text-sm text-muted-foreground">
        A live one is running at the top of this page — scroll to see it fill.
      </p>
    </div>
  ),
  "browser-mockup": (
    <BrowserMockup url="velora.dev" className="w-full max-w-md">
      <div className="flex h-40 items-center justify-center bg-gradient-to-br from-brand-from/20 via-brand-via/15 to-brand-to/20">
        <p className="text-sm text-muted-foreground">Your product here</p>
      </div>
    </BrowserMockup>
  ),
  "iphone-mockup": (
    <IphoneMockup className="w-44">
      <div className="flex size-full items-center justify-center bg-gradient-to-b from-brand-from/25 to-brand-to/25 pt-10">
        <p className="text-xs text-muted-foreground">Your app here</p>
      </div>
    </IphoneMockup>
  ),
  terminal: (
    <Terminal
      className="max-w-md"
      lines={[
        "$ npx shadcn@latest add velora/marquee",
        "✔ Checking registry…",
        "✔ Installing dependencies…",
        "✔ Created components/velora/marquee.tsx",
      ]}
    />
  ),
};

