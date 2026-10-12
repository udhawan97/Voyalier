import {
  act,
  fireEvent,
  renderHook,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { createMockGateway } from "@voyalier/contracts";
import { StrictMode } from "react";
import { renderApp } from "./test/helpers";
import { useDeviceDate } from "./app/useDeviceDate";

beforeEach(() => vi.stubEnv("TZ", "America/Chicago"));
afterEach(() => vi.unstubAllEnvs());

describe("Today device calendar date", () => {
  afterEach(() => vi.useRealTimers());

  async function openToday(
    base = createMockGateway(),
    getToday = vi.fn(base.getToday),
  ) {
    renderApp({ ...base, getToday });
    fireEvent.click(
      await screen.findByRole("button", { name: "Open Kyoto autumn journey" }),
    );
    await screen.findByRole("region", { name: "Today" });
    return getToday;
  }

  it("requests the device date while UTC is already the following day", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-08T01:30:00Z"));
    // Run with TZ=America/Chicago: the floating event date is October 7.
    expect(new Date().getDate()).toBe(7);
    const getToday = await openToday();
    expect(getToday).toHaveBeenLastCalledWith("trip_kyoto", "2026-10-07");
  });

  it("refreshes on resume after the device crosses midnight", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-08T04:59:00Z"));
    const getToday = await openToday();
    const calls = getToday.mock.calls.length;
    act(() => {
      vi.setSystemTime(new Date("2026-10-08T05:01:00Z"));
      window.dispatchEvent(new Event("focus"));
    });
    await waitFor(() =>
      expect(getToday.mock.calls.length).toBeGreaterThan(calls),
    );
    expect(getToday).toHaveBeenLastCalledWith("trip_kyoto", "2026-10-08");
  });

  it("does not repeat requests when focus and page resume keep the same date", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 7, 18));
    const getToday = await openToday();
    const calls = getToday.mock.calls.length;
    await act(async () => {
      vi.setSystemTime(new Date(2026, 9, 7, 18, 30));
      window.dispatchEvent(new Event("focus"));
      window.dispatchEvent(new Event("pageshow"));
    });
    expect(getToday).toHaveBeenCalledTimes(calls);
  });

  it("hides previous-day floating plans during refresh and failure, then retries the current day", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 7, 18));
    const base = createMockGateway();
    await base.createTripItem({
      tripId: "trip_kyoto",
      kind: "activity",
      title: "Yesterday floating plan",
      startAt: "2026-10-07T12:00",
    });
    await base.createTripItem({
      tripId: "trip_kyoto",
      kind: "activity",
      title: "Current floating plan",
      startAt: "2026-10-08T12:00",
    });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let fail = true;
    const getToday = vi.fn(async (tripId: string, referenceDate?: string) => {
      if (referenceDate === "2026-10-08") {
        await gate;
        if (fail)
          throw {
            code: "transport/failure",
            message: "Synthetic day refresh failure",
          };
      }
      return base.getToday(tripId, referenceDate);
    });
    await openToday(base, getToday);
    expect(
      within(screen.getByRole("region", { name: "Today" })).getByText(
        /Yesterday floating plan/,
      ),
    ).toBeInTheDocument();
    act(() => {
      vi.setSystemTime(new Date(2026, 9, 8, 0, 1));
      window.dispatchEvent(new Event("focus"));
    });
    const updating = await screen.findByRole("status", { name: "Today" });
    expect(updating).toHaveAttribute("aria-busy", "true");
    expect(
      within(updating).queryByText(/Yesterday floating plan/),
    ).not.toBeInTheDocument();
    await act(async () => {
      release();
      await gate;
    });
    const failed = await screen.findByRole("region", { name: "Today" });
    expect(
      within(failed).queryByText(/Yesterday floating plan/),
    ).not.toBeInTheDocument();
    fail = false;
    fireEvent.click(within(failed).getByRole("button", { name: "Retry" }));
    await waitFor(() =>
      expect(
        within(screen.getByRole("region", { name: "Today" })).getByText(
          /Current floating plan/,
        ),
      ).toBeInTheDocument(),
    );
    expect(getToday).toHaveBeenLastCalledWith("trip_kyoto", "2026-10-08");
    expect(
      (await base.getTrip("trip_kyoto")).tripItems.map((item) => item.startAt),
    ).toEqual(expect.arrayContaining(["2026-10-07T12:00", "2026-10-08T12:00"]));
  });

  it("offers retry for a successful response using a different reference day", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 8, 12));
    const base = createMockGateway();
    const getToday = vi.fn((tripId: string, referenceDate?: string) => {
      void referenceDate;
      return base.getToday(tripId, "2026-10-07");
    });
    await openToday(base, getToday);
    const today = screen.getByRole("region", { name: "Today" });
    expect(
      within(today).getByRole("button", { name: "Retry" }),
    ).toBeInTheDocument();
    expect(within(today).queryByText("Next")).not.toBeInTheDocument();
  });

  it.each([false, true])(
    "ignores an old-day completion after a new day is accepted (reject=%s)",
    async (reject) => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date(2026, 9, 7, 23, 58));
      const base = createMockGateway();
      await base.createTripItem({
        tripId: "trip_kyoto",
        kind: "activity",
        title: "Old-day late result",
        startAt: "2026-10-07T12:00",
      });
      await base.createTripItem({
        tripId: "trip_kyoto",
        kind: "activity",
        title: "Accepted current day",
        startAt: "2026-10-08T12:00",
      });
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const getToday = vi.fn(async (tripId: string, referenceDate?: string) => {
        if (referenceDate === "2026-10-07") {
          await gate;
          if (reject)
            throw {
              code: "transport/failure",
              message: "Synthetic late old-day error",
            };
        }
        return base.getToday(tripId, referenceDate);
      });
      renderApp({ ...base, getToday });
      fireEvent.click(
        await screen.findByRole("button", {
          name: "Open Kyoto autumn journey",
        }),
      );
      await screen.findByRole("status", { name: "Today" });
      expect(getToday).toHaveBeenCalledWith("trip_kyoto", "2026-10-07");
      act(() => {
        vi.setSystemTime(new Date(2026, 9, 8, 0, 1));
        window.dispatchEvent(new Event("focus"));
      });
      await waitFor(() =>
        expect(
          within(screen.getByRole("region", { name: "Today" })).getByText(
            /Accepted current day/,
          ),
        ).toBeInTheDocument(),
      );
      await act(async () => {
        release();
        await gate;
      });
      const today = screen.getByRole("region", { name: "Today" });
      expect(
        within(today).getByText(/Accepted current day/),
      ).toBeInTheDocument();
      expect(
        within(today).queryByText(/Old-day late result/),
      ).not.toBeInTheDocument();
      expect(
        within(today).queryByRole("button", { name: "Retry" }),
      ).not.toBeInTheDocument();
    },
  );
});

