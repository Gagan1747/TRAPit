import { MIN_OPTION_COUNT, validateQuestionDraft } from "@trapit/testing";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { useQuestionBank } from "../testing/question-bank-context";
import { MobileCollapsibleSection } from "./mobile-collapsible-section";

const AI_OCR_PROMPT = `convert the image/text to questions in the following format
-add colon after question, each options, answer
-question, each options and answer should be in separate line
-Each set of 'question, each options and answer' should be separated from other set by a spacing of line`;

const AI_OCR_EXAMPLE = `Question: 5+3?
Option A: 10
Option B: 6
Option C: 9
Option D: 8
Option E: 7
Answer: 8`;

function createEmptyOptions(count: number) {
  return Array.from({ length: count }, () => "");
}

type AdminMobileSection = "author" | "pools" | "question-bank";

export function MobileAdminQuestionWorkspace() {
  const {
    addQuestion,
    clearQuestions,
    createPool,
    isReady,
    loadSamples,
    pools,
    questions,
    removeQuestion,
  } = useQuestionBank();
  const [correctOptionIndex, setCorrectOptionIndex] = useState(0);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [openSection, setOpenSection] = useState<AdminMobileSection | null>(null);
  const [optionCount, setOptionCount] = useState(MIN_OPTION_COUNT);
  const [options, setOptions] = useState<string[]>(createEmptyOptions(MIN_OPTION_COUNT));
  const [poolDescription, setPoolDescription] = useState("");
  const [poolFeedback, setPoolFeedback] = useState<string | null>(null);
  const [poolName, setPoolName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [questionPoolIds, setQuestionPoolIds] = useState<string[]>([]);
  const [selectedQuestionBankPoolId, setSelectedQuestionBankPoolId] = useState<string | null>(null);

  useEffect(() => {
    setSelectedQuestionBankPoolId((currentPoolId) =>
      currentPoolId && pools.some((pool) => pool.id === currentPoolId)
        ? currentPoolId
        : null,
    );
  }, [pools]);

  function toggleSection(section: AdminMobileSection) {
    setOpenSection((currentSection) => (currentSection === section ? null : section));
  }

  function toggleArrayValue(currentValues: string[], value: string) {
    return currentValues.includes(value)
      ? currentValues.filter((currentValue) => currentValue !== value)
      : [...currentValues, value];
  }

  function updateOption(index: number, value: string) {
    setOptions((current) =>
      current.map((option, optionIndex) => (optionIndex === index ? value : option)),
    );
  }

  function resetForm(nextCount = optionCount) {
    setPrompt("");
    setOptionCount(nextCount);
    setOptions(createEmptyOptions(nextCount));
    setCorrectOptionIndex(0);
  }

  function changeOptionCount(nextCount: number) {
    setOptionCount(nextCount);
    setOptions((currentOptions) => {
      if (nextCount > currentOptions.length) {
        return [...currentOptions, ...createEmptyOptions(nextCount - currentOptions.length)];
      }

      return currentOptions.slice(0, nextCount);
    });
    setCorrectOptionIndex((currentIndex) => Math.min(currentIndex, nextCount - 1));
  }

  function handleCreatePool() {
    const nextPool = createPool({ description: poolDescription, name: poolName });

    if (!nextPool) {
      setPoolFeedback("Pool name is required.");
      return;
    }

    setPoolFeedback("Pool created on this device.");
    setPoolName("");
    setPoolDescription("");
    setQuestionPoolIds((currentPoolIds) =>
      currentPoolIds.includes(nextPool.id) ? currentPoolIds : [...currentPoolIds, nextPool.id],
    );
    setSelectedQuestionBankPoolId(nextPool.id);
  }

  function handleAddQuestion() {
    if (!questionPoolIds.length) {
      setFeedback("Select at least one pool before saving the question.");
      return;
    }

    const draft = {
      correctOptionIndex,
      options,
      prompt,
    };
    const validationError = validateQuestionDraft(draft);

    if (validationError) {
      setFeedback(validationError);
      return;
    }

    addQuestion(draft, questionPoolIds);
    setFeedback("Question added to the selected mobile pools.");
    resetForm(optionCount);
  }

  const filteredQuestions = selectedQuestionBankPoolId
    ? questions.filter((question) => question.poolIds.includes(selectedQuestionBankPoolId))
    : [];
  const selectedPool = pools.find((pool) => pool.id === selectedQuestionBankPoolId) ?? null;

  if (!isReady) {
    return null;
  }

  return (
    <View style={styles.stack}>
      <View style={styles.metricRow}>
        <View style={styles.metricCard}>
          <Text style={styles.metricValue}>{pools.length}</Text>
          <Text style={styles.metricLabel}>pools</Text>
        </View>
        <View style={styles.metricCard}>
          <Text style={styles.metricValue}>{questions.length}</Text>
          <Text style={styles.metricLabel}>questions</Text>
        </View>
      </View>

      <MobileCollapsibleSection
        description="Create pools first so the mobile question bank stays organized by topic or chapter."
        eyebrow="Question pools"
        isOpen={openSection === "pools"}
        title="Compact pool overview"
        onToggle={() => toggleSection("pools")}
      >
        <View style={styles.field}>
          <Text style={styles.label}>Pool name</Text>
          <TextInput
            placeholder="Type a pool name"
            placeholderTextColor="#8e7d70"
            style={styles.input}
            value={poolName}
            onChangeText={setPoolName}
          />
        </View>
        <View style={styles.field}>
          <Text style={styles.label}>Description</Text>
          <TextInput
            multiline
            placeholder="Optional notes about this pool"
            placeholderTextColor="#8e7d70"
            style={[styles.input, styles.textareaSmall]}
            value={poolDescription}
            onChangeText={setPoolDescription}
          />
        </View>

        {poolFeedback ? <Text style={styles.meta}>{poolFeedback}</Text> : null}

        <View style={styles.actionRow}>
          <Pressable style={styles.primaryButton} onPress={handleCreatePool}>
            <Text style={styles.primaryButtonText}>Create pool</Text>
          </Pressable>
          <Pressable style={styles.secondaryButton} onPress={loadSamples}>
            <Text style={styles.secondaryButtonText}>Load sample set</Text>
          </Pressable>
        </View>

        {pools.length ? (
          <View style={styles.filterGrid}>
            {pools.map((pool) => (
              <Pressable
                key={pool.id}
                style={[
                  styles.poolCard,
                  selectedQuestionBankPoolId === pool.id && styles.poolCardActive,
                ]}
                onPress={() => setSelectedQuestionBankPoolId(pool.id)}
              >
                <Text style={styles.poolTitle}>{pool.name}</Text>
                <Text style={styles.meta}>{pool.questionIds.length} question{pool.questionIds.length === 1 ? "" : "s"}</Text>
                <Text numberOfLines={2} style={styles.meta}>
                  {pool.description || "No description yet."}
                </Text>
              </Pressable>
            ))}
          </View>
        ) : (
          <Text style={styles.meta}>Create your first pool to start grouping mobile questions.</Text>
        )}
      </MobileCollapsibleSection>

      <MobileCollapsibleSection
        description="Write questions once, assign them to one or more pools, and keep the mobile bank organized."
        eyebrow="Author questions"
        isOpen={openSection === "author"}
        title="Manual question entry"
        onToggle={() => toggleSection("author")}
      >
        <View style={styles.summaryCard}>
          <Text style={styles.cardTitle}>AI prompt for OCR or text conversion</Text>
          <Text style={styles.meta}>
            If the questions are on paper or already in text, send the photo or text to AI and use this exact prompt.
          </Text>
          <Text style={styles.promptBlock}>{AI_OCR_PROMPT}</Text>
          <Text style={styles.meta}>Expected output example:</Text>
          <Text style={styles.promptBlock}>{AI_OCR_EXAMPLE}</Text>
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Question</Text>
          <TextInput
            multiline
            placeholder="Type the question"
            placeholderTextColor="#8e7d70"
            style={[styles.input, styles.textarea]}
            value={prompt}
            onChangeText={setPrompt}
          />
        </View>

        <View style={styles.actionRow}>
          <Pressable
            style={[styles.pill, optionCount === 4 && styles.pillActive]}
            onPress={() => changeOptionCount(4)}
          >
            <Text style={[styles.pillText, optionCount === 4 && styles.pillTextActive]}>4 options</Text>
          </Pressable>
          <Pressable
            style={[styles.pill, optionCount === 5 && styles.pillActive]}
            onPress={() => changeOptionCount(5)}
          >
            <Text style={[styles.pillText, optionCount === 5 && styles.pillTextActive]}>5 options</Text>
          </Pressable>
        </View>

        {options.map((option, index) => (
          <View key={`option-${index}`} style={styles.optionBlock}>
            <View style={styles.fieldGrow}>
              <Text style={styles.label}>Option {index + 1}</Text>
              <TextInput
                placeholder={`Type option ${index + 1}`}
                placeholderTextColor="#8e7d70"
                style={styles.input}
                value={option}
                onChangeText={(value) => updateOption(index, value)}
              />
            </View>
            <Pressable
              style={[styles.pill, correctOptionIndex === index && styles.pillActive]}
              onPress={() => setCorrectOptionIndex(index)}
            >
              <Text style={[styles.pillText, correctOptionIndex === index && styles.pillTextActive]}>Correct</Text>
            </Pressable>
          </View>
        ))}

        <View style={styles.field}>
          <Text style={styles.label}>Assign to pools</Text>
          <View style={styles.filterGrid}>
            {pools.map((pool) => (
              <Pressable
                key={pool.id}
                style={[
                  styles.selectionCard,
                  questionPoolIds.includes(pool.id) && styles.selectionCardActive,
                ]}
                onPress={() =>
                  setQuestionPoolIds((currentPoolIds) => toggleArrayValue(currentPoolIds, pool.id))
                }
              >
                <Text
                  style={[
                    styles.selectionTitle,
                    questionPoolIds.includes(pool.id) && styles.selectionTitleActive,
                  ]}
                >
                  {pool.name}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        {feedback ? <Text style={styles.meta}>{feedback}</Text> : null}

        <View style={styles.actionRow}>
          <Pressable style={styles.primaryButton} onPress={handleAddQuestion}>
            <Text style={styles.primaryButtonText}>Add question</Text>
          </Pressable>
          <Pressable style={styles.secondaryButton} onPress={() => resetForm(optionCount)}>
            <Text style={styles.secondaryButtonText}>Reset form</Text>
          </Pressable>
        </View>
      </MobileCollapsibleSection>

      <MobileCollapsibleSection
        action={questions.length ? (
          <Pressable style={styles.secondaryButton} onPress={clearQuestions}>
            <Text style={styles.secondaryButtonText}>Clear all</Text>
          </Pressable>
        ) : null}
        description="Choose a pool first, then browse only its questions in a tighter mobile-friendly layout."
        eyebrow="Question bank"
        isOpen={openSection === "question-bank"}
        title={`${questions.length} saved questions`}
        onToggle={() => toggleSection("question-bank")}
      >
        <View style={styles.filterGrid}>
          {pools.map((pool) => (
            <Pressable
              key={`filter-${pool.id}`}
              style={[
                styles.poolCard,
                selectedQuestionBankPoolId === pool.id && styles.poolCardActive,
              ]}
              onPress={() => setSelectedQuestionBankPoolId(pool.id)}
            >
              <Text style={styles.poolTitle}>{pool.name}</Text>
              <Text style={styles.meta}>{pool.questionIds.length} question{pool.questionIds.length === 1 ? "" : "s"}</Text>
            </Pressable>
          ))}
        </View>

        {selectedPool ? (
          <View style={styles.summaryCard}>
            <Text style={styles.cardTitle}>{selectedPool.name}</Text>
            <Text style={styles.meta}>{selectedPool.description || "No description yet."}</Text>
            <Text style={styles.meta}>{filteredQuestions.length} visible question{filteredQuestions.length === 1 ? "" : "s"}</Text>
          </View>
        ) : (
          <Text style={styles.meta}>Select a pool to display only the questions inside it.</Text>
        )}

        {selectedQuestionBankPoolId && filteredQuestions.length ? (
          <View style={styles.list}>
            {filteredQuestions.map((question, index) => (
              <View key={question.id} style={styles.compactQuestionCard}>
                <View style={styles.spaceBetween}>
                  <Text style={styles.cardTitle}>Q{index + 1}</Text>
                  <Pressable style={styles.secondaryButton} onPress={() => removeQuestion(question.id)}>
                    <Text style={styles.secondaryButtonText}>Remove</Text>
                  </Pressable>
                </View>
                <Text style={styles.questionPrompt}>{question.prompt}</Text>
                <View style={styles.optionListCompact}>
                  {question.options.map((option, optionIndex) => (
                    <Text key={`${question.id}-${optionIndex}`} style={styles.meta}>
                      {optionIndex + 1}. {option}
                      {optionIndex === question.correctOptionIndex ? " (correct)" : ""}
                    </Text>
                  ))}
                </View>
              </View>
            ))}
          </View>
        ) : selectedQuestionBankPoolId ? (
          <Text style={styles.meta}>No questions are assigned to this pool yet.</Text>
        ) : null}
      </MobileCollapsibleSection>
    </View>
  );
}

const styles = StyleSheet.create({
  actionRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  cardTitle: {
    color: "#231712",
    fontSize: 16,
    fontWeight: "700",
  },
  compactQuestionCard: {
    backgroundColor: "#fffaf5",
    borderColor: "#d7c3af",
    borderRadius: 18,
    borderWidth: 1,
    gap: 8,
    padding: 12,
  },
  field: {
    gap: 8,
  },
  fieldGrow: {
    flex: 1,
    gap: 8,
  },
  filterGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  input: {
    backgroundColor: "#fffaf5",
    borderColor: "#d7c3af",
    borderRadius: 14,
    borderWidth: 1,
    fontSize: 15,
    minHeight: 48,
    paddingHorizontal: 14,
  },
  label: {
    color: "#231712",
    fontSize: 14,
    fontWeight: "700",
  },
  list: {
    gap: 12,
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
  optionBlock: {
    alignItems: "flex-end",
    flexDirection: "row",
    gap: 10,
  },
  optionListCompact: {
    gap: 4,
  },
  promptBlock: {
    backgroundColor: "rgba(255, 248, 240, 0.92)",
    borderColor: "#d7c3af",
    borderRadius: 14,
    borderWidth: 1,
    color: "#231712",
    fontSize: 14,
    lineHeight: 20,
    padding: 12,
  },
  pill: {
    alignItems: "center",
    backgroundColor: "#fffaf5",
    borderColor: "#d7c3af",
    borderRadius: 999,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 44,
    paddingHorizontal: 16,
  },
  pillActive: {
    backgroundColor: "#b44c2f",
    borderColor: "#b44c2f",
  },
  pillText: {
    color: "#3b2d26",
    fontWeight: "600",
  },
  pillTextActive: {
    color: "#ffffff",
  },
  poolCard: {
    backgroundColor: "#fffaf5",
    borderColor: "#d7c3af",
    borderRadius: 18,
    borderWidth: 1,
    gap: 4,
    minWidth: 150,
    padding: 12,
  },
  poolCardActive: {
    backgroundColor: "rgba(180, 76, 47, 0.12)",
    borderColor: "#b44c2f",
  },
  poolTitle: {
    color: "#231712",
    fontSize: 15,
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
  secondaryButton: {
    alignItems: "center",
    backgroundColor: "#fffaf5",
    borderColor: "#d7c3af",
    borderRadius: 999,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 44,
    paddingHorizontal: 16,
  },
  secondaryButtonText: {
    color: "#6d5a4e",
    fontWeight: "600",
  },
  selectionCard: {
    backgroundColor: "#fffaf5",
    borderColor: "#d7c3af",
    borderRadius: 16,
    borderWidth: 1,
    minWidth: 120,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  selectionCardActive: {
    backgroundColor: "#b44c2f",
    borderColor: "#b44c2f",
  },
  selectionTitle: {
    color: "#3b2d26",
    fontWeight: "600",
  },
  selectionTitleActive: {
    color: "#ffffff",
  },
  spaceBetween: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
    justifyContent: "space-between",
  },
  stack: {
    gap: 16,
    marginTop: 16,
  },
  summaryCard: {
    backgroundColor: "#fffaf5",
    borderColor: "#d7c3af",
    borderRadius: 18,
    borderWidth: 1,
    gap: 6,
    padding: 14,
  },
  textarea: {
    minHeight: 110,
    paddingTop: 14,
    textAlignVertical: "top",
  },
  textareaSmall: {
    minHeight: 84,
    paddingTop: 14,
    textAlignVertical: "top",
  },
});