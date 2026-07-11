import type { AppError } from "@voyalier/contracts";
import { createMockGateway } from "@voyalier/contracts";

import { createHttpGateway } from "./http";
import { createTauriGateway } from "./tauri";

async function caught(run: () => Promise<unknown>): Promise<AppError> {
  try {
    await run();
    throw new Error("expected the gateway call to reject");
  } catch (error) {
    return error as AppError;
  }
}

describe("gateway error normalization", () => {
  it("collapses network/invoke failures to an identical transport/failure shape", async () => {
    const http = createHttpGateway({
      fetch: () => Promise.reject(new Error("connection refused")),
    });
    const tauri = createTauriGateway({
      invoke: () => Promise.reject(new Error("ipc channel closed")),
    });
    const mock = createMockGateway({ failOn: { health: "transport/failure" } });

    const errors = await Promise.all([
      caught(() => http.health()),
      caught(() => tauri.health()),
      caught(() => mock.health()),
    ]);

    for (const error of errors) {
      expect(error.code).toBe("transport/failure");
      expect(typeof error.message).toBe("string");
      expect(Object.keys(error).sort()).toEqual(["code", "message"]);
    }
  });

  it("passes server AppErrors through unchanged (not collapsed to transport)", async () => {
    const notFound: AppError = {
      code: "trip/not_found",
      message: "Trip not found",
    };
    const http = createHttpGateway({
      fetch: () =>
        Promise.resolve(
          new Response(JSON.stringify(notFound), {
            status: 404,
            headers: { "Content-Type": "application/json" },
          }),
        ),
    });

    const error = await caught(() => http.getTrip("missing"));
    expect(error).toEqual(notFound);
  });

  it("preserves AppError rejections from the Tauri bridge", async () => {
    const alreadyResolved: AppError = {
      code: "candidate/already_resolved",
      message: "Candidate has already been resolved",
      details: { candidateId: "c1" },
    };
    const tauri = createTauriGateway({
      invoke: () => Promise.reject(alreadyResolved),
    });

    const error = await caught(() =>
      tauri.confirmCandidate({ candidateId: "c1" }),
    );
    expect(error).toEqual(alreadyResolved);
  });
});