describe("device calendar refresh", () => {
  afterEach(() => vi.useRealTimers());

  it("rolls over at local midnight and releases its timer when unmounted", () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    vi.setSystemTime(new Date(2026, 9, 7, 23, 59, 59));
    const { result, unmount } = renderHook(useDeviceDate);
    expect(result.current).toBe("2026-10-07");
    act(() => vi.advanceTimersByTime(1000));
    expect(result.current).toBe("2026-10-08");
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("checks a changed device time zone on the bounded visible timer", () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    vi.setSystemTime(new Date("2026-10-08T01:30:00Z"));
    const { result, unmount } = renderHook(useDeviceDate);
    expect(result.current).toBe("2026-10-07");
    act(() => {
      vi.stubEnv("TZ", "Asia/Tokyo");
      vi.advanceTimersByTime(60_000);
    });
    expect(result.current).toBe("2026-10-08");
    unmount();
  });

  it("owns one timer through StrictMode effect replay and removes it on unmount", () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    const { unmount } = renderHook(useDeviceDate, { wrapper: StrictMode });
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("pauses while hidden and checks a changed clock on visibility and page resume", () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    vi.setSystemTime(new Date(2026, 9, 7, 21));
    const descriptor = Object.getOwnPropertyDescriptor(document, "hidden");
    let hidden = false;
    Object.defineProperty(document, "hidden", {
      configurable: true,
      get: () => hidden,
    });
    const { result, unmount } = renderHook(useDeviceDate);
    try {
      act(() => {
        hidden = true;
        document.dispatchEvent(new Event("visibilitychange"));
      });
      expect(vi.getTimerCount()).toBe(0);
      act(() => vi.advanceTimersByTime(2 * 86_400_000));
      expect(result.current).toBe("2026-10-07");
      act(() => {
        hidden = false;
        document.dispatchEvent(new Event("visibilitychange"));
      });
      expect(result.current).toBe("2026-10-09");
      act(() => {
        vi.setSystemTime(new Date(2026, 9, 8, 18));
        window.dispatchEvent(new Event("pageshow"));
      });
      expect(result.current).toBe("2026-10-08");
    } finally {
      unmount();
      if (descriptor) Object.defineProperty(document, "hidden", descriptor);
      else Reflect.deleteProperty(document, "hidden");
    }
  });

  it.each([
    [2, 7, "2026-03-08", 23, "2026-03-09"],
    [9, 31, "2026-11-01", 25, "2026-11-02"],
  ] as const)(
    "recomputes midnight across a daylight-saving change from %s",
    (month, day, firstDay, hours, nextDay) => {
      vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
      vi.setSystemTime(new Date(2026, month, day, 23, 59, 59));
      const { result, unmount } = renderHook(useDeviceDate);
      act(() => vi.advanceTimersByTime(1000));
      expect(result.current).toBe(firstDay);
      act(() => vi.advanceTimersByTime(hours * 60 * 60 * 1000));
      expect(result.current).toBe(nextDay);
      unmount();
    },
  );
});
