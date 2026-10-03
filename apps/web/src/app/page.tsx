/**
 * There is no generic landing page by design — every real visitor arrives
 * via a tenant-specific QR code/poster URL (/q/{code}, /c/{code},
 * /display/{code}; staff via /admin/login), never the bare domain root
 * (D-10). This route exists only so "/" isn't a dead 404.
 */
export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-8 text-center">
      <h1 className="text-3xl font-semibold text-text-primary">QueueFlow</h1>
      <p className="text-text-secondary">
        There&apos;s nothing to see at this address directly — customers arrive via a
        business&apos;s own QR code, and staff sign in at{" "}
        <a href="/admin/login" className="underline">
          /admin/login
        </a>
        .
      </p>
    </main>
  );
}
