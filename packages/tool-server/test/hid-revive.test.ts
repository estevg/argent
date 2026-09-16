/**
 * The boot-time warm-up is a race, and on runtimes newer than iOS 18.6 the host
 * loses it: measured on **iOS 26.4 with Xcode 27.0 (27A266a)**, 3 of 3 boots
 * came up with the hardware buttons and the external keyboard torn down while
 * the digitizer stayed healthy — the shape `hid-suppression.ts` already
 * documents for 26.5, on a runtime its note lists as untested.
 *
 * Reviving those services needs two guest commands in a fixed order: clear the
 * suppression flag, then restart `backboardd`. Reversing them is the failure
 * the module's own docs call out — `backboardd` rebuilds the services, reads a
 * flag that is still set, and tears them down again, leaving only the digitizer.
 * That ordering is what these tests pin, with no simulator involved.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

/** Every `simctl spawn` argv the code under test issues, in order. */
const spawned: string[][] = [];
let flagValue = "1";

// Only pulled in for the boot-time warm-up, which these tests do not exercise;
// resolving it for real would need the workspace package built.
vi.mock("@argent/native-devtools-ios", () => ({
  simulatorServerBinaryPath: () => "/unused/simulator-server",
}));

vi.mock("../src/utils/sim-remote", () => ({
  simctlSpawn: (_udid: string, opts: { args?: string[] }) => {
    const args = opts.args ?? [];
    spawned.push(args);
    const reading = args[0] === "notifyutil" && args[1] === "-g";
    return Promise.resolve({
      exitCode: 0,
      stdout: reading ? `com.apple.coredevice.dtuhidd.active ${flagValue}\n` : "",
      stderr: "",
    });
  },
}));

const { DTUHIDD_ACTIVE_KEY, readSuppressionFlag, reviveHidServices } =
  await import("../src/utils/hid-suppression");

const UDID = "9977BDF1-83E1-4AF3-8BD7-C886B3F570A9";

describe("HID revive", () => {
  beforeEach(() => {
    spawned.length = 0;
    flagValue = "1";
  });

  it("reads the suppression flag from inside the guest", async () => {
    // Host-side reads are a silent false negative: the guest runs its own notifyd.
    expect(await readSuppressionFlag(UDID)).toBe(true);
    expect(spawned[0]).toEqual(["notifyutil", "-g", DTUHIDD_ACTIVE_KEY]);
  });

  it("reports a cleared flag as not suppressed", async () => {
    flagValue = "0";
    expect(await readSuppressionFlag(UDID)).toBe(false);
  });

  it("clears the flag BEFORE restarting backboardd", async () => {
    await reviveHidServices(UDID);

    const clearAt = spawned.findIndex((a) => a[0] === "notifyutil" && a[1] === "-s");
    const restartAt = spawned.findIndex((a) => a[0] === "launchctl");

    expect(clearAt).toBeGreaterThanOrEqual(0);
    expect(restartAt).toBeGreaterThanOrEqual(0);
    // The whole point: reversed, the rebuilt services are torn down immediately.
    expect(clearAt).toBeLessThan(restartAt);
  });

  it("clears the flag with both -s and -p, so the daemon sees the change", async () => {
    await reviveHidServices(UDID);
    expect(spawned.find((a) => a[1] === "-s")).toEqual([
      "notifyutil",
      "-s",
      DTUHIDD_ACTIVE_KEY,
      "0",
      "-p",
      DTUHIDD_ACTIVE_KEY,
    ]);
  });

  it("restarts backboardd by name, not by pid", async () => {
    await reviveHidServices(UDID);
    expect(spawned.find((a) => a[0] === "launchctl")).toEqual([
      "launchctl",
      "kill",
      "SIGTERM",
      "system/com.apple.backboardd",
    ]);
  });

  it("reports the flag as it was before the repair", async () => {
    expect(await reviveHidServices(UDID)).toEqual({ flagWasSet: true });
    flagValue = "0";
    spawned.length = 0;
    expect(await reviveHidServices(UDID)).toEqual({ flagWasSet: false });
  });
});
