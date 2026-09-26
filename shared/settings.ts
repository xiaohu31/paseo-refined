import { defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

export function migrateRefinedSettings(values: unknown) {
  const previous = values !== null && typeof values === "object" && !Array.isArray(values) ? values : {};
  return { ...previous, uiLanguage: "auto" as const };
}

export const refinedSettings = defineSettings({
  id: "appearance",
  scope: "host",
  version: 2,
  schema: z.object({
    groupConsecutiveTools: z.boolean().default(true),
    toolGroupThreshold: z.number().int().min(3).max(30).default(7),
    uiLanguage: z.enum(["auto", "en", "zh-CN"]).default("auto"),
  }),
  migrate: migrateRefinedSettings,
});
