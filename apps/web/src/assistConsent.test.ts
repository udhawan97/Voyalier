import { createMockGateway } from "@voyalier/contracts";

describe("assist approved-content precondition", () => {
  it.each(["fact", "model", "instruction"])(
    "rejects a changed %s until a new preview is explicitly sent",
    async (kind) => {
      const gateway = createMockGateway();
      const preview = await gateway.previewAssist("trip_kyoto", "ollama");
      expect(preview.approvalToken).toBeTruthy();
      if (kind === "fact")
        await gateway.addManualFact({
          tripId: "trip_kyoto",
          factType: "flight_segment",
          payload: { flightNumber: "SYN202" },
        });
      if (kind === "model")
        await gateway.setProviderModel({
          provider: "ollama",
          model: "synthetic-model-after",
        });
      if (kind === "instruction")
        await gateway.setAiPrompt("assist", "Synthetic changed instruction");
      await expect(
        gateway.runAssist("trip_kyoto", "ollama", preview.approvalToken!),
      ).rejects.toMatchObject({
        details: { reason: "assist_preview_changed" },
      });
      expect(await gateway.listAssistActivity("trip_kyoto")).toEqual([]);
      const next = await gateway.previewAssist("trip_kyoto", "ollama");
      expect(next.approvalToken).not.toBe(preview.approvalToken);
      await gateway.runAssist("trip_kyoto", "ollama", next.approvalToken!);
      expect(await gateway.listAssistActivity("trip_kyoto")).toHaveLength(1);
    },
  );

  it("accepts unchanged content and rejects missing legacy approval and a wrong provider", async () => {
    const gateway = createMockGateway();
    await expect(
      Reflect.apply(gateway.runAssist, gateway, ["trip_kyoto", "ollama"]),
    ).rejects.toMatchObject({
      details: { reason: "assist_approval_required" },
    });
    const preview = await gateway.previewAssist("trip_kyoto", "ollama");
    await expect(
      gateway.runAssist("trip_kyoto", "openai", preview.approvalToken!),
    ).rejects.toMatchObject({ details: { reason: "assist_preview_changed" } });
    expect(await gateway.listAssistActivity("trip_kyoto")).toEqual([]);
    const unchanged = await gateway.previewAssist("trip_kyoto", "ollama");
    expect(unchanged.approvalToken).toBe(preview.approvalToken);
    await gateway.runAssist("trip_kyoto", "ollama", preview.approvalToken!);
    expect(await gateway.listAssistActivity("trip_kyoto")).toHaveLength(1);
  });

  it("uses a validated explicit Today date and retains omitted mock fallback", async () => {
    const gateway = createMockGateway();
    expect(
      (await gateway.getToday("trip_kyoto", "2026-10-07")).referenceDate,
    ).toBe("2026-10-07");
    expect((await gateway.getToday("trip_kyoto")).referenceDate).toMatch(
      /^\d{4}-\d{2}-\d{2}$/,
    );
    for (const date of [
      "2026-02-29",
      "2026-04-31",
      "2026-1-01",
      "2026-01-01T00:00:00Z",
    ]) {
      await expect(gateway.getToday("trip_kyoto", date)).rejects.toMatchObject({
        details: { field: "referenceDate" },
      });
    }
  });
});
