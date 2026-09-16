import { z } from "zod";
import type { ToolDefinition } from "@argent/registry";
import { reviveHidServices } from "../../utils/hid-suppression";
import { resolveDevice } from "../../utils/device-info";

const zodSchema = z.object({
  udid: z
    .string()
    .describe("Target iOS simulator UDID (from `list-devices`) whose HID services to rebuild."),
});

type Params = { udid: string };
type Result = { revived: boolean; udid: string; flagWasSet: boolean | null };

export function createReviveSimulatorHidTool(): ToolDefinition<Params, Result> {
  return {
    id: "revive-simulator-hid",
    interaction: {
      startedMsg: ({ params }) => `Rebuilding HID services on ${params.udid}`,
      completedMsg: ({ params }) => `Rebuilt HID services on ${params.udid}`,
      failedMsg: ({ params, failureSignal }) =>
        `Failed to rebuild HID services on ${params.udid}: ${failureSignal.error_code}`,
    },
    description:
      "Rebuild an iOS simulator's HID services after CoreDevice tore them down, so taps, hardware buttons and typed text land again.\n" +
      "Use when input is silently dropped: the interaction tools report success (`{ typed, keys }`, `{ pressed }`) but nothing reaches the app, and `describe` shows the field unchanged. `boot-device` already warms the services up before boot, but that is a race the host loses on runtimes newer than iOS 18.6 — this is the repair for a window that has already closed.\n" +
      "DISRUPTIVE: it kills the foreground app and restarts SpringBoard. Relaunch the app under test afterwards (`launch-app` / `restart-app`) and expect to redo any in-app state. That is why it is an explicit call and not part of booting.\n" +
      "Returns { revived, udid, flagWasSet } — `flagWasSet` reports the suppression flag as read inside the guest before the repair, or null when it could not be read. iOS simulators only.",
    zodSchema,
    services: () => ({}),
    async execute(_services, params) {
      const { udid } = params as Params;
      // Rejects for a non-iOS id, which is the whole point: `notifyutil` and
      // `backboardd` do not exist anywhere else.
      resolveDevice(udid);
      const { flagWasSet } = await reviveHidServices(udid);
      return { revived: true, udid, flagWasSet };
    },
  };
}
