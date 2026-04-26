import {
  formatElapsedTime,
  scoreObjectiveTest,
  type TestResult,
} from "@trapit/testing";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { useQuestionBank } from "../testing/question-bank-context";
import { MobileCollapsibleSection } from "./mobile-collapsible-section";

type MobileUserSection = "results" | "tests";

export function MobileUserTestWorkspace() {
  const { isReady, questions } = useQuestionBank();
  const [answers, setAnswers] = useState<Record<string, number | undefined>>({});
  const [isActive, setIsActive] = useState(false);
  const [openSection, setOpenSection] = useState<MobileUserSection | null>(null);
  const [result, setResult] = useState<TestResult | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);

  if (!isReady) {
    return null;
  }

  function startTest() {
    setAnswers({});
    setIsActive(true);
    setOpenSection("tests");
    setResult(null);
    setStartedAt(Date.now());
  }

  function toggleSection(section: MobileUserSection) {
    setOpenSection((currentSection) => (currentSection === section ? null : section));
  }

  function submitTest() {
    if (!startedAt) {
      return;
    }

    setResult(scoreObjectiveTest(questions, answers, startedAt, Date.now()));
    setIsActive(false);
  }

  return (
    <View style={styles.stack}>
      <View style={styles.metricRow}>
        <View style={styles.metricCard}>
          <Text style={styles.metricValue}>{questions.length}</Text>
          <Text style={styles.metricLabel}>questions</Text>
        </View>
        <View style={styles.metricCard}>
          <Text style={styles.metricValue}>
            {result ? `${result.correctCount}/${result.totalCount}` : "-"}
          </Text>
          <Text style={styles.metricLabel}>latest score</Text>
        </View>
        <View style={styles.metricCard}>
          <Text style={styles.metricValue}>
            {result ? formatElapsedTime(result.elapsedMs) : "-"}
          </Text>
          <Text style={styles.metricLabel}>time taken</Text>
        </View>
      </View>

      <MobileCollapsibleSection
        description="Open the assigned local test bank, answer the questions, and submit once you are done."
        eyebrow="Assigned tests"
        isOpen={openSection === "tests"}
        title="Mobile test runner"
        onToggle={() => toggleSection("tests")}
      >
        {!questions.length ? (
          <Text style={styles.meta}>No test is available yet. Ask the admin to add questions first.</Text>
        ) : !isActive ? (
          <Pressable style={styles.primaryButton} onPress={startTest}>
            <Text style={styles.primaryButtonText}>{result ? "Retake test" : "Start test"}</Text>
          </Pressable>
        ) : (
          <View style={styles.list}>
            {questions.map((question, index) => (
              <View key={question.id} style={styles.card}>
                <Text style={styles.cardTitle}>Question {index + 1}</Text>
                <Text style={styles.questionPrompt}>{question.prompt}</Text>
                <View style={styles.list}>
                  {question.options.map((option, optionIndex) => (
                    <Pressable
                      key={`${question.id}-${optionIndex}`}
                      style={[
                        styles.answerOption,
                        answers[question.id] === optionIndex && styles.answerOptionActive,
                      ]}
                      onPress={() =>
                        setAnswers((currentAnswers) => ({
                          ...currentAnswers,
                          [question.id]: optionIndex,
                        }))
                      }
                    >
                      <Text
                        style={[
                          styles.answerOptionText,
                          answers[question.id] === optionIndex && styles.answerOptionTextActive,
                        ]}
                      >
                        {option}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            ))}

            <Pressable style={styles.primaryButton} onPress={submitTest}>
              <Text style={styles.primaryButtonText}>Submit test</Text>
            </Pressable>
          </View>
        )}
      </MobileCollapsibleSection>

      <MobileCollapsibleSection
        description="Review your most recent score and completion stats after each attempt."
        eyebrow="Latest result"
        isOpen={openSection === "results"}
        title="Result summary"
        onToggle={() => toggleSection("results")}
      >
        {result ? (
          <View style={styles.resultCard}>
            <Text style={styles.cardTitle}>Latest result</Text>
            <Text style={styles.meta}>Correct answers: {result.correctCount} / {result.totalCount}</Text>
            <Text style={styles.meta}>Attempted: {result.attemptedCount}</Text>
            <Text style={styles.meta}>Time taken: {formatElapsedTime(result.elapsedMs)}</Text>
          </View>
        ) : (
          <Text style={styles.meta}>Your latest score will appear here after you submit a test.</Text>
        )}
      </MobileCollapsibleSection>
    </View>
  );
}

const styles = StyleSheet.create({
  answerOption: {
    backgroundColor: "#fffaf5",
    borderColor: "#d7c3af",
    borderRadius: 16,
    borderWidth: 1,
    minHeight: 46,
    justifyContent: "center",
    paddingHorizontal: 14,
  },
  answerOptionActive: {
    backgroundColor: "#b44c2f",
    borderColor: "#b44c2f",
  },
  answerOptionText: {
    color: "#3b2d26",
    fontSize: 14,
    fontWeight: "600",
  },
  answerOptionTextActive: {
    color: "#ffffff",
  },
  card: {
    backgroundColor: "rgba(255, 248, 240, 0.92)",
    borderRadius: 24,
    gap: 14,
    padding: 18,
  },
  cardTitle: {
    color: "#231712",
    fontSize: 18,
    fontWeight: "700",
  },
  list: {
    gap: 14,
  },
  meta: {
    color: "#6d5a4e",
    fontSize: 14,
    lineHeight: 20,
  },
  metricCard: {
    backgroundColor: "rgba(255, 248, 240, 0.92)",
    borderRadius: 20,
    flex: 1,
    gap: 4,
    padding: 16,
  },
  metricLabel: {
    color: "#6d5a4e",
    fontSize: 12,
  },
  metricRow: {
    flexDirection: "row",
    gap: 10,
  },
  metricValue: {
    color: "#231712",
    fontSize: 22,
    fontWeight: "700",
  },
  primaryButton: {
    alignItems: "center",
    backgroundColor: "#b44c2f",
    borderRadius: 999,
    justifyContent: "center",
    minHeight: 48,
    paddingHorizontal: 18,
  },
  primaryButtonText: {
    color: "#ffffff",
    fontSize: 15,
    fontWeight: "700",
  },
  questionPrompt: {
    color: "#231712",
    fontSize: 15,
    lineHeight: 22,
  },
  resultCard: {
    backgroundColor: "#fffaf5",
    borderColor: "#d7c3af",
    borderRadius: 18,
    borderWidth: 1,
    gap: 8,
    padding: 14,
  },
  stack: {
    gap: 16,
    marginTop: 16,
  },
});