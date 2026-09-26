import type { PluginServerContext } from "@getpaseo/plugin/server";
import { refinedSettings } from "./shared/settings";

export default function contribute(server: PluginServerContext) {
  server.registerSettings(refinedSettings);
  return () => {};
}
