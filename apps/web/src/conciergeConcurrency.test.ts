import { createMockGateway } from "@voyalier/contracts";

describe("whole-profile revision and source lifetime", () => {
  it("rejects both stale and omitted existing-profile preconditions without mutation", async () => {
    const gateway = createMockGateway();
    const a = (await gateway.getConciergeWorkspace("trip_kyoto")).profile;
    const b = (await gateway.getConciergeWorkspace("trip_kyoto")).profile;
    const first = await gateway.setConciergeProfile({
      ...a,
      preferences: { ...a.preferences, selectedArea: "Higashiyama" },
    });
    expect(first.profile.revision).toBeTruthy();
    await expect(
      gateway.setConciergeProfile({
        ...b,
        preferences: { ...b.preferences, pace: "slow" },
      }),
    ).rejects.toMatchObject({
      details: { reason: "profile_revision_required" },
    });
    const current = (await gateway.getConciergeWorkspace("trip_kyoto")).profile;
    const saved = await gateway.setConciergeProfile({
      ...current,
      preferences: { ...current.preferences, pace: "slow" },
    });
    await expect(
      gateway.setConciergeProfile({
        ...current,
        preferences: { ...current.preferences, selectedArea: "Gion" },
      }),
    ).rejects.toMatchObject({ details: { reason: "profile_changed" } });
    expect((await gateway.getConciergeWorkspace("trip_kyoto")).profile).toEqual(
      saved.profile,
    );
    expect(saved.profile.preferences.selectedArea).toBe("Higashiyama");
    expect(saved.profile.revision).not.toBe(first.profile.revision);
  });

  it("detaches deleted document provenance while retaining authored metadata and rotating revision", async () => {
    const gateway = createMockGateway();
    const source = (await gateway.listDocuments("trip_kyoto"))[0].document;
    const empty = (await gateway.getConciergeWorkspace("trip_kyoto")).profile;
    const link = {
      id: "source_link",
      label: "My return confirmation",
      category: "confirmation",
      travelerIds: [],
      preparationRequirementIds: [],
      sourceDocumentId: source.id,
      note: "Keep this authored note",
    };
    const before = await gateway.setConciergeProfile({
      ...empty,
      walletLinks: [link],
    });
    await gateway.deleteDocument(source.id);
    const after = (await gateway.getConciergeWorkspace("trip_kyoto")).profile;
    expect(after.walletLinks).toEqual([
      { ...link, sourceDocumentId: undefined },
    ]);
    expect(after.revision).not.toBe(before.profile.revision);
    await expect(
      gateway.setConciergeProfile(before.profile),
    ).rejects.toMatchObject({ details: { reason: "profile_changed" } });
    const saved = await gateway.setConciergeProfile({
      ...after,
      preferences: { ...after.preferences, pace: "slow" },
    });
    expect(saved.profile.walletLinks[0].note).toBe(link.note);
    expect(saved.profile.preferences.pace).toBe("slow");
  });

  it("trip context changes rotate an existing profile revision", async () => {
    const gateway = createMockGateway();
    const initial = (await gateway.getConciergeWorkspace("trip_kyoto")).profile;
    const saved = await gateway.setConciergeProfile(initial);
    await gateway.updateTrip("trip_kyoto", { origin: "Lyon" });
    const current = (await gateway.getConciergeWorkspace("trip_kyoto")).profile;
    expect(current.revision).not.toBe(saved.profile.revision);
    await expect(
      gateway.setConciergeProfile(saved.profile),
    ).rejects.toMatchObject({ details: { reason: "profile_changed" } });
  });
});
