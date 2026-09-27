/**
 * Placeholder customer landing route (Phase 0). The real QR-context resolver
 * and landing experience — /q/{code} → business/location/queue landing —
 * lands in Phase 4 (Customer Queue UI). See docs/plan-review.md §4.5 for the
 * unified code model this route will eventually front.
 */
export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-8 text-center">
      <h1 className="text-3xl font-semibold text-text-primary">QueueFlow</h1>
      <p className="text-text-secondary">
        Customer experience placeholder — Phase 4 builds the real QR-context landing flow here.
      </p>
    </main>
  );
}
