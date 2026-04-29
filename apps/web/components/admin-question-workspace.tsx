"use client";

import {
  createEmptyTestingWorkspaceState,
  formatElapsedTime,
  type GroupJoinRequest,
  validateQuestionDraft,
  type BulkImportPreview,
  type ParticipantGroup,
  type ParticipantProfile,
  type PersistentQuestion,
  type QuestionPool,
  type ScheduledTest,
  type TestLeaderboard,
  type TestHistoryEntry,
} from "@trapit/testing";
import { useEffect, useState } from "react";

import { formatShortDate, formatShortDateTime } from "../lib/date-format";
import { CollapsibleWorkspaceSection } from "./collapsible-workspace-section";

const MANUAL_OPTION_COUNT = 5;

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

function createDefaultScheduleTime() {
  const date = new Date(Date.now() + 60 * 60 * 1000);
  const timezoneOffsetMs = date.getTimezoneOffset() * 60 * 1000;

  return new Date(date.getTime() - timezoneOffsetMs).toISOString().slice(0, 16);
}

type QuestionApiResponse = {
  questions: PersistentQuestion[];
};

type QuestionMutationPayload =
  | {
      draft: {
        correctOptionIndex: number;
        options: string[];
        prompt: string;
      };
      mode: "create";
      poolIds: string[];
    }
  | {
      drafts: Array<{
        correctOptionIndex: number;
        options: string[];
        prompt: string;
      }>;
      mode: "import";
      poolIds: string[];
    }
  | {
      mode: "sample-set";
      poolIds: string[];
      replaceExisting?: boolean;
    };

type PoolsResponse = {
  pools: QuestionPool[];
};

type ParticipantsResponse = {
  groupJoinRequests: GroupJoinRequest[];
  participantGroups: ParticipantGroup[];
  participants: ParticipantProfile[];
};

type ScheduledTestsResponse = {
  scheduledTests: ScheduledTest[];
};

type HistoryResponse = {
  history: TestHistoryEntry[];
  leaderboards: TestLeaderboard[];
  summary: {
    attempts: number;
    groups: number;
    participants: number;
    pools: number;
    questions: number;
    scheduledTests: number;
  };
};

type AdminTestReviewResponse = {
  review: Array<{
    correctOptionIndex: number;
    optionSelectionCounts: number[];
    options: string[];
    prompt: string;
    questionId: string;
    totalResponses: number;
  }>;
  submittedCount: number;
  testId: string;
  testTitle: string;
};

type AdminWorkspaceSection =
  | "assigned-tests"
  | "author"
  | "history"
  | "participants"
  | "pools"
  | "question-bank"
  | "schedule";

type AuthorMode = "manual" | "ocr";

type EditableQuestionDraft = {
  correctOptionIndex: number;
  options: string[];
  prompt: string;
};

type EditableGroupDraft = {
  name: string;
  participantIds: string[];
};

const adminTestStatusPriority: Record<ScheduledTest["status"], number> = {
  live: 0,
  scheduled: 1,
  completed: 2,
};

type ParticipantSearchPickerProps = {
  emptyMessage: string;
  inputId: string;
  participants: ParticipantProfile[];
  searchPlaceholder: string;
  selectedIds: string[];
  selectionLabel: string;
  onChange: (participantIds: string[]) => void;
};

async function readJson<T>(response: Response): Promise<T> {
  const payload = (await response.json()) as T & { error?: string };

  if (!response.ok) {
    throw new Error((payload as { error?: string }).error ?? "Request failed.");
  }

  return payload;
}

function normalizeParticipantIdentifier(value: string) {
  return value.trim().toLowerCase();
}

function getParticipantIdentifierCandidates(value: string) {
  const normalized = normalizeParticipantIdentifier(value);
  const compact = normalized.replace(/[\s()-]/g, "");
  const digitsOnly = compact.replace(/\D/g, "");
  const candidates = new Set<string>([normalized, compact]);

  if (digitsOnly) {
    candidates.add(digitsOnly);

    if (digitsOnly.length > 10) {
      candidates.add(digitsOnly.slice(-10));
    }
  }

  return candidates;
}

function participantIdentifiersMatch(left: string, right: string) {
  const leftCandidates = getParticipantIdentifierCandidates(left);

  return Array.from(getParticipantIdentifierCandidates(right)).some((candidate) =>
    leftCandidates.has(candidate),
  );
}

function formatParticipantName(
  identifier: string,
  participants: ParticipantProfile[],
) {
  const participant = participants.find(
    (entry) => participantIdentifiersMatch(entry.identifier, identifier),
  );

  if (!participant) {
    return identifier;
  }

  return participant.label && participant.label !== participant.identifier
    ? `${participant.label} (${participant.identifier})`
    : participant.label || participant.identifier;
}

function formatResultParticipantName(
  identifier: string,
  participantName: string | undefined,
  participants: ParticipantProfile[],
) {
  const fallbackName = formatParticipantName(identifier, participants);

  return participantName?.trim()
    ? `${participantName.trim()} (${fallbackName})`
    : fallbackName;
}

function matchesParticipantSearch(participant: ParticipantProfile, query: string) {
  const normalizedQuery = query.trim().toLowerCase();

  if (!normalizedQuery) {
    return true;
  }

  return [participant.label, participant.identifier]
    .filter(Boolean)
    .some((value) => value.toLowerCase().includes(normalizedQuery));
}

function ParticipantSearchPicker({
  emptyMessage,
  inputId,
  participants,
  searchPlaceholder,
  selectedIds,
  selectionLabel,
  onChange,
}: ParticipantSearchPickerProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const selectedParticipants = selectedIds
    .map((participantId) => participants.find((participant) => participant.id === participantId))
    .filter((participant): participant is ParticipantProfile => Boolean(participant));
  const filteredParticipants = participants
    .filter((participant) => !selectedIds.includes(participant.id))
    .filter((participant) => matchesParticipantSearch(participant, searchQuery))
    .slice(0, 8);

  function addParticipant(participantId: string) {
    onChange([...selectedIds, participantId]);
    setSearchQuery("");
  }

  function removeParticipant(participantId: string) {
    onChange(selectedIds.filter((currentId) => currentId !== participantId));
  }

  return (
    <div className="field">
      <label htmlFor={inputId}>{selectionLabel}</label>
      <input
        id={inputId}
        placeholder={searchPlaceholder}
        value={searchQuery}
        onChange={(event) => setSearchQuery(event.target.value)}
      />

      {participants.length ? (
        filteredParticipants.length ? (
          <div className="search-dropdown-list">
            {filteredParticipants.map((participant) => (
              <button
                className="search-dropdown-item"
                key={`${inputId}-${participant.id}`}
                type="button"
                onClick={() => addParticipant(participant.id)}
              >
                <span>{participant.label}</span>
                <span className="muted-text">{participant.identifier}</span>
              </button>
            ))}
          </div>
        ) : searchQuery.trim() ? (
          <p className="muted-text">No matching participants found.</p>
        ) : null
      ) : (
        <p className="muted-text">Add participants first, then include them in a group.</p>
      )}

      {selectedParticipants.length ? (
        <div className="selected-token-list">
          {selectedParticipants.map((participant) => (
            <button
              className="selected-token"
              key={`${inputId}-selected-${participant.id}`}
              type="button"
              onClick={() => removeParticipant(participant.id)}
            >
              <span>{participant.label}</span>
              <span className="muted-text">{participant.identifier}</span>
            </button>
          ))}
        </div>
      ) : (
        <p className="muted-text">{emptyMessage}</p>
      )}
    </div>
  );
}

