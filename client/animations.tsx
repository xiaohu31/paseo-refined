import { useEffect, useRef, useState, type ReactNode } from "react";
import { AccessibilityInfo, Animated, Easing, Text, View } from "react-native";
import type { ToolCardData } from "./tool-presentation";

function useReduceMotionPreference() {
  const [reduceMotion, setReduceMotion] = useState<boolean | null>(null);

  useEffect(() => {
    let active = true;
    void AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        if (active) setReduceMotion(enabled);
      })
      .catch(() => {
        if (active) setReduceMotion(false);
      });
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduceMotion);
    return () => {
      active = false;
      subscription.remove();
    };
  }, []);

  return reduceMotion;
}

export function useSmoothedRunning(running: boolean, enterDelay = 180, minimumVisible = 450) {
  const [visible, setVisible] = useState(false);
  const visibleRef = useRef(false);
  const visibleSince = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;

    if (running) {
      if (!visibleRef.current) {
        timer.current = setTimeout(() => {
          visibleRef.current = true;
          visibleSince.current = Date.now();
          setVisible(true);
        }, enterDelay);
      }
    } else if (visibleRef.current) {
      const remaining = Math.max(0, minimumVisible - (Date.now() - visibleSince.current));
      timer.current = setTimeout(() => {
        visibleRef.current = false;
        setVisible(false);
      }, remaining);
    }

    return () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
    };
  }, [enterDelay, minimumVisible, running]);

  return visible;
}

