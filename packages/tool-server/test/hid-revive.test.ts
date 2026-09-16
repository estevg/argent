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
/** When set, the guest command whose argv[0] matches fails with this exit code. */
let failing: { argv0: string; exitCode: number; stderr: string } | null = null;

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
    if (failing && args[0] === failing.argv0) {
      return Promise.resolve({ exitCode: failing.exitCode, stdout: "", stderr: failing.stderr });
    }
    return Promise.resolve({
      exitCode: 0,
      stdout: reading ? `com.apple.coredevice.dtuhidd.active ${flagValue}\n` : "",
      stderr: "",
    });
  },
}));

const { DTUHIDD_ACTIVE_KEY, readSuppressionFlag, reviveHidServices } =
  await import("../src/utils/hid-suppression");
const { createReviveSimulatorHidTool } =
  await import("../src/tools/simulator/revive-simulator-hid");

const UDID = "9977BDF1-83E1-4AF3-8BD7-C886B3F570A9";

describe("HID revive", () => {
  beforeEach(() => {
    spawned.length = 0;
    flagValue = "1";
    failing = null;
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

  it("fails loudly when backboardd cannot be restarted, instead of claiming success", async () => {
    failing = { argv0: "launchctl", exitCode: 113, stderr: "Could not find service" };
    await expect(reviveHidServices(UDID)).rejects.toThrow(
      /launchctl kill.*exit 113.*Could not find service/
    );
  });

  it("does not restart backboardd if clearing the flag failed", async () => {
    // Restarting with the flag still set tears the rebuilt services down again —
    // better to stop and say so than to bounce SpringBoard for nothing.
    failing = { argv0: "notifyutil", exitCode: 1, stderr: "notifyd unavailable" };
    await expect(reviveHidServices(UDID)).rejects.toThrow(/notifyutil/);
    expect(spawned.some((a) => a[0] === "launchctl")).toBe(false);
  });

  it("reports the flag as it was before the repair", async () => {
    expect(await reviveHidServices(UDID)).toEqual({ flagWasSet: true });
    flagValue = "0";
    spawned.length = 0;
    expect(await reviveHidServices(UDID)).toEqual({ flagWasSet: false });
  });
});

describe("revive-simulator-hid tool", () => {
  beforeEach(() => {
    spawned.length = 0;
    flagValue = "1";
    failing = null;
  });

  it("runs the repair on an iOS simulator and reports the prior flag", async () => {
    const tool = createReviveSimulatorHidTool();
    await expect(tool.execute({}, { udid: UDID })).resolves.toEqual({
      revived: true,
      udid: UDID,
      flagWasSet: true,
    });
    expect(spawned.some((a) => a[0] === "launchctl")).toBe(true);
  });

  it("refuses an Android serial before touching the device", async () => {
    const tool = createReviveSimulatorHidTool();
    await expect(tool.execute({}, { udid: "emulator-5554" })).rejects.toThrow(
      /only applies to an iOS simulator/
    );
    // Nothing was spawned: the guard fires before any guest command.
    expect(spawned).toEqual([]);
  });
});
