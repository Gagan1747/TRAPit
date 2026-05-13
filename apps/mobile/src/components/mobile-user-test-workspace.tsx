import { createPresentedQuestions, formatElapsedTime, type TestResult } from "@trapit/testing";
import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { useQuestionBank } from "../testing/question-bank-context";
import { MobileCollapsibleSection } from "./mobile-collapsible-section";

function formatShortDateTime(value: string) {
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

type MobileUserSection = "results" | "tests";

type MobileUserTestWorkspaceProps = {
  currentParticipantIdentifier: string | null;
};

export function MobileUserTestWorkspace({ currentParticipantIdentifier }: MobileUserTestWorkspaceProps) {
  const { getAvailableTestsForParticipant, getUserHistory, getUserTestReview, isReady, recordAttempt } = useQuestionBank();
  const [activeTestId, setActiveTestId] = useState<string | null>(null);
  const [activeParticipantName, setActiveParticipantName] = useState("");
  const [answers, setAnswers] = useState<Record<string, number | undefined>>({});
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [openSection, setOpenSection] = useState<MobileUserSection | null>("tests");
  const [participantNamesByTest, setParticipantNamesByTest] = useState<Record<string, string>>({});
  const [remainingMs, setRemainingMs] = useState<number | null>(null);
  const [result, setResult] = useState<TestResult | null>(null);
  const [reviewByTestId, setReviewByTestId] = useState<Record<string, ReturnType<typeof getUserTestReview>>>({});
  const [reviewTestIds, setReviewTestIds] = useState<string[]>([]);
  const [startedAt, setStartedAt] = useState<string | null>(null);
  const answersRef = useRef<Record<string, number | undefined>>({});
  const submittingRef = useRef(false);

  const availableTests = currentParticipantIdentifier
    ? getAvailableTestsForParticipant(currentParticipantIdentifier)
    : [];
  const history = currentParticipantIdentifier ? getUserHistory(currentParticipantIdentifier) : [];
  const historyByTestId = new Map(history.map((entry) => [entry.testId, entry]));
  const activeTest = availableTests.find((test) => test.id === activeTestId) ?? null;
  const presentedQuestions = useMemo(() => {
    if (!activeTest || !currentParticipantIdentifier) {
      return [];
    }

    return createPresentedQuestions(
      activeTest.questions,
      `${activeTest.id}:${currentParticipantIdentifier}`,
    );
  }, [activeTest, currentParticipantIdentifier]);
  const activeQuestion = presentedQuestions[currentQuestionIndex] ?? null;

  useEffect(() => {
    answersRef.current = answers;
  }, [answers]);

  useEffect(() => {
    if (!activeTest || !startedAt) {
      setRemainingMs(null);
      return;
    }

    const deadlineMs = new Date(activeTest.startsAt).getTime() + activeTest.durationMinutes * 60 * 1000;

    const tick = () => {
      const nextRemainingMs = Math.max(0, deadlineMs - Date.now());
      setRemainingMs(nextRemainingMs);

      if (nextRemainingMs === 0 && !submittingRef.current) {
        void submitTest(true);
      }
    };

    tick();
    const intervalId = setInterval(tick, 1000);

    return () => {
      clearInterval(intervalId);
    };
  }, [activeTest, startedAt]);

  if (!isReady) {
    return null;
  }

  function toggleSection(section: MobileUserSection) {
    setOpenSection((currentSection) => (currentSection === section ? null : section));
  }

  function startTest(testId: string) {
    const participantName = participantNamesByTest[testId]?.trim() ?? "";

    if (!participantName) {
      setFeedback("Enter your name before starting the test.");
      return;
    }

    setActiveTestId(testId);
    setActiveParticipantName(participantName);
    setAnswers({});
    answersRef.current = {};
    setCurrentQuestionIndex(0);
    setFeedback(null);
    setOpenSection("tests");
    setResult(null);
    setStartedAt(new Date().toISOString());
  }

  async function submitTest(dueToTimer = false) {
    if (!activeTest || !currentParticipantIdentifier || !startedAt || submittingRef.current) {
      return;
    }

    try {
      submittingRef.current = true;
      const attempt = recordAttempt({
        answers: answersRef.current,
        completedAt: dueToTimer
          ? new Date(new Date(activeTest.startsAt).getTime() + activeTest.durationMinutes * 60 * 1000).toISOString()
          : new Date().toISOString(),
        participantName: activeParticipantName,
        startedAt,
        testId: activeTest.id,
        userId: currentParticipantIdentifier,
      });

      setResult(attempt.result);
      setFeedback(dueToTimer ? "Time is up. Your test was submitted automatically." : "Test submitted.");
      setActiveTestId(null);
      setActiveParticipantName("");
      setAnswers({});
      answersRef.current = {};
      setCurrentQuestionIndex(0);
      setStartedAt(null);
      setOpenSection("results");
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Unable to submit this test.");
    } finally {
      submittingRef.current = false;
    }
  }

  function formatCountdown(value: number | null) {
    if (value === null) {
      return "--:--";
    }

    const totalSeconds = Math.max(0, Math.ceil(value / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;

    return `${minutes}:${seconds.toString().padStart(2, "0")}`;
  }

  function handleSelectAnswer(questionId: string, originalOptionIndex: number) {
    const nextAnswers = {
      ...answersRef.current,
      [questionId]: originalOptionIndex,
    };

    answersRef.current = nextAnswers;
    setAnswers(nextAnswers);
    setFeedback(null);
  }

  function goToPreviousQuestion() {
    setCurrentQuestionIndex((currentIndex) => Math.max(currentIndex - 1, 0));
    setFeedback(null);
  }

  function goToNextQuestion() {
    if (!activeTest) {
      return;
    }

    setCurrentQuestionIndex((currentIndex) => Math.min(currentIndex + 1, activeTest.questionCount));
    setFeedback(null);
  }

  function handleLoadReview(testId: string) {
    if (!currentParticipantIdentifier) {
      return;
    }

    if (reviewByTestId[testId]) {
      setReviewTestIds((currentIds) =>
        currentIds.includes(testId)
          ? currentIds.filter((currentId) => currentId !== testId)
          : [...currentIds, testId],
      );
      return;
    }

    try {
      const review = getUserTestReview(testId, currentParticipantIdentifier);
      setReviewByTestId((currentReviews) => ({
        ...currentReviews,
        [testId]: review,
      }));
      setReviewTestIds((currentIds) => [...new Set([...currentIds, testId])]);
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Unable to load the test review.");
    }
  }

  return (
    <View style={styles.stack}>
      <View style={styles.metricRow}>
        <View style={styles.metricCard}>
          <Text style={styles.metricValue}>{availableTests.length}</Text>
          <Text style={styles.metricLabel}>tests</Text>
        </View>
        <View style={styles.metricCard}>
          <Text style={styles.metricValue}>{result ? `${result.correctCount}/${result.totalCount}` : "-"}</Text>
          <Text style={styles.metricLabel}>latest score</Text>
        </View>
        <View style={styles.metricCard}>
          <Text style={styles.metricValue}>{result ? formatElapsedTime(result.elapsedMs) : "-"}</Text>
          <Text style={styles.metricLabel}>time taken</Text>
        </View>
      </View>

      <MobileCollapsibleSection
        description="Open assigned tests, answer the questions, and submit once you are done."
        eyebrow="Assigned tests"
        isOpen={openSection === "tests"}
        title="Mobile test runner"
        onToggle={() => toggleSection("tests")}
      >
        {feedback ? <Text style={styles.meta}>{feedback}</Text> : null}
        {activeTest ? (
          <View style={styles.list}>
            <View style={styles.card}>
              <View style={styles.cardHead}>
                <Text style={styles.cardTitle}>{activeTest.title}</Text>
              </View>
              <View
                style={[
                  styles.countdownBadge,
                  remainingMs !== null && remainingMs <= 60_000 ? styles.countdownBadgeWarning : styles.countdownBadgeSafe,
                ]}
              >
                <Text style={styles.countdownLabel}>Time left</Text>
                <Text style={styles.countdownValue}>{formatCountdown(remainingMs)}</Text>
              </View>
              <Text style={styles.meta}>Question {Math.min(currentQuestionIndex + 1, activeTest.questionCount)} of {activeTest.questionCount}</Text>
              <Text style={styles.meta}>Select an answer, then use the navigation buttons to review or skip before submitting.</Text>
            </View>

            {activeQuestion ? (
              <View style={styles.card}>
                <Text style={styles.cardTitle}>Question {currentQuestionIndex + 1}</Text>
                <Text style={styles.questionPrompt}>{activeQuestion.question.prompt}</Text>
                <View style={styles.list}>
                  {activeQuestion.displayOptions.map((option, optionIndex) => (
                    <Pressable
                      key={`${activeQuestion.question.id}-${optionIndex}`}
                      style={[
                        styles.answerOption,
                        answers[activeQuestion.question.id] === activeQuestion.originalOptionIndexes[optionIndex] && styles.answerOptionActive,
                      ]}
                      onPress={() => handleSelectAnswer(activeQuestion.question.id, activeQuestion.originalOptionIndexes[optionIndex])}
                    >
                      <Text
                        style={[
                          styles.answerOptionText,
                          answers[activeQuestion.question.id] === activeQuestion.originalOptionIndexes[optionIndex] && styles.answerOptionTextActive,
                        ]}
                      >
                        {option}
                      </Text>
                    </Pressable>
                  ))}
                </View>
                <View style={styles.navigationRow}>
                  <Pressable
                    disabled={currentQuestionIndex === 0}
                    style={[styles.secondaryButton, currentQuestionIndex === 0 && styles.buttonDisabled]}
                    onPress={goToPreviousQuestion}
                  >
                    <Text style={[styles.secondaryButtonText, currentQuestionIndex === 0 && styles.buttonTextDisabled]}>Previous question</Text>
                  </Pressable>
                  <Pressable style={styles.secondaryButton} onPress={goToNextQuestion}>
                    <Text style={styles.secondaryButtonText}>Next question</Text>
                  </Pressable>
                </View>
              </View>
            ) : (
              <View style={styles.card}>
                <Text style={styles.cardTitle}>Ready to submit</Text>
                <Text style={styles.meta}>You have answered all questions. Submit now to see your result.</Text>
                <View style={styles.navigationRow}>
                  <Pressable
                    disabled={activeTest.questionCount === 0}
                    style={[styles.secondaryButton, activeTest.questionCount === 0 && styles.buttonDisabled]}
                    onPress={goToPreviousQuestion}
                  >
                    <Text style={[styles.secondaryButtonText, activeTest.questionCount === 0 && styles.buttonTextDisabled]}>Review previous question</Text>
                  </Pressable>
                  <Pressable style={styles.primaryButton} onPress={() => void submitTest()}>
                    <Text style={styles.primaryButtonText}>Submit test</Text>
                  </Pressable>
                </View>
              </View>
            )}
          </View>
        ) : availableTests.length ? (
          <View style={styles.list}>
            {availableTests.map((test) => {
              const historyEntry = historyByTestId.get(test.id);
              const isCompleted = test.status === "completed";

              return (
                <View key={test.id} style={styles.card}>
                  <View style={styles.cardHead}>
                    <Text style={styles.cardTitle}>{test.title}</Text>
                    <Text style={styles.reviewChip}>{test.status}</Text>
                  </View>
                  <Text style={styles.meta}>Starts {formatShortDateTime(test.startsAt)}</Text>
                  <Text style={styles.meta}>{test.questionCount} questions, {test.durationMinutes} minutes</Text>
                  {isCompleted ? (
                    historyEntry ? (
                      <>
                        <Text style={styles.meta}>Score {historyEntry.correctCount}/{historyEntry.totalCount}</Text>
                        <Text style={styles.meta}>Time taken {formatElapsedTime(historyEntry.elapsedMs)}</Text>
                      </>
                    ) : (
                      <Text style={styles.meta}>This test is completed.</Text>
                    )
                  ) : (
                    <>
                      <Text style={styles.label}>Your name for this test</Text>
                      <TextInput
                        placeholder="Enter your display name"
                        placeholderTextColor="#8e7d70"
                        style={styles.nameInput}
                        value={participantNamesByTest[test.id] ?? ""}
                        onChangeText={(value) =>
                          setParticipantNamesByTest((currentNames) => ({
                            ...currentNames,
                            [test.id]: value,
                          }))
                        }
                      />
                      <Pressable
                        style={styles.secondaryButton}
                        onPress={() => {
                          const nextName = currentParticipantIdentifier ?? "Participant";
                          setParticipantNamesByTest((currentNames) => ({
                            ...currentNames,
                            [test.id]: currentNames[test.id]?.trim() ? currentNames[test.id] : nextName,
                          }));
                        }}
                      >
                        <Text style={styles.secondaryButtonText}>Use my identifier</Text>
                      </Pressable>
                      <Pressable style={styles.primaryButton} onPress={() => startTest(test.id)}>
                        <Text style={styles.primaryButtonText}>{test.status === "live" ? "Start test" : "Open when live"}</Text>
                      </Pressable>
                    </>
                  )}
                </View>
              );
            })}
          </View>
        ) : (
          <Text style={styles.meta}>No assigned tests are available for this user yet.</Text>
        )}
      </MobileCollapsibleSection>

      <MobileCollapsibleSection
        description="Review your completed assigned tests and see the latest submission details."
        eyebrow="Latest result"
        isOpen={openSection === "results"}
        title="Result summary"
        onToggle={() => toggleSection("results")}
      >
        {history.length ? (
          <View style={styles.list}>
            {availableTests.filter((test) => test.status === "completed").map((test) => {
              const historyEntry = historyByTestId.get(test.id);
              const review = reviewByTestId[test.id];
              const isReviewVisible = reviewTestIds.includes(test.id);

              return (
                <View key={`result-${test.id}`} style={styles.card}>
                  <View style={styles.cardHead}>
                    <Text style={styles.cardTitle}>{test.title}</Text>
                    <Text style={styles.reviewChip}>{historyEntry?.status === "missed" ? "missed" : "completed"}</Text>
                  </View>
                  <Text style={styles.meta}>Completed {historyEntry ? formatShortDateTime(historyEntry.completedAt) : formatShortDateTime(test.startsAt)}</Text>
                  {historyEntry ? (
                    <>
                      <Text style={styles.meta}>Score {historyEntry.correctCount}/{historyEntry.totalCount}</Text>
                      <Text style={styles.meta}>Time taken {formatElapsedTime(historyEntry.elapsedMs)}</Text>
                    </>
                  ) : (
                    <Text style={styles.meta}>No participant submission was recorded for this test.</Text>
                  )}
                  <Pressable style={styles.secondaryButton} onPress={() => handleLoadReview(test.id)}>
                    <Text style={styles.secondaryButtonText}>{isReviewVisible ? "Hide review" : "Review questions"}</Text>
                  </Pressable>
                  {isReviewVisible && review ? (
                    <View style={styles.reviewList}>
                      {review.review.map((question, questionIndex) => (
                        <View key={`${test.id}-${question.questionId}`} style={styles.reviewCard}>
                          <View style={styles.cardHead}>
                            <Text style={styles.cardTitle}>Question {questionIndex + 1}</Text>
                            <Text style={styles.reviewChip}>Review</Text>
                          </View>
                          <Text style={styles.questionPrompt}>{question.prompt}</Text>
                          <View style={styles.list}>
                            {question.options.map((option, optionIndex) => (
                              <View key={`${question.questionId}-${optionIndex}`} style={styles.reviewOption}>
                                <Text style={styles.answerOptionText}>
                                  {option}
                                  {optionIndex === question.correctOptionIndex ? " (correct)" : ""}
                                  {optionIndex === question.selectedOptionIndex ? " (your answer)" : ""}
                                </Text>
                              </View>
                            ))}
                          </View>
                        </View>
                      ))}
                    </View>
                  ) : null}
                </View>
              );
            })}
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
    justifyContent: "center",
    minHeight: 46,
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
    gap: 12,
    padding: 18,
  },
  cardHead: {
    flexDirection: "row",
    gap: 10,
    justifyContent: "space-between",
  },
  cardTitle: {
    color: "#231712",
    fontSize: 18,
    fontWeight: "700",
  },
  countdownBadge: {
    borderRadius: 18,
    gap: 4,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  countdownBadgeSafe: {
    backgroundColor: "rgba(120, 141, 94, 0.2)",
    borderColor: "rgba(120, 141, 94, 0.42)",
    borderWidth: 1,
  },
  countdownBadgeWarning: {
    backgroundColor: "rgba(180, 76, 47, 0.18)",
    borderColor: "rgba(180, 76, 47, 0.4)",
    borderWidth: 1,
  },
  countdownLabel: {
    color: "#6d5a4e",
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  countdownValue: {
    color: "#231712",
    fontSize: 30,
    fontWeight: "800",
    lineHeight: 34,
  },
  label: {
    color: "#231712",
    fontSize: 14,
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
  nameInput: {
    backgroundColor: "#fffaf5",
    borderColor: "#d7c3af",
    borderRadius: 16,
    borderWidth: 1,
    color: "#231712",
    minHeight: 46,
    paddingHorizontal: 14,
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
  navigationRow: {
    flexDirection: "row",
    gap: 10,
  },
  primaryButton: {
    alignItems: "center",
    backgroundColor: "#b44c2f",
    borderRadius: 999,
    flex: 1,
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
  reviewCard: {
    backgroundColor: "rgba(255, 248, 240, 0.92)",
    borderRadius: 18,
    gap: 10,
    padding: 14,
  },
  reviewChip: {
    color: "#6d5a4e",
    fontSize: 12,
    fontWeight: "700",
  },
  reviewList: {
    gap: 12,
    marginTop: 10,
  },
  reviewOption: {
    backgroundColor: "#fffaf5",
    borderColor: "#d7c3af",
    borderRadius: 14,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 42,
    paddingHorizontal: 12,
  },
  secondaryButton: {
    alignItems: "center",
    backgroundColor: "#fffaf5",
    borderColor: "#d7c3af",
    borderRadius: 999,
    borderWidth: 1,
    flex: 1,
    justifyContent: "center",
    minHeight: 46,
    paddingHorizontal: 16,
  },
  secondaryButtonText: {
    color: "#6d5a4e",
    fontSize: 14,
    fontWeight: "700",
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonTextDisabled: {
    color: "#8f8075",
  },
  stack: {
    gap: 16,
    marginTop: 16,
  },
});