export function isDarkColor(color: string) {
  const match = color.match(/^#([0-9a-f]{6})/i);
  if (!match) return false;
  const value = Number.parseInt(match[1], 16);
  const red = (value >> 16) & 255;
  const green = (value >> 8) & 255;
  const blue = value & 255;
  return (red * 0.2126 + green * 0.7152 + blue * 0.0722) / 255 < 0.5;
}

function mixColors(from: string, to: string, amount: number) {
  const start = from.match(/^#([0-9a-f]{6})/i);
  const end = to.match(/^#([0-9a-f]{6})/i);
  if (!start || !end) return to;
  const a = Number.parseInt(start[1], 16);
  const b = Number.parseInt(end[1], 16);
  const channel = (shift: number) => Math.round(((a >> shift) & 255) * (1 - amount) + ((b >> shift) & 255) * amount);
  return `#${[channel(16), channel(8), channel(0)].map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

export function RunningStatusDot({
  color,
  dark,
  platform,
}: {
  color: string;
  dark: boolean;
  platform: "ios" | "android" | "web";
}) {
  const progress = useRef(new Animated.Value(0)).current;
  const reduceMotion = useReduceMotionPreference();

  useEffect(() => {
    progress.stopAnimation();
    if (reduceMotion !== false) {
      progress.setValue(0);
      return;
    }

    const inhale = Easing.bezier(0.32, 0, 0.2, 1);
    const exhale = Easing.bezier(0.4, 0, 0.68, 1);
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(progress, {
          toValue: 1,
          duration: 1450,
          easing: inhale,
          useNativeDriver: platform !== "web",
          isInteraction: false,
        }),
        Animated.delay(150),
        Animated.timing(progress, {
          toValue: 0,
          duration: 1950,
          easing: exhale,
          useNativeDriver: platform !== "web",
          isInteraction: false,
        }),
        Animated.delay(550),
      ]),
    );
    animation.start();
    return () => {
      animation.stop();
      progress.stopAnimation();
    };
  }, [platform, progress, reduceMotion]);

  return (
    <View accessible={false} style={{ width: 16, height: 16, alignItems: "center", justifyContent: "center" }}>
      <Animated.View
        style={{
          position: "absolute",
          width: 14,
          height: 14,
          borderRadius: 7,
          backgroundColor: color,
          opacity: progress.interpolate({ inputRange: [0, 1], outputRange: [0.025, dark ? 0.18 : 0.1] }),
          transform: [{ scale: progress.interpolate({ inputRange: [0, 1], outputRange: [0.88, 1.15] }) }],
        }}
      />
      <Animated.View
        style={{
          width: 7,
          height: 7,
          borderRadius: 3.5,
          backgroundColor: color,
          opacity: progress.interpolate({ inputRange: [0, 1], outputRange: [0.88, 1] }),
        }}
      />
    </View>
  );
}

export function ToolSummaryText({
  data,
  color,
  labelColor,
  glowRadius = 0,
}: {
  data: ToolCardData;
  color: string;
  labelColor: string;
  glowRadius?: number;
}) {
  return (
    <Text
      numberOfLines={1}
      style={{
        color,
        fontSize: 12,
        lineHeight: 18,
        textShadowColor: glowRadius > 0 ? color : "transparent",
        textShadowOffset: { width: 0, height: 0 },
        textShadowRadius: glowRadius,
      }}
    >
      {data.kind === "shell" ? null : (
        <Text style={{ color: labelColor, fontWeight: "500" }}>{`${data.title.replace(" file", "")} · `}</Text>
      )}
      {data.subtitle}
    </Text>
  );
}

export function RunningToolSummary({
  data,
  dark,
  foreground,
  mutedForeground,
  platform,
  active = true,
}: {
  data: ToolCardData;
  dark: boolean;
  foreground: string;
  mutedForeground: string;
  platform: "ios" | "android" | "web";
  active?: boolean;
}) {
  const [width, setWidth] = useState(0);
  const sweep = useRef(new Animated.Value(0)).current;
  const reduceMotion = useReduceMotionPreference();

  useEffect(() => {
    sweep.stopAnimation();
    if (!active || reduceMotion !== false || width <= 0) {
      sweep.setValue(0);
      return;
    }

    sweep.setValue(0);
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(sweep, {
          toValue: 1,
          duration: 2000,
          easing: Easing.linear,
          useNativeDriver: platform !== "web",
          isInteraction: false,
        }),
        Animated.delay(1800),
      ]),
    );
    animation.start();
    return () => {
      animation.stop();
      sweep.stopAnimation();
    };
  }, [active, platform, reduceMotion, sweep, width]);

  const travel = sweep.interpolate({ inputRange: [0, 1], outputRange: [-84, width + 84] });
  const baseColor = mixColors(mutedForeground, foreground, dark ? 0.3 : 0.24);
  // A light surface cannot show a pale highlight without looking washed out.
  // Use a narrow, neutral "ink" sweep instead: stronger contrast in the core,
  // with soft shoulders so the motion remains smooth rather than flashing.
  const softColor = mixColors(mutedForeground, foreground, dark ? 0.5 : 0.55);
  const coreColor = dark ? foreground : mixColors(mutedForeground, foreground, 0.88);
  const renderBand = (bandWidth: number, offset: number, opacity: number, color: string, glowRadius = 0) => (
    <Animated.View
      accessible={false}
      pointerEvents="none"
      style={{
        position: "absolute",
        top: 0,
        bottom: 0,
        left: offset,
        width: bandWidth,
        opacity,
        overflow: "hidden",
        transform: [{ translateX: travel }],
      }}
    >
      <Animated.View
        style={{
          width,
          transform: [{ translateX: Animated.add(Animated.multiply(travel, -1), -offset) }],
        }}
      >
        <ToolSummaryText data={data} color={color} labelColor={color} glowRadius={glowRadius} />
      </Animated.View>
    </Animated.View>
  );

  return (
    <View
      onLayout={({ nativeEvent }) => setWidth(nativeEvent.layout.width)}
      style={{ flex: 1, minWidth: 0, height: 18, overflow: "hidden" }}
    >
      <ToolSummaryText data={data} color={baseColor} labelColor={foreground} />
      {active && reduceMotion === false && width > 0 && (
        <>
          {renderBand(84, 0, 0.12, softColor)}
          {renderBand(50, 17, dark ? 0.26 : 0.3, softColor)}
          {renderBand(18, 33, dark ? 0.55 : 0.64, coreColor, dark ? 2 : 0)}
        </>
      )}
    </View>
  );
}

export function CompletedToolSummary({
  data,
  dark,
  foreground,
  mutedForeground,
  platform,
  trigger,
}: {
  data: ToolCardData;
  dark: boolean;
  foreground: string;
  mutedForeground: string;
  platform: "ios" | "android" | "web";
  trigger: number;
}) {
  const [width, setWidth] = useState(0);
  const sweep = useRef(new Animated.Value(0)).current;
  const reduceMotion = useReduceMotionPreference();

  useEffect(() => {
    sweep.stopAnimation();
    if (trigger <= 0 || reduceMotion !== false || width <= 0) {
      sweep.setValue(0);
      return;
    }

    sweep.setValue(0);
    const animation = Animated.timing(sweep, {
      toValue: 1,
      duration: 1400,
      easing: Easing.bezier(0.4, 0, 0.2, 1),
      useNativeDriver: platform !== "web",
      isInteraction: false,
    });
    animation.start();
    return () => {
      animation.stop();
      sweep.stopAnimation();
    };
  }, [platform, reduceMotion, sweep, trigger, width]);

  const travel = sweep.interpolate({ inputRange: [0, 1], outputRange: [-110, width + 110] });
  const softColor = mixColors(mutedForeground, foreground, dark ? 0.45 : 0.5);
  const coreColor = dark ? foreground : mixColors(mutedForeground, foreground, 0.85);
  const renderBand = (bandWidth: number, offset: number, opacity: number, color: string, glowRadius = 0) => (
    <Animated.View
      accessible={false}
      pointerEvents="none"
      style={{
        position: "absolute",
        top: 0,
        bottom: 0,
        left: offset,
        width: bandWidth,
        opacity,
        overflow: "hidden",
        transform: [{ translateX: travel }],
      }}
    >
      <Animated.View
        style={{
          width,
          transform: [{ translateX: Animated.add(Animated.multiply(travel, -1), -offset) }],
        }}
      >
        <ToolSummaryText data={data} color={color} labelColor={color} glowRadius={glowRadius} />
      </Animated.View>
    </Animated.View>
  );

  return (
    <View
      onLayout={({ nativeEvent }) => setWidth(nativeEvent.layout.width)}
      style={{ flex: 1, minWidth: 0, height: 18, overflow: "hidden" }}
    >
      <ToolSummaryText data={data} color={mutedForeground} labelColor={foreground} />
      {trigger > 0 && reduceMotion === false && width > 0 && (
        <>
          {renderBand(110, 0, 0.1, softColor)}
          {renderBand(68, 21, dark ? 0.23 : 0.25, softColor)}
          {renderBand(24, 43, dark ? 0.5 : 0.52, coreColor, dark ? 2 : 0)}
        </>
      )}
    </View>
  );
}

export function CompletionGlint({
  color,
  dark,
  platform,
  trigger,
}: {
  color: string;
  dark: boolean;
  platform: "ios" | "android" | "web";
  trigger: number;
}) {
  const [width, setWidth] = useState(0);
  const sweep = useRef(new Animated.Value(0)).current;
  const reduceMotion = useReduceMotionPreference();

  useEffect(() => {
    sweep.stopAnimation();
    if (trigger <= 0 || reduceMotion !== false || width <= 0) {
      sweep.setValue(0);
      return;
    }

    sweep.setValue(0);
    const animation = Animated.timing(sweep, {
      toValue: 1,
      duration: 1400,
      easing: Easing.bezier(0.4, 0, 0.2, 1),
      useNativeDriver: platform !== "web",
      isInteraction: false,
    });
    animation.start();
    return () => {
      animation.stop();
      sweep.stopAnimation();
    };
  }, [platform, reduceMotion, sweep, trigger, width]);

  const travel = sweep.interpolate({ inputRange: [0, 1], outputRange: [-120, width + 120] });

  return (
    <View
      accessible={false}
      pointerEvents="none"
      onLayout={({ nativeEvent }) => setWidth(nativeEvent.layout.width)}
      style={{ position: "absolute", zIndex: 2, top: 0, right: 0, bottom: 0, left: 0, overflow: "hidden" }}
    >
      {trigger > 0 && reduceMotion === false && width > 0 && (
        <>
          <Animated.View
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: 112,
              height: 1,
              borderRadius: 1,
              backgroundColor: color,
              opacity: dark ? 0.16 : 0.08,
              transform: [{ translateX: travel }],
            }}
          />
          <Animated.View
            style={{
              position: "absolute",
              top: 0,
              left: 32,
              width: 48,
              height: 1,
              borderRadius: 1,
              backgroundColor: color,
              opacity: dark ? 0.55 : 0.28,
              transform: [{ translateX: travel }],
            }}
          />
        </>
      )}
    </View>
  );
}

export function CompletionMark({
  children,
  platform,
  trigger,
}: {
  children: ReactNode;
  platform: "ios" | "android" | "web";
  trigger: number;
}) {
  const progress = useRef(new Animated.Value(1)).current;
  const reduceMotion = useReduceMotionPreference();

  useEffect(() => {
    progress.stopAnimation();
    if (trigger <= 0 || reduceMotion !== false) {
      progress.setValue(1);
      return;
    }

    progress.setValue(0);
    const animation = Animated.timing(progress, {
      toValue: 1,
      duration: 420,
      easing: Easing.bezier(0.16, 1, 0.3, 1),
      useNativeDriver: platform !== "web",
      isInteraction: false,
    });
    animation.start();
    return () => {
      animation.stop();
      progress.stopAnimation();
    };
  }, [platform, progress, reduceMotion, trigger]);

  return (
    <Animated.View
      style={{
        opacity: progress.interpolate({ inputRange: [0, 1], outputRange: [0.55, 1] }),
        transform: [{ scale: progress.interpolate({ inputRange: [0, 1], outputRange: [0.88, 1] }) }],
      }}
    >
      {children}
    </Animated.View>
  );
}