type AdminQuestionWorkspaceProps = {
  currentAdminIdentifier: string | null;
};

export function AdminQuestionWorkspace({ currentAdminIdentifier }: AdminQuestionWorkspaceProps) {
  const [authorMode, setAuthorMode] = useState<AuthorMode>("manual");
  const [correctOptionIndex, setCorrectOptionIndex] = useState(0);
  const [editingGroupDraft, setEditingGroupDraft] = useState<EditableGroupDraft | null>(null);
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [editingQuestionDraft, setEditingQuestionDraft] = useState<EditableQuestionDraft | null>(null);
  const [editingQuestionId, setEditingQuestionId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [groupFeedback, setGroupFeedback] = useState<string | null>(null);
  const [groupJoinRequests, setGroupJoinRequests] = useState<GroupJoinRequest[]>([]);
  const [groupName, setGroupName] = useState("");
  const [history, setHistory] = useState<TestHistoryEntry[]>([]);
  const [importFeedback, setImportFeedback] = useState<string | null>(null);
  const [importPreview, setImportPreview] = useState<BulkImportPreview | null>(null);
  const [importText, setImportText] = useState("");
  const [isImporting, setIsImporting] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isMutating, setIsMutating] = useState(false);
  const [leaderboards, setLeaderboards] = useState<TestLeaderboard[]>([]);
  const [openSection, setOpenSection] = useState<AdminWorkspaceSection | null>(null);
  const [options, setOptions] = useState<string[]>(createEmptyOptions(MANUAL_OPTION_COUNT));
  const [participantGroups, setParticipantGroups] = useState<ParticipantGroup[]>([]);
  const [participants, setParticipants] = useState<ParticipantProfile[]>([]);
  const [poolFeedback, setPoolFeedback] = useState<string | null>(null);
  const [poolName, setPoolName] = useState("");
  const [pools, setPools] = useState<QuestionPool[]>([]);
  const [prompt, setPrompt] = useState("");
  const [authorPoolId, setAuthorPoolId] = useState("");
  const [selectedQuestionBankPoolId, setSelectedQuestionBankPoolId] = useState<string | null>(null);
  const [questions, setQuestions] = useState<PersistentQuestion[]>(
    createEmptyTestingWorkspaceState().questions,
  );
  const [reviewByTestId, setReviewByTestId] = useState<Record<string, AdminTestReviewResponse>>({});
  const [reviewLoadingByTestId, setReviewLoadingByTestId] = useState<Record<string, boolean>>({});
  const [scheduleDurationMinutes, setScheduleDurationMinutes] = useState("30");
  const [scheduleFeedback, setScheduleFeedback] = useState<string | null>(null);
  const [scheduleParticipantGroupIds, setScheduleParticipantGroupIds] = useState<string[]>([]);
  const [scheduleParticipantIds, setScheduleParticipantIds] = useState<string[]>([]);
  const [schedulePoolId, setSchedulePoolId] = useState("");
  const [scheduleQuestionCount, setScheduleQuestionCount] = useState("1");
  const [scheduleStartMode, setScheduleStartMode] = useState<"later" | "now">("now");
  const [scheduleStartsAtInput, setScheduleStartsAtInput] = useState(createDefaultScheduleTime());
  const [scheduledTests, setScheduledTests] = useState<ScheduledTest[]>([]);
  const [selectedGroupParticipantIds, setSelectedGroupParticipantIds] = useState<string[]>([]);
  const [summary, setSummary] = useState<HistoryResponse["summary"]>({
    attempts: 0,
    groups: 0,
    participants: 0,
    pools: 0,
    questions: 0,
    scheduledTests: 0,
  });
  const [visibleReviewTestIds, setVisibleReviewTestIds] = useState<string[]>([]);

  async function loadWorkspace() {
    setIsLoading(true);

    try {
      const [questionsPayload, poolsPayload, participantsPayload, testsPayload, historyPayload] =
        await Promise.all([
          readJson<QuestionApiResponse>(await fetch("/api/admin/questions")),
          readJson<PoolsResponse>(await fetch("/api/admin/pools")),
          readJson<ParticipantsResponse>(await fetch("/api/admin/participants")),
          readJson<ScheduledTestsResponse>(await fetch("/api/admin/tests")),
          readJson<HistoryResponse>(await fetch("/api/admin/history")),
        ]);

      setQuestions(questionsPayload.questions);
      setPools(poolsPayload.pools);
      setParticipants(participantsPayload.participants);
      setParticipantGroups(participantsPayload.participantGroups);
      setGroupJoinRequests(participantsPayload.groupJoinRequests);
      setScheduledTests(testsPayload.scheduledTests);
      setHistory(historyPayload.history);
      setLeaderboards(historyPayload.leaderboards);
      setSummary(historyPayload.summary);

      if (!schedulePoolId && poolsPayload.pools.length) {
        setSchedulePoolId(poolsPayload.pools[0].id);
      }

      if (!authorPoolId && poolsPayload.pools.length) {
        setAuthorPoolId(poolsPayload.pools[0].id);
      }

      setSelectedQuestionBankPoolId((currentPoolId) =>
        currentPoolId && poolsPayload.pools.some((pool) => pool.id === currentPoolId)
          ? currentPoolId
          : null,
      );
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Unable to load the admin workspace.");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void loadWorkspace();
  }, []);

  function resetQuestionForm(nextCount = MANUAL_OPTION_COUNT) {
    setPrompt("");
    setOptions(createEmptyOptions(nextCount));
    setCorrectOptionIndex(0);
  }

  function updateOption(index: number, value: string) {
    setOptions((currentOptions) =>
      currentOptions.map((option, optionIndex) =>
        optionIndex === index ? value : option,
      ),
    );
  }

  function updateEditableOption(index: number, value: string) {
    setEditingQuestionDraft((currentDraft) => {
      if (!currentDraft) {
        return currentDraft;
      }

      return {
        ...currentDraft,
        options: currentDraft.options.map((option, optionIndex) =>
          optionIndex === index ? value : option,
        ),
      };
    });
  }

  function handleEditableOptionCountChange(nextCount: number) {
    setEditingQuestionDraft((currentDraft) => {
      if (!currentDraft) {
        return currentDraft;
      }

      const nextOptions =
        nextCount > currentDraft.options.length
          ? [...currentDraft.options, ...createEmptyOptions(nextCount - currentDraft.options.length)]
          : currentDraft.options.slice(0, nextCount);

      return {
        ...currentDraft,
        correctOptionIndex: Math.min(currentDraft.correctOptionIndex, nextCount - 1),
        options: nextOptions,
      };
    });
  }

  function toggleArrayValue(currentValues: string[], value: string) {
    return currentValues.includes(value)
      ? currentValues.filter((currentValue) => currentValue !== value)
      : [...currentValues, value];
  }

  function toggleSection(section: AdminWorkspaceSection) {
    setOpenSection((currentSection) =>
      currentSection === section ? null : section,
    );
  }

  function toggleReviewVisibility(testId: string) {
    setVisibleReviewTestIds((currentIds) =>
      currentIds.includes(testId)
        ? currentIds.filter((currentId) => currentId !== testId)
        : [...currentIds, testId],
    );
  }

  async function mutateWorkspace(work: () => Promise<void>) {
    setIsMutating(true);

    try {
      await work();
      await loadWorkspace();
    } finally {
      setIsMutating(false);
    }
  }

  async function handleLoadReview(testId: string) {
    if (reviewByTestId[testId]) {
      toggleReviewVisibility(testId);
      return;
    }

    setReviewLoadingByTestId((currentState) => ({
      ...currentState,
      [testId]: true,
    }));

    try {
      const payload = await readJson<AdminTestReviewResponse>(
        await fetch(`/api/admin/tests/${testId}/review`),
      );

      setReviewByTestId((currentReviews) => ({
        ...currentReviews,
        [testId]: payload,
      }));
      setVisibleReviewTestIds((currentIds) => [...new Set([...currentIds, testId])]);
      setFeedback(null);
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Unable to load the test review.");
    } finally {
      setReviewLoadingByTestId((currentState) => ({
        ...currentState,
        [testId]: false,
      }));
    }
  }

  function handleAddQuestion() {
    if (!pools.length || !authorPoolId) {
      setFeedback("Create a pool and select a question pool before saving a question.");
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

    void mutateWorkspace(async () => {
      await readJson<QuestionApiResponse>(
        await fetch("/api/admin/questions", {
          body: JSON.stringify({
            draft,
            mode: "create",
            poolIds: [authorPoolId],
          } satisfies QuestionMutationPayload),
          headers: {
            "Content-Type": "application/json",
          },
          method: "POST",
        }),
      );

      setFeedback("Question saved to the shared admin bank.");
      resetQuestionForm();
    }).catch((error) => {
      setFeedback(error instanceof Error ? error.message : "Unable to save the question.");
    });
  }

  function handleDeleteQuestion(questionId: string) {
    void mutateWorkspace(async () => {
      await readJson<QuestionApiResponse>(
        await fetch(`/api/admin/questions/${questionId}`, {
          method: "DELETE",
        }),
      );

      setFeedback("Question removed from the shared bank.");
    }).catch((error) => {
      setFeedback(error instanceof Error ? error.message : "Unable to remove the question.");
    });
  }

  function handleStartEditingQuestion(question: PersistentQuestion) {
    setEditingQuestionId(question.id);
    setEditingQuestionDraft({
      correctOptionIndex: question.correctOptionIndex,
      options: [...question.options],
      prompt: question.prompt,
    });
    setFeedback(null);
  }

  function handleCancelEditingQuestion() {
    setEditingQuestionId(null);
    setEditingQuestionDraft(null);
  }

  function handleSaveEditedQuestion(questionId: string) {
    if (editingQuestionId !== questionId || !editingQuestionDraft) {
      return;
    }

    const validationError = validateQuestionDraft(editingQuestionDraft);

    if (validationError) {
      setFeedback(validationError);
      return;
    }

    void mutateWorkspace(async () => {
      await readJson<QuestionApiResponse>(
        await fetch(`/api/admin/questions/${questionId}`, {
          body: JSON.stringify({ draft: editingQuestionDraft }),
          headers: {
            "Content-Type": "application/json",
          },
          method: "PATCH",
        }),
      );

      setEditingQuestionId(null);
      setEditingQuestionDraft(null);
      setFeedback("Question updated.");
    }).catch((error) => {
      setFeedback(error instanceof Error ? error.message : "Unable to update the question.");
    });
  }

  function handleLoadSamples() {
    if (!pools.length || !authorPoolId) {
      setFeedback("Create a pool and select a question pool before loading sample questions.");
      return;
    }

    void mutateWorkspace(async () => {
      await readJson<QuestionApiResponse>(
        await fetch("/api/admin/questions", {
          body: JSON.stringify({
            mode: "sample-set",
            poolIds: [authorPoolId],
            replaceExisting: true,
          } satisfies QuestionMutationPayload),
          headers: {
            "Content-Type": "application/json",
          },
          method: "POST",
        }),
      );

      setFeedback("Loaded the sample set into the shared admin bank.");
    }).catch((error) => {
      setFeedback(error instanceof Error ? error.message : "Unable to load the sample set.");
    });
  }

  function handlePreviewImport() {
    if (!importText.trim()) {
      setImportFeedback("Paste OCR text before previewing the import.");
      setImportPreview(null);
      return;
    }

    setIsImporting(true);
    setImportFeedback(null);

    void (async () => {
      try {
        const payload = await readJson<BulkImportPreview>(
          await fetch("/api/admin/questions/import/preview", {
            body: JSON.stringify({ text: importText }),
            headers: {
              "Content-Type": "application/json",
            },
            method: "POST",
          }),
        );

        setImportPreview(payload);

        if (!payload.totalCount) {
          setImportFeedback("No question blocks were detected. Separate each question with a blank line.");
          return;
        }

        setImportFeedback(
          `${payload.validCount} valid question${payload.validCount === 1 ? "" : "s"} ready and ${payload.invalidCount} need review.`,
        );
      } catch (error) {
        setImportFeedback(
          error instanceof Error ? error.message : "Unable to preview the OCR import.",
        );
      } finally {
        setIsImporting(false);
      }
    })();
  }

  function handleKeepValidBlocks() {
    if (!importPreview) {
      return;
    }

    const nextText = importPreview.candidates
      .filter((candidate) => candidate.valid)
      .map((candidate) => candidate.rawText.trim())
      .join("\n\n");

    setImportText(nextText);
    setImportPreview(null);
    setImportFeedback(
      nextText
        ? "Kept only valid blocks. Review the text and preview again if needed."
        : "No valid blocks were available to keep.",
    );
  }

  function handleCommitImport() {
    if (!pools.length || !authorPoolId) {
      setImportFeedback("Create a pool and select a question pool before importing questions.");
      return;
    }

    if (!importPreview?.validCount) {
      setImportFeedback("Preview valid questions before importing.");
      return;
    }

    const drafts = importPreview.candidates
      .filter((candidate) => candidate.valid)
      .map((candidate) => candidate.draft);

    void mutateWorkspace(async () => {
      await readJson<QuestionApiResponse>(
        await fetch("/api/admin/questions", {
          body: JSON.stringify({
            drafts,
            mode: "import",
            poolIds: [authorPoolId],
          } satisfies QuestionMutationPayload),
          headers: {
            "Content-Type": "application/json",
          },
          method: "POST",
        }),
      );

      setImportFeedback(
        `Imported ${drafts.length} question${drafts.length === 1 ? "" : "s"} into the shared admin bank.`,
      );
      setImportPreview(null);
      setImportText("");
    }).catch((error) => {
      setImportFeedback(
        error instanceof Error ? error.message : "Unable to import the previewed questions.",
      );
    });
  }

  function handleClearAll() {
    void mutateWorkspace(async () => {
      await readJson<QuestionApiResponse>(
        await fetch("/api/admin/questions", {
          method: "DELETE",
        }),
      );

      setFeedback("Cleared the shared admin bank and related schedules.");
    }).catch((error) => {
      setFeedback(error instanceof Error ? error.message : "Unable to clear the question bank.");
    });
  }

  function handleCreatePool() {
    if (!poolName.trim()) {
      setPoolFeedback("Pool name is required.");
      return;
    }

    void mutateWorkspace(async () => {
      const payload = await readJson<PoolsResponse>(
        await fetch("/api/admin/pools", {
          body: JSON.stringify({ name: poolName }),
          headers: {
            "Content-Type": "application/json",
          },
          method: "POST",
        }),
      );
      const newestPool = payload.pools[0];

      if (newestPool) {
        setAuthorPoolId(newestPool.id);
        setSchedulePoolId(newestPool.id);
      }

      setPoolFeedback("Pool created.");
      setPoolName("");
    }).catch((error) => {
      setPoolFeedback(error instanceof Error ? error.message : "Unable to create the pool.");
    });
  }

  function handleCreateGroup() {
    if (!groupName.trim()) {
      setGroupFeedback("Group or class name is required.");
      return;
    }

    if (!selectedGroupParticipantIds.length) {
      setGroupFeedback("Select at least one participant for the group or class.");
      return;
    }

    void mutateWorkspace(async () => {
      await readJson<ParticipantsResponse>(
        await fetch("/api/admin/participants", {
          body: JSON.stringify({
            mode: "create-group",
            name: groupName,
            participantIds: selectedGroupParticipantIds,
          }),
          headers: {
            "Content-Type": "application/json",
          },
          method: "POST",
        }),
      );

      setGroupFeedback("Group or class created.");
      setGroupName("");
      setSelectedGroupParticipantIds([]);
    }).catch((error) => {
      setGroupFeedback(error instanceof Error ? error.message : "Unable to create the group.");
    });
  }

  function handleStartEditingGroup(group: ParticipantGroup) {
    setEditingGroupId(group.id);
    setEditingGroupDraft({
      name: group.name,
      participantIds: [...group.participantIds],
    });
    setGroupFeedback(null);
  }

  function handleCancelEditingGroup() {
    setEditingGroupId(null);
    setEditingGroupDraft(null);
  }

  function handleSaveGroup() {
    if (!editingGroupId || !editingGroupDraft) {
      return;
    }

    if (!editingGroupDraft.name.trim()) {
      setGroupFeedback("Group or class name is required.");
      return;
    }

    void mutateWorkspace(async () => {
      await readJson<ParticipantsResponse>(
        await fetch("/api/admin/participants", {
          body: JSON.stringify({
            groupId: editingGroupId,
            mode: "update-group",
            name: editingGroupDraft.name,
            participantIds: editingGroupDraft.participantIds,
          }),
          headers: {
            "Content-Type": "application/json",
          },
          method: "POST",
        }),
      );

      setGroupFeedback("Group updated.");
      setEditingGroupId(null);
      setEditingGroupDraft(null);
    }).catch((error) => {
      setGroupFeedback(error instanceof Error ? error.message : "Unable to update the group.");
    });
  }

  function handleScheduleTest() {
    if (!schedulePoolId) {
      setScheduleFeedback("Select a question pool first.");
      return;
    }

    const durationMinutes = Number(scheduleDurationMinutes);
    const questionCount = Number(scheduleQuestionCount);
    const startsAt =
      scheduleStartMode === "now"
        ? new Date().toISOString()
        : new Date(scheduleStartsAtInput).toISOString();

    if (!Number.isFinite(durationMinutes) || durationMinutes < 1) {
      setScheduleFeedback("Duration must be at least 1 minute.");
      return;
    }

    if (!Number.isFinite(questionCount) || questionCount < 1) {
      setScheduleFeedback("Question count must be at least 1.");
      return;
    }

    if (
      scheduleStartMode === "later" &&
      (!scheduleStartsAtInput || Number.isNaN(new Date(scheduleStartsAtInput).getTime()))
    ) {
      setScheduleFeedback("Choose a valid future date and time.");
      return;
    }

    void mutateWorkspace(async () => {
      await readJson<ScheduledTestsResponse>(
        await fetch("/api/admin/tests", {
          body: JSON.stringify({
            durationMinutes,
            participantGroupIds: scheduleParticipantGroupIds,
            participantIds: scheduleParticipantIds,
            poolId: schedulePoolId,
            questionCount,
            startsAt,
          }),
          headers: {
            "Content-Type": "application/json",
          },
          method: "POST",
        }),
      );

      setScheduleFeedback("Test scheduled.");
      setScheduleDurationMinutes("30");
      setScheduleParticipantGroupIds([]);
      setScheduleParticipantIds([]);
      setScheduleQuestionCount("1");
      setScheduleStartMode("now");
      setScheduleStartsAtInput(createDefaultScheduleTime());
    }).catch((error) => {
      setScheduleFeedback(error instanceof Error ? error.message : "Unable to schedule the test.");
    });
  }

  const selectedPool = pools.find((pool) => pool.id === schedulePoolId) ?? null;
  const selectedQuestionBankPool = pools.find((pool) => pool.id === selectedQuestionBankPoolId) ?? null;
  const sortedScheduledTests = [...scheduledTests].sort((leftTest, rightTest) => {
    const priorityDifference =
      adminTestStatusPriority[leftTest.status] - adminTestStatusPriority[rightTest.status];

    if (priorityDifference !== 0) {
      return priorityDifference;
    }

    return new Date(rightTest.startsAt).getTime() - new Date(leftTest.startsAt).getTime();
  });
  const filteredQuestionBankQuestions = selectedQuestionBankPoolId
    ? questions.filter((question) => question.poolIds.includes(selectedQuestionBankPoolId))
    : [];
  const scheduledTestsByStatus: Array<{
    description: string;
    key: ScheduledTest["status"];
    label: string;
    tests: ScheduledTest[];
  }> = [
    {
      description: "Currently open tests and in-progress submissions",
      key: "live",
      label: "Live tests",
      tests: sortedScheduledTests.filter((test) => test.status === "live"),
    },
    {
      description: "Tests that are scheduled but not open yet",
      key: "scheduled",
      label: "Upcoming tests",
      tests: sortedScheduledTests.filter((test) => test.status === "scheduled"),
    },
    {
      description: "Completed tests with final results and question review",
      key: "completed",
      label: "Completed tests",
      tests: sortedScheduledTests.filter((test) => test.status === "completed"),
    },
  ];
  const assignedTests = currentAdminIdentifier
    ? sortedScheduledTests.filter((test) =>
        test.resolvedParticipantIdentifiers.some((identifier) =>
          participantIdentifiersMatch(identifier, currentAdminIdentifier),
        ),
      )
    : [];

  function handleResolveGroupRequest(requestId: string, decision: "accept" | "reject") {
    void mutateWorkspace(async () => {
      await readJson<ParticipantsResponse>(
        await fetch("/api/admin/participants", {
          body: JSON.stringify({
            decision,
            mode: "resolve-request",
            requestId,
          }),
          headers: {
            "Content-Type": "application/json",
          },
          method: "POST",
        }),
      );

      setGroupFeedback(
        decision === "accept" ? "Request accepted and participant added to the group." : "Request rejected.",
      );
    }).catch((error) => {
      setGroupFeedback(error instanceof Error ? error.message : "Unable to update the request.");
    });
  }

  return (
    <div className="workspace-stack">
      <section className="panel workspace-card">
        <div className="section-head compact-head">
          <div>
            <p className="eyebrow">Web admin rollout</p>
            <h2 className="section-title">Questions, pools, scheduling, and history</h2>
          </div>
          <div className="metric-inline">
            <span className="status-chip success">{summary.questions} questions</span>
            <span className="status-chip success">{summary.pools} pools</span>
            <span className="status-chip success">{summary.scheduledTests} tests</span>
          </div>
        </div>

        <div className="metric-row">
          <div className="metric-card">
            <strong>{summary.participants}</strong>
            <span>participants</span>
          </div>
          <div className="metric-card">
            <strong>{summary.groups}</strong>
            <span>groups or classes</span>
          </div>
          <div className="metric-card">
            <strong>{summary.attempts}</strong>
            <span>submitted attempts</span>
          </div>
        </div>
      </section>

      <CollapsibleWorkspaceSection
        eyebrow=""
        isOpen={openSection === "author"}
        sectionId="admin-author-questions"
        title="Add Questions"
        onToggle={() => toggleSection("author")}
      >
        <div className="form-stack">
          <div className="field">
            <label>Assign questions to pools</label>
            <div className="question-list">
              <div className="field compact-field">
                <label htmlFor="author-pool">Question pool</label>
                <select
                  className="select-field"
                  id="author-pool"
                  value={authorPoolId}
                  onChange={(event) => setAuthorPoolId(event.target.value)}
                >
                  <option value="">Select a pool</option>
                  {pools.map((pool) => (
                    <option key={pool.id} value={pool.id}>
                      {pool.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="role-option role-option-create">
                <div className="field compact-field">
                  <label htmlFor="pool-name-inline">Create question pool</label>
                  <input
                    id="pool-name-inline"
                    placeholder="Pool name"
                    value={poolName}
                    onChange={(event) => setPoolName(event.target.value)}
                  />
                </div>
                <button className="button-secondary small-button" disabled={isMutating} type="button" onClick={handleCreatePool}>
                  Create pool
                </button>
              </div>
            </div>
          </div>

          {poolFeedback ? <p className="muted-text">{poolFeedback}</p> : null}
          {feedback ? <p className="muted-text">{feedback}</p> : null}

          <div className="field">
            <label>Question input method</label>
            <div className="inline-actions">
              <label className="radio-chip">
                <input
                  checked={authorMode === "manual"}
                  name="author-mode"
                  type="radio"
                  onChange={() => setAuthorMode("manual")}
                />
                Manual entry
              </label>
              <label className="radio-chip">
                <input
                  checked={authorMode === "ocr"}
                  name="author-mode"
                  type="radio"
                  onChange={() => setAuthorMode("ocr")}
                />
                OCR import
              </label>
            </div>
          </div>

          {authorMode === "manual" ? (
            <>
              <div className="field textarea-field">
                <label htmlFor="question-prompt">Question</label>
                <textarea
                  id="question-prompt"
                  placeholder="Type the question exactly as users should see it."
                  value={prompt}
                  onChange={(event) => setPrompt(event.target.value)}
                />
              </div>

              <div className="option-list">
                {options.map((option, index) => (
                  <div className="option-editor" key={`option-${index}`}>
                    <div className="field">
                      <label htmlFor={`option-${index}`}>Option {index + 1}</label>
                      <input
                        id={`option-${index}`}
                        placeholder={`Type option ${index + 1}`}
                        value={option}
                        onChange={(event) => updateOption(index, event.target.value)}
                      />
                    </div>
                    <label className="radio-chip">
                      <input
                        checked={correctOptionIndex === index}
                        name="correct-option"
                        type="radio"
                        onChange={() => setCorrectOptionIndex(index)}
                      />
                      Correct
                    </label>
                  </div>
                ))}
              </div>

              <div className="inline-actions">
                <button className="button" disabled={isMutating} type="button" onClick={handleAddQuestion}>
                  Save question
                </button>
                <button
                  className="button-secondary"
                  disabled={isMutating}
                  type="button"
                  onClick={() => resetQuestionForm()}
                >
                  Reset form
                </button>
                <button
                  className="button-secondary"
                  disabled={isMutating}
                  type="button"
                  onClick={handleLoadSamples}
                >
                  Load sample set
                </button>
              </div>
            </>
          ) : (
            <div className="form-stack import-card">
              <div className="section-head">
                <div>
                  <p className="eyebrow">OCR import</p>
                  <h2 className="section-title">Import, preview, and clean pasted text</h2>
                </div>
                <div className="form-stack">
                  <p className="muted-text">
                    If the questions are on paper or already in text, send the photo or text to AI and use this exact prompt.
                  </p>
                  <div className="field textarea-field">
                    <label htmlFor="meta-ai-prompt">AI prompt</label>
                    <textarea
                      id="meta-ai-prompt"
                      readOnly
                      value={AI_OCR_PROMPT}
                    />
                  </div>
                  <p className="muted-text">
                    Expected output example:
                  </p>
                  <div className="field textarea-field">
                    <label htmlFor="meta-ai-example">Example format</label>
                    <textarea
                      id="meta-ai-example"
                      readOnly
                      value={AI_OCR_EXAMPLE}
                    />
                  </div>
                </div>
              </div>

              <div className="field textarea-field">
                <label htmlFor="import-text">OCR text</label>
                <textarea
                  id="import-text"
                  placeholder={AI_OCR_EXAMPLE}
                  value={importText}
                  onChange={(event) => setImportText(event.target.value)}
                />
              </div>

              {importFeedback ? <p className="muted-text">{importFeedback}</p> : null}
              <div className="inline-actions">
                <button className="button" disabled={isImporting || isMutating} type="button" onClick={handlePreviewImport}>
                  Preview import
                </button>
                <button
                  className="button-secondary"
                  disabled={!importPreview?.validCount || isMutating}
                  type="button"
                  onClick={handleCommitImport}
                >
                  Import valid questions
                </button>
                <button
                  className="button-secondary"
                  disabled={!importPreview?.validCount || isMutating}
                  type="button"
                  onClick={handleKeepValidBlocks}
                >
                  Keep valid blocks only
                </button>
              </div>

              {importPreview ? (
                <div className="import-preview-list">
                  <div className="import-summary">
                    <strong>{importPreview.validCount}</strong>
                    <span>valid</span>
                    <strong>{importPreview.invalidCount}</strong>
                    <span>need fixes</span>
                    <strong>{importPreview.totalCount}</strong>
                    <span>total blocks</span>
                  </div>

                  {importPreview.candidates.map((candidate, index) => (
                    <article className="question-card" key={candidate.id}>
                      <div className="question-head">
                        <strong>Imported block {index + 1}</strong>
                        <span className={candidate.valid ? "status-chip success" : "status-chip warning"}>
                          {candidate.valid ? "Ready" : "Needs cleanup"}
                        </span>
                      </div>
                      <p>{candidate.draft.prompt || "Prompt missing"}</p>
                      {candidate.draft.options.length ? (
                        <ol className="question-options">
                          {candidate.draft.options.map((option, optionIndex) => (
                            <li key={`${candidate.id}-${optionIndex}`}>
                              {option}
                              {optionIndex === candidate.draft.correctOptionIndex ? " (correct)" : ""}
                            </li>
                          ))}
                        </ol>
                      ) : null}
                      {candidate.issues.length ? (
                        <ul className="issue-list">
                          {candidate.issues.map((issue, issueIndex) => (
                            <li key={`${candidate.id}-issue-${issueIndex}`}>{issue.message}</li>
                          ))}
                        </ul>
                      ) : null}
                    </article>
                  ))}
                </div>
              ) : null}
            </div>
          )}
        </div>
      </CollapsibleWorkspaceSection>

      <CollapsibleWorkspaceSection
        eyebrow=""
        isOpen={openSection === "question-bank"}
        sectionId="admin-question-bank"
        title="Question Bank"
        onToggle={() => toggleSection("question-bank")}
      >
        {isLoading ? (
          <div className="empty-state">
            <p className="muted-text">Loading the shared admin bank...</p>
          </div>
        ) : questions.length ? (
          <div className="form-stack">
            <div className="pool-filter-grid">
              {pools.map((pool) => {
                const questionCount = questions.filter((question) => question.poolIds.includes(pool.id)).length;

                return (
                  <button
                    className={`pool-filter-card${selectedQuestionBankPoolId === pool.id ? " is-active" : ""}`}
                    key={pool.id}
                    type="button"
                    onClick={() => setSelectedQuestionBankPoolId(pool.id)}
                  >
                    <strong>{pool.name}</strong>
                    <span>{questionCount} question{questionCount === 1 ? "" : "s"}</span>
                  </button>
                );
              })}
            </div>

            {selectedQuestionBankPool ? (
              <div className="question-bank-summary">
                <div>
                  <strong>{selectedQuestionBankPool.name}</strong>
                  <p className="muted-text question-bank-summary-copy">
                    {selectedQuestionBankPool.description || "No description added for this pool yet."}
                  </p>
                </div>
                <span className="status-chip success">
                  {filteredQuestionBankQuestions.length} visible
                </span>
              </div>
            ) : (
              <div className="empty-state compact-empty-state">
                <p className="muted-text">Select a pool to see only the questions assigned to it.</p>
              </div>
            )}

            {selectedQuestionBankPoolId && filteredQuestionBankQuestions.length ? (
              <div className="question-bank-grid">
                {filteredQuestionBankQuestions.map((question, index) => (
                  <article className="question-card compact-question-card" key={question.id}>
                    <div className="question-head compact-question-head">
                      <strong>Q{index + 1}</strong>
                      <div className="inline-actions">
                        <button
                          className="button-secondary small-button"
                          disabled={isMutating}
                          type="button"
                          onClick={() =>
                            editingQuestionId === question.id
                              ? handleCancelEditingQuestion()
                              : handleStartEditingQuestion(question)
                          }
                        >
                          {editingQuestionId === question.id ? "Cancel" : "Edit"}
                        </button>
                        <button
                          className="button-secondary small-button"
                          disabled={isMutating}
                          type="button"
                          onClick={() => handleDeleteQuestion(question.id)}
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                    {editingQuestionId === question.id && editingQuestionDraft ? (
                      <div className="form-stack">
                        <div className="field textarea-field">
                          <label htmlFor={`edit-question-${question.id}`}>Question</label>
                          <textarea
                            id={`edit-question-${question.id}`}
                            value={editingQuestionDraft.prompt}
                            onChange={(event) =>
                              setEditingQuestionDraft((currentDraft) =>
                                currentDraft
                                  ? {
                                      ...currentDraft,
                                      prompt: event.target.value,
                                    }
                                  : currentDraft,
                              )
                            }
                          />
                        </div>

                        <div className="inline-actions">
                          <button
                            className={editingQuestionDraft.options.length === 4 ? "button" : "button-secondary"}
                            type="button"
                            onClick={() => handleEditableOptionCountChange(4)}
                          >
                            4 options
                          </button>
                          <button
                            className={editingQuestionDraft.options.length === 5 ? "button" : "button-secondary"}
                            type="button"
                            onClick={() => handleEditableOptionCountChange(5)}
                          >
                            5 options
                          </button>
                        </div>

                        <div className="option-list">
                          {editingQuestionDraft.options.map((option, optionIndex) => (
                            <div className="option-editor" key={`${question.id}-edit-option-${optionIndex}`}>
                              <div className="field">
                                <label htmlFor={`${question.id}-edit-option-${optionIndex}`}>
                                  Option {optionIndex + 1}
                                </label>
                                <input
                                  id={`${question.id}-edit-option-${optionIndex}`}
                                  value={option}
                                  onChange={(event) => updateEditableOption(optionIndex, event.target.value)}
                                />
                              </div>
                              <label className="radio-chip">
                                <input
                                  checked={editingQuestionDraft.correctOptionIndex === optionIndex}
                                  name={`edit-correct-option-${question.id}`}
                                  type="radio"
                                  onChange={() =>
                                    setEditingQuestionDraft((currentDraft) =>
                                      currentDraft
                                        ? {
                                            ...currentDraft,
                                            correctOptionIndex: optionIndex,
                                          }
                                        : currentDraft,
                                    )
                                  }
                                />
                                Correct
                              </label>
                            </div>
                          ))}
                        </div>

                        <div className="inline-actions">
                          <button
                            className="button"
                            disabled={isMutating}
                            type="button"
                            onClick={() => handleSaveEditedQuestion(question.id)}
                          >
                            Save changes
                          </button>
                          <button
                            className="button-secondary"
                            disabled={isMutating}
                            type="button"
                            onClick={handleCancelEditingQuestion}
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <p className="compact-question-prompt">{question.prompt}</p>
                        <ol className="question-options compact-question-options">
                          {question.options.map((option, optionIndex) => (
                            <li key={`${question.id}-${optionIndex}`}>
                              {option}
                              {optionIndex === question.correctOptionIndex ? " (correct)" : ""}
                            </li>
                          ))}
                        </ol>
                      </>
                    )}
                    <p className="muted-text compact-question-meta">
                      {question.source} · {formatShortDate(question.createdAt)}
                    </p>
                  </article>
                ))}
              </div>
            ) : selectedQuestionBankPoolId ? (
              <div className="empty-state compact-empty-state">
                <p className="muted-text">No questions are assigned to this pool yet.</p>
              </div>
            ) : null}
          </div>
        ) : (
          <div className="empty-state">
            <p className="muted-text">
              No questions yet. Add your first question above, load the sample set, or import OCR text.
            </p>
          </div>
        )}
      </CollapsibleWorkspaceSection>

      <CollapsibleWorkspaceSection
        eyebrow=""
        isOpen={openSection === "participants"}
        sectionId="admin-participants"
        title="Create Groups"
        onToggle={() => toggleSection("participants")}
      >
        <div className="stack-grid">
          <div className="question-card form-stack">
            <div className="question-head">
              <strong>Create a group</strong>
            </div>
            <div className="field">
              <label htmlFor="group-name">Name of the group</label>
              <input
                id="group-name"
                placeholder="Enter group or class name"
                value={groupName}
                onChange={(event) => setGroupName(event.target.value)}
              />
            </div>
            <ParticipantSearchPicker
              emptyMessage="No participants selected for this group yet."
              inputId="group-participant-search"
              participants={participants}
              searchPlaceholder="Search participants by name, phone number, roll number, or username"
              selectedIds={selectedGroupParticipantIds}
              selectionLabel="Select participants"
              onChange={setSelectedGroupParticipantIds}
            />
            {groupFeedback ? <p className="muted-text">{groupFeedback}</p> : null}
            <div className="inline-actions">
              <button className="button" disabled={isMutating} type="button" onClick={handleCreateGroup}>
                Create group
              </button>
            </div>
          </div>

          <div className="question-card">
            <div className="question-head">
              <strong>Incoming access requests</strong>
              <span className="status-chip success">{groupJoinRequests.filter((request) => request.status === "pending").length} pending</span>
            </div>
            {groupJoinRequests.length ? (
              <div className="request-list">
                {groupJoinRequests.map((request) => (
                  <article className="request-card" key={request.id}>
                    <div>
                      <strong>{request.requesterLabel}</strong>
                      <p className="muted-text">{request.requesterId}</p>
                      <p className="muted-text">Requested {formatShortDateTime(request.requestedAt)}</p>
                    </div>
                    <div className="inline-actions">
                      <span className={`status-chip ${request.status === "accepted" ? "success" : request.status === "rejected" ? "warning" : ""}`}>
                        {request.status}
                      </span>
                      {request.status === "pending" ? (
                        <>
                          <button
                            className="button-secondary small-button"
                            disabled={isMutating}
                            type="button"
                            onClick={() => handleResolveGroupRequest(request.id, "accept")}
                          >
                            Accept
                          </button>
                          <button
                            className="button-secondary small-button"
                            disabled={isMutating}
                            type="button"
                            onClick={() => handleResolveGroupRequest(request.id, "reject")}
                          >
                            Reject
                          </button>
                        </>
                      ) : null}
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <p className="muted-text">No access requests have been submitted for your groups yet.</p>
            )}
          </div>

          <div className="question-card">
            <div className="question-head">
              <strong>Already created groups</strong>
              <span className="status-chip success">{participantGroups.length} total</span>
            </div>
              {participantGroups.length ? (
                <div className="question-list">
                  {participantGroups.map((group) => (
                    <article className="question-card nested-card" key={group.id}>
                      <div className="question-head">
                        <strong>{group.name}</strong>
                        <div className="inline-actions">
                          <span className="status-chip success">{group.participantIds.length} members</span>
                          <button
                            className="button-secondary small-button"
                            disabled={isMutating}
                            type="button"
                            onClick={() =>
                              editingGroupId === group.id
                                ? handleCancelEditingGroup()
                                : handleStartEditingGroup(group)
                            }
                          >
                            {editingGroupId === group.id ? "Cancel" : "Edit group"}
                          </button>
                        </div>
                      </div>
                      {editingGroupId === group.id && editingGroupDraft ? (
                        <div className="form-stack">
                          <div className="field">
                            <label htmlFor={`edit-group-name-${group.id}`}>Group name</label>
                            <input
                              id={`edit-group-name-${group.id}`}
                              value={editingGroupDraft.name}
                              onChange={(event) =>
                                setEditingGroupDraft((currentDraft) =>
                                  currentDraft
                                    ? {
                                        ...currentDraft,
                                        name: event.target.value,
                                      }
                                    : currentDraft,
                                )
                              }
                            />
                          </div>
                          <div className="field">
                            <ParticipantSearchPicker
                              emptyMessage="No participants selected for this group yet."
                              inputId={`edit-group-search-${group.id}`}
                              participants={participants}
                              searchPlaceholder="Search and add participants"
                              selectedIds={editingGroupDraft.participantIds}
                              selectionLabel="Manage participants"
                              onChange={(participantIds) =>
                                setEditingGroupDraft((currentDraft) =>
                                  currentDraft
                                    ? {
                                        ...currentDraft,
                                        participantIds,
                                      }
                                    : currentDraft,
                                )
                              }
                            />
                          </div>
                          <div className="inline-actions">
                            <button
                              className="button"
                              disabled={isMutating}
                              type="button"
                              onClick={handleSaveGroup}
                            >
                              Save group
                            </button>
                            <button
                              className="button-secondary"
                              disabled={isMutating}
                              type="button"
                              onClick={handleCancelEditingGroup}
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="selection-grid">
                          {group.participantIds.length ? (
                            group.participantIds.map((participantId) => {
                              const participant = participants.find((entry) => entry.id === participantId);

                              return participant ? (
                                <div className="role-option" key={`${group.id}-${participant.id}`}>
                                  <span>{participant.label}</span>
                                  <span className="muted-text">{participant.identifier}</span>
                                </div>
                              ) : null;
                            })
                          ) : (
                            <p className="muted-text">No participants in this group yet.</p>
                          )}
                        </div>
                      )}
                    </article>
                  ))}
                </div>
              ) : (
                <p className="muted-text">Create a group or class to assign many participants at once.</p>
              )}
          </div>
        </div>
      </CollapsibleWorkspaceSection>

      <CollapsibleWorkspaceSection
        eyebrow=""
        isOpen={openSection === "schedule"}
        sectionId="admin-schedule-tests"
        title="Schedule Test"
        onToggle={() => toggleSection("schedule")}
      >
        <div className="form-stack">
          <div className="field">
            <label htmlFor="schedule-pool">Question pool</label>
            <select
              className="select-field"
              id="schedule-pool"
              value={schedulePoolId}
              onChange={(event) => setSchedulePoolId(event.target.value)}
            >
              <option value="">Select a pool</option>
              {pools.map((pool) => (
                <option key={pool.id} value={pool.id}>
                  {pool.name}
                </option>
              ))}
            </select>
          </div>

          <div className="field-row">
            <div className="field">
              <label htmlFor="schedule-count">Number of questions</label>
              <input
                id="schedule-count"
                min={1}
                type="number"
                value={scheduleQuestionCount}
                onChange={(event) => setScheduleQuestionCount(event.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="schedule-duration">Duration in minutes</label>
              <input
                id="schedule-duration"
                min={1}
                type="number"
                value={scheduleDurationMinutes}
                onChange={(event) => setScheduleDurationMinutes(event.target.value)}
              />
            </div>
          </div>

          {selectedPool ? (
            <p className="muted-text">
              Selected pool has {selectedPool.questionIds.length} question{selectedPool.questionIds.length === 1 ? "" : "s"}.
            </p>
          ) : null}

          <p className="muted-text">
            Directory users listed here can be assigned individually, including admins who should take a test as participants.
          </p>

          <div className="field">
            <label>Start mode</label>
            <div className="selection-grid">
              <label className="role-option">
                <input
                  checked={scheduleStartMode === "now"}
                  name="schedule-start-mode"
                  type="radio"
                  onChange={() => setScheduleStartMode("now")}
                />
                <span>Start now</span>
              </label>
              <label className="role-option">
                <input
                  checked={scheduleStartMode === "later"}
                  name="schedule-start-mode"
                  type="radio"
                  onChange={() => setScheduleStartMode("later")}
                />
                <span>Schedule for later</span>
              </label>
            </div>
          </div>

          {scheduleStartMode === "later" ? (
            <div className="field">
              <label htmlFor="schedule-starts-at">Test date and time</label>
              <input
                id="schedule-starts-at"
                type="datetime-local"
                value={scheduleStartsAtInput}
                onChange={(event) => setScheduleStartsAtInput(event.target.value)}
              />
            </div>
          ) : null}

          <div className="field">
            <label>Choose participants individually</label>
            <div className="selection-grid">
              {participants.map((participant) => (
                <label className="role-option" key={`schedule-participant-${participant.id}`}>
                  <input
                    checked={scheduleParticipantIds.includes(participant.id)}
                    type="checkbox"
                    onChange={() =>
                      setScheduleParticipantIds((current) => toggleArrayValue(current, participant.id))
                    }
                  />
                  <span>{participant.label}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="field">
            <label>Or add participants by groups or classes</label>
            <div className="selection-grid">
              {participantGroups.map((group) => (
                <label className="role-option" key={`schedule-group-${group.id}`}>
                  <input
                    checked={scheduleParticipantGroupIds.includes(group.id)}
                    type="checkbox"
                    onChange={() =>
                      setScheduleParticipantGroupIds((current) =>
                        toggleArrayValue(current, group.id),
                      )
                    }
                  />
                  <span>{group.name}</span>
                </label>
              ))}
            </div>
          </div>

          {scheduleFeedback ? <p className="muted-text">{scheduleFeedback}</p> : null}
          <div className="inline-actions">
            <button className="button" disabled={isMutating} type="button" onClick={handleScheduleTest}>
              Schedule test
            </button>
          </div>
        </div>
      </CollapsibleWorkspaceSection>

      <CollapsibleWorkspaceSection
        eyebrow=""
        isOpen={openSection === "history"}
        sectionId="admin-test-history"
        title="Results"
        onToggle={() => toggleSection("history")}
      >
        {sortedScheduledTests.length ? (
          <div className="result-status-stack">
            {scheduledTestsByStatus.map((statusGroup) => (
              <details className="status-group" key={statusGroup.key} open={statusGroup.key !== "scheduled"}>
                <summary className="status-group-summary">
                  <span>{statusGroup.label}</span>
                  <span className="status-chip success">{statusGroup.tests.length}</span>
                </summary>
                <p className="muted-text status-group-copy">{statusGroup.description}</p>

                {statusGroup.tests.length ? (
                  <div className="question-list">
                    {statusGroup.tests.map((scheduledTest) => {
              const leaderboard = leaderboards.find((entry) => entry.testId === scheduledTest.id);
              const submittedIdentifiers = new Set(
                (leaderboard?.entries ?? []).map((entry) =>
                  normalizeParticipantIdentifier(entry.participantId),
                ),
              );
              const absentParticipants = scheduledTest.resolvedParticipantIdentifiers.filter(
                (identifier) =>
                  !Array.from(submittedIdentifiers).some((submittedIdentifier) =>
                    participantIdentifiersMatch(identifier, submittedIdentifier),
                  ),
              );
              const attemptsForTest = history.filter((entry) => entry.testId === scheduledTest.id);

              return (
                <article className="question-card" key={`history-${scheduledTest.id}`}>
                  <div className="question-head">
                    <strong>{scheduledTest.title}</strong>
                    <span className={`status-chip ${scheduledTest.status === "live" ? "success" : "warning"}`}>
                      {scheduledTest.status}
                    </span>
                  </div>
                  <p className="muted-text">
                    Pool: {pools.find((pool) => pool.id === scheduledTest.poolId)?.name ?? "Unknown pool"}
                  </p>
                  <p className="muted-text">Starts: {formatShortDateTime(scheduledTest.startsAt)}</p>
                  <p className="muted-text">
                    Participants: {scheduledTest.resolvedParticipantIdentifiers.length
                      ? scheduledTest.resolvedParticipantIdentifiers
                          .map((identifier) => formatParticipantName(identifier, participants))
                          .join(", ")
                      : "None"}
                  </p>

                  {leaderboard ? (
                    <>
                      <p className="muted-text">
                        Submitted: {leaderboard.submittedCount}/{leaderboard.assignedParticipantCount}
                      </p>
                      {leaderboard.entries.length ? (
                        <div className="leaderboard-table-wrap">
                          <table className="leaderboard-table">
                            <thead>
                              <tr>
                                <th>Rank</th>
                                <th>Participant</th>
                                <th>Marks</th>
                                <th>Incorrect</th>
                                <th>Time</th>
                                <th>Submitted</th>
                              </tr>
                            </thead>
                            <tbody>
                              {leaderboard.entries.map((entry) => (
                                <tr key={entry.attemptId}>
                                  <td>{entry.rank}</td>
                                  <td>{formatResultParticipantName(entry.participantId, entry.participantName, participants)}</td>
                                  <td>{entry.correctCount}/{entry.totalCount}</td>
                                  <td>{entry.incorrectCount}</td>
                                  <td>{formatElapsedTime(entry.elapsedMs)}</td>
                                  <td>{formatShortDateTime(entry.completedAt)}</td>
                                </tr>
                              ))}
                              {absentParticipants.length ? (
                                <tr>
                                  <td colSpan={6}>
                                    <strong>Absent:</strong> {absentParticipants
                                      .map((identifier) => formatParticipantName(identifier, participants))
                                      .join(", ")}
                                  </td>
                                </tr>
                              ) : null}
                            </tbody>
                          </table>
                        </div>
                      ) : (
                        <p className="muted-text">No submissions were recorded before this test closed.</p>
                      )}
                    </>
                  ) : attemptsForTest.length ? (
                    <div className="question-list">
                      {attemptsForTest.map((entry) => (
                        <article className="question-card nested-card" key={entry.attemptId}>
                          <div className="question-head">
                            <strong>{formatResultParticipantName(entry.participantId, entry.participantName, participants)}</strong>
                            <span className="status-chip success">{entry.correctCount}/{entry.totalCount}</span>
                          </div>
                          <p className="muted-text">Incorrect: {entry.incorrectCount}</p>
                          <p className="muted-text">Completed: {formatShortDateTime(entry.completedAt)}</p>
                          <p className="muted-text">Elapsed time: {formatElapsedTime(entry.elapsedMs)}</p>
                        </article>
                      ))}
                    </div>
                  ) : scheduledTest.status === "scheduled" ? (
                    <p className="muted-text">This test has not started yet.</p>
                  ) : scheduledTest.status === "live" ? (
                    <p className="muted-text">This test is live. Results will update here as participants submit.</p>
                  ) : (
                    <p className="muted-text">No submissions were recorded before this test closed.</p>
                  )}

                  {scheduledTest.status === "completed" ? (
                    <div className="form-stack">
                      <div className="inline-actions">
                        <button
                          className="button-secondary small-button"
                          disabled={reviewLoadingByTestId[scheduledTest.id]}
                          type="button"
                          onClick={() => void handleLoadReview(scheduledTest.id)}
                        >
                          {reviewLoadingByTestId[scheduledTest.id]
                            ? "Loading..."
                            : visibleReviewTestIds.includes(scheduledTest.id)
                              ? "Hide review"
                              : "Review questions"}
                        </button>
                      </div>

                      {visibleReviewTestIds.includes(scheduledTest.id) && reviewByTestId[scheduledTest.id] ? (
                        <div className="review-list">
                          {reviewByTestId[scheduledTest.id].review.map((question, questionIndex) => (
                            <article className="question-card nested-card" key={`${scheduledTest.id}-${question.questionId}`}>
                              <div className="question-head">
                                <strong>Question {questionIndex + 1}</strong>
                                <span className="status-chip success">
                                  {question.totalResponses} response{question.totalResponses === 1 ? "" : "s"}
                                </span>
                              </div>
                              <p>{question.prompt}</p>
                              <ol className="question-options compact-question-options">
                                {question.options.map((option, optionIndex) => (
                                  <li key={`${question.questionId}-${optionIndex}`}>
                                    {option}
                                    {optionIndex === question.correctOptionIndex ? " (correct)" : ""}
                                    {` - ${question.optionSelectionCounts[optionIndex] ?? 0} response${(question.optionSelectionCounts[optionIndex] ?? 0) === 1 ? "" : "s"}`}
                                  </li>
                                ))}
                              </ol>
                            </article>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </article>
              );
                    })}
                  </div>
                ) : (
                  <div className="empty-state compact-empty-state">
                    <p className="muted-text">No tests are in this section yet.</p>
                  </div>
                )}
              </details>
            ))}
          </div>
        ) : (
          <div className="empty-state">
            <p className="muted-text">Scheduled tests will appear here once created.</p>
          </div>
        )}
      </CollapsibleWorkspaceSection>

      <CollapsibleWorkspaceSection
        eyebrow=""
        isOpen={openSection === "assigned-tests"}
        sectionId="admin-assigned-tests"
        title="Assigned Test"
        onToggle={() => toggleSection("assigned-tests")}
      >
        {assignedTests.length ? (
          <div className="question-list">
            {assignedTests.map((scheduledTest) => (
              <article className="question-card" key={`assigned-${scheduledTest.id}`}>
                <div className="question-head">
                  <strong>{scheduledTest.title}</strong>
                  <span
                    className={`status-chip ${scheduledTest.status === "live" ? "success" : "warning"}`}
                  >
                    {scheduledTest.status}
                  </span>
                </div>
                <p className="muted-text">
                  Pool: {pools.find((pool) => pool.id === scheduledTest.poolId)?.name ?? "Unknown pool"}
                </p>
                <p className="muted-text">Starts: {formatShortDateTime(scheduledTest.startsAt)}</p>
                <p className="muted-text">Duration: {scheduledTest.durationMinutes} min</p>
                <p className="muted-text">Questions: {scheduledTest.questionIds.length}</p>
                <div className="inline-actions">
                  <a className="button-secondary small-button" href="/user">
                    Open test workspace
                  </a>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="empty-state compact-empty-state">
            <p className="muted-text">No tests are currently assigned to this admin account.</p>
          </div>
        )}
      </CollapsibleWorkspaceSection>
    </div>
  );
}
