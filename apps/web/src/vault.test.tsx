import { fireEvent, screen, within } from "@testing-library/react";
import type { AppGateway, VaultStatus } from "@voyalier/contracts";
import { createMockGateway } from "@voyalier/contracts";

import { renderApp } from "./test/helpers";

/**
 * The optional passphrase: the panel on the home view sets/removes it, and a
 * locked vault gates the whole workspace behind an unlock prompt.
 */
describe("encrypted vault — optional passphrase", () => {
  it("adds a passphrase and reflects that protection is on", async () => {
    renderApp(createMockGateway());
    const region = await screen.findByRole("region", { name: "Encryption" });

    expect(
      await within(region).findByText("Passphrase protection is off."),
    ).toBeInTheDocument();

    fireEvent.click(
      within(region).getByRole("button", { name: "Add a passphrase" }),
    );
    fireEvent.change(within(region).getByLabelText("New passphrase"), {
      target: { value: "river-paper-inn" },
    });
    fireEvent.change(within(region).getByLabelText("Confirm passphrase"), {
      target: { value: "river-paper-inn" },
    });
    fireEvent.click(
      within(region).getByRole("button", { name: "Set passphrase" }),
    );

    expect(
      await within(region).findByText("Passphrase protection is on."),
    ).toBeInTheDocument();
    expect(
      within(region).getByRole("button", { name: "Remove passphrase" }),
    ).toBeInTheDocument();
  });

  it("rejects a mismatched confirmation without calling the gateway", async () => {
    let calls = 0;
    const base = createMockGateway();
    const gateway: AppGateway = {
      ...base,
      setVaultPassphrase: (p: string) => {
        calls += 1;
        return base.setVaultPassphrase(p);
      },
    };
    renderApp(gateway);
    const region = await screen.findByRole("region", { name: "Encryption" });

    fireEvent.click(
      within(region).getByRole("button", { name: "Add a passphrase" }),
    );
    fireEvent.change(within(region).getByLabelText("New passphrase"), {
      target: { value: "river-paper-inn" },
    });
    fireEvent.change(within(region).getByLabelText("Confirm passphrase"), {
      target: { value: "different-value" },
    });
    fireEvent.click(
      within(region).getByRole("button", { name: "Set passphrase" }),
    );

    expect(
      await within(region).findByText("The two passphrases don't match."),
    ).toBeInTheDocument();
    expect(calls).toBe(0);
  });

  it("locks the whole workspace until the correct passphrase is entered", async () => {
    const base = createMockGateway();
    let locked = true;
    const gateway: AppGateway = {
      ...base,
      getVaultStatus: (): Promise<VaultStatus> =>
        Promise.resolve({ active: !locked, protected: true, locked }),
      unlockVault: (passphrase: string): Promise<VaultStatus> => {
        if (passphrase !== "open-sesame-now") {
          return Promise.reject({
            code: "vault/passphrase_incorrect",
            message: "that passphrase is incorrect",
          });
        }
        locked = false;
        return Promise.resolve({
          active: true,
          protected: true,
          locked: false,
        });
      },
    };
    renderApp(gateway);

    // Locked: the unlock gate stands in for the workspace; no trips are shown.
    await screen.findByRole("heading", { name: "Your vault is locked" });
    expect(screen.queryByRole("heading", { name: "Trips" })).toBeNull();

    // The screen is not a dead end: a "Forgot your passphrase?" disclosure
    // explains the honest no-recovery reality.
    fireEvent.click(
      screen.getByText("Forgot your passphrase?", { selector: "summary" }),
    );
    expect(screen.getByText(/no recovery, by design/)).toBeInTheDocument();

    // Wrong passphrase surfaces an error and stays locked.
    fireEvent.change(screen.getByLabelText("Passphrase"), {
      target: { value: "wrong-guess" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Unlock" }));
    expect(
      await screen.findByText("that passphrase is incorrect"),
    ).toBeInTheDocument();

    // Correct passphrase opens the workspace.
    fireEvent.change(screen.getByLabelText("Passphrase"), {
      target: { value: "open-sesame-now" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Unlock" }));
    expect(
      await screen.findByRole("heading", { name: "Trips" }),
    ).toBeInTheDocument();
  });
});
