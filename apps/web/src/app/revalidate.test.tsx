import { act, render, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";

import {
  RevalidateProvider,
  documentsScope,
  tripScope,
  tripsScope,
  useRevalidate,
  useRevalidateAll,
  useScopeKey,
} from "./revalidate";

const wrapper = ({ children }: { children: ReactNode }) => (
  <RevalidateProvider>{children}</RevalidateProvider>
);

describe("revalidate", () => {
  it("changes a scope's key only when that scope is revalidated", () => {
    const { result } = renderHook(
      () => ({
        trips: useScopeKey(tripsScope),
        trip: useScopeKey(tripScope("t1")),
        revalidate: useRevalidate(),
      }),
      { wrapper },
    );
    const before = { trips: result.current.trips, trip: result.current.trip };

    act(() => result.current.revalidate(tripScope("t1")));

    // The one thing the old global counter could not do: leave the rest alone.
    expect(result.current.trip).not.toBe(before.trip);
    expect(result.current.trips).toBe(before.trips);
  });

  it("does not re-render a view reading an unrelated scope", () => {
    // Both views must sit under ONE provider — a second renderHook would mount
    // its own, and the test would pass without proving anything.
    let tripsRenders = 0;
    let revalidate: (...scopes: string[]) => void = () => {};

    function TripsReader() {
      tripsRenders += 1;
      useScopeKey(tripsScope);
      return null;
    }
    function Writer() {
      revalidate = useRevalidate();
      return null;
    }
    render(
      <RevalidateProvider>
        <TripsReader />
        <Writer />
      </RevalidateProvider>,
    );

    const before = tripsRenders;
    act(() => revalidate(documentsScope("t1")));
    // The trip list is not reading documents, so it must not re-render at all.
    expect(tripsRenders).toBe(before);

    act(() => revalidate(tripsScope));
    expect(tripsRenders).toBe(before + 1);
  });

  it("revalidates several scopes at once", () => {
    const { result } = renderHook(
      () => ({
        trip: useScopeKey(tripScope("t1")),
        documents: useScopeKey(documentsScope("t1")),
        revalidate: useRevalidate(),
      }),
      { wrapper },
    );
    const before = {
      trip: result.current.trip,
      documents: result.current.documents,
    };

    // Deleting a document reaches beyond its own panel: facts confirmed from it
    // get flagged, and those cards live on the trip page.
    act(() => result.current.revalidate(tripScope("t1"), documentsScope("t1")));

    expect(result.current.trip).not.toBe(before.trip);
    expect(result.current.documents).not.toBe(before.documents);
  });

  it("scopes are per trip", () => {
    const { result } = renderHook(
      () => ({
        one: useScopeKey(tripScope("t1")),
        two: useScopeKey(tripScope("t2")),
        revalidate: useRevalidate(),
      }),
      { wrapper },
    );
    const before = result.current.two;

    act(() => result.current.revalidate(tripScope("t1")));
    expect(result.current.two).toBe(before);
  });

  it("revalidateAll refreshes every scope on screen", () => {
    const { result } = renderHook(
      () => ({
        trips: useScopeKey(tripsScope),
        trip: useScopeKey(tripScope("t1")),
        documents: useScopeKey(documentsScope("t1")),
        revalidateAll: useRevalidateAll(),
      }),
      { wrapper },
    );
    const before = { ...result.current };

    act(() => result.current.revalidateAll());

    // Retry-after-failure is the one caller that cannot name what changed.
    expect(result.current.trips).not.toBe(before.trips);
    expect(result.current.trip).not.toBe(before.trip);
    expect(result.current.documents).not.toBe(before.documents);
  });

  it("stops tracking a scope once nothing reads it", () => {
    const { result, unmount } = renderHook(() => useScopeKey(tripScope("t1")), {
      wrapper,
    });
    expect(result.current).toBe("trip:t1#0");
    unmount();
    // Nothing to assert on the key after unmount; this pins that unsubscribing
    // does not throw, which is what a panel scrolling out of view does.
  });
});
