import { SiteHeader } from "@/components/layout/SiteHeader";
import { Hero } from "./Hero";
import { LaunchModesLedger } from "./LaunchModesLedger";
import { LaunchSteps } from "./LaunchSteps";
import { RecentLaunches } from "./RecentLaunches";

/**
 * Single-viewport landing page. The page itself never scrolls: content is
 * sized against the dynamic viewport height and secondary blocks drop out on
 * short screens (see the `short` and `tiny` variants in styles.css).
 */
export function LandingPage() {
  return (
    <div className="flex h-dvh flex-col overflow-hidden pt-[env(safe-area-inset-top)] pr-[env(safe-area-inset-right)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)]">
      <div className="mx-auto flex size-full max-w-7xl min-h-0 flex-col px-5 sm:px-8 lg:px-12">
        <SiteHeader showLaunchAction />

        <main className="grid min-h-0 flex-1 items-center gap-12 py-6 lg:grid-cols-[1.15fr_0.85fr] xl:gap-20 short:py-3">
          <Hero />
          <LaunchModesLedger className="hidden lg:block" />
        </main>

        <footer className="flex shrink-0 flex-col gap-3 border-t border-line py-4 md:flex-row md:items-center md:justify-between md:gap-8 tiny:hidden">
          <LaunchSteps />
          <RecentLaunches className="hidden md:flex md:max-w-[55%]" />
        </footer>
      </div>
    </div>
  );
}
