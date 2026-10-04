"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card } from "@queueflow/ui";
import type { StaffSession } from "@queueflow/api-client";
import { staffApi } from "../lib/staff-api-client";
import { isBusinessAdmin } from "../lib/roles";

interface Step {
  label: string;
  detail: string;
  href: string;
  done: boolean;
}

/**
 * The new business's setup checklist (Phase 19). A business onboarded from
 * /platform starts empty; the owner finishes it here, in order. Shown to
 * owner/admin until every step is done, then it disappears.
 */
export function GetStarted({ session }: { session: StaffSession }) {
  const [steps, setSteps] = useState<Step[] | null>(null);

  useEffect(() => {
    if (!isBusinessAdmin(session.role)) return;
    (async () => {
      const [locations, services, queues] = await Promise.all([
        staffApi.listLocations(),
        staffApi.listServices(),
        staffApi.listQueues(),
      ]);
      const codes = await Promise.all(
        queues.map((queue) => staffApi.listCodes(queue.id).catch(() => [])),
      );
      const hasPoster = codes.some((list) =>
        list.some((code) => code.contextType === "QUEUE" && code.active),
      );
      const firstLocation = locations[0];
      setSteps([
        {
          label: "Add your location",
          detail: "Where customers come: name, timezone and opening hours.",
          href: "/admin/locations",
          done: locations.length > 0,
        },
        {
          label: "Add your services",
          detail: "What you offer and how long each takes (it drives wait times).",
          href: firstLocation ? `/admin/locations/${firstLocation.id}` : "/admin/locations",
          done: services.length > 0,
        },
        {
          label: "Create a queue",
          detail: "The line customers join. Add your services to it.",
          href: "/admin/queues",
          done: queues.length > 0,
        },
        {
          label: "Print your QR poster",
          detail: "Customers scan it to join or book.",
          href: "/admin/codes",
          done: hasPoster,
        },
        {
          label: "Add your logo",
          detail: "Shown to customers and on your TV board, next to QueueFlow's.",
          href: "/admin/settings",
          done: session.tenantLogoPath !== null,
        },
      ]);
    })().catch(() => setSteps(null));
  }, [session]);

  if (!steps || steps.every((step) => step.done)) return null;
  const next = steps.find((step) => !step.done);
  const doneCount = steps.filter((step) => step.done).length;

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-lg font-semibold text-text-primary">Get started</h2>
        <span className="text-sm text-text-secondary">
          {doneCount} of {steps.length} done
        </span>
      </div>
      <ol className="flex flex-col gap-1">
        {steps.map((step, index) => (
          <li key={step.label}>
            <Link
              href={step.href}
              className={`flex items-start gap-3 rounded-md px-2 py-2 hover:bg-bg ${
                step === next ? "bg-primary/5" : ""
              }`}
            >
              <span
                className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                  step.done ? "bg-emerald-500 text-white" : "bg-primary/15 text-primary"
                }`}
                aria-hidden="true"
              >
                {step.done ? "✓" : index + 1}
              </span>
              <span>
                <span
                  className={`block text-sm font-medium ${
                    step.done ? "text-text-secondary line-through" : "text-text-primary"
                  }`}
                >
                  {step.label}
                  <span className="sr-only">{step.done ? " (done)" : ""}</span>
                </span>
                {!step.done && (
                  <span className="block text-xs text-text-secondary">{step.detail}</span>
                )}
              </span>
            </Link>
          </li>
        ))}
      </ol>
    </Card>
  );
}
