import { defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

export const refinedSettings = defineSettings({
  id: "appearance",
  scope: "host",
  version: 1,
  schema: z.object({
    groupConsecutiveTools: z.boolean().default(true),
    toolGroupThreshold: z.number().int().min(3).max(30).default(7),
  }),
});
