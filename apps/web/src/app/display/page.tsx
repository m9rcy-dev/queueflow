import { QueueFlowLogo } from "../../components/QueueFlowLogo";

/**
 * /display itself is just an entry point (Phase 6) — the real board lives
 * at /display/[code], keyed by a DISPLAY-context code minted per queue
 * (`POST /tenants/me/queues/:queueId/codes` with `contextType: "DISPLAY"`).
 * No display-picker UI exists yet — a business owner points the TV's
 * browser at the specific /display/{code} URL directly.
 */
export default function DisplayEntryPoint() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-[#172033] p-8 text-center text-white">
      <h1 className="flex flex-col items-center gap-2">
        <QueueFlowLogo size="lg" tone="dark" />
        <span className="text-lg font-medium text-white/70">Display</span>
      </h1>
      <p className="text-white/70">
        Point this screen&apos;s browser at your business&apos;s display link (
        <code>/display/&lt;code&gt;</code>) to show the live queue board.
      </p>
    </main>
  );
}
