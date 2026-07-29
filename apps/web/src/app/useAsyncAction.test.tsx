import { act, renderHook, waitFor } from "@testing-library/react";
import type { AppError } from "@voyalier/contracts";

import { useAsyncAction } from "./useAsync";

const notFound: AppError = { code: "trip/not_found", message: "gone" };

describe("useAsyncAction", () => {
  it("latches busy for the length of the run", async () => {
    let release: (value: string) => void = () => {};
    const action = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          release = resolve;
        }),
    );
    const { result } = renderHook(() => useAsyncAction(action));

    expect(result.current.busy).toBe(false);
    act(() => void result.current.run());
    await waitFor(() => expect(result.current.busy).toBe(true));

    await act(async () => release("done"));
    await waitFor(() => expect(result.current.busy).toBe(false));
  });

  it("hands the result and the arguments to onSuccess", async () => {
    const onSuccess = vi.fn();
    const { result } = renderHook(() =>
      useAsyncAction((id: string) => Promise.resolve(`saw ${id}`), onSuccess),
    );

    await act(async () => {
      await result.current.run("trip_1");
    });

    expect(onSuccess).toHaveBeenCalledWith("saw trip_1", "trip_1");
    expect(result.current.error).toBeUndefined();
  });

  it("captures a failure instead of rejecting", async () => {
    const onSuccess = vi.fn();
    const { result } = renderHook(() =>
      useAsyncAction(() => Promise.reject(notFound), onSuccess),
    );

    // run() must not reject: callers await it directly from onClick.
    await act(async () => {
      await expect(result.current.run()).resolves.toBeUndefined();
    });

    expect(result.current.error).toEqual(notFound);
    expect(result.current.busy).toBe(false);
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it("normalizes a non-gateway throw into an AppError", async () => {
    // The hand-rolled handlers cast `caught as AppError` over whatever was
    // thrown — including a TypeError from the view's own code, which then
    // reported as a gateway failure.
    const { result } = renderHook(() =>
      useAsyncAction(() => {
        throw new TypeError("createObjectURL is not a function");
      }),
    );

    await act(async () => {
      await result.current.run();
    });

    expect(result.current.error?.code).toBe("internal/unexpected");
    expect(typeof result.current.error?.message).toBe("string");
  });

  it("clears a previous failure when a new run starts", async () => {
    let fail = true;
    const { result } = renderHook(() =>
      useAsyncAction(() =>
        fail ? Promise.reject(notFound) : Promise.resolve("ok"),
      ),
    );

    await act(async () => {
      await result.current.run();
    });
    expect(result.current.error).toEqual(notFound);

    fail = false;
    await act(async () => {
      await result.current.run();
    });
    expect(result.current.error).toBeUndefined();
  });

  it("lets the newest run win, whatever order they settle in", async () => {
    // The failure this prevents is silent: both runs succeed, so nothing
    // errors and nothing looks stale — the view just shows the older answer.
    const releases: ((value: string) => void)[] = [];
    const onSuccess = vi.fn();
    const { result } = renderHook(() =>
      useAsyncAction(
        (label: string) =>
          new Promise<string>((resolve) => {
            releases.push(() => resolve(label));
          }),
        onSuccess,
      ),
    );

    act(() => void result.current.run("first"));
    act(() => void result.current.run("second"));

    // The older request answers last, which is exactly the case a mount guard
    // cannot see.
    await act(async () => {
      releases[1]("second");
      releases[0]("first");
    });

    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(onSuccess).toHaveBeenCalledWith("second", "second");
  });

  it("keeps busy latched while a superseding run is still going", async () => {
    const releases: ((value: string) => void)[] = [];
    const { result } = renderHook(() =>
      useAsyncAction(
        (label: string) =>
          new Promise<string>((resolve) => {
            releases.push(() => resolve(label));
          }),
      ),
    );

    act(() => void result.current.run("first"));
    act(() => void result.current.run("second"));
    await waitFor(() => expect(result.current.busy).toBe(true));

    // The superseded run finishing is not the view finishing waiting.
    await act(async () => releases[0]("first"));
    expect(result.current.busy).toBe(true);

    await act(async () => releases[1]("second"));
    await waitFor(() => expect(result.current.busy).toBe(false));
  });

  it("does not write state after the view unmounts", async () => {
    let release: (value: string) => void = () => {};
    const onSuccess = vi.fn();
    const { result, unmount } = renderHook(() =>
      useAsyncAction(
        () =>
          new Promise<string>((resolve) => {
            release = resolve;
          }),
        onSuccess,
      ),
    );

    act(() => void result.current.run());
    unmount();
    await act(async () => release("late"));

    expect(onSuccess).not.toHaveBeenCalled();
  });
});
