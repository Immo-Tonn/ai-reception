import { describe, expect, it } from "vitest";
import { assignLanes } from "../TimeGrid";

const a = (id: string, time: string, durationMinutes = 30) => ({ id, time, durationMinutes });

describe("TimeGrid lanes", () => {
  it("back-to-back appointments share one full-width lane", () => {
    const { lanes, laneOf } = assignLanes([a("1", "09:00", 45), a("2", "10:30"), a("3", "14:00", 60)]);
    expect(lanes).toBe(1);
    expect([...laneOf.values()]).toEqual([1, 1, 1]);
  });

  it("only simultaneous appointments go side by side, and a lane is reused afterwards", () => {
    const { lanes, laneOf } = assignLanes([a("x", "10:00", 60), a("y", "10:30", 60), a("z", "11:30")]);
    expect(lanes).toBe(2);
    expect(laneOf.get("x")).toBe(1);
    expect(laneOf.get("y")).toBe(2);
    expect(laneOf.get("z")).toBe(1); // x ended at 11:00
  });

  it("an empty day still has one lane (header and hour lines span it)", () => {
    expect(assignLanes([]).lanes).toBe(1);
  });
});
