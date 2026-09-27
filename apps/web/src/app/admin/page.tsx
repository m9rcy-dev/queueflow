/**
 * Placeholder staff/admin route (Phase 0). Real content — business signup,
 * queue dashboard, staff device view — lands across Phase 1 (identity) and
 * Phase 5 (staff queue UI). Device-agnostic per C-01/C-06 — no desktop-only
 * assumption baked in here or later.
 */
export default function AdminPlaceholder() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-8 text-center">
      <h1 className="text-3xl font-semibold text-text-primary">QueueFlow — Business</h1>
      <p className="text-text-secondary">
        Staff/admin placeholder — Phase 1 builds business signup and login here.
      </p>
    </main>
  );
}
