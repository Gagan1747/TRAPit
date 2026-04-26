import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

type MobileCollapsibleSectionProps = {
  action?: ReactNode;
  children: ReactNode;
  description?: string;
  eyebrow: string;
  isOpen: boolean;
  onToggle: () => void;
  title: string;
};

export function MobileCollapsibleSection({
  action,
  children,
  description,
  eyebrow,
  isOpen,
  onToggle,
  title,
}: MobileCollapsibleSectionProps) {
  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.copyBlock}>
          <Text style={styles.eyebrow}>{eyebrow}</Text>
          <Text style={styles.title}>{title}</Text>
          {description ? <Text style={styles.description}>{description}</Text> : null}
        </View>

        <View style={styles.actionBlock}>
          {action}
          <Pressable style={styles.triggerButton} onPress={onToggle}>
            <Text style={styles.triggerText}>{isOpen ? "Hide section" : "Open section"}</Text>
          </Pressable>
        </View>
      </View>

      {isOpen ? <View style={styles.body}>{children}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  actionBlock: {
    alignItems: "flex-start",
    gap: 10,
  },
  body: {
    gap: 14,
    marginTop: 16,
  },
  card: {
    backgroundColor: "rgba(255, 248, 240, 0.92)",
    borderRadius: 24,
    padding: 18,
  },
  copyBlock: {
    flex: 1,
    gap: 6,
  },
  description: {
    color: "#6d5a4e",
    fontSize: 14,
    lineHeight: 20,
  },
  eyebrow: {
    color: "#8e3f2c",
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 1.6,
    textTransform: "uppercase",
  },
  header: {
    flexDirection: "row",
    gap: 12,
    justifyContent: "space-between",
  },
  title: {
    color: "#231712",
    fontSize: 22,
    fontWeight: "700",
  },
  triggerButton: {
    alignItems: "center",
    backgroundColor: "#fffaf5",
    borderColor: "#d7c3af",
    borderRadius: 999,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 44,
    paddingHorizontal: 16,
  },
  triggerText: {
    color: "#6d5a4e",
    fontWeight: "600",
  },
});