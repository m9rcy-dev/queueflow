"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import type { GuestCardSummary, LocationSummary } from "@queueflow/types";
import { staffApi } from "../../../../../lib/staff-api-client";
import { useStaffSession } from "../../../../../lib/use-staff-session";
import { TicketQrCode } from "../../../../../components/TicketQrCode";

/**
 * A printable sheet of a location's guest cards (Phase 17): each card
 * shows its number (what staff call out) and the QR the counter scanner
 * reads. Cut them out, laminate, put them in the rack. The QR is the
 * card's secret code (G-39), so this page needs a staff session.
 */
export default function GuestCardSheetPage() {
  const params = useParams<{ locationId: string }>();
  const session = useStaffSession();
  const [location, setLocation] = useState<LocationSummary | null>(null);
  const [cards, setCards] = useState<GuestCardSummary[] | null>(null);

  useEffect(() => {
    if (!session) return;
    staffApi.getLocation(params.locationId).then(setLocation);
    staffApi.listGuestCards(params.locationId).then(setCards);
  }, [session, params.locationId]);

  if (!session || !cards || !location) {
    return <p className="p-8 text-center text-text-secondary">Loading…</p>;
  }

  return (
    <main className="bg-white p-6 text-black">
      <div className="mb-4 flex items-center justify-between print:hidden">
        <h1 className="text-xl font-semibold">
          {session.tenantName}: {location.name}, {cards.length} guest cards
        </h1>
        <button
          type="button"
          onClick={() => window.print()}
          className="rounded-md bg-primary px-6 py-3 font-medium text-white"
        >
          Print
        </button>
      </div>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 print:grid-cols-3">
        {cards.map((card) => (
          <div
            key={card.id}
            className="flex break-inside-avoid flex-col items-center gap-2 rounded-lg border-2 border-dashed border-gray-400 p-4"
          >
            <p className="text-sm font-medium">{session.tenantName}</p>
            <p className="text-3xl font-bold">Guest {card.guestNumber}</p>
            <TicketQrCode url={card.publicCode} size={130} alt={`Guest card ${card.guestNumber}`} />
            <p className="text-xs text-gray-500">Scan at the counter to join the queue</p>
          </div>
        ))}
      </div>
    </main>
  );
}
