import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { useSettings } from "@getpaseo/plugin/client";
import {
  Icon,
} from "@getpaseo/plugin/client/react-native";
import {
  SettingsAction,
  SettingsCard,
  SettingsRow,
  SettingsSection,
  SettingsSwitch,
} from "@getpaseo/plugin/client/ui";
import { Pressable, Text, View } from "react-native";
import { refinedSettings } from "../shared/settings";

const MIN_THRESHOLD = 3;
const MAX_THRESHOLD = 30;

export function RefinedSettings({ theme, layout }: PluginSurfaceProps) {
  const settings = useSettings(refinedSettings);

  if (settings.status === "loading") {
    return (
      <View style={{ padding: layout.compact ? 16 : 20 }}>
        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 13 }}>Loading settings…</Text>
      </View>
    );
  }

  if (settings.status === "error") {
    return (
      <SettingsSection title="Paseo Refined">
        <SettingsCard>
          <SettingsAction
            label="Settings unavailable"
            hint={settings.error}
            actionLabel="Try again"
            onPress={() => void settings.reload()}
          />
        </SettingsCard>
      </SettingsSection>
    );
  }

  if (settings.status === "invalid") {
    return (
      <SettingsSection title="Paseo Refined">
        <SettingsCard>
          <SettingsAction
            label="Settings need to be reset"
            hint={settings.error}
            actionLabel="Restore defaults"
            onPress={() => void settings.reset()}
            disabled={settings.saving}
          />
        </SettingsCard>
      </SettingsSection>
    );
  }

  const { groupConsecutiveTools, toolGroupThreshold } = settings.values;
  const values = settings.values;
  const revision = settings.revision;

  async function saveThreshold(next: number) {
    const threshold = Math.max(MIN_THRESHOLD, Math.min(MAX_THRESHOLD, next));
    if (threshold === toolGroupThreshold || settings.saving) return;
    await settings.save({ ...values, toolGroupThreshold: threshold }, revision);
  }

  async function saveEnabled(enabled: boolean) {
    if (settings.saving) return;
    await settings.save({ ...values, groupConsecutiveTools: enabled }, revision);
  }

  const controlButton = (disabled: boolean) => ({
    width: 34,
    height: 34,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: disabled ? theme.colors.surface1 : theme.colors.surface2,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    opacity: disabled ? 0.45 : 1,
  });

  return (
    <View style={{ gap: 22, paddingVertical: layout.compact ? 4 : 8 }}>
      <SettingsSection
        title="Tool calls"
        info="Long uninterrupted runs are condensed into one card. Tool details remain available inside the group."
      >
        <SettingsCard>
          <SettingsSwitch
            label="Group long tool runs"
            hint="Keeps short runs visible and condenses only busy sections."
            value={groupConsecutiveTools}
            onValueChange={(enabled) => void saveEnabled(enabled)}
            disabled={settings.saving}
          />
          <SettingsRow
            label="Group at"
            hint={`Runs with 1–${toolGroupThreshold - 1} calls stay as individual cards.`}
            error={settings.saveError}
          >
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Decrease tool grouping threshold"
                disabled={!groupConsecutiveTools || settings.saving || toolGroupThreshold <= MIN_THRESHOLD}
                onPress={() => void saveThreshold(toolGroupThreshold - 1)}
                style={controlButton(!groupConsecutiveTools || settings.saving || toolGroupThreshold <= MIN_THRESHOLD)}
              >
                <Icon name="Minus" size={14} color={theme.colors.foregroundMuted} />
              </Pressable>
              <View
                style={{
                  minWidth: 66,
                  height: 34,
                  paddingHorizontal: 10,
                  borderRadius: 10,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: theme.colors.surface2,
                }}
              >
                <Text style={{ color: theme.colors.foreground, fontSize: 13, fontWeight: "600" }}>
                  {toolGroupThreshold} calls
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Increase tool grouping threshold"
                disabled={!groupConsecutiveTools || settings.saving || toolGroupThreshold >= MAX_THRESHOLD}
                onPress={() => void saveThreshold(toolGroupThreshold + 1)}
                style={controlButton(!groupConsecutiveTools || settings.saving || toolGroupThreshold >= MAX_THRESHOLD)}
              >
                <Icon name="Plus" size={14} color={theme.colors.foregroundMuted} />
              </Pressable>
            </View>
          </SettingsRow>
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title="Behavior">
        <SettingsCard>
          <SettingsRow
            label="Stable timeline position"
            hint="Groups open in a sheet, so inspecting tools does not move the conversation."
          >
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 6,
                paddingHorizontal: 9,
                minHeight: 28,
                borderRadius: 8,
                backgroundColor: theme.colors.surface2,
              }}
            >
              <Icon name="Check" size={12} color={theme.colors.statusSuccess} />
              <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>Enabled</Text>
            </View>
          </SettingsRow>
        </SettingsCard>
      </SettingsSection>
    </View>
  );
}
