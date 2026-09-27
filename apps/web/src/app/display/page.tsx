/**
 * Placeholder public display route (Phase 0). Real content lands in Phase 6
 * (Public Display) — ticket number only, no customer PII (C-01), fullscreen,
 * reconnect-tolerant.
 */
export default function DisplayPlaceholder() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-[#172033] p-8 text-center text-white">
      <h1 className="text-3xl font-semibold">QueueFlow Display</h1>
      <p className="text-white/70">
        Public display placeholder — Phase 6 builds the real &ldquo;now serving&rdquo; screen here.
      </p>
    </main>
  );
}
