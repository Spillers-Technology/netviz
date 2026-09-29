// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ThemeProvider } from "@mui/material/styles";
import { theme } from "../theme";
import { ConfirmProvider, useConfirm } from "./useConfirm";

function Harness({ onResult }: { onResult: (value: boolean) => void }) {
  const confirm = useConfirm();
  return (
    <button
      onClick={async () =>
        onResult(await confirm({ title: "Uninstall the probe?", items: ["Stops the service", "Removes netviz-probe"], confirmLabel: "Uninstall", destructive: true }))
      }
    >
      open
    </button>
  );
}

function setup() {
  const results: boolean[] = [];
  render(
    <ThemeProvider theme={theme}>
      <ConfirmProvider>
        <Harness onResult={(value) => results.push(value)} />
      </ConfirmProvider>
    </ThemeProvider>,
  );
  return results;
}

afterEach(cleanup);

describe("useConfirm", () => {
  it("lists exactly what will change and resolves true on confirm", async () => {
    const results = setup();
    fireEvent.click(screen.getByText("open"));
    expect(await screen.findByText("• Removes netviz-probe")).toBeTruthy();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Uninstall" })));
    expect(results).toEqual([true]);
  });

  it("starts destructive dialogs on Cancel and resolves false", async () => {
    const results = setup();
    fireEvent.click(screen.getByText("open"));
    const cancel = await screen.findByRole("button", { name: "Cancel" });
    await waitFor(() => expect(document.activeElement).toBe(cancel));
    await act(async () => fireEvent.click(cancel));
    expect(results).toEqual([false]);
  });
});
