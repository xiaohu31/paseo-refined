import type { PluginClientContext } from "@getpaseo/plugin/client";
import { RefinedSettings } from "./client/settings";
import {
  reasoningSchema,
  ReasoningCard,
  ToolCallCard,
  ToolGroupCard,
} from "./client/timeline";
import { toolCallSchema, toolGroupSchema, toToolCardData } from "./client/tool-presentation";
import { createToolGroupingController } from "./client/tool-groups";

export default function contribute(client: PluginClientContext) {
  const cleanup = [
    client.addTheme({
      id: "quiet-light",
      name: "Zinc Light",
      appearance: "light",
      colors: {
        background: "#F7F7F8",
        foreground: "#18181B",
        raised: "#FFFFFF",
        control: "#F4F4F5",
        border: "#E4E4E7",
        accent: "#3F3F46",
        mutedForeground: "#71717A",
        ring: "#A1A1AA",
      },
    }),
    client.addSettingsScreen({
      id: "appearance",
      title: "Paseo Refined",
      icon: "SlidersHorizontal",
      Component: RefinedSettings,
    }),
    client.addTheme({
      id: "midnight-focus",
      name: "Zinc Focus",
      appearance: "dark",
      colors: {
        background: "#18181b",
        foreground: "#fafafa",
        raised: "#1f1f22",
        control: "#27272a",
        border: "#27272a",
        accent: "#e4e4e7",
        mutedForeground: "#a1a1aa",
        ring: "#d4d4d8",
      },
    }),
    client.addTheme({
      id: "oled-black",
      name: "OLED Black",
      appearance: "dark",
      colors: {
        background: "#000000",
        foreground: "#FAFAFA",
        raised: "#0A0A0A",
        control: "#171717",
        border: "#262626",
        accent: "#E4E4E7",
        mutedForeground: "#A1A1AA",
        ring: "#52525B",
      },
    }),
    client.addTimelineTransformer({
      id: "polished-reasoning",
      query: { itemType: "reasoning" },
      transform: ({ item, phase }) => ({
        items: [
          {
            type: "plugin",
            kind: "polished-reasoning",
            version: 1,
            data: { text: item.text, phase },
          },
        ],
      }),
    }),
    client.addTimelineRenderer({
      kind: "polished-reasoning",
      version: 1,
      schema: reasoningSchema,
      Component: ReasoningCard,
    }),
    client.addTimelineRenderer({
      kind: "polished-tool-call",
      version: 1,
      schema: toolCallSchema,
      Component: ToolCallCard,
    }),
    client.addTimelineRenderer({
      kind: "polished-tool-group",
      version: 1,
      schema: toolGroupSchema,
      Component: ToolGroupCard,
    }),
  ];
  const toolGrouping = createToolGroupingController(client, toToolCardData);

  return () => {
    toolGrouping.dispose();
    for (const remove of cleanup.reverse()) remove();
  };
}
