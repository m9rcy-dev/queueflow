"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card } from "@queueflow/ui";
import type { QueueSummary } from "@queueflow/types";
import { staffApi } from "../../../lib/staff-api-client";
import { useStaffSession } from "../../../lib/use-staff-session";

/** Queue picker — skips straight through when a tenant has exactly one queue, which is the common case (D-04 defaults to one queue per location). */
export default function QueuePickerPage() {
  const router = useRouter();
  const session = useStaffSession();
  const [queues, setQueues] = useState<QueueSummary[] | null>(null);

  useEffect(() => {
    if (!session) return;
    staffApi.listQueues().then((result) => {
      if (result.length === 1) {
        router.replace(`/admin/queues/${result[0].id}`);
        return;
      }
      setQueues(result);
    });
  }, [session, router]);

  if (!session || !queues) {
    return <Centered>Loading…</Centered>;
  }

  if (queues.length === 0) {
    return <Centered>No queues have been set up yet. Ask a business owner to create one.</Centered>;
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col gap-4 bg-bg p-6 pt-16">
      <h1 className="text-xl font-semibold text-text-primary">Choose a queue</h1>
      {queues.map((queue) => (
        <Card key={queue.id}>
          <Button variant="secondary" onClick={() => router.push(`/admin/queues/${queue.id}`)}>
            {queue.name}
          </Button>
        </Card>
      ))}
    </main>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-bg p-8 text-center text-text-secondary">
      {children}
    </main>
  );
}
