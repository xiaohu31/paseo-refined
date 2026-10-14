import type { PluginServerContext } from "@getpaseo/plugin/server";
import { tryContribute } from "./shared/compatibility";
import { refinedSettings } from "./shared/settings";

export default function contribute(server: PluginServerContext) {
  tryContribute("settings persistence", () => server.registerSettings(refinedSettings));
  return () => {};
}
