import { compareQueueOrder, isPriorityActive, sortByQueueOrder } from "./queue-order";

const NOW = new Date("2026-10-05T10:00:00Z");
const at = (minutesFromNow: number): Date => new Date(NOW.getTime() + minutesFromNow * 60_000);

function entry(id: string, joinedMinutes: number, priorityFromMinutes: number | null = null) {
  return {
    id,
    joinedAt: at(joinedMinutes),
    priorityFrom: priorityFromMinutes === null ? null : at(priorityFromMinutes),
  };
}

const ids = (list: Array<{ id: string }>): string[] => list.map((e) => e.id);

describe("queue order (G-25)", () => {
  it("is plain FIFO with no appointments", () => {
    const list = [entry("c", -1), entry("a", -10), entry("b", -5)];
    expect(ids(sortByQueueOrder(list, NOW))).toEqual(["a", "b", "c"]);
  });

  it("puts an appointment whose window has opened ahead of every walk-in", () => {
    const list = [entry("walk1", -30), entry("walk2", -20), entry("appt", -1, -2)];
    expect(ids(sortByQueueOrder(list, NOW))).toEqual(["appt", "walk1", "walk2"]);
  });

  it("keeps an early arrival in FIFO order until its window opens", () => {
    const list = [entry("walk1", -30), entry("appt", -25, 15), entry("walk2", -20)];
    expect(ids(sortByQueueOrder(list, NOW))).toEqual(["walk1", "appt", "walk2"]);
    // ...and it moves up on its own once the window opens, with no mutation.
    expect(ids(sortByQueueOrder(list, at(15)))).toEqual(["appt", "walk1", "walk2"]);
  });

  it("orders several open-window appointments by appointment time, not arrival", () => {
    const list = [entry("late-appt", -30, -1), entry("early-appt", -2, -8), entry("walk", -40)];
    expect(ids(sortByQueueOrder(list, NOW))).toEqual(["early-appt", "late-appt", "walk"]);
  });

  it("treats the window opening exactly now as open", () => {
    expect(isPriorityActive(entry("a", 0, 0), NOW)).toBe(true);
  });

  it("breaks exact joinedAt ties by id", () => {
    expect(compareQueueOrder(entry("b", -5), entry("a", -5), NOW)).toBeGreaterThan(0);
  });
});
