import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pendingSends, sendWithUndo } from "../../web/src/lib/undoSend";

vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { dismiss: vi.fn() }) }));

describe("sendWithUndo", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("sends only after the delay", async () => {
    const run = vi.fn(async () => {});
    sendWithUndo({ seconds: 5, run, onUndo: vi.fn() });
    expect(pendingSends()).toBe(1);
    vi.advanceTimersByTime(4900);
    expect(run).not.toHaveBeenCalled();
    vi.advanceTimersByTime(200);
    expect(run).toHaveBeenCalledOnce();
    expect(pendingSends()).toBe(0);
  });

  it("undo cancels the send and is idempotent", () => {
    const run = vi.fn(async () => {});
    const onUndo = vi.fn();
    const h = sendWithUndo({ seconds: 10, run, onUndo });
    h.cancel();
    h.cancel();
    vi.advanceTimersByTime(20_000);
    expect(run).not.toHaveBeenCalled();
    expect(onUndo).toHaveBeenCalledOnce();
    expect(pendingSends()).toBe(0);
  });

  it("can't undo after it was sent", () => {
    const run = vi.fn(async () => {});
    const onUndo = vi.fn();
    const h = sendWithUndo({ seconds: 5, run, onUndo });
    vi.advanceTimersByTime(5000);
    h.cancel();
    expect(onUndo).not.toHaveBeenCalled();
    expect(run).toHaveBeenCalledOnce();
  });

  it("sends immediately when undo send is off", () => {
    const run = vi.fn(async () => {});
    sendWithUndo({ seconds: 0, run, onUndo: vi.fn() });
    expect(run).toHaveBeenCalledOnce();
  });
});
