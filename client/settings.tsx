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
  SettingsSelect,
  SettingsSwitch,
} from "@getpaseo/plugin/client/ui";
import { Pressable, Text, View } from "react-native";
import { refinedSettings } from "../shared/settings";
import { resolveUiLanguage, tr, type UiLanguagePreference } from "./i18n";

const MIN_THRESHOLD = 3;
const MAX_THRESHOLD = 30;

export function RefinedSettings({ theme, layout }: PluginSurfaceProps) {
  const settings = useSettings(refinedSettings);
  const preference = settings.status === "ready" ? settings.values.uiLanguage : "auto";
  const language = resolveUiLanguage(preference);

  if (settings.status === "loading") {
    return (
      <View style={{ padding: layout.compact ? 16 : 20 }}>
        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 13 }}>{tr(language, "Loading settings…")}</Text>
      </View>
    );
  }

  if (settings.status === "error") {
    return (
      <SettingsSection title="Paseo Refined">
        <SettingsCard>
          <SettingsAction
            label={tr(language, "Settings unavailable")}
            hint={settings.error}
            actionLabel={tr(language, "Try again")}
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
            label={tr(language, "Settings need to be reset")}
            hint={settings.error}
            actionLabel={tr(language, "Restore defaults")}
            onPress={() => void settings.reset()}
            disabled={settings.saving}
          />
        </SettingsCard>
      </SettingsSection>
    );
  }

  const { groupConsecutiveTools, toolGroupThreshold, uiLanguage } = settings.values;
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

  async function saveLanguage(next: string) {
    if (settings.saving || !["auto", "en", "zh-CN"].includes(next)) return;
    await settings.save({ ...values, uiLanguage: next as UiLanguagePreference }, revision);
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
        title={tr(language, "Tool calls")}
        info={
          language === "zh-CN"
            ? "较长的连续工具调用会收拢为一张卡片，每一项的完整详情仍可查看。"
            : "Long uninterrupted runs are condensed into one card. Every tool's full details remain available."
        }
      >
        <SettingsCard>
          <SettingsSwitch
            label={tr(language, "Group long tool runs")}
            hint={language === "zh-CN" ? "保留较短的调用序列，只收拢繁忙区段。" : "Keeps short runs visible and condenses only busy sections."}
            value={groupConsecutiveTools}
            onValueChange={(enabled) => void saveEnabled(enabled)}
            disabled={settings.saving}
          />
          <SettingsRow
            label={tr(language, "Group at")}
            hint={
              language === "zh-CN"
                ? `连续 1–${toolGroupThreshold - 1} 次调用仍保持为独立卡片。`
                : `Runs with 1–${toolGroupThreshold - 1} calls stay as individual cards.`
            }
            error={settings.saveError}
          >
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={tr(language, "Decrease tool grouping threshold")}
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
                  {language === "zh-CN" ? `${toolGroupThreshold} 次` : `${toolGroupThreshold} calls`}
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={tr(language, "Increase tool grouping threshold")}
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

      <SettingsSection title={tr(language, "Language")}>
        <SettingsCard>
          <SettingsSelect
            label={tr(language, "Interface language")}
            hint={
              language === "zh-CN"
                ? "自动模式跟随设备区域；也可以为插件单独指定语言。"
                : "Automatic follows the device locale, or you can override it for this plugin."
            }
            value={uiLanguage}
            options={[
              { label: tr(language, "Automatic"), value: "auto" },
              { label: "English", value: "en" },
              { label: "简体中文", value: "zh-CN" },
            ]}
            onValueChange={(value) => void saveLanguage(value)}
            disabled={settings.saving}
          />
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title={tr(language, "Behavior")}>
        <SettingsCard>
          <SettingsRow
            label={tr(language, "Stable timeline position")}
            hint={
              language === "zh-CN"
                ? "工具列表在会话中原地展开，单项详情使用弹窗显示。"
                : "Tool lists expand in the conversation, while individual details open in a focused modal."
            }
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
              <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>{tr(language, "Enabled")}</Text>
            </View>
          </SettingsRow>
        </SettingsCard>
      </SettingsSection>
    </View>
  );
}
