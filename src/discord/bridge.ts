/**
 * How the Discord bridge presents itself. Public builds use neutral wording;
 * a machine-local `.env.local` (never committed) can name the user's own bot
 * and host, e.g. VITE_BRIDGE_NAME, VITE_BRIDGE_HOST, VITE_BRIDGE_NETWORK.
 */
import type { BridgeState } from "../lib/types";

const env = import.meta.env;

export const BRIDGE = {
  /** Name of the bot that sends the messages. */
  name: (env.VITE_BRIDGE_NAME as string | undefined) || "your Discord bot",
  /** Short name for headings ("Discord via …"). */
  label: (env.VITE_BRIDGE_NAME as string | undefined) || "the bridge",
  /** The machine the bot runs on. */
  host: (env.VITE_BRIDGE_HOST as string | undefined) || "the bot host",
  /** How Worlds reaches that machine. */
  network: (env.VITE_BRIDGE_NETWORK as string | undefined) || "SSH",
  /** Where the bridge module lives, shown in the install hint. */
  moduleDir: (env.VITE_BRIDGE_MODULE as string | undefined) || "docs/DISCORD_BRIDGE.md",
  /** Profile block source id used by older saved profiles. */
  legacySource: (env.VITE_BRIDGE_LEGACY_SOURCE as string | undefined) || "",
};

/** Capitalised label for the start of a sentence. */
export const BRIDGE_TITLE = BRIDGE.label.charAt(0).toUpperCase() + BRIDGE.label.slice(1);

export function bridgeExplain(state: BridgeState): { title: string; text: string } {
  switch (state) {
    case "connected":
      return { title: `Connected to ${BRIDGE.label}`, text: `Messages are sent by ${BRIDGE.name}.` };
    case "module-missing":
      return {
        title: `${BRIDGE_TITLE} is disconnected`,
        text: `${BRIDGE.host} is reachable, but the Worlds bridge module is not installed yet. Install it from Integrations.`,
      };
    case "host-unreachable":
      return { title: `${BRIDGE_TITLE} is unreachable`, text: `${BRIDGE.host} did not answer over ${BRIDGE.network}. Check that it is on and reachable.` };
    case "unauthorized":
      return { title: `${BRIDGE_TITLE} refused the key`, text: "The shared key changed. Reconnect from Integrations." };
    case "not-configured":
      return { title: `${BRIDGE_TITLE} is not set up`, text: "Add your bot host in Integrations." };
    case "unknown":
      return { title: `Checking ${BRIDGE.label}`, text: "" };
    default:
      return { title: `${BRIDGE_TITLE} is unavailable`, text: `Something went wrong talking to ${BRIDGE.label}. Details are in Integrations.` };
  }
}
