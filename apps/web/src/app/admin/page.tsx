"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** /admin itself is just an entry point — real content lives at /admin/login and /admin/queues (Phase 5). */
export default function AdminEntryPoint() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/admin/login");
  }, [router]);
  return null;
}
