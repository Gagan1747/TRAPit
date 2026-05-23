"use client";

import {
  findNextNormalUserCategory,
  normalUserCategoryDefinitions,
  orderedNormalUserCategories,
  type NormalUserCategory,
} from "@trapit/auth";
import {
  createPresentedQuestions,
  formatElapsedTime,
  getScheduledTestEndTime,
  type GroupJoinRequest,
  type ObjectiveQuestion,
  type PollBulkImportPreview,
  type PollQuestionDraft,
  type PersistentPollQuestion,
  type PollParticipantType,
  type ScheduledPoll,
  validatePollQuestionDraft,
  validateQuestionDraft,
  type BulkImportPreview,
  type ParticipantGroup,
  type ParticipantProfile,
  type PersistentQuestion,
  type QuestionPool,
  type ScheduledTest,
  type TestLeaderboard,
  type TestHistoryEntry,
  type TestResult,
  type WorkspaceBranding,
} from "@trapit/testing";
import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";

import { formatShortDate, formatShortDateTime } from "../lib/date-format";
import { formatPhoneNumberForDisplay } from "../lib/privacy";
import { CollapsibleWorkspaceSection } from "./collapsible-workspace-section";
import { type NotificationBellItem } from "./notification-bell";

const AI_OCR_EXAMPLE = `Question: 5+3?
Option A: 10
Option B: 6
Option C: 9
Option D: 8
Option E: 7
Answer: 8`;

const AI_OCR_PROMPT = `convert the image/text to questions in the following format
-add colon after question, each options, answer
-question, each options and answer should be in separate line
-Each set of 'question, each options and answer' should be separated from other set by a spacing of line

Example:
${AI_OCR_EXAMPLE}`;

const POLL_OCR_EXAMPLE = `Question: Which topic should we revise next?
Option A: Algebra
Option B: Geometry
Option C: Mensuration
Option D: Statistics`;

const POLL_OCR_PROMPT = `convert the image/text to poll questions in the following format
-add colon after question and each option
-question and each option should be on separate lines
-separate each poll question block with one blank line

Example:
${POLL_OCR_EXAMPLE}`;

function createEmptyOptions(count: number) {
  return Array.from({ length: count }, () => "");
}

function createDefaultScheduleTime() {
  const date = new Date(Date.now() + 60 * 60 * 1000);
  const timezoneOffsetMs = date.getTimezoneOffset() * 60 * 1000;

  return new Date(date.getTime() - timezoneOffsetMs).toISOString().slice(0, 16);
}

function toDateTimeInputValue(value: string) {
  const date = new Date(value);
  const timezoneOffsetMs = date.getTimezoneOffset() * 60 * 1000;

  return new Date(date.getTime() - timezoneOffsetMs).toISOString().slice(0, 16);
}

function formatMembershipCount(value: number) {
  return value > 0 ? value : "-";
}

function formatMembershipBoolean(value: boolean) {
  return value ? "✓" : "-";
}

function formatMembershipQuestionsPerPool(plan: (typeof normalUserCategoryDefinitions)[NormalUserCategory]) {
  if (!plan.test.addQuestion || plan.test.maxQuestionPools <= 0 || plan.test.maxQuestionsPerPool === null) {
    return "-";
  }

  return plan.test.maxQuestionsPerPool;
}

function formatCountShare(count: number, total: number) {
  if (total <= 0) {
    return "0%";
  }

  return `${Math.round((count / total) * 100)}%`;
}

type QuestionApiResponse = {
  questions: WorkspaceQuestion[];
};

type QuestionImportResponse = {
  importedCount: number;
};

type WorkspaceQuestion = PersistentQuestion & {
  canManage: boolean;
  isShared: boolean;
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
    };

type PoolsResponse = {
  pools: WorkspaceQuestionPool[];
};

type WorkspaceQuestionPool = QuestionPool & {
  canManage: boolean;
  isShared: boolean;
};

type ParticipantsResponse = {
  groupJoinRequests: GroupJoinRequest[];
  participantGroups: ParticipantGroup[];
  participants: ParticipantProfile[];
};

type GroupSearchResponse = {
  groupJoinRequests: GroupJoinRequest[];
  participantGroups: ParticipantGroup[];
};

type UserDashboardResponse = {
  availablePolls: ScheduledPoll[];
  availableTests: Array<{
    branding?: WorkspaceBranding | null;
    durationMinutes: number;
    hasAttempt: boolean;
    id: string;
    poolId: string;
    questionCount: number;
    questions: ObjectiveQuestion[];
    startsAt: string;
    status: ScheduledTest["status"];
    title: string;
    topPerformer?: {
      correctCount: number;
      elapsedMs: number;
      participantName: string;
    };
  }>;
  groupJoinRequests: GroupJoinRequest[];
  history: TestHistoryEntry[];
  identifier: string;
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

type PollsResponse = {
  pollQuestions: PersistentPollQuestion[];
  scheduledPolls: ScheduledPoll[];
};

type BrandingResponse = {
  branding: WorkspaceBranding | null;
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

type UserTestReviewResponse = {
  review: Array<{
    correctOptionIndex: number;
    options: string[];
    prompt: string;
    questionId: string;
    selectedOptionIndex?: number;
  }>;
  submittedAt: string | null;
  testId: string;
  testTitle: string;
};

type AttemptResponse = {
  attempt: {
    result: TestResult;
  };
  resultReleaseAt: string | null;
  resultReleased: boolean;
};

type UserCategoryUpgradeRequest = {
  approvedDurationMonths: 3 | 12 | null;
  currentCategory: NormalUserCategory;
  id: string;
  requestedAt: string;
  requestedCategory: NormalUserCategory;
  requesterDisplayName: string | null;
  requesterIdentifier: string | null;
  requesterSub: string | null;
  resolvedAt: string | null;
  reviewerDisplayName: string | null;
  reviewerIdentifier: string | null;
  status: "accepted" | "pending" | "rejected";
};

type UserCategoryPlan = {
  category: NormalUserCategory;
  definition: {
    group: {
      create: boolean;
      join: boolean;
      manage: boolean;
    };
    home: boolean;
    label: string;
    poll: {
      addQuestion: boolean;
      schedule: boolean;
      shareOpenToAll: boolean;
      shareWithGroups: boolean;
    };
    test: {
      addQuestion: boolean;
      maxQuestionPools: number;
      maxQuestionsPerPool: number | null;
      maxScheduledTestsPerMonth: number;
      maxSelfTestsPerMonth: number;
    };
  };
  isCurrent: boolean;
  label: string;
};

type UserCategorySnapshotResponse = {
  activeAssignment: {
    expiresAt: string | null;
    id: string;
  } | null;
  availableCategories: UserCategoryPlan[];
  currentCategory: NormalUserCategory;
  currentCategoryLabel: string;
  requests: UserCategoryUpgradeRequest[];
};

type SuperAdminCategoryManagementResponse = {
  managedUsers: Array<{
    currentCategory: NormalUserCategory;
    currentCategoryLabel: string;
    displayName: string | null;
    expiresAt: string | null;
    identifier: string;
    pendingRequest: UserCategoryUpgradeRequest | null;
    userSub: string | null;
  }>;
  requests: UserCategoryUpgradeRequest[];
};

type UpgradePrompt = {
  featureLabel: string;
  message: string;
  targetCategory: NormalUserCategory | null;
};

function createEmptyBranding(): WorkspaceBranding {
  return {
    imageDataUrl: null,
    instituteName: "",
  };
}

function normalizeBrandingInput(branding: WorkspaceBranding | null): WorkspaceBranding | null {
  const instituteName = branding?.instituteName.trim() ?? "";
  const imageDataUrl = branding?.imageDataUrl?.trim() ?? null;

  if (!instituteName && !imageDataUrl) {
    return null;
  }

  return {
    imageDataUrl,
    instituteName,
  };
}

async function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }

      reject(new Error("Unable to read the selected image."));
    };

    reader.onerror = () => reject(new Error("Unable to read the selected image."));
    reader.readAsDataURL(file);
  });
}

type AdminWorkspaceSection =
  | "author"
  | "create-groups"
  | "history"
  | "join-groups"
  | "manage-groups"
  | "poll-questions"
  | "poll-schedule"
  | "participants"
  | "pools"
  | "question-bank"
  | "schedule"
  | "self-test";

type AdminMenuGroup = "groups" | "poll" | "test";

type AdminTestListFilter = "admin" | "both" | "participant";

type AdminResultsMode = "polls" | "tests";

type UnifiedAdminTestListItem = {
  durationMinutes: number;
  hasAdminScope: boolean;
  hasParticipantScope: boolean;
  id: string;
  participantHistoryEntry?: TestHistoryEntry;
  participantTest?: UserDashboardResponse["availableTests"][number];
  poolId: string;
  questionCount: number;
  scheduledTest?: ScheduledTest;
  startsAt: string;
  status: ScheduledTest["status"];
  title: string;
};

type UnifiedAdminPollListItem = {
  hasAdminScope: boolean;
  hasParticipantScope: boolean;
  id: string;
  participantPoll?: ScheduledPoll;
  scheduledPoll?: ScheduledPoll;
  startsAt: string;
  status: ScheduledPoll["status"];
  title: string;
};

type ShuffledQuestion = {
  displayOptions: string[];
  originalOptionIndexes: number[];
  question: ObjectiveQuestion;
};

type EditableQuestionDraft = {
  correctOptionIndex: number;
  options: string[];
  prompt: string;
};

type EditableGroupDraft = {
  generateInviteLink: boolean;
  inviteJoinMode: "approval-required" | "automatic";
  name: string;
  participantIds: string[];
  shareCode: string | null;
};

type EditablePollScheduleDraft = PollQuestionDraft;

function createEmptyPollScheduleDraft(): EditablePollScheduleDraft {
  return {
    options: ["", ""],
    prompt: "",
    topic: "",
  };
}

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
  showFullPhoneNumbers?: boolean;
  onChange: (participantIds: string[]) => void;
};

async function readJson<T>(response: Response): Promise<T> {
  const payload = (await response.json()) as T & { error?: string };

  if (!response.ok) {
    throw new Error((payload as { error?: string }).error ?? "Request failed.");
  }

  return payload;
}

function getTestReleaseTimestamp(
  test: ScheduledTest | UserDashboardResponse["availableTests"][number],
) {
  if ("updatedAt" in test) {
    return new Date(test.updatedAt).getTime();
  }

  return new Date(getScheduledTestEndTime(test)).getTime();
}

function isLimitPopupMessage(message: string) {
  return message.startsWith("You have utilized all allowable limits of ");
}

function handleWorkspaceActionError(
  error: unknown,
  fallbackMessage: string,
  setFeedback: (message: string | null) => void,
) {
  const message = error instanceof Error ? error.message : fallbackMessage;

  if (typeof window !== "undefined" && isLimitPopupMessage(message)) {
    window.alert(message);
    setFeedback(null);
    return;
  }

  setFeedback(message);
}

function getSectionUpgradePrompt(
  section: AdminWorkspaceSection,
  currentCategory: NormalUserCategory,
): UpgradePrompt | null {
  const currentDefinition = normalUserCategoryDefinitions[currentCategory];

  const requirement = (() => {
    switch (section) {
      case "author":
        return {
          featureLabel: "Add test questions",
          isIncluded: currentDefinition.test.addQuestion,
          matcher: (candidate: NormalUserCategory) => normalUserCategoryDefinitions[candidate].test.addQuestion,
          message: "Add test questions from this workspace.",
        };
      case "question-bank":
        return {
          featureLabel: "Question pools",
          isIncluded: currentDefinition.test.maxQuestionPools > 0,
          matcher: (candidate: NormalUserCategory) => normalUserCategoryDefinitions[candidate].test.maxQuestionPools > 0,
          message: "Create and manage shared question pools.",
        };
      case "schedule":
        return {
          featureLabel: "Scheduled tests",
          isIncluded: currentDefinition.test.maxScheduledTestsPerMonth > 0,
          matcher: (candidate: NormalUserCategory) => normalUserCategoryDefinitions[candidate].test.maxScheduledTestsPerMonth > 0,
          message: "Schedule live tests for your participants.",
        };
      case "self-test":
        return {
          featureLabel: "Self tests",
          isIncluded: currentDefinition.test.maxSelfTestsPerMonth > 0,
          matcher: (candidate: NormalUserCategory) => normalUserCategoryDefinitions[candidate].test.maxSelfTestsPerMonth > 0,
          message: "Run self-paced test sessions from your own question pools.",
        };
      case "poll-questions":
        return {
          featureLabel: "Poll questions",
          isIncluded: currentDefinition.poll.addQuestion,
          matcher: (candidate: NormalUserCategory) => normalUserCategoryDefinitions[candidate].poll.addQuestion,
          message: "Create poll question sets in your workspace.",
        };
      case "poll-schedule":
        return {
          featureLabel: "Poll scheduling",
          isIncluded: currentDefinition.poll.schedule,
          matcher: (candidate: NormalUserCategory) => normalUserCategoryDefinitions[candidate].poll.schedule,
          message: "Schedule polls and distribute them to your audience.",
        };
      case "create-groups":
        return {
          featureLabel: "Create groups",
          isIncluded: currentDefinition.group.create,
          matcher: (candidate: NormalUserCategory) => normalUserCategoryDefinitions[candidate].group.create,
          message: "Create groups for tests and polls.",
        };
      case "manage-groups":
        return {
          featureLabel: "Manage groups",
          isIncluded: currentDefinition.group.manage,
          matcher: (candidate: NormalUserCategory) => normalUserCategoryDefinitions[candidate].group.manage,
          message: "Approve requests and manage your groups.",
        };
      default:
        return null;
    }
  })();

  if (!requirement || requirement.isIncluded) {
    return null;
  }

  return {
    featureLabel: requirement.featureLabel,
    message: requirement.message,
    targetCategory: findNextNormalUserCategory(currentCategory, requirement.matcher),
  };
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

function getManagedUserOptionLabel(user: {
  displayName: string | null;
  identifier: string;
}, showFullPhoneNumbers = false) {
  const identifier = formatPhoneNumberForDisplay(user.identifier, { showFullPhoneNumber: showFullPhoneNumbers });

  return user.displayName ? `${user.displayName} - ${identifier}` : identifier;
}

function formatParticipantName(
  identifier: string,
  participants: ParticipantProfile[],
  showFullPhoneNumbers = false,
) {
  const participant = participants.find(
    (entry) => participantIdentifiersMatch(entry.identifier, identifier),
  );

  const maskedIdentifier = formatPhoneNumberForDisplay(identifier, { showFullPhoneNumber: showFullPhoneNumbers });

  if (!participant) {
    return maskedIdentifier;
  }

  const participantIdentifier = formatPhoneNumberForDisplay(participant.identifier, { showFullPhoneNumber: showFullPhoneNumbers });

  return participant.label && participant.label !== participant.identifier
    ? `${participant.label} (${participantIdentifier})`
    : participant.label || participantIdentifier;
}

function normalizeDuplicateQuestionValue(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function createQuestionDuplicateSignature(question: Pick<PersistentQuestion, "options" | "prompt">) {
  return [
    normalizeDuplicateQuestionValue(question.prompt),
    ...question.options.map((option) => normalizeDuplicateQuestionValue(option)),
  ].join("||");
}

function formatQuestionForBulkEdit(question: Pick<PersistentQuestion, "correctOptionIndex" | "options" | "prompt">) {
  const lines = [`Question: ${question.prompt}`];

  question.options.forEach((option, index) => {
    const optionLabel = String.fromCharCode(65 + index);
    lines.push(`Option ${optionLabel}: ${option}`);
  });

  const answerLabel = question.options[question.correctOptionIndex]
    ? String.fromCharCode(65 + question.correctOptionIndex)
    : "";

  lines.push(`Answer: ${answerLabel}`);

  return lines.join("\n");
}

async function copyTextToClipboard(text: string) {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  if (typeof document === "undefined") {
    throw new Error("Clipboard access is not available in this browser.");
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  textarea.setSelectionRange(0, textarea.value.length);

  const didCopy = document.execCommand("copy");

  document.body.removeChild(textarea);

  if (!didCopy) {
    throw new Error("Unable to copy the question list.");
  }
}

function formatResultParticipantName(
  identifier: string,
  participantName: string | undefined,
  participants: ParticipantProfile[],
  showFullPhoneNumbers = false,
) {
  const fallbackName = formatParticipantName(identifier, participants, showFullPhoneNumbers);

  return participantName?.trim()
    ? `${participantName.trim()} (${fallbackName})`
    : fallbackName;
}

function matchesParticipantSearch(participant: ParticipantProfile, query: string) {
  const normalizedQuery = normalizeParticipantIdentifier(query);

  if (!normalizedQuery) {
    return true;
  }

  const queryDigits = normalizedQuery.replace(/\D/g, "");

  if (queryDigits && queryDigits.length < 10) {
    return false;
  }

  return Array.from(getParticipantIdentifierCandidates(participant.identifier)).some((candidate) =>
    candidate === normalizedQuery,
  );
}

function getParticipantSecondaryText(participant: ParticipantProfile, showFullPhoneNumbers = false) {
  const label = participant.label.trim();
  const identifier = participant.identifier.trim();

  return label && label !== identifier
    ? formatPhoneNumberForDisplay(identifier, { showFullPhoneNumber: showFullPhoneNumbers })
    : null;
}

function ParticipantSearchPicker({
  emptyMessage,
  inputId,
  participants,
  searchPlaceholder,
  selectedIds,
  selectionLabel,
  showFullPhoneNumbers,
  onChange,
}: ParticipantSearchPickerProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const hasSearchQuery = searchQuery.trim().length > 0;
  const selectedParticipants = selectedIds
    .map((participantId) => participants.find((participant) => participant.id === participantId))
    .filter((participant): participant is ParticipantProfile => Boolean(participant));
  const filteredParticipants = hasSearchQuery
    ? participants
        .filter((participant) => !selectedIds.includes(participant.id))
        .filter((participant) => matchesParticipantSearch(participant, searchQuery))
        .slice(0, 8)
    : [];

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
                {getParticipantSecondaryText(participant, showFullPhoneNumbers) ? (
                  <span className="muted-text">{getParticipantSecondaryText(participant, showFullPhoneNumbers)}</span>
                ) : null}
              </button>
            ))}
          </div>
        ) : hasSearchQuery ? (
          searchQuery.trim().replace(/\D/g, "").length >= 10 ? (
            <p className="muted-text">No participant was found for that exact phone number.</p>
          ) : null
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
              {getParticipantSecondaryText(participant, showFullPhoneNumbers) ? (
                <span className="muted-text">{getParticipantSecondaryText(participant, showFullPhoneNumbers)}</span>
              ) : null}
              <span className="muted-text">Remove</span>
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
  currentActorRole: "admin" | "user";
  currentAdminIdentifier: string | null;
  currentUserCategory: NormalUserCategory | null;
  isSuperAdmin: boolean;
  previousSignInAt: string | null;
};

export function AdminQuestionWorkspace({
  currentActorRole,
  currentAdminIdentifier,
  currentUserCategory,
  isSuperAdmin,
  previousSignInAt,
}: AdminQuestionWorkspaceProps) {
  const [categoryAssignmentCategory, setCategoryAssignmentCategory] = useState<NormalUserCategory>(currentUserCategory ?? "trapit-normal");
  const [categoryAssignmentDurationMonths, setCategoryAssignmentDurationMonths] = useState<3 | 12>(3);
  const [categoryAssignmentIdentifier, setCategoryAssignmentIdentifier] = useState("");
  const [categoryFeedback, setCategoryFeedback] = useState<string | null>(null);
  const [categoryManagement, setCategoryManagement] = useState<SuperAdminCategoryManagementResponse | null>(null);
  const [categoryManagementFeedback, setCategoryManagementFeedback] = useState<string | null>(null);
  const [isManageUpgradesPanelOpen, setIsManageUpgradesPanelOpen] = useState(false);
  const [categorySearchQuery, setCategorySearchQuery] = useState("");
  const [categorySnapshot, setCategorySnapshot] = useState<UserCategorySnapshotResponse | null>(null);
  const [isUpgradePanelOpen, setIsUpgradePanelOpen] = useState(false);
  const [upgradePrompt, setUpgradePrompt] = useState<UpgradePrompt | null>(null);
  const [editingGroupDraft, setEditingGroupDraft] = useState<EditableGroupDraft | null>(null);
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [editingQuestionDraft, setEditingQuestionDraft] = useState<EditableQuestionDraft | null>(null);
  const [editingQuestionId, setEditingQuestionId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [groupFeedback, setGroupFeedback] = useState<string | null>(null);
  const [groupGenerateInviteLink, setGroupGenerateInviteLink] = useState(false);
  const [groupInviteJoinMode, setGroupInviteJoinMode] = useState<"approval-required" | "automatic">("approval-required");
  const [groupJoinRequests, setGroupJoinRequests] = useState<GroupJoinRequest[]>([]);
  const [groupSearchFeedback, setGroupSearchFeedback] = useState<string | null>(null);
  const [groupSearchPhoneNumber, setGroupSearchPhoneNumber] = useState("");
  const [groupSearchResults, setGroupSearchResults] = useState<ParticipantGroup[]>([]);
  const [groupName, setGroupName] = useState("");
  const [history, setHistory] = useState<TestHistoryEntry[]>([]);
  const [brandingFeedback, setBrandingFeedback] = useState<string | null>(null);
  const [brandingImageDataUrl, setBrandingImageDataUrl] = useState<string | null>(null);
  const [brandingInstituteName, setBrandingInstituteName] = useState("");
  const [importFeedback, setImportFeedback] = useState<string | null>(null);
  const [importPreview, setImportPreview] = useState<BulkImportPreview | null>(null);
  const [importText, setImportText] = useState("");
  const [isImporting, setIsImporting] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isMutating, setIsMutating] = useState(false);
  const [isOverflowMenuOpen, setIsOverflowMenuOpen] = useState(false);
  const [isPollImporting, setIsPollImporting] = useState(false);
  const [isPollOcrImportOpen, setIsPollOcrImportOpen] = useState(true);
  const [isSearchingGroups, setIsSearchingGroups] = useState(false);
  const [isSendingGroupRequest, setIsSendingGroupRequest] = useState<string | null>(null);
  const [leaderboards, setLeaderboards] = useState<TestLeaderboard[]>([]);
  const [openSection, setOpenSection] = useState<AdminWorkspaceSection | null>("history");
  const [outgoingGroupJoinRequests, setOutgoingGroupJoinRequests] = useState<GroupJoinRequest[]>([]);
  const [participantPolls, setParticipantPolls] = useState<ScheduledPoll[]>([]);
  const [activeParticipantName, setActiveParticipantName] = useState("");
  const [activeParticipantTestId, setActiveParticipantTestId] = useState<string | null>(null);
  const [currentParticipantQuestionIndex, setCurrentParticipantQuestionIndex] = useState(0);
  const [participantTestHistory, setParticipantTestHistory] = useState<TestHistoryEntry[]>([]);
  const [participantTests, setParticipantTests] = useState<UserDashboardResponse["availableTests"]>([]);
  const [participantAnswers, setParticipantAnswers] = useState<Record<string, number | undefined>>({});
  const [participantNamesByTest, setParticipantNamesByTest] = useState<Record<string, string>>({});
  const [participantRemainingMs, setParticipantRemainingMs] = useState<number | null>(null);
  const [participantResult, setParticipantResult] = useState<TestResult | null>(null);
  const [participantReviewByTestId, setParticipantReviewByTestId] = useState<Record<string, UserTestReviewResponse>>({});
  const [participantReviewLoadingByTestId, setParticipantReviewLoadingByTestId] = useState<Record<string, boolean>>({});
  const [participantStartedAt, setParticipantStartedAt] = useState<string | null>(null);
  const [participantGroups, setParticipantGroups] = useState<ParticipantGroup[]>([]);
  const [participants, setParticipants] = useState<ParticipantProfile[]>([]);
  const [pollFeedback, setPollFeedback] = useState<string | null>(null);
  const [pollImportFeedback, setPollImportFeedback] = useState<string | null>(null);
  const [pollImportPreview, setPollImportPreview] = useState<PollBulkImportPreview | null>(null);
  const [pollImportText, setPollImportText] = useState("");
  const [pollQrCodes, setPollQrCodes] = useState<Record<string, string>>({});
  const [pollQuestions, setPollQuestions] = useState<PersistentPollQuestion[]>([]);
  const [editingScheduledPollId, setEditingScheduledPollId] = useState<string | null>(null);
  const [pollScheduleAnonymous, setPollScheduleAnonymous] = useState(false);
  const [pollScheduleGenerateQrCode, setPollScheduleGenerateQrCode] = useState(true);
  const [pollScheduleGroupIds, setPollScheduleGroupIds] = useState<string[]>([]);
  const [pollScheduleParticipantType, setPollScheduleParticipantType] = useState<PollParticipantType>("registered");
  const [pollScheduleTypedDrafts, setPollScheduleTypedDrafts] = useState<EditablePollScheduleDraft[]>([]);
  const [pollScheduleQuestionIds, setPollScheduleQuestionIds] = useState<string[]>([]);
  const [pollScheduleStartsAtInput, setPollScheduleStartsAtInput] = useState(createDefaultScheduleTime());
  const [pollScheduleDurationMinutes, setPollScheduleDurationMinutes] = useState("60");
  const [pollScheduleTitle, setPollScheduleTitle] = useState("");
  const [scheduledPolls, setScheduledPolls] = useState<ScheduledPoll[]>([]);
  const [testQrCodes, setTestQrCodes] = useState<Record<string, string>>({});
  const [poolFeedback, setPoolFeedback] = useState<string | null>(null);
  const [poolName, setPoolName] = useState("");
  const [poolShareSearch, setPoolShareSearch] = useState("");
  const [pools, setPools] = useState<WorkspaceQuestionPool[]>([]);
  const [authorPoolId, setAuthorPoolId] = useState("");
  const [isOcrImportOpen, setIsOcrImportOpen] = useState(false);
  const [selectedQuestionIds, setSelectedQuestionIds] = useState<string[]>([]);
  const [selectedQuestionBankPoolId, setSelectedQuestionBankPoolId] = useState<string | null>(null);
  const [questions, setQuestions] = useState<WorkspaceQuestion[]>([]);
  const [reviewByTestId, setReviewByTestId] = useState<Record<string, AdminTestReviewResponse>>({});
  const [reviewLoadingByTestId, setReviewLoadingByTestId] = useState<Record<string, boolean>>({});
  const [resultsMode, setResultsMode] = useState<AdminResultsMode>("tests");
  const [expandedOpenPollResultIds, setExpandedOpenPollResultIds] = useState<string[]>([]);
  const [collapsedTestResultIds, setCollapsedTestResultIds] = useState<string[]>([]);
  const [openMenuGroup, setOpenMenuGroup] = useState<AdminMenuGroup | null>(null);
  const [editingScheduledTestId, setEditingScheduledTestId] = useState<string | null>(null);
  const [editingSelfTestId, setEditingSelfTestId] = useState<string | null>(null);
  const [scheduleDurationMinutes, setScheduleDurationMinutes] = useState("30");
  const [scheduleFeedback, setScheduleFeedback] = useState<string | null>(null);
  const [scheduleGenerateInviteLink, setScheduleGenerateInviteLink] = useState(false);
  const [scheduleInviteJoinMode, setScheduleInviteJoinMode] = useState<"approval-required" | "automatic">("approval-required");
  const [scheduleParticipantGroupIds, setScheduleParticipantGroupIds] = useState<string[]>([]);
  const [schedulePoolId, setSchedulePoolId] = useState("");
  const [scheduleQuestionCount, setScheduleQuestionCount] = useState("1");
  const [scheduleStartsAtInput, setScheduleStartsAtInput] = useState(createDefaultScheduleTime());
  const [scheduleTitle, setScheduleTitle] = useState("");
  const [scheduledTests, setScheduledTests] = useState<ScheduledTest[]>([]);
  const [selectedGroupParticipantIds, setSelectedGroupParticipantIds] = useState<string[]>([]);
  const [selfTestDurationMinutes, setSelfTestDurationMinutes] = useState("30");
  const [selfTestFeedback, setSelfTestFeedback] = useState<string | null>(null);
  const [selfTestPoolId, setSelfTestPoolId] = useState("");
  const [selfTestQuestionCount, setSelfTestQuestionCount] = useState("1");
  const [selfTestStartMode, setSelfTestStartMode] = useState<"later" | "now">("now");
  const [selfTestStartsAtInput, setSelfTestStartsAtInput] = useState(createDefaultScheduleTime());
  const [selfTestTitle, setSelfTestTitle] = useState("");
  const [summary, setSummary] = useState<HistoryResponse["summary"]>({
    attempts: 0,
    groups: 0,
    participants: 0,
    pools: 0,
    questions: 0,
    scheduledTests: 0,
  });
  const [testListFilter, setTestListFilter] = useState<AdminTestListFilter>("both");
  const [toolbarMenuView, setToolbarMenuView] = useState<"branding" | "menu" | "notifications" | "user-details">("menu");
  const [visibleParticipantReviewTestIds, setVisibleParticipantReviewTestIds] = useState<string[]>([]);
  const [visibleReviewTestIds, setVisibleReviewTestIds] = useState<string[]>([]);
  const [workspaceBranding, setWorkspaceBranding] = useState<WorkspaceBranding | null>(null);
  const participantAnswersRef = useRef<Record<string, number | undefined>>({});
  const participantIsSubmittingRef = useRef(false);
  const toolbarMenuRef = useRef<HTMLDivElement | null>(null);

  async function loadWorkspace(options?: { silent?: boolean }) {
    if (!options?.silent) {
      setIsLoading(true);
    }

    try {
      const [questionsPayload, poolsPayload, participantsPayload, testsPayload, historyPayload, userDashboardPayload, pollsPayload, brandingPayload, categorySnapshotPayload, categoryManagementPayload] =
        await Promise.all([
          readJson<QuestionApiResponse>(await fetch("/api/admin/questions")),
          readJson<PoolsResponse>(await fetch("/api/admin/pools")),
          readJson<ParticipantsResponse>(await fetch("/api/admin/participants")),
          readJson<ScheduledTestsResponse>(await fetch("/api/admin/tests")),
          readJson<HistoryResponse>(await fetch("/api/admin/history")),
          readJson<UserDashboardResponse>(await fetch("/api/user/dashboard")),
          readJson<PollsResponse>(await fetch("/api/admin/polls")),
          readJson<BrandingResponse>(await fetch("/api/admin/branding")),
          currentActorRole === "user"
            ? readJson<UserCategorySnapshotResponse>(await fetch("/api/user/category"))
            : Promise.resolve<UserCategorySnapshotResponse | null>(null),
          isSuperAdmin
            ? readJson<SuperAdminCategoryManagementResponse>(await fetch("/api/admin/user-categories"))
            : Promise.resolve<SuperAdminCategoryManagementResponse | null>(null),
        ]);

      setQuestions(questionsPayload.questions);
      setPools(poolsPayload.pools);
      setParticipants(participantsPayload.participants);
      setParticipantGroups(participantsPayload.participantGroups);
      setGroupJoinRequests(participantsPayload.groupJoinRequests);
      setOutgoingGroupJoinRequests(userDashboardPayload.groupJoinRequests);
      setParticipantPolls(userDashboardPayload.availablePolls);
      setParticipantTests(userDashboardPayload.availableTests);
      setParticipantTestHistory(userDashboardPayload.history);
      setPollQuestions(pollsPayload.pollQuestions);
      setScheduledPolls(pollsPayload.scheduledPolls);
      setScheduledTests(testsPayload.scheduledTests);
      setWorkspaceBranding(brandingPayload.branding);
      setBrandingInstituteName(brandingPayload.branding?.instituteName ?? "");
      setBrandingImageDataUrl(brandingPayload.branding?.imageDataUrl ?? null);
      setHistory(historyPayload.history);
      setLeaderboards(historyPayload.leaderboards);
      setSummary(historyPayload.summary);
      setCategorySnapshot(categorySnapshotPayload);
      setCategoryManagement(categoryManagementPayload);

      if (!schedulePoolId && poolsPayload.pools.length) {
        setSchedulePoolId(poolsPayload.pools[0].id);
      }

      if (!selfTestPoolId && poolsPayload.pools.length) {
        setSelfTestPoolId(poolsPayload.pools[0].id);
      }

      setSelectedQuestionBankPoolId((currentPoolId) =>
        currentPoolId && poolsPayload.pools.some((pool) => pool.id === currentPoolId)
          ? currentPoolId
          : null,
      );

    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Unable to load the admin workspace.");
    } finally {
      if (!options?.silent) {
        setIsLoading(false);
      }
    }
  }

  useEffect(() => {
    void loadWorkspace();
  }, []);

  useEffect(() => {
    if (currentActorRole !== "user" || activeParticipantTestId) {
      return;
    }

    const intervalId = window.setInterval(() => {
      void loadWorkspace({ silent: true });
    }, 30000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [activeParticipantTestId, currentActorRole]);

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      if (!toolbarMenuRef.current?.contains(event.target as Node)) {
        setIsOverflowMenuOpen(false);
        setToolbarMenuView("menu");
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, []);

  useEffect(() => {
    participantAnswersRef.current = participantAnswers;
  }, [participantAnswers]);

  useEffect(() => {
    if (!authorPoolId) {
      setIsOcrImportOpen(false);
    }
  }, [authorPoolId]);

  useEffect(() => {
    let isMounted = true;
    const pollsWithQrCodes = scheduledPolls.filter((poll) => poll.shareCode);

    if (!pollsWithQrCodes.length) {
      setPollQrCodes({});
      return () => {
        isMounted = false;
      };
    }

    void Promise.all(
      pollsWithQrCodes.map(async (poll) => [
        poll.id,
        await QRCode.toDataURL(getPollAccessUrl(poll.shareCode ?? ""), { margin: 1, width: 180 }),
      ] as const),
    ).then((entries) => {
      if (!isMounted) {
        return;
      }

      setPollQrCodes(Object.fromEntries(entries));
    });

    return () => {
      isMounted = false;
    };
  }, [scheduledPolls]);

  useEffect(() => {
    let isMounted = true;
    const testsWithQrCodes = scheduledTests.filter((test) => test.shareCode);

    if (!testsWithQrCodes.length) {
      setTestQrCodes({});
      return () => {
        isMounted = false;
      };
    }

    void Promise.all(
      testsWithQrCodes.map(async (test) => [
        test.id,
        await QRCode.toDataURL(getTestAccessUrl(test.shareCode ?? ""), { margin: 1, width: 180 }),
      ] as const),
    ).then((entries) => {
      if (!isMounted) {
        return;
      }

      setTestQrCodes(Object.fromEntries(entries));
    });

    return () => {
      isMounted = false;
    };
  }, [scheduledTests]);

  useEffect(() => {
    const activeParticipantTest = participantTests.find((test) => test.id === activeParticipantTestId) ?? null;

    if (!activeParticipantTest || !participantStartedAt) {
      setParticipantRemainingMs(null);
      return;
    }

    const deadlineMs =
      new Date(activeParticipantTest.startsAt).getTime() + activeParticipantTest.durationMinutes * 60 * 1000;

    const tick = () => {
      const nextRemainingMs = Math.max(0, deadlineMs - Date.now());
      setParticipantRemainingMs(nextRemainingMs);

      if (nextRemainingMs === 0 && !participantIsSubmittingRef.current) {
        void submitParticipantTest({ dueToTimer: true });
      }
    };

    tick();
    const intervalId = window.setInterval(tick, 1000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [activeParticipantTestId, participantStartedAt, participantTests]);

  function getPollAccessUrl(shareCode: string) {
    if (!shareCode.trim()) {
      return "";
    }

    if (typeof window === "undefined") {
      return `/poll/${shareCode}`;
    }

    return `${window.location.origin}/poll/${shareCode}`;
  }

  function getRegisteredPollPath(pollId: string) {
    if (!pollId.trim()) {
      return "";
    }

    return `/user/poll/${encodeURIComponent(pollId)}`;
  }

  function getTestAccessUrl(shareCode: string) {
    if (!shareCode.trim()) {
      return "";
    }

    if (typeof window === "undefined") {
      return `/test/${shareCode}`;
    }

    return `${window.location.origin}/test/${shareCode}`;
  }

  function getGroupAccessUrl(shareCode: string) {
    if (!shareCode.trim()) {
      return "";
    }

    if (typeof window === "undefined") {
      return `/group/${shareCode}`;
    }

    return `${window.location.origin}/group/${shareCode}`;
  }

  function resetPollScheduleForm() {
    setEditingScheduledPollId(null);
    setPollScheduleAnonymous(false);
    setPollScheduleGenerateQrCode(true);
    setPollScheduleGroupIds([]);
    setPollScheduleParticipantType("registered");
    setPollScheduleTypedDrafts([]);
    setPollScheduleQuestionIds([]);
    setPollScheduleStartsAtInput(createDefaultScheduleTime());
    setPollScheduleDurationMinutes("60");
    setPollScheduleTitle("");
  }

  function resetScheduledTestForm() {
    setEditingScheduledTestId(null);
    setScheduleDurationMinutes("30");
    setScheduleGenerateInviteLink(false);
    setScheduleInviteJoinMode("approval-required");
    setScheduleParticipantGroupIds([]);
    setScheduleQuestionCount("1");
    setScheduleStartsAtInput(createDefaultScheduleTime());
    setScheduleTitle("");
  }

  function resetSelfTestForm() {
    setEditingSelfTestId(null);
    setSelfTestDurationMinutes("30");
    setSelfTestQuestionCount("1");
    setSelfTestStartMode("now");
    setSelfTestStartsAtInput(createDefaultScheduleTime());
    setSelfTestTitle("");
  }

  function handleStartEditingPoll(poll: ScheduledPoll) {
    setEditingScheduledPollId(poll.id);
    setPollScheduleParticipantType(poll.participantType);
    setPollScheduleAnonymous(poll.participantType === "open" ? true : poll.anonymous);
    setPollScheduleGenerateQrCode(poll.participantType === "open");
    setPollScheduleGroupIds([...poll.participantGroupIds]);
    setPollScheduleTypedDrafts([]);
    setPollScheduleQuestionIds([...poll.questionIds]);
    setPollScheduleStartsAtInput(toDateTimeInputValue(poll.startsAt));
    setPollScheduleDurationMinutes(
      String(Math.max(1, Math.round((new Date(poll.endsAt).getTime() - new Date(poll.startsAt).getTime()) / 60000))),
    );
    setPollScheduleTitle(poll.title);
    setPollFeedback(null);
    setOpenSection("poll-schedule");
  }

  function handleStartEditingScheduledTest(test: ScheduledTest) {
    setEditingScheduledTestId(test.id);
    setSchedulePoolId(test.poolId);
    setScheduleQuestionCount(String(test.questionCount));
    setScheduleDurationMinutes(String(test.durationMinutes));
    setScheduleGenerateInviteLink(Boolean(test.shareCode));
    setScheduleInviteJoinMode(test.inviteJoinMode ?? "approval-required");
    setScheduleParticipantGroupIds([...test.participantGroupIds]);
    setScheduleStartsAtInput(toDateTimeInputValue(test.startsAt));
    setScheduleTitle(test.title);
    setScheduleFeedback(null);
    setOpenSection("schedule");
  }

  function handleStartEditingSelfTest(test: ScheduledTest) {
    setEditingSelfTestId(test.id);
    setSelfTestPoolId(test.poolId);
    setSelfTestQuestionCount(String(test.questionCount));
    setSelfTestDurationMinutes(String(test.durationMinutes));
    setSelfTestStartMode("later");
    setSelfTestStartsAtInput(toDateTimeInputValue(test.startsAt));
    setSelfTestTitle(test.title);
    setSelfTestFeedback(null);
    setOpenSection("self-test");
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
    setOpenSection((currentSection) => {
      if (currentSection === section && section === "history") {
        return currentSection;
      }

      return currentSection === section ? null : section;
    });
  }

  function openUpgradePanel(prompt?: UpgradePrompt | null) {
    setUpgradePrompt(prompt ?? null);
    setIsUpgradePanelOpen(true);
  }

  function selectManagedUser(identifier: string) {
    const user = categoryManagement?.managedUsers.find((entry) => entry.identifier === identifier) ?? null;

    if (!user) {
      return;
    }

    setCategoryAssignmentIdentifier(user.identifier);
    setCategoryAssignmentCategory(user.currentCategory);
  }

  function closeManagementDrawers() {
    setIsUpgradePanelOpen(false);
    setIsManageUpgradesPanelOpen(false);
  }

  function handleMenuSectionSelection(section: AdminWorkspaceSection) {
    closeManagementDrawers();
    setOpenSection(section);
  }

  function toggleReviewVisibility(testId: string) {
    setVisibleReviewTestIds((currentIds) =>
      currentIds.includes(testId)
        ? currentIds.filter((currentId) => currentId !== testId)
        : [...currentIds, testId],
    );
  }

  function getLatestOutgoingGroupRequest(groupId: string) {
    return outgoingGroupJoinRequests.find((request) => request.adminGroupId === groupId);
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

  function toggleParticipantReviewVisibility(testId: string) {
    setVisibleParticipantReviewTestIds((currentIds) =>
      currentIds.includes(testId)
        ? currentIds.filter((currentId) => currentId !== testId)
        : [...currentIds, testId],
    );
  }

  async function handleLoadParticipantReview(testId: string) {
    if (participantReviewByTestId[testId]) {
      toggleParticipantReviewVisibility(testId);
      return;
    }

    setParticipantReviewLoadingByTestId((currentState) => ({
      ...currentState,
      [testId]: true,
    }));

    try {
      const payload = await readJson<UserTestReviewResponse>(
        await fetch(`/api/user/tests/${testId}/review`),
      );

      setParticipantReviewByTestId((currentReviews) => ({
        ...currentReviews,
        [testId]: payload,
      }));
      setVisibleParticipantReviewTestIds((currentIds) => [...new Set([...currentIds, testId])]);
      setFeedback(null);
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Unable to load the test review.");
    } finally {
      setParticipantReviewLoadingByTestId((currentState) => ({
        ...currentState,
        [testId]: false,
      }));
    }
  }

  function startParticipantTest(testId: string) {
    const participantName = participantNamesByTest[testId]?.trim() ?? "";

    if (!participantName) {
      setFeedback("Enter your name before starting the test.");
      return;
    }

    setActiveParticipantTestId(testId);
    setActiveParticipantName(participantName);
    setParticipantAnswers({});
    participantAnswersRef.current = {};
    setCurrentParticipantQuestionIndex(0);
    setParticipantResult(null);
    setParticipantStartedAt(new Date().toISOString());
    setParticipantRemainingMs(null);
    setFeedback(null);
    setResultsMode("tests");
    setTestListFilter("participant");
    setOpenSection("history");
  }

  function cancelActiveParticipantTest() {
    setActiveParticipantTestId(null);
    setActiveParticipantName("");
    setParticipantAnswers({});
    participantAnswersRef.current = {};
    setCurrentParticipantQuestionIndex(0);
    setParticipantStartedAt(null);
    setParticipantRemainingMs(null);
    setFeedback(null);
  }

  async function submitParticipantTest(options?: { dueToTimer?: boolean }) {
    const activeParticipantTest = participantTests.find((test) => test.id === activeParticipantTestId) ?? null;

    if (!activeParticipantTest || !participantStartedAt || participantIsSubmittingRef.current) {
      return;
    }

    setIsMutating(true);
    participantIsSubmittingRef.current = true;

    try {
      const payload = await readJson<AttemptResponse>(
        await fetch(`/api/user/tests/${activeParticipantTest.id}/attempt`, {
          body: JSON.stringify({
            answers: participantAnswersRef.current,
            completedAt: options?.dueToTimer
              ? new Date(
                  new Date(activeParticipantTest.startsAt).getTime() + activeParticipantTest.durationMinutes * 60 * 1000,
                ).toISOString()
              : new Date().toISOString(),
            participantName: activeParticipantName,
            startedAt: participantStartedAt,
          }),
          headers: {
            "Content-Type": "application/json",
          },
          method: "POST",
        }),
      );

      setParticipantResult(payload.resultReleased ? payload.attempt.result : null);
      setActiveParticipantTestId(null);
      setCurrentParticipantQuestionIndex(0);
      setActiveParticipantName("");
      setParticipantStartedAt(null);
      setParticipantRemainingMs(null);
      setParticipantAnswers({});
      participantAnswersRef.current = {};
      setFeedback(
        payload.resultReleased
          ? options?.dueToTimer
            ? "Time is up. Your test was submitted automatically."
            : null
          : `Your test has been submitted. Results will be released after ${formatShortDateTime(payload.resultReleaseAt ?? activeParticipantTest.startsAt)}.`,
      );
      await loadWorkspace();
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Unable to submit this test.");
    } finally {
      setIsMutating(false);
      participantIsSubmittingRef.current = false;
    }
  }

  function handleSelectParticipantAnswer(questionId: string, originalOptionIndex: number) {
    const nextAnswers = {
      ...participantAnswersRef.current,
      [questionId]: originalOptionIndex,
    };

    participantAnswersRef.current = nextAnswers;
    setParticipantAnswers(nextAnswers);
    setFeedback(null);
  }

  function goToPreviousParticipantQuestion() {
    setCurrentParticipantQuestionIndex((currentIndex) => Math.max(currentIndex - 1, 0));
    setFeedback(null);
  }

  function goToNextParticipantQuestion() {
    const activeParticipantTest = participantTests.find((test) => test.id === activeParticipantTestId) ?? null;

    if (!activeParticipantTest) {
      return;
    }

    setCurrentParticipantQuestionIndex((currentIndex) => Math.min(currentIndex + 1, Math.max(activeParticipantTest.questions.length - 1, 0)));
    setFeedback(null);
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

  function formatParticipantAnswerLabel(optionIndex: number | undefined, options: string[]) {
    if (typeof optionIndex !== "number" || optionIndex < 0 || optionIndex >= options.length) {
      return "Not answered";
    }

    return `Option ${optionIndex + 1}: ${options[optionIndex]}`;
  }

  async function handleSearchGroups() {
    if (!groupSearchPhoneNumber.trim()) {
      setGroupSearchFeedback("Enter the admin phone number to search for groups.");
      setGroupSearchResults([]);
      return;
    }

    setIsSearchingGroups(true);

    try {
      const payload = await readJson<GroupSearchResponse>(
        await fetch(`/api/user/groups?phone=${encodeURIComponent(groupSearchPhoneNumber.trim())}`),
      );

      setGroupSearchResults(payload.participantGroups);
      setOutgoingGroupJoinRequests(payload.groupJoinRequests);
      setGroupSearchFeedback(
        payload.participantGroups.length
          ? null
          : "No groups were found for that admin phone number.",
      );
    } catch (error) {
      setGroupSearchResults([]);
      setGroupSearchFeedback(
        error instanceof Error ? error.message : "Unable to search for admin groups.",
      );
    } finally {
      setIsSearchingGroups(false);
    }
  }

  async function handleRequestGroup(groupId: string) {
    setIsSendingGroupRequest(groupId);

    try {
      const payload = await readJson<{ groupJoinRequests: GroupJoinRequest[] }>(
        await fetch("/api/user/groups", {
          body: JSON.stringify({ adminGroupId: groupId }),
          headers: {
            "Content-Type": "application/json",
          },
          method: "POST",
        }),
      );

      setOutgoingGroupJoinRequests(payload.groupJoinRequests);
      setGroupSearchFeedback("Request sent to the admin for review.");
    } catch (error) {
      setGroupSearchFeedback(
        error instanceof Error ? error.message : "Unable to send the group request.",
      );
    } finally {
      setIsSendingGroupRequest(null);
    }
  }

  async function handleResolveOwnGroupInvite(requestId: string, decision: "accept" | "reject") {
    try {
      const payload = await readJson<{ groupJoinRequests: GroupJoinRequest[] }>(
        await fetch("/api/user/groups", {
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

      setOutgoingGroupJoinRequests(payload.groupJoinRequests);
      await loadWorkspace();
      setGroupSearchFeedback(
        decision === "accept"
          ? "Group invitation accepted. You now have access to the group."
          : "Group invitation rejected.",
      );
    } catch (error) {
      setGroupSearchFeedback(
        error instanceof Error ? error.message : "Unable to update the group invitation.",
      );
    }
  }

  function handleDeleteQuestion(questionId: string) {
    if (!window.confirm("Remove this question from the shared bank?")) {
      return;
    }

    void mutateWorkspace(async () => {
      await readJson<QuestionApiResponse>(
        await fetch("/api/admin/questions", {
          body: JSON.stringify({ questionIds: [questionId] }),
          headers: {
            "Content-Type": "application/json",
          },
          method: "DELETE",
        }),
      );

      setSelectedQuestionIds((currentIds) =>
        currentIds.filter((currentId) => currentId !== questionId),
      );
      setFeedback("Question removed from the shared bank.");
    }).catch((error) => {
      setFeedback(error instanceof Error ? error.message : "Unable to remove the question.");
    });
  }

  function toggleQuestionSelection(questionId: string) {
    setSelectedQuestionIds((currentIds) => toggleArrayValue(currentIds, questionId));
  }

  function isMenuGroupActive(group: AdminMenuGroup) {
    if (group === "test") {
      return openSection === "author" || openSection === "question-bank" || openSection === "schedule" || openSection === "self-test";
    }

    if (group === "poll") {
      return openSection === "poll-questions" || openSection === "poll-schedule";
    }

    return openSection === "create-groups" || openSection === "manage-groups" || openSection === "join-groups";
  }

  function renderMenuItem(label: string, section: AdminWorkspaceSection) {
    const lockedPrompt =
      currentActorRole === "user" && currentUserCategory
        ? getSectionUpgradePrompt(section, currentUserCategory)
        : null;

    return (
      <button
        key={section}
        className={`admin-menu-item${openSection === section ? " is-active" : ""}`}
        type="button"
        onClick={() => {
          if (lockedPrompt) {
            openUpgradePanel(lockedPrompt);
            return;
          }

          handleMenuSectionSelection(section);
        }}
      >
        {label}
      </button>
    );
  }

  function renderMenuGroup(
    label: string,
    group: AdminMenuGroup,
    items: Array<{ label: string; section: AdminWorkspaceSection }>,
  ) {
    const isOpen = openMenuGroup === group;
    const isActive = isMenuGroupActive(group);

    return (
      <div className="admin-menu-group" key={group}>
        <button
          aria-expanded={isOpen}
          className={`admin-menu-group-toggle${isOpen || isActive ? " is-active" : ""}`}
          type="button"
          onClick={() => setOpenMenuGroup((currentGroup) => (currentGroup === group ? null : group))}
        >
          <span>{label}</span>
          <span className="admin-menu-group-toggle-symbol" aria-hidden="true">{isOpen ? "▲" : "▼"}</span>
        </button>
        {isOpen ? <div className="admin-menu-substack">{items.map((item) => renderMenuItem(item.label, item.section))}</div> : null}
      </div>
    );
  }

  function handleToggleSelectAllQuestions(questionIds: string[]) {
    if (!questionIds.length) {
      return;
    }

    const allSelected = questionIds.every((questionId) => selectedQuestionIds.includes(questionId));

    setSelectedQuestionIds((currentIds) =>
      allSelected
        ? currentIds.filter((questionId) => !questionIds.includes(questionId))
        : [...new Set([...currentIds, ...questionIds])],
    );
  }

  function handleDeleteSelectedQuestions(questionIds: string[]) {
    if (!questionIds.length) {
      setFeedback("Select at least one question to remove.");
      return;
    }

    const questionCount = questionIds.length;
    const confirmationMessage =
      questionCount === 1
        ? "Remove the selected question from the shared bank?"
        : `Remove ${questionCount} selected questions from the shared bank?`;

    if (!window.confirm(confirmationMessage)) {
      return;
    }

    void mutateWorkspace(async () => {
      await readJson<QuestionApiResponse>(
        await fetch("/api/admin/questions", {
          body: JSON.stringify({ questionIds }),
          headers: {
            "Content-Type": "application/json",
          },
          method: "DELETE",
        }),
      );

      setSelectedQuestionIds((currentIds) =>
        currentIds.filter((questionId) => !questionIds.includes(questionId)),
      );
      setFeedback(
        questionCount === 1
          ? "Question removed from the shared bank."
          : `${questionCount} questions removed from the shared bank.`,
      );
    }).catch((error) => {
      setFeedback(
        error instanceof Error ? error.message : "Unable to remove the selected questions.",
      );
    });
  }

  function handleCopyQuestionsForBulkEdit(
    questionList: Array<Pick<PersistentQuestion, "correctOptionIndex" | "options" | "prompt">>,
  ) {
    if (!questionList.length) {
      setFeedback("No questions are available to copy.");
      return;
    }

    void (async () => {
      try {
        await copyTextToClipboard(questionList.map((question) => formatQuestionForBulkEdit(question)).join("\n\n"));
        setFeedback(
          `Copied ${questionList.length} question${questionList.length === 1 ? "" : "s"} for bulk edits.`,
        );
      } catch (error) {
        setFeedback(error instanceof Error ? error.message : "Unable to copy the questions.");
      }
    })();
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

  function handleTogglePoolShareIdentifier(identifier: string) {
    if (!selectedQuestionBankPool || !selectedQuestionBankPool.canManage) {
      return;
    }

    const nextSharedIdentifiers = selectedQuestionBankPool.sharedWithIdentifiers.includes(identifier)
      ? selectedQuestionBankPool.sharedWithIdentifiers.filter((currentIdentifier) => currentIdentifier !== identifier)
      : [...selectedQuestionBankPool.sharedWithIdentifiers, identifier];

    void mutateWorkspace(async () => {
      const payload = await readJson<PoolsResponse>(
        await fetch("/api/admin/pools", {
          body: JSON.stringify({
            poolId: selectedQuestionBankPool.id,
            sharedWithIdentifiers: nextSharedIdentifiers,
          }),
          headers: {
            "Content-Type": "application/json",
          },
          method: "PATCH",
        }),
      );

      setPools(payload.pools);
      setFeedback(
        nextSharedIdentifiers.includes(identifier)
          ? "Question pool shared successfully."
          : "Question pool sharing updated.",
      );
    }).catch((error) => {
      setFeedback(error instanceof Error ? error.message : "Unable to update question pool sharing.");
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
      const payload = await readJson<QuestionImportResponse>(
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
        `Imported ${payload.importedCount} question${payload.importedCount === 1 ? "" : "s"} into the shared admin bank.`,
      );
      setImportPreview(null);
      setImportText("");
    }).catch((error) => {
      handleWorkspaceActionError(error, "Unable to import the previewed questions.", setImportFeedback);
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
      handleWorkspaceActionError(error, "Unable to create the pool.", setPoolFeedback);
    });
  }

  function handleCreateGroup() {
    if (!groupName.trim()) {
      setGroupFeedback("Group or class name is required.");
      return;
    }

    if (!selectedGroupParticipantIds.length && !groupGenerateInviteLink) {
      setGroupFeedback("Select at least one participant for the group or class.");
      return;
    }

    void mutateWorkspace(async () => {
      await readJson<ParticipantsResponse>(
        await fetch("/api/admin/participants", {
          body: JSON.stringify({
            generateInviteLink: groupGenerateInviteLink,
            inviteJoinMode: groupInviteJoinMode,
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

      setGroupFeedback(
        groupGenerateInviteLink
          ? "Group created. Share the invite link with users so they can join based on this group setting."
          : "Group or class created. Selected users will receive addition requests.",
      );
      setGroupGenerateInviteLink(false);
      setGroupInviteJoinMode("approval-required");
      setGroupName("");
      setSelectedGroupParticipantIds([]);
    }).catch((error) => {
      handleWorkspaceActionError(error, "Unable to create the group.", setGroupFeedback);
    });
  }

  async function handleBrandingFileSelection(file: File | null) {
    if (!file) {
      return;
    }

    try {
      const imageDataUrl = await fileToDataUrl(file);
      setBrandingImageDataUrl(imageDataUrl);
      setBrandingFeedback(null);
    } catch (error) {
      setBrandingFeedback(error instanceof Error ? error.message : "Unable to read the selected image.");
    }
  }

  function handlePreviewPollImport() {
    if (!pollImportText.trim()) {
      setPollImportFeedback("Paste OCR text before previewing the poll import.");
      setPollImportPreview(null);
      return;
    }

    setIsPollImporting(true);
    setPollImportFeedback(null);

    void (async () => {
      try {
        const payload = await readJson<PollBulkImportPreview>(
          await fetch("/api/admin/polls/import/preview", {
            body: JSON.stringify({ text: pollImportText }),
            headers: {
              "Content-Type": "application/json",
            },
            method: "POST",
          }),
        );

        setPollImportPreview(payload);

        if (!payload.totalCount) {
          setPollImportFeedback("No poll question blocks were detected. Separate each question with a blank line.");
          return;
        }

        setPollImportFeedback(
          `${payload.validCount} valid poll question${payload.validCount === 1 ? "" : "s"} ready and ${payload.invalidCount} need review.`,
        );
      } catch (error) {
        setPollImportFeedback(error instanceof Error ? error.message : "Unable to preview the poll OCR import.");
      } finally {
        setIsPollImporting(false);
      }
    })();
  }

  function handleKeepValidPollBlocks() {
    if (!pollImportPreview) {
      return;
    }

    const nextText = pollImportPreview.candidates
      .filter((candidate) => candidate.valid)
      .map((candidate) => candidate.rawText.trim())
      .join("\n\n");

    setPollImportText(nextText);
    setPollImportPreview(null);
    setPollImportFeedback(
      nextText
        ? "Kept only valid poll blocks. Review the text and preview again if needed."
        : "No valid poll blocks were available to keep.",
    );
  }

  function handleCommitPollImport() {
    if (!pollImportPreview?.validCount) {
      setPollImportFeedback("Preview valid poll questions before importing.");
      return;
    }

    const drafts = pollImportPreview.candidates
      .filter((candidate) => candidate.valid)
      .map((candidate) => candidate.draft);

    void mutateWorkspace(async () => {
      await readJson<PollsResponse>(
        await fetch("/api/admin/polls", {
          body: JSON.stringify({
            drafts,
            mode: "create-questions",
          }),
          headers: {
            "Content-Type": "application/json",
          },
          method: "POST",
        }),
      );

      setPollImportFeedback(`Imported ${drafts.length} poll question${drafts.length === 1 ? "" : "s"}.`);
      setPollImportPreview(null);
      setPollImportText("");
    }).catch((error) => {
      handleWorkspaceActionError(error, "Unable to import the previewed poll questions.", setPollImportFeedback);
    });
  }

  async function handleSaveBranding() {
    const nextBranding = normalizeBrandingInput({
      imageDataUrl: brandingImageDataUrl,
      instituteName: brandingInstituteName,
    });

    try {
      const payload = await readJson<BrandingResponse>(
        await fetch("/api/admin/branding", {
          body: JSON.stringify({ branding: nextBranding }),
          headers: {
            "Content-Type": "application/json",
          },
          method: "POST",
        }),
      );

      setWorkspaceBranding(payload.branding);
      setBrandingInstituteName(payload.branding?.instituteName ?? "");
      setBrandingImageDataUrl(payload.branding?.imageDataUrl ?? null);
      setBrandingFeedback(payload.branding ? "Branding saved." : "Branding cleared.");
    } catch (error) {
      setBrandingFeedback(error instanceof Error ? error.message : "Unable to save branding.");
    }
  }

  async function handleClearBranding() {
    setBrandingInstituteName("");
    setBrandingImageDataUrl(null);

    try {
      const payload = await readJson<BrandingResponse>(
        await fetch("/api/admin/branding", {
          body: JSON.stringify({ branding: null }),
          headers: {
            "Content-Type": "application/json",
          },
          method: "POST",
        }),
      );

      setWorkspaceBranding(payload.branding);
      setBrandingInstituteName(payload.branding?.instituteName ?? "");
      setBrandingImageDataUrl(payload.branding?.imageDataUrl ?? null);
      setBrandingFeedback("Branding cleared.");
    } catch (error) {
      setBrandingFeedback(error instanceof Error ? error.message : "Unable to clear branding.");
    }
  }

  function handleSchedulePoll() {
    const typedDrafts = pollScheduleTypedDrafts.filter((draft) =>
      draft.prompt.trim() || draft.topic.trim() || draft.options.some((option) => option.trim()),
    );

    if (!pollQuestions.length && !typedDrafts.length) {
      setPollFeedback("Add poll questions before scheduling a poll.");
      return;
    }

    if (!pollScheduleQuestionIds.length && !typedDrafts.length) {
      setPollFeedback("Select at least one poll question.");
      return;
    }

    for (const draft of typedDrafts) {
      const validationError = validatePollQuestionDraft(draft);

      if (validationError) {
        setPollFeedback(validationError);
        return;
      }
    }

    if (!pollScheduleStartsAtInput || Number.isNaN(new Date(pollScheduleStartsAtInput).getTime())) {
      setPollFeedback("Choose a valid poll start date and time.");
      return;
    }

    const durationMinutes = Number(pollScheduleDurationMinutes);

    if (!Number.isFinite(durationMinutes) || durationMinutes < 1) {
      setPollFeedback("Poll duration must be at least 1 minute.");
      return;
    }

    const startsAt = new Date(pollScheduleStartsAtInput).toISOString();
    const endsAt = new Date(new Date(startsAt).getTime() + durationMinutes * 60 * 1000).toISOString();

    if (pollScheduleParticipantType === "registered" && !pollScheduleGroupIds.length) {
      setPollFeedback("Select at least one group when sharing a poll with groups.");
      return;
    }

    const selectedQuestions = pollQuestions.filter((question) => pollScheduleQuestionIds.includes(question.id));
    const selectedTopics = Array.from(
      new Set([
        ...selectedQuestions.map((question) => question.topic.trim()),
        ...typedDrafts.map((draft) => draft.topic.trim()),
      ].filter(Boolean)),
    );
    const title = pollScheduleTitle.trim()
      || (selectedTopics.length === 1
        ? selectedTopics[0]
        : `${pollScheduleQuestionIds.length + typedDrafts.length} question poll`);

    void mutateWorkspace(async () => {
      await readJson<PollsResponse>(
        await fetch("/api/admin/polls", {
          body: JSON.stringify({
            anonymous: pollScheduleAnonymous,
            branding: normalizeBrandingInput(workspaceBranding),
            endsAt,
            generateQrCode: pollScheduleParticipantType === "open",
            mode: editingScheduledPollId ? "update-poll" : "schedule-poll",
            drafts: typedDrafts,
            participantGroupIds:
              pollScheduleParticipantType === "registered" ? pollScheduleGroupIds : [],
            participantType: pollScheduleParticipantType,
            pollId: editingScheduledPollId,
            questionIds: pollScheduleQuestionIds,
            startsAt,
            title,
          }),
          headers: {
            "Content-Type": "application/json",
          },
          method: "POST",
        }),
      );

      setPollFeedback(editingScheduledPollId ? "Poll updated." : "Poll scheduled.");
      resetPollScheduleForm();
    }).catch((error) => {
      handleWorkspaceActionError(error, "Unable to save the poll.", setPollFeedback);
    });
  }

  function handleAddTypedPollScheduleDraft() {
    setPollScheduleTypedDrafts((currentDrafts) => [...currentDrafts, createEmptyPollScheduleDraft()]);
  }

  function handleUpdateTypedPollScheduleDraft(
    draftIndex: number,
    updater: (draft: EditablePollScheduleDraft) => EditablePollScheduleDraft,
  ) {
    setPollScheduleTypedDrafts((currentDrafts) =>
      currentDrafts.map((draft, currentIndex) => (currentIndex === draftIndex ? updater(draft) : draft)),
    );
  }

  function handleRemoveTypedPollScheduleDraft(draftIndex: number) {
    setPollScheduleTypedDrafts((currentDrafts) =>
      currentDrafts.filter((_, currentIndex) => currentIndex !== draftIndex),
    );
  }

  function toggleOpenPollResultDetails(pollId: string) {
    setExpandedOpenPollResultIds((currentIds) => toggleArrayValue(currentIds, pollId));
  }

  function toggleTestResultCollapse(testId: string) {
    setCollapsedTestResultIds((currentIds) => toggleArrayValue(currentIds, testId));
  }

  function handleStartEditingGroup(group: ParticipantGroup) {
    setEditingGroupId(group.id);
    setEditingGroupDraft({
      generateInviteLink: Boolean(group.shareCode),
      inviteJoinMode: group.inviteJoinMode,
      name: group.name,
      participantIds: [...group.participantIds],
      shareCode: group.shareCode,
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
            generateInviteLink: editingGroupDraft.generateInviteLink,
            groupId: editingGroupId,
            inviteJoinMode: editingGroupDraft.inviteJoinMode,
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

      setGroupFeedback(
        editingGroupDraft.generateInviteLink
          ? "Group updated. Share the invite link with users so they can join based on this group setting."
          : "Group updated. New users will receive addition requests.",
      );
      setEditingGroupId(null);
      setEditingGroupDraft(null);
    }).catch((error) => {
      handleWorkspaceActionError(error, "Unable to update the group.", setGroupFeedback);
    });
  }

  function handleScheduleTest() {
    if (!schedulePoolId) {
      setScheduleFeedback("Select a question pool first.");
      return;
    }

    const durationMinutes = Number(scheduleDurationMinutes);
    const questionCount = Number(scheduleQuestionCount);

    if (!Number.isFinite(durationMinutes) || durationMinutes < 1) {
      setScheduleFeedback("Duration must be at least 1 minute.");
      return;
    }

    if (!Number.isFinite(questionCount) || questionCount < 1) {
      setScheduleFeedback("Question count must be at least 1.");
      return;
    }

    if (scheduleGenerateInviteLink && scheduleParticipantGroupIds.length !== 1) {
      setScheduleFeedback("Invite links require exactly one selected group.");
      return;
    }

    if (!scheduleStartsAtInput || Number.isNaN(new Date(scheduleStartsAtInput).getTime())) {
      setScheduleFeedback("Choose a valid test date and time.");
      return;
    }

    const startsAt = new Date(scheduleStartsAtInput).toISOString();

    void mutateWorkspace(async () => {
      await readJson<ScheduledTestsResponse>(
        await fetch("/api/admin/tests", {
          body: JSON.stringify({
            branding: normalizeBrandingInput(workspaceBranding),
            durationMinutes,
            generateInviteLink: scheduleGenerateInviteLink,
            inviteJoinMode: scheduleInviteJoinMode,
            participantGroupIds: scheduleParticipantGroupIds,
            participantIds: [],
            poolId: schedulePoolId,
            questionCount,
            startsAt,
            testId: editingScheduledTestId,
            title: scheduleTitle.trim(),
          }),
          headers: {
            "Content-Type": "application/json",
          },
          method: editingScheduledTestId ? "PATCH" : "POST",
        }),
      );

      setScheduleFeedback(editingScheduledTestId ? "Test updated." : "Test scheduled.");
      resetScheduledTestForm();
    }).catch((error) => {
      handleWorkspaceActionError(error, "Unable to save the test.", setScheduleFeedback);
    });
  }

  function handleScheduleSelfTest() {
    if (!currentAdminIdentifier) {
      setSelfTestFeedback("Your account needs a participant identifier before you can create a self test.");
      return;
    }

    if (!selfTestPoolId) {
      setSelfTestFeedback("Select a question pool first.");
      return;
    }

    const durationMinutes = Number(selfTestDurationMinutes);
    const questionCount = Number(selfTestQuestionCount);
    const startsAt =
      selfTestStartMode === "now"
        ? new Date().toISOString()
        : new Date(selfTestStartsAtInput).toISOString();

    if (!Number.isFinite(durationMinutes) || durationMinutes < 1) {
      setSelfTestFeedback("Duration must be at least 1 minute.");
      return;
    }

    if (!Number.isFinite(questionCount) || questionCount < 1) {
      setSelfTestFeedback("Question count must be at least 1.");
      return;
    }

    if (
      selfTestStartMode === "later" &&
      (!selfTestStartsAtInput || Number.isNaN(new Date(selfTestStartsAtInput).getTime()))
    ) {
      setSelfTestFeedback("Choose a valid future date and time.");
      return;
    }

    void mutateWorkspace(async () => {
      await readJson<ScheduledTestsResponse>(
        await fetch("/api/admin/tests", {
          body: JSON.stringify({
            branding: normalizeBrandingInput(workspaceBranding),
            durationMinutes,
            participantGroupIds: [],
            participantIds: [currentAdminIdentifier],
            poolId: selfTestPoolId,
            questionCount,
            startsAt,
            testId: editingSelfTestId,
            title: selfTestTitle.trim(),
          }),
          headers: {
            "Content-Type": "application/json",
          },
          method: editingSelfTestId ? "PATCH" : "POST",
        }),
      );

      setSelfTestFeedback(editingSelfTestId ? "Self test updated." : "Self test scheduled.");
      resetSelfTestForm();
      setResultsMode("tests");
      setTestListFilter("both");
      setOpenSection("history");
    }).catch((error) => {
      handleWorkspaceActionError(error, "Unable to save the self test.", setSelfTestFeedback);
    });
  }

  const selectedPool = pools.find((pool) => pool.id === schedulePoolId) ?? null;
  const selectedSelfTestPool = pools.find((pool) => pool.id === selfTestPoolId) ?? null;
  const selectedQuestionBankPool = pools.find((pool) => pool.id === selectedQuestionBankPoolId) ?? null;
  const participantHistoryByTestId = new Map(
    participantTestHistory.map((entry) => [entry.testId, entry]),
  );
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
  const filteredQuestionBankQuestionIds = filteredQuestionBankQuestions
    .filter((question) => question.canManage)
    .map((question) => question.id);
  const selectedVisibleQuestionIds = filteredQuestionBankQuestionIds.filter((questionId) =>
    selectedQuestionIds.includes(questionId),
  );
  const areAllVisibleQuestionsSelected =
    filteredQuestionBankQuestionIds.length > 0 &&
    filteredQuestionBankQuestionIds.every((questionId) => selectedQuestionIds.includes(questionId));
  const questionBankQuestionPositionById = new Map(
    filteredQuestionBankQuestions.map((question, index) => [question.id, index + 1]),
  );
  const duplicateQuestionGroupsBySignature = new Map<string, WorkspaceQuestion[]>();

  for (const question of filteredQuestionBankQuestions) {
    const signature = createQuestionDuplicateSignature(question);
    const existingQuestions = duplicateQuestionGroupsBySignature.get(signature);

    if (existingQuestions) {
      existingQuestions.push(question);
    } else {
      duplicateQuestionGroupsBySignature.set(signature, [question]);
    }
  }

  const duplicateQuestionGroups = Array.from(duplicateQuestionGroupsBySignature.entries())
    .filter(([, duplicateQuestions]) => duplicateQuestions.length > 1)
    .map(([signature, duplicateQuestions]) => ({
      questions: duplicateQuestions,
      signature,
    }));
  const removableDuplicateQuestionIds = Array.from(new Set(
    duplicateQuestionGroups.flatMap((duplicateGroup) =>
      duplicateGroup.questions
        .slice(1)
        .filter((question) => question.canManage)
        .map((question) => question.id),
    ),
  ));
  const duplicateQuestionGroupByQuestionId = new Map<
    string,
    {
      questions: WorkspaceQuestion[];
      signature: string;
    }
  >();

  for (const duplicateGroup of duplicateQuestionGroups) {
    for (const question of duplicateGroup.questions) {
      duplicateQuestionGroupByQuestionId.set(question.id, duplicateGroup);
    }
  }

  const filteredShareableParticipants = participants.filter((participant) => {
    if (currentAdminIdentifier && participantIdentifiersMatch(participant.identifier, currentAdminIdentifier)) {
      return false;
    }

    const query = poolShareSearch.trim();

    if (!query) {
      return false;
    }

    return matchesParticipantSearch(participant, query);
  });
  const mergedTestListMap = new Map<string, UnifiedAdminTestListItem>();

  for (const scheduledTest of sortedScheduledTests) {
    mergedTestListMap.set(scheduledTest.id, {
      durationMinutes: scheduledTest.durationMinutes,
      hasAdminScope: true,
      hasParticipantScope: false,
      id: scheduledTest.id,
      poolId: scheduledTest.poolId,
      questionCount: scheduledTest.questionCount,
      scheduledTest,
      startsAt: scheduledTest.startsAt,
      status: scheduledTest.status,
      title: scheduledTest.title,
    });
  }

  for (const participantTest of participantTests) {
    const existingItem = mergedTestListMap.get(participantTest.id);

    mergedTestListMap.set(participantTest.id, {
      durationMinutes: existingItem?.durationMinutes ?? participantTest.durationMinutes,
      hasAdminScope: existingItem?.hasAdminScope ?? false,
      hasParticipantScope: true,
      id: participantTest.id,
      participantHistoryEntry: participantHistoryByTestId.get(participantTest.id),
      participantTest,
      poolId: existingItem?.poolId ?? participantTest.poolId,
      questionCount: existingItem?.questionCount ?? participantTest.questionCount,
      scheduledTest: existingItem?.scheduledTest,
      startsAt: existingItem?.startsAt ?? participantTest.startsAt,
      status: existingItem?.status ?? participantTest.status,
      title: existingItem?.title ?? participantTest.title,
    });
  }

  const filteredMergedTests = Array.from(mergedTestListMap.values())
    .filter((test) => {
      if (testListFilter === "admin") {
        return test.hasAdminScope;
      }

      if (testListFilter === "participant") {
        return test.hasParticipantScope;
      }

      return true;
    })
    .sort((leftTest, rightTest) => {
      const priorityDifference =
        adminTestStatusPriority[leftTest.status] - adminTestStatusPriority[rightTest.status];

      if (priorityDifference !== 0) {
        return priorityDifference;
      }

      const rightTime = new Date(
        rightTest.status === "completed"
          ? rightTest.participantHistoryEntry?.completedAt ?? rightTest.startsAt
          : rightTest.startsAt,
      ).getTime();
      const leftTime = new Date(
        leftTest.status === "completed"
          ? leftTest.participantHistoryEntry?.completedAt ?? leftTest.startsAt
          : leftTest.startsAt,
      ).getTime();

      return rightTime - leftTime;
    });
  const activeParticipantTest = participantTests.find((test) => test.id === activeParticipantTestId) ?? null;
  const shuffledParticipantQuestions = activeParticipantTest
    ? createPresentedQuestions(
        activeParticipantTest.questions,
        `${activeParticipantTest.id}:${currentAdminIdentifier || "participant"}`,
      ).map(
        (presentedQuestion) =>
          ({
            displayOptions: presentedQuestion.displayOptions,
            originalOptionIndexes: presentedQuestion.originalOptionIndexes,
            question: presentedQuestion.question,
          }) satisfies ShuffledQuestion,
      )
    : [];
  const activeParticipantQuestion =
    activeParticipantTest && currentParticipantQuestionIndex < shuffledParticipantQuestions.length
      ? shuffledParticipantQuestions[currentParticipantQuestionIndex]
      : null;
  const groupMenuItems: Array<{ label: string; section: AdminWorkspaceSection }> = [
    { label: "Create", section: "create-groups" },
    { label: "Manage", section: "manage-groups" },
    ...(activeParticipantTestId
      ? []
      : ([{ label: "Join", section: "join-groups" }] satisfies Array<{ label: string; section: AdminWorkspaceSection }>)),
  ];
  const sortedScheduledPolls = [...scheduledPolls].sort((leftPoll, rightPoll) => {
    const priorityDifference =
      adminTestStatusPriority[leftPoll.status] - adminTestStatusPriority[rightPoll.status];

    if (priorityDifference !== 0) {
      return priorityDifference;
    }

    return new Date(rightPoll.startsAt).getTime() - new Date(leftPoll.startsAt).getTime();
  });
  const mergedPollListMap = new Map<string, UnifiedAdminPollListItem>();

  for (const scheduledPoll of sortedScheduledPolls) {
    mergedPollListMap.set(scheduledPoll.id, {
      hasAdminScope: true,
      hasParticipantScope: false,
      id: scheduledPoll.id,
      scheduledPoll,
      startsAt: scheduledPoll.startsAt,
      status: scheduledPoll.status,
      title: scheduledPoll.title,
    });
  }

  for (const participantPoll of participantPolls) {
    const existingItem = mergedPollListMap.get(participantPoll.id);

    mergedPollListMap.set(participantPoll.id, {
      hasAdminScope: existingItem?.hasAdminScope ?? false,
      hasParticipantScope: true,
      id: participantPoll.id,
      participantPoll,
      scheduledPoll: existingItem?.scheduledPoll,
      startsAt: existingItem?.startsAt ?? participantPoll.startsAt,
      status: existingItem?.status ?? participantPoll.status,
      title: existingItem?.title ?? participantPoll.title,
    });
  }

  const filteredMergedPolls = Array.from(mergedPollListMap.values())
    .filter((poll) => {
      if (testListFilter === "admin") {
        return poll.hasAdminScope;
      }

      if (testListFilter === "participant") {
        return poll.hasParticipantScope;
      }

      return true;
    })
    .sort((leftPoll, rightPoll) => {
      const priorityDifference =
        adminTestStatusPriority[leftPoll.status] - adminTestStatusPriority[rightPoll.status];

      if (priorityDifference !== 0) {
        return priorityDifference;
      }

      return new Date(rightPoll.startsAt).getTime() - new Date(leftPoll.startsAt).getTime();
    });
  const notificationBaseline = previousSignInAt ? new Date(previousSignInAt).getTime() : null;
  const notificationTests = currentActorRole === "user" ? participantTests : sortedScheduledTests;
  const notificationPolls = currentActorRole === "user" ? participantPolls : sortedScheduledPolls;
  const liveTestsCount = notificationTests.filter((test) => test.status === "live").length;
  const livePollsCount = notificationPolls.filter((poll) => poll.status === "live").length;
  const upcomingTestsCount = notificationTests.filter((test) => test.status === "scheduled").length;
  const upcomingPollsCount = notificationPolls.filter((poll) => poll.status === "scheduled").length;
  const releasedTestResultsCount = notificationBaseline === null
    ? notificationTests.filter((test) => test.status === "completed").length
    : notificationTests.filter(
      (test) => test.status === "completed" && getTestReleaseTimestamp(test) > notificationBaseline,
    ).length;
  const releasedPollResultsCount = notificationBaseline === null
    ? notificationPolls.filter((poll) => poll.status === "completed").length
    : notificationPolls.filter(
      (poll) => poll.status === "completed" && new Date(poll.updatedAt).getTime() > notificationBaseline,
    ).length;
  const pendingOutgoingGroupRequestCount = currentActorRole === "user"
    ? outgoingGroupJoinRequests.filter((request) => request.status === "pending").length
    : 0;
  const acceptedOutgoingGroupRequestCount = currentActorRole === "user"
    ? (notificationBaseline === null
      ? outgoingGroupJoinRequests.filter((request) => request.status === "accepted").length
      : outgoingGroupJoinRequests.filter(
        (request) =>
          request.status === "accepted"
          && request.resolvedAt
          && new Date(request.resolvedAt).getTime() > notificationBaseline,
      ).length)
    : 0;
  const notificationItems: NotificationBellItem[] = [
    { count: liveTestsCount + livePollsCount, label: "Live tests and polls" },
    { count: upcomingTestsCount + upcomingPollsCount, label: "Upcoming tests and polls" },
    { count: releasedTestResultsCount + releasedPollResultsCount, label: "Released results" },
    ...(currentActorRole === "user"
      ? [{
        count: pendingOutgoingGroupRequestCount + acceptedOutgoingGroupRequestCount,
        label: "Group requests and acceptances",
      } satisfies NotificationBellItem]
      : []),
  ];
  const brandingPreview = normalizeBrandingInput({
    imageDataUrl: brandingImageDataUrl,
    instituteName: brandingInstituteName,
  });
  const notificationSubtitle = notificationBaseline === null
    ? "Counts reflect the current workspace state."
    : currentActorRole === "user"
      ? "Released results and accepted group requests are measured from your previous sign in."
      : "Released results are measured from your previous sign in.";
  const filteredManagedUsers = categoryManagement?.managedUsers.filter((user) => {
    const query = categorySearchQuery.trim().toLowerCase();
    const normalizedQueryCandidates = Array.from(getParticipantIdentifierCandidates(query));

    if (!query) {
      return false;
    }

    const haystack = [user.identifier, user.displayName ?? "", user.userSub ?? ""]
      .join(" ")
      .toLowerCase();

    return haystack.includes(query) || normalizedQueryCandidates.some((candidate) => haystack.includes(candidate));
  }) ?? [];
  const pendingCategoryRequests = categoryManagement?.requests.filter((request) => request.status === "pending") ?? [];
  const userPendingCategoryRequest = categorySnapshot?.requests.find((request) => request.status === "pending") ?? null;
  const latestResolvedCategoryRequest = categorySnapshot?.requests.find((request) => request.status !== "pending") ?? null;
  const selectedManagedUser = categoryManagement?.managedUsers.find((user) => user.identifier === categoryAssignmentIdentifier) ?? null;
  const nextUpgradeableCategory = currentUserCategory
    ? findNextNormalUserCategory(currentUserCategory, (candidate) => candidate !== currentUserCategory)
    : null;
  const suggestedUpgradeCategory = upgradePrompt?.targetCategory ?? nextUpgradeableCategory;
  const suggestedUpgradePlans = currentUserCategory && categorySnapshot
    ? categorySnapshot.availableCategories.filter(
        (plan) => orderedNormalUserCategories.indexOf(plan.category) > orderedNormalUserCategories.indexOf(currentUserCategory),
      )
    : [];
  const membershipUpgradePlans = currentUserCategory && categorySnapshot
    ? [
        {
          category: currentUserCategory,
          definition: normalUserCategoryDefinitions[currentUserCategory],
          label: categorySnapshot.currentCategoryLabel,
        },
        ...suggestedUpgradePlans,
      ]
    : [];
  const totalManagedUsers = categoryManagement?.managedUsers.length ?? 0;
  const userPlanDistribution = orderedNormalUserCategories.map((category) => {
    const count = categoryManagement?.managedUsers.filter((user) => user.currentCategory === category).length ?? 0;

    return {
      category,
      count,
      label: normalUserCategoryDefinitions[category].label,
      share: formatCountShare(count, totalManagedUsers),
    };
  });
  const latestResolvedCategoryMessage = latestResolvedCategoryRequest
    ? latestResolvedCategoryRequest.status === "accepted"
      ? `Your upgrade request for ${normalUserCategoryDefinitions[latestResolvedCategoryRequest.requestedCategory].label} was approved${latestResolvedCategoryRequest.approvedDurationMonths ? ` for ${latestResolvedCategoryRequest.approvedDurationMonths === 12 ? "1 year" : "3 months"}` : ""}.`
      : `Your upgrade request for ${normalUserCategoryDefinitions[latestResolvedCategoryRequest.requestedCategory].label} was rejected.`
    : null;

  useEffect(() => {
    const visibleQuestionIds = new Set(
      selectedQuestionBankPoolId
        ? questions
            .filter(
              (question) => question.poolIds.includes(selectedQuestionBankPoolId) && question.canManage,
            )
            .map((question) => question.id)
        : [],
    );

    setSelectedQuestionIds((currentIds) => {
      const nextIds = currentIds.filter((questionId) => visibleQuestionIds.has(questionId));

      return nextIds.length === currentIds.length ? currentIds : nextIds;
    });
  }, [questions, selectedQuestionBankPoolId]);

  useEffect(() => {
    const availablePollQuestionIds = new Set(pollQuestions.map((question) => question.id));

    setPollScheduleQuestionIds((currentIds) =>
      currentIds.filter((questionId) => availablePollQuestionIds.has(questionId)),
    );
  }, [pollQuestions]);

  useEffect(() => {
    const availableGroupIds = new Set(participantGroups.map((group) => group.id));

    setPollScheduleGroupIds((currentIds) =>
      currentIds.filter((groupId) => availableGroupIds.has(groupId)),
    );
  }, [participantGroups]);

  useEffect(() => {
    if (!isSuperAdmin) {
      return;
    }

    if (!categoryManagement?.managedUsers.length) {
      setCategoryAssignmentIdentifier("");
      return;
    }

    if (
      categoryAssignmentIdentifier
      && !categoryManagement.managedUsers.some((user) => user.identifier === categoryAssignmentIdentifier)
    ) {
      setCategoryAssignmentIdentifier("");
    }
  }, [categoryAssignmentIdentifier, categoryManagement?.managedUsers, isSuperAdmin]);

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
      handleWorkspaceActionError(error, "Unable to update the request.", setGroupFeedback);
    });
  }

  async function handleRequestCategoryUpgrade(requestedCategory: NormalUserCategory) {
    try {
      const payload = await readJson<UserCategorySnapshotResponse>(
        await fetch("/api/user/category", {
          body: JSON.stringify({ requestedCategory }),
          headers: {
            "Content-Type": "application/json",
          },
          method: "POST",
        }),
      );

      setCategorySnapshot(payload);
      setCategoryFeedback("Upgrade request sent to the super admin for review.");
      setUpgradePrompt((currentPrompt) =>
        currentPrompt
          ? {
              ...currentPrompt,
              targetCategory: requestedCategory,
            }
          : currentPrompt,
      );
    } catch (error) {
      setCategoryFeedback(error instanceof Error ? error.message : "Unable to send the upgrade request.");
    }
  }

  async function handleResolveCategoryRequest(requestId: string, decision: "accept" | "reject", durationMonths?: 3 | 12) {
    try {
      const payload = await readJson<SuperAdminCategoryManagementResponse>(
        await fetch("/api/admin/user-categories", {
          body: JSON.stringify({
            decision,
            durationMonths,
            mode: "resolve-request",
            requestId,
          }),
          headers: {
            "Content-Type": "application/json",
          },
          method: "POST",
        }),
      );

      setCategoryManagement(payload);
      setCategoryManagementFeedback(
        decision === "accept"
          ? `Request accepted for ${durationMonths === 12 ? "1 year" : "3 months"}.`
          : "Request rejected.",
      );
    } catch (error) {
      setCategoryManagementFeedback(
        error instanceof Error ? error.message : "Unable to update the category request.",
      );
    }
  }

  async function handleAssignUserCategory() {
    if (!categoryAssignmentIdentifier.trim()) {
      setCategoryManagementFeedback("Select a user before changing the category.");
      return;
    }

    try {
      const payload = await readJson<SuperAdminCategoryManagementResponse>(
        await fetch("/api/admin/user-categories", {
          body: JSON.stringify({
            category: categoryAssignmentCategory,
            durationMonths: categoryAssignmentCategory === "trapit-normal" ? null : categoryAssignmentDurationMonths,
            mode: "assign-category",
            userIdentifier: categoryAssignmentIdentifier,
            userSub: categoryManagement?.managedUsers.find((user) => user.identifier === categoryAssignmentIdentifier)?.userSub ?? null,
          }),
          headers: {
            "Content-Type": "application/json",
          },
          method: "POST",
        }),
      );

      setCategoryManagement(payload);
      setCategoryManagementFeedback("User category updated.");
    } catch (error) {
      setCategoryManagementFeedback(
        error instanceof Error ? error.message : "Unable to update the user category.",
      );
    }
  }

  return (
    <div className="workspace-stack">
      <div className="workspace-toolbar">
        <div className="workspace-overflow" ref={toolbarMenuRef}>
          <button
            aria-expanded={isOverflowMenuOpen}
            aria-haspopup="dialog"
            className="workspace-overflow-button"
            type="button"
            onClick={() => {
              setToolbarMenuView("menu");
              setIsOverflowMenuOpen((current) => !current);
            }}
          >
            <span aria-hidden="true">...</span>
            <span className="sr-only">Open workspace actions</span>
          </button>

          {isOverflowMenuOpen ? (
            <div className="workspace-overflow-panel panel" role="dialog">
              {toolbarMenuView === "menu" ? (
                <div className="workspace-overflow-stack">
                  <p className="eyebrow">Workspace actions</p>
                  {currentActorRole === "user" ? (
                    <button
                      className="workspace-overflow-action"
                      type="button"
                      onClick={() => {
                        openUpgradePanel();
                        setIsOverflowMenuOpen(false);
                      }}
                    >
                      {isUpgradePanelOpen ? "Hide upgrade" : "Upgrade"}
                    </button>
                  ) : null}
                  {isSuperAdmin ? (
                    <button
                      className="workspace-overflow-action"
                      type="button"
                      onClick={() => {
                        setIsManageUpgradesPanelOpen((current) => !current);
                        setIsOverflowMenuOpen(false);
                      }}
                    >
                      {isManageUpgradesPanelOpen ? "Hide manage upgrades" : "Manage upgrades"}
                    </button>
                  ) : null}
                  {isSuperAdmin ? (
                    <button
                      className="workspace-overflow-action"
                      type="button"
                      onClick={() => setToolbarMenuView("user-details")}
                    >
                      User details
                    </button>
                  ) : null}
                  <button
                    className="workspace-overflow-action"
                    type="button"
                    onClick={() => setToolbarMenuView("notifications")}
                  >
                    Notifications
                  </button>
                  {!isSuperAdmin ? (
                    <button
                      className="workspace-overflow-action"
                      type="button"
                      onClick={() => setToolbarMenuView("branding")}
                    >
                      Branding
                    </button>
                  ) : null}
                </div>
              ) : null}

              {toolbarMenuView === "notifications" ? (
                <div className="workspace-overflow-stack">
                  <div className="workspace-overflow-head">
                    <button className="button-secondary small-button" type="button" onClick={() => setToolbarMenuView("menu")}>
                      Back
                    </button>
                    <p className="eyebrow">Notifications</p>
                  </div>
                  <h2 className="section-title">{currentActorRole === "user" ? "Workspace alerts" : "Admin workspace alerts"}</h2>
                  <p className="muted-text notification-panel-subtitle">{notificationSubtitle}</p>
                  <div className="notification-panel-list">
                    {notificationItems.map((item) => (
                      <div className="notification-panel-item" key={item.label}>
                        <span>{item.label}</span>
                        <strong>{item.count}</strong>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              {toolbarMenuView === "user-details" ? (
                <div className="workspace-overflow-stack">
                  <div className="workspace-overflow-head">
                    <button className="button-secondary small-button" type="button" onClick={() => setToolbarMenuView("menu")}>
                      Back
                    </button>
                    <p className="eyebrow">User details</p>
                  </div>
                  <h2 className="section-title">Registered users</h2>
                  <div className="notification-panel-item user-detail-summary-card">
                    <span>Total registered users</span>
                    <strong>{totalManagedUsers}</strong>
                  </div>
                  {categoryManagement ? (
                    <div className="notification-panel-list">
                      {userPlanDistribution.map((plan) => (
                        <div className="notification-panel-item user-detail-plan-row" key={plan.category}>
                          <div className="user-detail-plan-copy">
                            <strong>{plan.label.replace(/ users$/i, " user")}</strong>
                            <span className="muted-text">{plan.share} of registered users</span>
                          </div>
                          <strong>{plan.count}</strong>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="muted-text">Unable to load user distribution right now.</p>
                  )}
                </div>
              ) : null}

              {toolbarMenuView === "branding" ? (
                <div className="workspace-overflow-stack">
                  <div className="workspace-overflow-head">
                    <button className="button-secondary small-button" type="button" onClick={() => setToolbarMenuView("menu")}>
                      Back
                    </button>
                    <p className="eyebrow">Branding</p>
                  </div>
                  <h2 className="section-title">Institute branding</h2>
                  <div className="form-stack">
                    <div className="field">
                      <label htmlFor="branding-institute-name">Institute name</label>
                      <input
                        id="branding-institute-name"
                        placeholder="Enter institute name"
                        value={brandingInstituteName}
                        onChange={(event) => setBrandingInstituteName(event.target.value)}
                      />
                    </div>
                    <div className="field">
                      <label htmlFor="branding-image">Logo or branding image</label>
                      <input
                        accept="image/*"
                        id="branding-image"
                        type="file"
                        onChange={(event) => void handleBrandingFileSelection(event.target.files?.[0] ?? null)}
                      />
                    </div>
                    {brandingPreview?.imageDataUrl ? (
                      <div className="branding-preview-card">
                        <img alt="Branding preview" className="branding-preview-image" src={brandingPreview.imageDataUrl} />
                      </div>
                    ) : null}
                    {brandingFeedback ? <p className="muted-text">{brandingFeedback}</p> : null}
                    <div className="inline-actions">
                      <button className="button" disabled={isMutating} type="button" onClick={() => void handleSaveBranding()}>
                        Save branding
                      </button>
                      <button
                        className="button-secondary"
                        disabled={isMutating || (!brandingInstituteName.trim() && !brandingImageDataUrl)}
                        type="button"
                        onClick={() => void handleClearBranding()}
                      >
                        Clear form
                      </button>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      <div className="admin-shell">
        <aside className="admin-menu panel workspace-card">
          <div className="section-head compact-head">
            <div>
              <p className="eyebrow">Workspace menu</p>
              <h2 className="section-title">Admin navigation</h2>
            </div>
          </div>
          <div className="admin-menu-stack">
            <div className="admin-menu-group">
              {renderMenuItem("Home", "history")}
            </div>
            {renderMenuGroup("Test", "test", [
              { label: "Add Questions", section: "author" },
              { label: "Question Pools", section: "question-bank" },
              { label: "Schedule", section: "schedule" },
              { label: "Self Test", section: "self-test" },
            ])}
            {renderMenuGroup("Poll", "poll", [
              { label: "Add Questions", section: "poll-questions" },
              { label: "Schedule", section: "poll-schedule" },
            ])}
            {renderMenuGroup("Groups", "groups", groupMenuItems)}
          </div>
        </aside>

        <div className="admin-main-column">
          {currentActorRole === "user" && categorySnapshot && isUpgradePanelOpen ? (
            <section className="panel workspace-card">
              <div className="section-head compact-head">
                <div>
                  <p className="eyebrow">Membership</p>
                  <h2 className="section-title">Upgrade membership</h2>
                  <p className="muted-text">
                    Review the next available upgrade, see what it unlocks, and send your request from this workspace.
                  </p>
                </div>
                <button className="button-secondary small-button" type="button" onClick={() => setIsUpgradePanelOpen(false)}>
                  Close
                </button>
              </div>
              {membershipUpgradePlans.length ? (
                <div className="leaderboard-table-wrap membership-upgrade-table-wrap">
                  <table className="leaderboard-table membership-upgrade-table">
                        <thead>
                          <tr>
                            <th scope="col">Feature</th>
                            {membershipUpgradePlans.map((plan) => {
                              const isCurrentPlan = plan.category === currentUserCategory;
                              const isHighlighted = plan.category === suggestedUpgradeCategory;

                              return (
                                <th
                                  key={plan.category}
                                  className={[
                                    "membership-upgrade-column",
                                    isCurrentPlan ? "is-current" : "",
                                    isHighlighted ? "is-recommended" : "",
                                  ].filter(Boolean).join(" ")}
                                  scope="col"
                                >
                                  <strong>{plan.label.replace(/ users$/i, " user")}</strong>
                                </th>
                              );
                            })}
                          </tr>
                        </thead>
                        <tbody>
                          <tr>
                            <th scope="row">Pools</th>
                            {membershipUpgradePlans.map((plan) => (
                              <td key={`${plan.category}-pools`}>{formatMembershipCount(plan.definition.test.maxQuestionPools)}</td>
                            ))}
                          </tr>
                          <tr>
                            <th scope="row">Questions / pool</th>
                            {membershipUpgradePlans.map((plan) => (
                              <td key={`${plan.category}-questions`}>{formatMembershipQuestionsPerPool(plan.definition)}</td>
                            ))}
                          </tr>
                          <tr>
                            <th scope="row">Scheduled tests / month</th>
                            {membershipUpgradePlans.map((plan) => (
                              <td key={`${plan.category}-scheduled-tests`}>{formatMembershipCount(plan.definition.test.maxScheduledTestsPerMonth)}</td>
                            ))}
                          </tr>
                          <tr>
                            <th scope="row">Self tests / month</th>
                            {membershipUpgradePlans.map((plan) => (
                              <td key={`${plan.category}-self-tests`}>{formatMembershipCount(plan.definition.test.maxSelfTestsPerMonth)}</td>
                            ))}
                          </tr>
                          <tr>
                            <th scope="row">Poll scheduling</th>
                            {membershipUpgradePlans.map((plan) => (
                              <td key={`${plan.category}-poll-schedule`}>{formatMembershipBoolean(plan.definition.poll.schedule)}</td>
                            ))}
                          </tr>
                          <tr>
                            <th scope="row">Open polls</th>
                            {membershipUpgradePlans.map((plan) => (
                              <td key={`${plan.category}-open-polls`}>{formatMembershipBoolean(plan.definition.poll.shareOpenToAll)}</td>
                            ))}
                          </tr>
                          <tr>
                            <th scope="row">Group management</th>
                            {membershipUpgradePlans.map((plan) => (
                              <td key={`${plan.category}-group-management`}>{formatMembershipBoolean(plan.definition.group.manage)}</td>
                            ))}
                          </tr>
                          <tr>
                            <th scope="row">Status</th>
                            {membershipUpgradePlans.map((plan) => {
                              const isCurrentPlan = plan.category === currentUserCategory;
                              const hasPendingRequest = userPendingCategoryRequest?.requestedCategory === plan.category;

                              return (
                                <td key={`${plan.category}-status`}>
                                  {isCurrentPlan ? (
                                    <span className="status-chip success">Current plan</span>
                                  ) : hasPendingRequest ? (
                                    <span className="status-chip warning">Pending review</span>
                                  ) : (
                                    <button
                                      className="button-secondary small-button"
                                      type="button"
                                      onClick={() => void handleRequestCategoryUpgrade(plan.category)}
                                    >
                                      Send request
                                    </button>
                                  )}
                                </td>
                              );
                            })}
                          </tr>
                        </tbody>
                  </table>
                </div>
              ) : null}
              {!suggestedUpgradePlans.length ? <p className="muted-text">You are already on the highest available category.</p> : null}
              {latestResolvedCategoryMessage ? <p className="muted-text">{latestResolvedCategoryMessage}</p> : null}
              {categorySnapshot.activeAssignment ? (
                <p className="muted-text">
                  Active assignment ends on {formatShortDate(categorySnapshot.activeAssignment.expiresAt ?? new Date().toISOString())}.
                </p>
              ) : null}
              {categoryFeedback ? <p className="muted-text">{categoryFeedback}</p> : null}
            </section>
          ) : null}

          {isSuperAdmin && categoryManagement && isManageUpgradesPanelOpen ? (
            <section className="panel workspace-card">
              <div className="section-head compact-head">
                <div>
                  <p className="eyebrow">Super admin</p>
                  <h2 className="section-title">Review category approvals</h2>
                  <p className="muted-text">
                    Search by user, apply a plan directly, or clear the pending approval queue without leaving the dashboard.
                  </p>
                </div>
                <button className="button-secondary small-button" type="button" onClick={() => setIsManageUpgradesPanelOpen(false)}>
                  Close
                </button>
              </div>

              <div className="form-grid">
                <div className="field compact-field">
                  <label htmlFor="category-user-search">User</label>
                  <input
                    id="category-user-search"
                    list="category-user-options"
                    placeholder="Search or select by phone, name, or user id"
                    value={categorySearchQuery}
                    onChange={(event) => {
                      const nextValue = event.target.value;

                      setCategorySearchQuery(nextValue);

                      const matchedUser = categoryManagement?.managedUsers.find((user) => {
                        const optionLabel = getManagedUserOptionLabel(user, isSuperAdmin).toLowerCase();
                        const normalizedValue = nextValue.trim().toLowerCase();

                        return optionLabel === normalizedValue || user.identifier.toLowerCase() === normalizedValue;
                      });

                      if (matchedUser) {
                        setCategoryAssignmentIdentifier(matchedUser.identifier);
                        setCategoryAssignmentCategory(matchedUser.currentCategory);
                      }
                    }}
                  />
                  <datalist id="category-user-options">
                    {filteredManagedUsers.map((user) => (
                      <option key={user.identifier} value={getManagedUserOptionLabel(user, isSuperAdmin)} />
                    ))}
                  </datalist>
                  {selectedManagedUser ? (
                    <p className="muted-text">Selected user: {formatPhoneNumberForDisplay(selectedManagedUser.identifier, { showFullPhoneNumber: isSuperAdmin })}</p>
                  ) : null}
                </div>
                <div className="field compact-field">
                  <label htmlFor="category-select">Category</label>
                  <select
                    className="select-field"
                    id="category-select"
                    value={categoryAssignmentCategory}
                    onChange={(event) => setCategoryAssignmentCategory(event.target.value as NormalUserCategory)}
                  >
                    {orderedNormalUserCategories.map((category) => (
                      <option key={category} value={category}>
                        {normalUserCategoryDefinitions[category].label}
                      </option>
                    ))}
                  </select>
                  {selectedManagedUser ? (
                    <p className="muted-text">Current category: {selectedManagedUser.currentCategoryLabel.replace(/ users$/i, " user")}</p>
                  ) : null}
                </div>
                {categoryAssignmentCategory !== "trapit-normal" ? (
                  <div className="field compact-field">
                    <label htmlFor="category-duration">Duration</label>
                    <select
                      className="select-field"
                      id="category-duration"
                      value={String(categoryAssignmentDurationMonths)}
                      onChange={(event) => setCategoryAssignmentDurationMonths(event.target.value === "12" ? 12 : 3)}
                    >
                      <option value="3">3 months</option>
                      <option value="12">1 year</option>
                    </select>
                  </div>
                ) : null}
              </div>

              <div className="role-option role-option-create">
                <button className="button-primary" type="button" onClick={() => void handleAssignUserCategory()}>
                  Apply category
                </button>
              </div>

              <div className="data-list compact-list">
                {pendingCategoryRequests.length === 0 ? (
                  <p className="muted-text">No pending upgrade requests.</p>
                ) : (
                  pendingCategoryRequests.map((request) => (
                    <article key={request.id} className="data-card">
                      <div>
                        <strong>{request.requesterDisplayName ?? request.requesterIdentifier ?? "Unknown user"}</strong>
                        <p className="muted-text">
                          Requested {normalUserCategoryDefinitions[request.requestedCategory].label} from {normalUserCategoryDefinitions[request.currentCategory].label}
                        </p>
                      </div>
                      <div className="role-option role-option-create">
                        <button className="button-secondary small-button" type="button" onClick={() => void handleResolveCategoryRequest(request.id, "accept", 3)}>
                          Approve 3 months
                        </button>
                        <button className="button-secondary small-button" type="button" onClick={() => void handleResolveCategoryRequest(request.id, "accept", 12)}>
                          Approve 1 year
                        </button>
                        <button className="button-secondary small-button" type="button" onClick={() => void handleResolveCategoryRequest(request.id, "reject")}>
                          Reject
                        </button>
                      </div>
                    </article>
                  ))
                )}
              </div>

              {categoryManagementFeedback ? <p className="muted-text">{categoryManagementFeedback}</p> : null}
            </section>
          ) : null}

      <CollapsibleWorkspaceSection
        eyebrow=""
        isOpen={openSection === "author"}
        sectionId="admin-author-questions"
        title="Add Questions"
        onToggle={() => toggleSection("author")}
      >
        <div className="form-stack">
          <div className="field">
            <div className="question-list">
              <div className="field compact-field">
                <label htmlFor="author-pool">Select or create question pool</label>
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
                  <label htmlFor="pool-name-inline">Create New Pool</label>
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

          <div className="question-bank-summary">
            <div>
              <strong>OCR import</strong>
              <p className="muted-text question-bank-summary-copy">
                Select or create a pool first, then use OCR import to preview and clean pasted text before saving.
              </p>
            </div>
            <button
              className="button-secondary small-button"
              disabled={!authorPoolId}
              type="button"
              onClick={() => setIsOcrImportOpen((currentState) => !currentState)}
            >
              {isOcrImportOpen ? "Hide OCR import" : "Show OCR import"}
            </button>
          </div>

          {!authorPoolId ? <p className="muted-text">Select or create a pool to enable OCR import.</p> : null}

          {authorPoolId && isOcrImportOpen ? (
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
          ) : null}
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
                const shareSummary = pool.isShared
                  ? "Shared with you"
                  : pool.sharedWithIdentifiers.length
                    ? `Shared with ${pool.sharedWithIdentifiers.length} user${pool.sharedWithIdentifiers.length === 1 ? "" : "s"}`
                    : null;

                return (
                  <button
                    className={`pool-filter-card${selectedQuestionBankPoolId === pool.id ? " is-active" : ""}`}
                    key={pool.id}
                    type="button"
                    onClick={() => setSelectedQuestionBankPoolId(pool.id)}
                  >
                    <strong>{pool.name}</strong>
                    <span>
                      {questionCount} question{questionCount === 1 ? "" : "s"}
                      {shareSummary ? ` · ${shareSummary}` : ""}
                    </span>
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
                  <div className="inline-actions question-bank-summary-chips">
                    {selectedQuestionBankPool.isShared ? (
                      <span className="status-chip">Shared with you</span>
                    ) : null}
                    {duplicateQuestionGroups.length ? (
                      <span className="status-chip warning">
                        {duplicateQuestionGroups.length} duplicate set{duplicateQuestionGroups.length === 1 ? "" : "s"}
                      </span>
                    ) : null}
                  </div>
                </div>
                <div className="inline-actions">
                  <button
                    className="button-secondary small-button"
                    disabled={!filteredQuestionBankQuestions.length}
                    type="button"
                    onClick={() => handleCopyQuestionsForBulkEdit(filteredQuestionBankQuestions)}
                  >
                    Copy all questions
                  </button>
                  <button
                    className="button-secondary small-button"
                    disabled={!removableDuplicateQuestionIds.length || isMutating}
                    type="button"
                    onClick={() => handleDeleteSelectedQuestions(removableDuplicateQuestionIds)}
                  >
                    Remove duplicates
                  </button>
                  <label className="radio-chip">
                    <input
                      checked={areAllVisibleQuestionsSelected}
                      disabled={!filteredQuestionBankQuestionIds.length}
                      type="checkbox"
                      onChange={() => handleToggleSelectAllQuestions(filteredQuestionBankQuestionIds)}
                    />
                    Select all
                  </label>
                  <button
                    className="button-secondary small-button"
                    disabled={!selectedVisibleQuestionIds.length || isMutating}
                    type="button"
                    onClick={() => handleDeleteSelectedQuestions(selectedVisibleQuestionIds)}
                  >
                    Remove selected
                  </button>
                  <span className="status-chip success">
                    {filteredQuestionBankQuestions.length} visible
                  </span>
                </div>
              </div>
            ) : (
              <div className="empty-state compact-empty-state">
                <p className="muted-text">Select a pool to see only the questions assigned to it.</p>
              </div>
            )}

            {selectedQuestionBankPool ? (
              <div className="question-card question-bank-share-panel">
                <div className="question-bank-share-panel-head">
                  <div>
                    <strong>Share question pool</strong>
                    <p className="muted-text question-bank-summary-copy">
                      {selectedQuestionBankPool.canManage
                        ? "Choose users who should be able to open and use this pool."
                        : "This pool was shared with you. Only the owner can change sharing."}
                    </p>
                  </div>
                  <span className="status-chip">
                    {selectedQuestionBankPool.sharedWithIdentifiers.length} shared
                  </span>
                </div>

                {selectedQuestionBankPool.sharedWithIdentifiers.length ? (
                  <div className="question-bank-share-chip-row">
                    {selectedQuestionBankPool.sharedWithIdentifiers.map((identifier) => (
                      <button
                        className="button-secondary small-button"
                        disabled={!selectedQuestionBankPool.canManage || isMutating}
                        key={`${selectedQuestionBankPool.id}-${identifier}`}
                        type="button"
                        onClick={() => handleTogglePoolShareIdentifier(identifier)}
                      >
                        {formatParticipantName(identifier, participants, isSuperAdmin)}
                        {selectedQuestionBankPool.canManage ? " Remove" : ""}
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="muted-text">This pool is not shared with anyone yet.</p>
                )}

                {selectedQuestionBankPool.canManage ? (
                  <div className="form-stack">
                    <div className="field">
                      <label htmlFor="pool-share-search">Search users to share with</label>
                      <input
                        id="pool-share-search"
                        placeholder="Enter the full phone number"
                        value={poolShareSearch}
                        onChange={(event) => setPoolShareSearch(event.target.value)}
                      />
                    </div>
                    <p className="muted-text">Enter the complete phone number to reveal a user before sharing this pool.</p>

                    <div className="question-bank-share-chip-row">
                      {poolShareSearch.trim() && filteredShareableParticipants.length ? (
                        filteredShareableParticipants.map((participant) => {
                          const isShared = selectedQuestionBankPool.sharedWithIdentifiers.some((identifier) =>
                            participantIdentifiersMatch(identifier, participant.identifier),
                          );

                          return (
                            <button
                              className={isShared ? "button small-button" : "button-secondary small-button"}
                              disabled={isMutating}
                              key={participant.id}
                              type="button"
                              onClick={() => handleTogglePoolShareIdentifier(participant.identifier)}
                            >
                              {formatParticipantName(participant.identifier, participants, isSuperAdmin)}
                            </button>
                          );
                        })
                      ) : poolShareSearch.trim() ? (
                        <p className="muted-text">No matching users found.</p>
                      ) : (
                        <p className="muted-text">Enter the full phone number to search.</p>
                      )}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}

            {selectedQuestionBankPoolId && duplicateQuestionGroups.length ? (
              <div className="duplicate-group-list">
                {duplicateQuestionGroups.map((duplicateGroup, groupIndex) => {
                  const duplicatePositions = duplicateGroup.questions
                    .map((question) => `Q${questionBankQuestionPositionById.get(question.id)}`)
                    .join(", ");
                  const removableDuplicateIds = duplicateGroup.questions
                    .slice(1)
                    .filter((question) => question.canManage)
                    .map((question) => question.id);

                  return (
                    <article className="question-card duplicate-group-card" key={duplicateGroup.signature}>
                      <div className="question-bank-share-panel-head">
                        <strong>Duplicate set {groupIndex + 1}</strong>
                        <span className="status-chip warning">
                          {duplicateGroup.questions.length} copies
                        </span>
                      </div>
                      <p className="compact-question-prompt">{duplicateGroup.questions[0]?.prompt}</p>
                      <p className="muted-text compact-question-meta">Found at {duplicatePositions}</p>
                      <div className="inline-actions">
                        <button
                          className="button-secondary small-button"
                          disabled={!removableDuplicateIds.length || isMutating}
                          type="button"
                          onClick={() => handleDeleteSelectedQuestions(removableDuplicateIds)}
                        >
                          Keep first, remove others
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : null}

            {selectedQuestionBankPoolId && filteredQuestionBankQuestions.length ? (
              <div className="question-bank-grid">
                {filteredQuestionBankQuestions.map((question, index) => {
                  const duplicateGroup = duplicateQuestionGroupByQuestionId.get(question.id);
                  const duplicatePositions = duplicateGroup
                    ? duplicateGroup.questions
                        .filter((entry) => entry.id !== question.id)
                        .map((entry) => `Q${questionBankQuestionPositionById.get(entry.id)}`)
                        .join(", ")
                    : "";
                  const removableDuplicateIds = duplicateGroup
                    ? duplicateGroup.questions
                        .filter((entry) => entry.id !== question.id && entry.canManage)
                        .map((entry) => entry.id)
                    : [];

                  return (
                  <article
                    className={`question-card compact-question-card${duplicateGroup ? " is-duplicate" : ""}`}
                    key={question.id}
                  >
                    <div className="question-head compact-question-head">
                      <div className="inline-actions">
                        <label className="radio-chip">
                          <input
                            checked={selectedQuestionIds.includes(question.id)}
                            disabled={!question.canManage}
                            type="checkbox"
                            onChange={() => toggleQuestionSelection(question.id)}
                          />
                          {question.canManage ? "Select" : "Read-only"}
                        </label>
                        <strong>Q{index + 1}</strong>
                      </div>
                      <div className="inline-actions">
                        <button
                          className="button-secondary small-button"
                          disabled={isMutating || !question.canManage}
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
                          disabled={isMutating || !question.canManage}
                          type="button"
                          onClick={() => handleDeleteQuestion(question.id)}
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                    {duplicateGroup || question.isShared ? (
                      <div className="duplicate-question-banner">
                        {duplicateGroup ? (
                          <>
                            <div className="inline-actions">
                              <span className="status-chip warning">
                                Duplicate with {duplicateGroup.questions.length - 1} other question{duplicateGroup.questions.length === 2 ? "" : "s"}
                              </span>
                              {!question.canManage ? <span className="status-chip">Read-only</span> : null}
                            </div>
                            <p className="muted-text compact-question-meta">
                              Matches {duplicatePositions}. Keep one copy and remove the rest.
                            </p>
                            {question.canManage ? (
                              <div className="inline-actions">
                                <button
                                  className="button-secondary small-button"
                                  disabled={!removableDuplicateIds.length || isMutating}
                                  type="button"
                                  onClick={() => handleDeleteSelectedQuestions(removableDuplicateIds)}
                                >
                                  Keep this, remove others
                                </button>
                              </div>
                            ) : null}
                          </>
                        ) : (
                          <span className="status-chip">Shared question</span>
                        )}
                      </div>
                    ) : null}
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
                );})}
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
        isOpen={openSection === "create-groups"}
        sectionId="admin-create-groups"
        title="Create Groups"
        onToggle={() => toggleSection("create-groups")}
      >
        <div className="question-card form-stack">
          <div className="field">
            <label htmlFor="group-name">Enter group name</label>
            <input
              id="group-name"
              placeholder="Enter group name"
              value={groupName}
              onChange={(event) => setGroupName(event.target.value)}
            />
          </div>
          <ParticipantSearchPicker
            emptyMessage="No participants selected for this group yet."
            inputId="group-participant-search"
            participants={participants}
            searchPlaceholder="Search participants by phone number"
            selectedIds={selectedGroupParticipantIds}
            selectionLabel="Select participants"
            showFullPhoneNumbers={isSuperAdmin}
            onChange={setSelectedGroupParticipantIds}
          />
          <div className="question-card nested-card form-stack">
            <label className="role-option">
              <input
                checked={groupGenerateInviteLink}
                type="checkbox"
                onChange={(event) => setGroupGenerateInviteLink(event.target.checked)}
              />
              <span>Create invite link for this group</span>
            </label>
            <div className="selection-grid">
              <label className="role-option">
                <input
                  checked={groupInviteJoinMode === "approval-required"}
                  name="group-invite-join-mode"
                  type="radio"
                  onChange={() => setGroupInviteJoinMode("approval-required")}
                />
                <span>Approval required</span>
              </label>
              <label className="role-option">
                <input
                  checked={groupInviteJoinMode === "automatic"}
                  name="group-invite-join-mode"
                  type="radio"
                  onChange={() => setGroupInviteJoinMode("automatic")}
                />
                <span>Open for all</span>
              </label>
            </div>
            <p className="muted-text">
              {groupGenerateInviteLink
                ? groupInviteJoinMode === "automatic"
                  ? "Anyone who signs in from the link will join this group automatically."
                  : "Anyone who signs in from the link will need creator approval before joining this group."
                : "Without an invite link, only the selected participants can be invited into this group right now."}
            </p>
          </div>
          {groupFeedback ? <p className="muted-text">{groupFeedback}</p> : null}
          <div className="inline-actions">
            <button className="button" disabled={isMutating} type="button" onClick={handleCreateGroup}>
              Create group
            </button>
          </div>
        </div>
      </CollapsibleWorkspaceSection>

      <CollapsibleWorkspaceSection
        eyebrow=""
        isOpen={openSection === "manage-groups"}
        sectionId="admin-manage-groups"
        title="Manage Groups"
        onToggle={() => toggleSection("manage-groups")}
      >
        <div className="question-card">
          <div className="question-head">
            <strong>My groups</strong>
            <span className="status-chip success">{participantGroups.length} total</span>
          </div>
          {participantGroups.length ? (
            <div className="question-list">
              {participantGroups.map((group) => {
                const requestsForGroup = groupJoinRequests.filter(
                  (request) => request.adminGroupId === group.id,
                );

                return (
                  <article className="question-card nested-card" key={group.id}>
                    <div className="question-head">
                      <strong>{group.name}</strong>
                      <div className="inline-actions">
                        <span className="status-chip success">
                          {group.inviteJoinMode === "automatic" ? "Open for all" : "Approval required"}
                        </span>
                        <span className="status-chip success">{group.participantIds.length} members</span>
                        {requestsForGroup.length ? (
                          <span className="status-chip success">
                            {requestsForGroup.length} request{requestsForGroup.length === 1 ? "" : "s"}
                          </span>
                        ) : null}
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
                          <div className="question-card nested-card form-stack">
                            <label className="role-option">
                              <input
                                checked={editingGroupDraft.generateInviteLink}
                                type="checkbox"
                                onChange={(event) =>
                                  setEditingGroupDraft((currentDraft) =>
                                    currentDraft
                                      ? {
                                          ...currentDraft,
                                          generateInviteLink: event.target.checked,
                                        }
                                      : currentDraft,
                                  )
                                }
                              />
                              <span>Create invite link for this group</span>
                            </label>
                            <div className="selection-grid">
                              <label className="role-option">
                                <input
                                  checked={editingGroupDraft.inviteJoinMode === "approval-required"}
                                  name={`edit-group-invite-mode-${group.id}`}
                                  type="radio"
                                  onChange={() =>
                                    setEditingGroupDraft((currentDraft) =>
                                      currentDraft
                                        ? {
                                            ...currentDraft,
                                            inviteJoinMode: "approval-required",
                                          }
                                        : currentDraft,
                                    )
                                  }
                                />
                                <span>Approval required</span>
                              </label>
                              <label className="role-option">
                                <input
                                  checked={editingGroupDraft.inviteJoinMode === "automatic"}
                                  name={`edit-group-invite-mode-${group.id}`}
                                  type="radio"
                                  onChange={() =>
                                    setEditingGroupDraft((currentDraft) =>
                                      currentDraft
                                        ? {
                                            ...currentDraft,
                                            inviteJoinMode: "automatic",
                                          }
                                        : currentDraft,
                                    )
                                  }
                                />
                                <span>Open for all</span>
                              </label>
                            </div>
                          </div>
                          <ParticipantSearchPicker
                            emptyMessage="No participants selected for this group yet."
                            inputId={`edit-group-search-${group.id}`}
                            participants={participants}
                            searchPlaceholder="Search and add participants"
                            selectedIds={editingGroupDraft.participantIds}
                            selectionLabel="Manage participants"
                            showFullPhoneNumbers={isSuperAdmin}
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
                          <p className="muted-text">Selected members appear below. Click Remove on any member to take them out of the group.</p>
                          <p className="muted-text">Enter the complete phone number to reveal a user. New selections receive a group addition request before joining.</p>
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
                      <div className="form-stack">
                        {group.shareCode ? (
                          <div className="form-stack">
                            <p className="muted-text">Access code: {group.shareCode}</p>
                            <p className="muted-text">URL: <a href={getGroupAccessUrl(group.shareCode)} target="_blank" rel="noreferrer">{getGroupAccessUrl(group.shareCode)}</a></p>
                            <div className="inline-actions">
                              <button
                                className="button-secondary small-button"
                                type="button"
                                onClick={() => void copyTextToClipboard(getGroupAccessUrl(group.shareCode ?? ""))}
                              >
                                Copy link
                              </button>
                            </div>
                          </div>
                        ) : null}
                        <div className="selection-grid">
                          {group.participantIds.length ? (
                            group.participantIds.map((participantId) => {
                              const participant = participants.find((entry) => entry.id === participantId);

                              return participant ? (
                                <div className="role-option" key={`${group.id}-${participant.id}`}>
                                  <span>{participant.label}</span>
                                  {getParticipantSecondaryText(participant, isSuperAdmin) ? (
                                    <span className="muted-text">{getParticipantSecondaryText(participant, isSuperAdmin)}</span>
                                  ) : null}
                                </div>
                              ) : null;
                            })
                          ) : (
                            <p className="muted-text">No participants in this group yet.</p>
                          )}
                        </div>
                      </div>
                    )}

                    {requestsForGroup.length ? (
                      <div className="request-list">
                        {requestsForGroup.map((request) => (
                          <article className="request-card" key={request.id}>
                            <div>
                              <strong>{request.requesterLabel}</strong>
                              <p className="muted-text">{formatPhoneNumberForDisplay(request.requesterId, { showFullPhoneNumber: isSuperAdmin })}</p>
                              <p className="muted-text">
                                {request.requestType === "admin-invite"
                                  ? `Invited ${formatShortDateTime(request.requestedAt)}`
                                  : `Requested ${formatShortDateTime(request.requestedAt)}`}
                              </p>
                            </div>
                            <div className="inline-actions">
                              <span className={`status-chip ${request.status === "accepted" ? "success" : request.status === "rejected" ? "warning" : ""}`}>
                                {request.status}
                              </span>
                              {request.status === "pending" && request.requestType === "user-request" ? (
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
                              ) : request.status === "pending" ? (
                                <span className="muted-text">Waiting for participant response.</span>
                              ) : null}
                            </div>
                          </article>
                        ))}
                      </div>
                    ) : null}
                  </article>
                );
              })}
            </div>
          ) : (
            <p className="muted-text">Create a group to assign many participants at once.</p>
          )}
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
            <label htmlFor="schedule-title">Topic or purpose</label>
            <input
              id="schedule-title"
              placeholder="Weekly revision test"
              value={scheduleTitle}
              onChange={(event) => setScheduleTitle(event.target.value)}
            />
          </div>

          <div className="field-row">
            <div className="field">
              <label htmlFor="schedule-starts-at">Test date and time</label>
              <input
                id="schedule-starts-at"
                type="datetime-local"
                value={scheduleStartsAtInput}
                onChange={(event) => setScheduleStartsAtInput(event.target.value)}
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

          <div className="field-row">
            <div className="field grow-field">
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
          </div>

          {selectedPool ? (
            <p className="muted-text">
              Selected pool has {selectedPool.questionIds.length} question{selectedPool.questionIds.length === 1 ? "" : "s"}.
            </p>
          ) : null}

          <div className="field">
            <label>Select groups or classes</label>
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

          <div className="field">
            <label className="role-option">
              <input
                checked={scheduleGenerateInviteLink}
                type="checkbox"
                onChange={(event) => setScheduleGenerateInviteLink(event.target.checked)}
              />
              <span>Create invite link and QR code for this test</span>
            </label>
            <p className="muted-text">Invite links work only when exactly one group is selected.</p>
          </div>

          {scheduleGenerateInviteLink ? (
            <div className="field">
              <label>When someone registers through this invite</label>
              <div className="selection-grid">
                <label className="role-option">
                  <input
                    checked={scheduleInviteJoinMode === "approval-required"}
                    name="schedule-invite-join-mode"
                    type="radio"
                    onChange={() => setScheduleInviteJoinMode("approval-required")}
                  />
                  <span>Require creator approval before adding to the group</span>
                </label>
                <label className="role-option">
                  <input
                    checked={scheduleInviteJoinMode === "automatic"}
                    name="schedule-invite-join-mode"
                    type="radio"
                    onChange={() => setScheduleInviteJoinMode("automatic")}
                  />
                  <span>Add automatically to the group after registration and sign-in</span>
                </label>
              </div>
            </div>
          ) : null}

          {scheduleFeedback ? <p className="muted-text">{scheduleFeedback}</p> : null}
          <div className="inline-actions">
            <button className="button" disabled={isMutating} type="button" onClick={handleScheduleTest}>
              {editingScheduledTestId ? "Update test" : "Schedule test"}
            </button>
            {editingScheduledTestId ? (
              <button className="button-secondary" disabled={isMutating} type="button" onClick={resetScheduledTestForm}>
                Cancel edit
              </button>
            ) : null}
          </div>
        </div>
      </CollapsibleWorkspaceSection>

      <CollapsibleWorkspaceSection
        eyebrow=""
        isOpen={openSection === "self-test"}
        sectionId="admin-self-test"
        title="Self Test"
        onToggle={() => toggleSection("self-test")}
      >
        <div className="form-stack">
          <div className="field">
            <label htmlFor="self-test-title">Topic or purpose</label>
            <input
              id="self-test-title"
              placeholder="Practice chemistry mock"
              value={selfTestTitle}
              onChange={(event) => setSelfTestTitle(event.target.value)}
            />
          </div>

          <div className="field-row">
            <div className="field grow-field">
              <label htmlFor="self-test-pool">Question pool</label>
              <select
                className="select-field"
                id="self-test-pool"
                value={selfTestPoolId}
                onChange={(event) => setSelfTestPoolId(event.target.value)}
              >
                {pools.map((pool) => (
                  <option key={pool.id} value={pool.id}>
                    {pool.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="self-test-question-count">Number of questions</label>
              <input
                id="self-test-question-count"
                min={1}
                type="number"
                value={selfTestQuestionCount}
                onChange={(event) => setSelfTestQuestionCount(event.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="self-test-duration">Duration in minutes</label>
              <input
                id="self-test-duration"
                min={1}
                type="number"
                value={selfTestDurationMinutes}
                onChange={(event) => setSelfTestDurationMinutes(event.target.value)}
              />
            </div>
          </div>

          <div className="field">
            <label>Start mode</label>
            <div className="selection-grid">
              <label className="role-option">
                <input
                  checked={selfTestStartMode === "now"}
                  name="self-test-start-mode"
                  type="radio"
                  onChange={() => setSelfTestStartMode("now")}
                />
                <span>Start now</span>
              </label>
              <label className="role-option">
                <input
                  checked={selfTestStartMode === "later"}
                  name="self-test-start-mode"
                  type="radio"
                  onChange={() => setSelfTestStartMode("later")}
                />
                <span>Schedule for later</span>
              </label>
            </div>
          </div>

          {selfTestStartMode === "later" ? (
            <div className="field">
              <label htmlFor="self-test-starts-at">Self test date and time</label>
              <input
                id="self-test-starts-at"
                type="datetime-local"
                value={selfTestStartsAtInput}
                onChange={(event) => setSelfTestStartsAtInput(event.target.value)}
              />
            </div>
          ) : null}

          {selectedSelfTestPool ? (
            <p className="muted-text">
              Pool size: {questions.filter((question) => question.poolIds.includes(selectedSelfTestPool.id)).length} questions
            </p>
          ) : null}

          {selfTestFeedback ? <p className="muted-text">{selfTestFeedback}</p> : null}

          <div className="inline-actions">
            <button className="button" disabled={isMutating} type="button" onClick={handleScheduleSelfTest}>
              {editingSelfTestId ? "Update self test" : "Schedule self test"}
            </button>
            {editingSelfTestId ? (
              <button className="button-secondary" disabled={isMutating} type="button" onClick={resetSelfTestForm}>
                Cancel edit
              </button>
            ) : null}
          </div>
        </div>
      </CollapsibleWorkspaceSection>

      <CollapsibleWorkspaceSection
        eyebrow=""
        isOpen={openSection === "poll-questions"}
        sectionId="admin-poll-questions"
        title="Add Poll Question"
        onToggle={() => toggleSection("poll-questions")}
      >
        <div className="form-stack">
          <div className="question-bank-summary">
            <div>
              <strong>OCR import</strong>
              <p className="muted-text question-bank-summary-copy">
                Use the same OCR workflow as tests to preview and clean poll questions before saving them.
              </p>
            </div>
            <button
              className="button-secondary small-button"
              type="button"
              onClick={() => setIsPollOcrImportOpen((currentState) => !currentState)}
            >
              {isPollOcrImportOpen ? "Hide OCR import" : "Show OCR import"}
            </button>
          </div>

          {isPollOcrImportOpen ? (
            <div className="form-stack import-card">
              <div className="section-head">
                <div>
                  <p className="eyebrow">OCR import</p>
                  <h2 className="section-title">Import and preview poll questions</h2>
                </div>
                <div className="form-stack">
                  <p className="muted-text">
                    If the poll questions are on paper or already in text, send the photo or text to AI and use this exact prompt.
                  </p>
                  <div className="field textarea-field">
                    <label htmlFor="poll-ai-prompt">AI prompt</label>
                    <textarea id="poll-ai-prompt" readOnly value={POLL_OCR_PROMPT} />
                  </div>
                </div>
              </div>

              <div className="field textarea-field">
                <label htmlFor="poll-import-text">OCR text</label>
                <textarea
                  id="poll-import-text"
                  placeholder={POLL_OCR_EXAMPLE}
                  value={pollImportText}
                  onChange={(event) => setPollImportText(event.target.value)}
                />
              </div>

              {pollImportFeedback ? <p className="muted-text">{pollImportFeedback}</p> : null}
              <div className="inline-actions">
                <button className="button" disabled={isPollImporting || isMutating} type="button" onClick={handlePreviewPollImport}>
                  Preview import
                </button>
                <button
                  className="button-secondary"
                  disabled={!pollImportPreview?.validCount || isMutating}
                  type="button"
                  onClick={handleCommitPollImport}
                >
                  Import valid poll questions
                </button>
                <button
                  className="button-secondary"
                  disabled={!pollImportPreview?.validCount || isMutating}
                  type="button"
                  onClick={handleKeepValidPollBlocks}
                >
                  Keep valid blocks only
                </button>
              </div>

              {pollImportPreview ? (
                <div className="import-preview-list">
                  <div className="import-summary">
                    <strong>{pollImportPreview.validCount}</strong>
                    <span>valid</span>
                    <strong>{pollImportPreview.invalidCount}</strong>
                    <span>need fixes</span>
                    <strong>{pollImportPreview.totalCount}</strong>
                    <span>total blocks</span>
                  </div>

                  {pollImportPreview.candidates.map((candidate, index) => (
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
                            <li key={`${candidate.id}-${optionIndex}`}>{option}</li>
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
          ) : null}

          {pollFeedback ? <p className="muted-text">{pollFeedback}</p> : null}

          {pollQuestions.length ? (
            <div className="question-card">
              <div className="question-head">
                <strong>Saved poll questions</strong>
                <span className="status-chip success">{pollQuestions.length}</span>
              </div>
              <div className="question-list">
                {pollQuestions.map((question, index) => (
                  <article className="question-card nested-card" key={question.id}>
                    <div className="question-head">
                      <strong>Question {index + 1}</strong>
                      {question.topic ? <span className="status-chip warning">{question.topic}</span> : null}
                    </div>
                    <p>{question.prompt}</p>
                    <ol className="question-options compact-question-options">
                      {question.options.map((option, optionIndex) => (
                        <li key={`${question.id}-${optionIndex}`}>{option}</li>
                      ))}
                    </ol>
                  </article>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </CollapsibleWorkspaceSection>

      <CollapsibleWorkspaceSection
        eyebrow=""
        isOpen={openSection === "poll-schedule"}
        sectionId="admin-schedule-polls"
        title="Schedule Poll"
        onToggle={() => toggleSection("poll-schedule")}
      >
        <div className="form-stack">
          <div className="question-card form-stack">
            <div className="field">
              <label htmlFor="poll-title">Topic or purpose</label>
              <input
                id="poll-title"
                placeholder="Parent feedback poll"
                value={pollScheduleTitle}
                onChange={(event) => setPollScheduleTitle(event.target.value)}
              />
            </div>

            <div className="field-row">
              <div className="field">
                <label htmlFor="poll-starts-at">Poll date and time</label>
                <input
                  id="poll-starts-at"
                  type="datetime-local"
                  value={pollScheduleStartsAtInput}
                  onChange={(event) => setPollScheduleStartsAtInput(event.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor="poll-duration">Duration in minutes</label>
                <input
                  id="poll-duration"
                  min={1}
                  type="number"
                  value={pollScheduleDurationMinutes}
                  onChange={(event) => setPollScheduleDurationMinutes(event.target.value)}
                />
              </div>
            </div>

            <div className="field">
              <label>Select poll questions</label>
              <div className="selection-grid">
                {pollQuestions.map((question) => (
                  <label className="role-option" key={`poll-question-select-${question.id}`}>
                    <input
                      checked={pollScheduleQuestionIds.includes(question.id)}
                      type="checkbox"
                      onChange={() =>
                        setPollScheduleQuestionIds((currentIds) => toggleArrayValue(currentIds, question.id))
                      }
                    />
                    <span>{question.topic ? `${question.topic}: ${question.prompt}` : question.prompt}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="field form-stack">
              <div className="question-head">
                <strong>Type additional poll questions</strong>
                <button className="button-secondary small-button" type="button" onClick={handleAddTypedPollScheduleDraft}>
                  Add question
                </button>
              </div>
              {pollScheduleTypedDrafts.length ? (
                <div className="question-list">
                  {pollScheduleTypedDrafts.map((draft, draftIndex) => (
                    <article className="question-card nested-card form-stack" key={`typed-poll-draft-${draftIndex}`}>
                      <div className="question-head">
                        <strong>Typed question {draftIndex + 1}</strong>
                        <button
                          className="button-secondary small-button"
                          type="button"
                          onClick={() => handleRemoveTypedPollScheduleDraft(draftIndex)}
                        >
                          Remove
                        </button>
                      </div>
                      <div className="field compact-field">
                        <label htmlFor={`typed-poll-topic-${draftIndex}`}>Topic</label>
                        <input
                          id={`typed-poll-topic-${draftIndex}`}
                          placeholder="Parent feedback"
                          value={draft.topic}
                          onChange={(event) =>
                            handleUpdateTypedPollScheduleDraft(draftIndex, (currentDraft) => ({
                              ...currentDraft,
                              topic: event.target.value,
                            }))
                          }
                        />
                      </div>
                      <div className="field compact-field">
                        <label htmlFor={`typed-poll-prompt-${draftIndex}`}>Question</label>
                        <input
                          id={`typed-poll-prompt-${draftIndex}`}
                          placeholder="How satisfied are you with the event?"
                          value={draft.prompt}
                          onChange={(event) =>
                            handleUpdateTypedPollScheduleDraft(draftIndex, (currentDraft) => ({
                              ...currentDraft,
                              prompt: event.target.value,
                            }))
                          }
                        />
                      </div>
                      <div className="form-stack">
                        {draft.options.map((option, optionIndex) => (
                          <div className="field compact-field" key={`typed-poll-option-${draftIndex}-${optionIndex}`}>
                            <label htmlFor={`typed-poll-option-${draftIndex}-${optionIndex}`}>Option {optionIndex + 1}</label>
                            <div className="inline-actions">
                              <input
                                id={`typed-poll-option-${draftIndex}-${optionIndex}`}
                                placeholder={`Option ${optionIndex + 1}`}
                                value={option}
                                onChange={(event) =>
                                  handleUpdateTypedPollScheduleDraft(draftIndex, (currentDraft) => ({
                                    ...currentDraft,
                                    options: currentDraft.options.map((currentOption, currentIndex) =>
                                      currentIndex === optionIndex ? event.target.value : currentOption,
                                    ),
                                  }))
                                }
                              />
                              {draft.options.length > 2 ? (
                                <button
                                  className="button-secondary small-button"
                                  type="button"
                                  onClick={() =>
                                    handleUpdateTypedPollScheduleDraft(draftIndex, (currentDraft) => ({
                                      ...currentDraft,
                                      options: currentDraft.options.filter((_, currentIndex) => currentIndex !== optionIndex),
                                    }))
                                  }
                                >
                                  Remove option
                                </button>
                              ) : null}
                            </div>
                          </div>
                        ))}
                        <div className="inline-actions">
                          <button
                            className="button-secondary small-button"
                            type="button"
                            onClick={() =>
                              handleUpdateTypedPollScheduleDraft(draftIndex, (currentDraft) => ({
                                ...currentDraft,
                                options: [...currentDraft.options, ""],
                              }))
                            }
                          >
                            Add option
                          </button>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <p className="muted-text">Use Add question if you want to type new poll questions while scheduling.</p>
              )}
            </div>

            <div className="field">
              <label>Participant type</label>
              <div className="selection-grid">
                <label className="role-option">
                  <input
                    checked={pollScheduleParticipantType === "registered"}
                    name="poll-participant-type"
                    type="radio"
                    onChange={() => {
                      setPollScheduleParticipantType("registered");
                      setPollScheduleAnonymous(false);
                      setPollScheduleGenerateQrCode(false);
                    }}
                  />
                  <span>Share with groups</span>
                </label>
                <label className="role-option">
                  <input
                    checked={pollScheduleParticipantType === "open"}
                    name="poll-participant-type"
                    type="radio"
                    onChange={() => {
                      if (currentActorRole === "user" && currentUserCategory && !normalUserCategoryDefinitions[currentUserCategory].poll.shareOpenToAll) {
                        openUpgradePanel({
                          featureLabel: "Poll - Open to all",
                          message: "Open-to-all polls are available only for TRAPit Pro Max users.",
                          targetCategory: findNextNormalUserCategory(
                            currentUserCategory,
                            (candidate) => normalUserCategoryDefinitions[candidate].poll.shareOpenToAll,
                          ),
                        });
                        return;
                      }

                      setPollScheduleParticipantType("open");
                      setPollScheduleAnonymous(true);
                      setPollScheduleGenerateQrCode(true);
                    }}
                  />
                  <span>Open to all</span>
                </label>
              </div>
            </div>

            {pollScheduleParticipantType === "registered" ? (
              <div className="field">
                <label>Select groups</label>
                <div className="selection-grid">
                  {participantGroups.map((group) => (
                    <label className="role-option" key={`poll-group-${group.id}`}>
                      <input
                        checked={pollScheduleGroupIds.includes(group.id)}
                        type="checkbox"
                        onChange={() =>
                          setPollScheduleGroupIds((currentIds) => toggleArrayValue(currentIds, group.id))
                        }
                      />
                      <span>{group.name}</span>
                    </label>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="selection-grid">
              <label className="role-option">
                <input
                  checked={pollScheduleParticipantType === "open" ? true : pollScheduleAnonymous}
                  disabled={pollScheduleParticipantType === "open"}
                  type="checkbox"
                  onChange={(event) => setPollScheduleAnonymous(event.target.checked)}
                />
                <span>Collect responses anonymously</span>
              </label>
            </div>

            {pollScheduleParticipantType === "open" ? (
              <p className="muted-text">
                Open polls are accessible only through their URL or QR code, are not pushed to all registered users, and always collect anonymous responses.
              </p>
            ) : null}

            {pollFeedback ? <p className="muted-text">{pollFeedback}</p> : null}

            <div className="inline-actions">
              <button className="button" disabled={isMutating} type="button" onClick={handleSchedulePoll}>
                {editingScheduledPollId ? "Update poll" : "Schedule poll"}
              </button>
              {editingScheduledPollId ? (
                <button className="button-secondary" disabled={isMutating} type="button" onClick={resetPollScheduleForm}>
                  Cancel edit
                </button>
              ) : null}
            </div>
          </div>

          {sortedScheduledPolls.length ? (
            <div className="question-list">
              {sortedScheduledPolls.map((poll) => (
                <article className="question-card" key={poll.id}>
                  <div className="question-head">
                    <strong>{poll.title}</strong>
                    <div className="inline-actions">
                      {poll.status === "scheduled" ? (
                        <button className="button-secondary small-button" type="button" onClick={() => handleStartEditingPoll(poll)}>
                          Edit poll
                        </button>
                      ) : null}
                      <span className={`status-chip ${poll.status === "live" ? "success" : "warning"}`}>
                        {poll.status}
                      </span>
                    </div>
                  </div>
                  <p className="muted-text">Starts: {formatShortDateTime(poll.startsAt)}</p>
                  <p className="muted-text">Ends: {formatShortDateTime(poll.endsAt)}</p>
                  <p className="muted-text">Questions: {poll.questionIds.length}</p>
                  <p className="muted-text">Participant type: {poll.participantType === "registered" ? "Shared with groups" : "Open to all"}</p>
                  <p className="muted-text">Anonymity: {poll.anonymous ? "Anonymous" : "Named"}</p>
                  {poll.participantType === "registered" ? (
                    <p className="muted-text">
                      Groups: {poll.participantGroupIds.length
                        ? poll.participantGroupIds
                            .map((groupId) => participantGroups.find((group) => group.id === groupId)?.name ?? "Unknown group")
                            .join(", ")
                        : "None"}
                    </p>
                  ) : null}
                  {poll.shareCode ? (
                    <div className="form-stack">
                      <p className="muted-text">Access code: {poll.shareCode}</p>
                      <p className="muted-text">URL: <a href={getPollAccessUrl(poll.shareCode)} target="_blank" rel="noreferrer">{getPollAccessUrl(poll.shareCode)}</a></p>
                      {pollQrCodes[poll.id] ? (
                        <img alt={`QR code for ${poll.title}`} height={180} src={pollQrCodes[poll.id]} width={180} />
                      ) : null}
                    </div>
                  ) : null}
                </article>
              ))}
            </div>
          ) : (
            <div className="empty-state compact-empty-state">
              <p className="muted-text">No polls scheduled yet.</p>
            </div>
          )}
        </div>
      </CollapsibleWorkspaceSection>

      <CollapsibleWorkspaceSection
        eyebrow=""
        isOpen={openSection === "history"}
        sectionId="admin-test-history"
        title="Results"
        onToggle={() => toggleSection("history")}
      >
        <div className="form-stack">
          {activeParticipantTest ? (
            <div className="question-list">
              <article className="question-card runner-summary-card">
                {activeParticipantTest.branding?.imageDataUrl || activeParticipantTest.branding?.instituteName ? (
                  <div className="assessment-branding">
                    {activeParticipantTest.branding.imageDataUrl ? (
                      <img alt="Institute branding" className="assessment-branding-image" src={activeParticipantTest.branding.imageDataUrl} />
                    ) : null}
                    {activeParticipantTest.branding.instituteName ? (
                      <div>
                        <p className="eyebrow">Institute</p>
                        <strong>{activeParticipantTest.branding.instituteName}</strong>
                      </div>
                    ) : null}
                  </div>
                ) : null}
                <div className="question-head">
                  <strong>{activeParticipantTest.title}</strong>
                  <span className="status-chip success">{activeParticipantTest.durationMinutes} min</span>
                </div>
                <div className="runner-meta-row">
                  <span className="status-chip success">
                    Question {Math.min(currentParticipantQuestionIndex + 1, activeParticipantTest.questions.length)} of {activeParticipantTest.questions.length}
                  </span>
                  <span className={`status-chip runner-countdown${participantRemainingMs !== null && participantRemainingMs <= 60_000 ? " warning" : " success"}`}>
                    Time left {formatCountdown(participantRemainingMs)}
                  </span>
                </div>
                <p className="muted-text">Select an answer, then use the navigation buttons to move backward or forward before submitting.</p>
              </article>

              {activeParticipantQuestion ? (
                <article className="question-card" key={activeParticipantQuestion.question.id}>
                  <div className="question-head">
                    <strong>Question {currentParticipantQuestionIndex + 1}</strong>
                    <span className="muted-text">{activeParticipantTest.questionCount - currentParticipantQuestionIndex - 1} remaining</span>
                  </div>
                  <p>{activeParticipantQuestion.question.prompt}</p>
                  <div className="answer-grid">
                    {activeParticipantQuestion.displayOptions.map((option, optionIndex) => (
                      <label className="role-option" key={`${activeParticipantQuestion.question.id}-${optionIndex}`}>
                        <input
                          checked={participantAnswers[activeParticipantQuestion.question.id] === activeParticipantQuestion.originalOptionIndexes[optionIndex]}
                          name={activeParticipantQuestion.question.id}
                          type="radio"
                          onChange={() =>
                            handleSelectParticipantAnswer(
                              activeParticipantQuestion.question.id,
                              activeParticipantQuestion.originalOptionIndexes[optionIndex],
                            )
                          }
                        />
                        {option}
                      </label>
                    ))}
                  </div>
                  <div className="inline-actions">
                    {currentParticipantQuestionIndex > 0 ? (
                      <button className="button-secondary" disabled={isMutating} type="button" onClick={goToPreviousParticipantQuestion}>
                        Previous question
                      </button>
                    ) : null}
                    {currentParticipantQuestionIndex < activeParticipantTest.questions.length - 1 ? (
                      <button className="button-secondary" disabled={isMutating} type="button" onClick={goToNextParticipantQuestion}>
                        Next question
                      </button>
                    ) : (
                      <button className="button" disabled={isMutating} type="button" onClick={() => void submitParticipantTest()}>
                        Submit test
                      </button>
                    )}
                  </div>
                </article>
              ) : (
                <article className="question-card">
                  <div className="question-head">
                    <strong>Ready to submit</strong>
                    <span className="status-chip success">{Object.keys(participantAnswers).length}/{activeParticipantTest.questionCount} answered</span>
                  </div>
                  <p className="muted-text">
                    You have answered all questions. Submit now to see your score and ranking.
                  </p>
                  <div className="inline-actions">
                    <button className="button" disabled={isMutating} type="button" onClick={() => void submitParticipantTest()}>
                      Submit test
                    </button>
                  </div>
                </article>
              )}

              <div className="inline-actions">
                <button className="button-secondary" disabled={isMutating} type="button" onClick={cancelActiveParticipantTest}>
                  Cancel
                </button>
              </div>
            </div>
          ) : null}

          <div aria-label="Results mode" className="segmented-control" role="group">
            <button
              aria-pressed={resultsMode === "tests"}
              className={`segmented-control-item${resultsMode === "tests" ? " is-active" : ""}`}
              type="button"
              onClick={() => setResultsMode("tests")}
            >
              Test results
            </button>
            <button
              aria-pressed={resultsMode === "polls"}
              className={`segmented-control-item${resultsMode === "polls" ? " is-active" : ""}`}
              type="button"
              onClick={() => setResultsMode("polls")}
            >
              Poll results
            </button>
          </div>

          <div aria-label="Results scope" className="segmented-control segmented-control-wide" role="group">
            <button
              aria-pressed={testListFilter === "admin"}
              className={`segmented-control-item${testListFilter === "admin" ? " is-active" : ""}`}
              type="button"
              onClick={() => setTestListFilter("admin")}
            >
              {resultsMode === "tests" ? "Scheduled as admin" : "Poll created as admin"}
            </button>
            <button
              aria-pressed={testListFilter === "both"}
              className={`segmented-control-item${testListFilter === "both" ? " is-active" : ""}`}
              type="button"
              onClick={() => setTestListFilter("both")}
            >
              Both
            </button>
            <button
              aria-pressed={testListFilter === "participant"}
              className={`segmented-control-item${testListFilter === "participant" ? " is-active" : ""}`}
              type="button"
              onClick={() => setTestListFilter("participant")}
            >
              {resultsMode === "tests" ? "Attended as participant" : "Poll responded as participant"}
            </button>
          </div>

          {participantResult ? (
            <section className="result-panel">
              <h3>Latest result</h3>
              <p className="muted-text">
                Correct answers: <strong>{participantResult.correctCount}</strong> out of {participantResult.totalCount}
              </p>
              <p className="muted-text">
                Attempted: <strong>{participantResult.attemptedCount}</strong>
              </p>
              <p className="muted-text">
                Time taken: <strong>{formatElapsedTime(participantResult.elapsedMs)}</strong>
              </p>
              {typeof participantResult.rank === "number" ? (
                <p className="muted-text">
                  Rank: <strong>{participantResult.rank}</strong>
                </p>
              ) : null}
            </section>
          ) : null}

          {!activeParticipantTest && resultsMode === "tests" ? (
            filteredMergedTests.length ? (
              <div className="question-list">
                {filteredMergedTests.map((test) => {
                const scheduledTest = test.scheduledTest;
                const participantTest = test.participantTest;
                const participantHistoryEntry = test.participantHistoryEntry;
                const leaderboard = scheduledTest
                  ? leaderboards.find((entry) => entry.testId === scheduledTest.id)
                  : undefined;
                const submittedIdentifiers = new Set(
                  (leaderboard?.entries ?? []).map((entry) => normalizeParticipantIdentifier(entry.participantId)),
                );
                const absentParticipants = scheduledTest
                  ? scheduledTest.resolvedParticipantIdentifiers.filter(
                      (identifier) =>
                        !Array.from(submittedIdentifiers).some((submittedIdentifier) =>
                          participantIdentifiersMatch(identifier, submittedIdentifier),
                        ),
                    )
                  : [];
                const attemptsForTest = scheduledTest
                  ? history.filter((entry) => entry.testId === scheduledTest.id)
                  : [];
                const scopeLabel =
                  test.hasAdminScope && test.hasParticipantScope
                    ? "Admin + participant"
                    : test.hasAdminScope
                      ? "Scheduled as admin"
                      : "Attended as participant";
                const summaryRank = typeof participantHistoryEntry?.rank === "number"
                  ? participantHistoryEntry.rank
                  : null;
                const scheduledTestShareCode = scheduledTest?.shareCode ?? null;
                const scheduledTestAccessUrl = scheduledTestShareCode
                  ? getTestAccessUrl(scheduledTestShareCode)
                  : null;
                const showScheduledTestAccessDetails = Boolean(scheduledTestAccessUrl)
                  && scheduledTest?.status !== "completed";
                const showScheduledParticipantList = Boolean(scheduledTest) && !leaderboard;
                const isTestResultCollapsed = !collapsedTestResultIds.includes(test.id);
                const participantResultName = participantHistoryEntry
                  ? formatResultParticipantName(
                    participantHistoryEntry.participantId,
                    participantHistoryEntry.participantName,
                    participants,
                    isSuperAdmin,
                  )
                  : null;

                return (
                  <article className="question-card result-card" key={`merged-test-${test.id}`}>
                    <div className="result-card-body">
                      <div className="question-head">
                        <strong>{test.title}</strong>
                        <div className="inline-actions">
                          <button
                            aria-expanded={!isTestResultCollapsed}
                            className="button-secondary small-button"
                            type="button"
                            onClick={() => toggleTestResultCollapse(test.id)}
                          >
                            {isTestResultCollapsed ? "+" : "-"}
                          </button>
                          {scheduledTest && scheduledTest.status === "scheduled" ? (
                            <button
                              className="button-secondary small-button"
                              type="button"
                              onClick={() =>
                                scheduledTest.participantIds.length
                                  ? handleStartEditingSelfTest(scheduledTest)
                                  : handleStartEditingScheduledTest(scheduledTest)
                              }
                            >
                              Edit test
                            </button>
                          ) : null}
                          {!isTestResultCollapsed ? <span className="status-chip success">{scopeLabel}</span> : null}
                          {!isTestResultCollapsed ? (
                            <span className={`status-chip ${test.status === "live" ? "success" : "warning"}`}>
                              {test.status}
                            </span>
                          ) : null}
                        </div>
                      </div>
                      {!isTestResultCollapsed ? (
                        <>
                          <p className="muted-text">
                            Pool: {pools.find((pool) => pool.id === test.poolId)?.name ?? "Unknown pool"}
                          </p>
                          <p className="muted-text">Starts: {formatShortDateTime(test.startsAt)}</p>
                          <p className="muted-text">Duration: {test.durationMinutes} min</p>
                          <p className="muted-text">Questions: {test.questionCount}</p>
                          {showScheduledTestAccessDetails ? (
                            <p className="muted-text">
                              Invite approval: {scheduledTest?.inviteJoinMode === "automatic" ? "Automatic group addition" : "Creator approval required"}
                            </p>
                          ) : null}
                          {showScheduledTestAccessDetails ? <p className="muted-text">Access code: {scheduledTestShareCode}</p> : null}
                          {showScheduledTestAccessDetails ? (
                            <p className="muted-text">
                              URL: <a href={scheduledTestAccessUrl ?? undefined} target="_blank" rel="noreferrer">{scheduledTestAccessUrl}</a>
                            </p>
                          ) : null}
                          {showScheduledTestAccessDetails ? (
                            <div className="form-stack">
                              <div className="inline-actions">
                                <a
                                  className="button-secondary small-button"
                                  href={scheduledTestAccessUrl ?? undefined}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  Open invite page
                                </a>
                              </div>
                              {scheduledTest && testQrCodes[scheduledTest.id] ? (
                                <img alt={`QR code for ${scheduledTest.title}`} height={180} src={testQrCodes[scheduledTest.id]} width={180} />
                              ) : null}
                            </div>
                          ) : null}
                        </>
                      ) : null}

                      {scheduledTest ? (
                        <div className="form-stack">
                        {!isTestResultCollapsed && showScheduledParticipantList ? (
                          <p className="muted-text">
                            Participants: {scheduledTest.resolvedParticipantIdentifiers.length
                              ? scheduledTest.resolvedParticipantIdentifiers
                                  .map((identifier) => formatParticipantName(identifier, participants, isSuperAdmin))
                                  .join(", ")
                              : "None"}
                          </p>
                        ) : null}

                        {leaderboard ? (
                          <>
                            {!isTestResultCollapsed ? (
                              <p className="muted-text">
                                Submitted: {leaderboard.submittedCount}/{leaderboard.assignedParticipantCount}
                              </p>
                            ) : null}
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
                                        <td>{formatResultParticipantName(entry.participantId, entry.participantName, participants, isSuperAdmin)}</td>
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
                                            .map((identifier) => formatParticipantName(identifier, participants, isSuperAdmin))
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
                        ) : !isTestResultCollapsed && attemptsForTest.length ? (
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
                        ) : !isTestResultCollapsed && scheduledTest.status === "scheduled" ? (
                          <p className="muted-text">This test has not started yet.</p>
                        ) : !isTestResultCollapsed && scheduledTest.status === "live" ? (
                          <p className="muted-text">This test is live. Results will update here as participants submit.</p>
                        ) : !isTestResultCollapsed ? (
                          <p className="muted-text">No submissions were recorded before this test closed.</p>
                        ) : null}

                        {!isTestResultCollapsed && scheduledTest.status === "completed" ? (
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
                      </div>
                    ) : null}

                    {participantTest && participantHistoryEntry && participantHistoryEntry.status !== "missed" ? (
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
                            <tr>
                              <td>{summaryRank ?? "-"}</td>
                              <td>{participantResultName}</td>
                              <td>{participantHistoryEntry.correctCount}/{participantHistoryEntry.totalCount}</td>
                              <td>{participantHistoryEntry.incorrectCount}</td>
                              <td>{formatElapsedTime(participantHistoryEntry.elapsedMs)}</td>
                              <td>{formatShortDateTime(participantHistoryEntry.completedAt)}</td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    ) : null}

                    {!isTestResultCollapsed && participantTest ? (
                      <div className="form-stack">
                        {participantHistoryEntry ? (
                          participantHistoryEntry.status === "missed" ? (
                            <p className="muted-text">You were assigned to this test but did not submit before it closed.</p>
                          ) : (
                            <p className="muted-text">Your submitted result is shown in the table above.</p>
                          )
                        ) : participantTest.status === "scheduled" ? (
                          <p className="muted-text">This assigned test has not opened yet.</p>
                        ) : participantTest.status === "live" ? (
                          <p className="muted-text">This assigned test is live now.</p>
                        ) : (
                          <p className="muted-text">No participant submission was recorded for this test.</p>
                        )}

                        {participantTest.topPerformer ? (
                          <p className="muted-text">
                            Topper {participantTest.topPerformer.participantName}: {participantTest.topPerformer.correctCount}/{participantTest.questionCount} in {formatElapsedTime(participantTest.topPerformer.elapsedMs)}
                          </p>
                        ) : null}

                        {participantTest.status === "completed" ? (
                          <div className="inline-actions">
                            <button
                              className="button-secondary small-button"
                              disabled={participantReviewLoadingByTestId[participantTest.id]}
                              type="button"
                              onClick={() => void handleLoadParticipantReview(participantTest.id)}
                            >
                              {participantReviewLoadingByTestId[participantTest.id]
                                ? "Loading..."
                                : visibleParticipantReviewTestIds.includes(participantTest.id)
                                  ? "Hide review"
                                  : "Review questions"}
                            </button>
                          </div>
                        ) : participantHistoryEntry ? (
                          <p className="muted-text">You have submitted this test. Review opens after the test is completed and results are announced.</p>
                        ) : participantTest.status === "live" ? (
                          <>
                            <div className="field">
                              <label htmlFor={`participant-name-${participantTest.id}`}>Your name for this test</label>
                              <input
                                id={`participant-name-${participantTest.id}`}
                                placeholder="Enter your name before starting"
                                value={participantNamesByTest[participantTest.id] ?? ""}
                                onChange={(event) =>
                                  setParticipantNamesByTest((current) => ({
                                    ...current,
                                    [participantTest.id]: event.target.value,
                                  }))
                                }
                              />
                            </div>
                            <div className="inline-actions">
                              <button
                                className="button"
                                disabled={participantTest.hasAttempt || !(participantNamesByTest[participantTest.id] ?? "").trim()}
                                type="button"
                                onClick={() => startParticipantTest(participantTest.id)}
                              >
                                {participantTest.hasAttempt ? "Already submitted" : "Take test"}
                              </button>
                            </div>
                          </>
                        ) : null}

                        {visibleParticipantReviewTestIds.includes(participantTest.id) && participantReviewByTestId[participantTest.id] ? (
                          <div className="review-list">
                            {participantReviewByTestId[participantTest.id].review.map((question, reviewIndex) => (
                              <article className="question-card nested-card" key={`${participantTest.id}-participant-review-${question.questionId}`}>
                                <div className="question-head">
                                  <strong>Question {reviewIndex + 1}</strong>
                                  <span className="status-chip success">
                                    Correct option {question.correctOptionIndex + 1}
                                  </span>
                                </div>
                                <p>{question.prompt}</p>
                                <ol className="question-options compact-question-options">
                                  {question.options.map((option, optionIndex) => (
                                    <li key={`${question.questionId}-${optionIndex}`}>
                                      {option}
                                      {optionIndex === question.correctOptionIndex ? " (correct)" : ""}
                                      {optionIndex === question.selectedOptionIndex ? " (your answer)" : ""}
                                    </li>
                                  ))}
                                </ol>
                                <p className="muted-text">
                                  Your response: {formatParticipantAnswerLabel(question.selectedOptionIndex, question.options)}
                                </p>
                              </article>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                    </div>
                  </article>
                );
              })}
              </div>
            ) : (
              <div className="empty-state">
                <p className="muted-text">No tests match this view yet.</p>
              </div>
            )
          ) : !activeParticipantTest && filteredMergedPolls.length ? (
            <div className="question-list">
              {filteredMergedPolls.map((poll) => {
                const resolvedPoll = poll.scheduledPoll ?? poll.participantPoll;

                if (!resolvedPoll) {
                  return null;
                }

                const scopeLabel =
                  poll.hasAdminScope && poll.hasParticipantScope
                    ? "Admin + participant"
                    : poll.hasAdminScope
                      ? "Created as admin"
                      : "Available as participant";
                const pollResultsCopy = poll.scheduledPoll
                  ? resolvedPoll.status === "completed"
                    ? null
                    : resolvedPoll.status === "live"
                      ? "This poll is live. Response summaries will populate here as participants submit."
                      : "This poll has not opened yet."
                  : "This poll is available in your participant scope.";
                const isOpenPoll = resolvedPoll.participantType === "open";
                const isCompletedOpenPoll = isOpenPoll && resolvedPoll.status === "completed";
                const isOpenPollExpanded = !isCompletedOpenPoll && expandedOpenPollResultIds.includes(resolvedPoll.id);
                const resolvedPollShareCode = resolvedPoll.shareCode ?? null;
                const resolvedPollAccessUrl = resolvedPoll.participantType === "registered"
                  ? getRegisteredPollPath(resolvedPoll.id)
                  : resolvedPollShareCode
                    ? getPollAccessUrl(resolvedPollShareCode)
                    : null;
                const showResolvedPollOpenAction = Boolean(resolvedPollAccessUrl);
                const showResolvedPollAccessDetails = resolvedPoll.participantType === "open"
                  && showResolvedPollOpenAction
                  && resolvedPoll.status !== "completed";

                if (isOpenPoll) {
                  return (
                    <article className="question-card result-card" key={`merged-poll-${poll.id}`}>
                      <div className="result-card-body">
                        {resolvedPoll.branding?.imageDataUrl || resolvedPoll.branding?.instituteName ? (
                          <div className="assessment-branding">
                            {resolvedPoll.branding.imageDataUrl ? (
                              <img alt="Institute branding" className="assessment-branding-image" src={resolvedPoll.branding.imageDataUrl} />
                            ) : null}
                            {resolvedPoll.branding.instituteName ? (
                              <div>
                                <p className="eyebrow">Institute</p>
                                <strong>{resolvedPoll.branding.instituteName}</strong>
                              </div>
                            ) : null}
                          </div>
                        ) : null}
                        <div className="question-head">
                          <strong>{resolvedPoll.title}</strong>
                          <div className="inline-actions">
                            <span className="status-chip success">{scopeLabel}</span>
                            <span className={`status-chip ${resolvedPoll.status === "live" ? "success" : "warning"}`}>
                              {resolvedPoll.status}
                            </span>
                            {!isCompletedOpenPoll ? (
                              <button
                                aria-expanded={isOpenPollExpanded}
                                className="button-secondary small-button"
                                type="button"
                                onClick={() => toggleOpenPollResultDetails(resolvedPoll.id)}
                              >
                                {isOpenPollExpanded ? "-" : "+"}
                              </button>
                            ) : null}
                          </div>
                        </div>
                        <div className="form-stack">
                          <div>
                            <p className="eyebrow">Results</p>
                            {pollResultsCopy ? <p className="muted-text">{pollResultsCopy}</p> : null}
                          </div>
                          {showResolvedPollOpenAction ? (
                            <div className="inline-actions">
                              <a
                                className="button-secondary small-button"
                                href={resolvedPollAccessUrl ?? undefined}
                                target="_blank"
                                rel="noreferrer"
                              >
                                {resolvedPoll.status === "live" ? "Respond to poll" : "Open poll page"}
                              </a>
                            </div>
                          ) : null}
                          {isOpenPollExpanded ? (
                            <div className="form-stack">
                              <p className="muted-text">Starts: {formatShortDateTime(resolvedPoll.startsAt)}</p>
                              <p className="muted-text">Ends: {formatShortDateTime(resolvedPoll.endsAt)}</p>
                              <p className="muted-text">Questions: {resolvedPoll.questionIds.length}</p>
                              <p className="muted-text">Participant type: Open to all</p>
                              <p className="muted-text">Anonymity: {resolvedPoll.anonymous ? "Anonymous" : "Named"}</p>
                              {showResolvedPollAccessDetails ? <p className="muted-text">Access code: {resolvedPollShareCode}</p> : null}
                              {showResolvedPollAccessDetails ? (
                                <p className="muted-text">
                                  URL: <a href={resolvedPollAccessUrl ?? undefined} target="_blank" rel="noreferrer">{resolvedPollAccessUrl}</a>
                                </p>
                              ) : null}
                              {showResolvedPollAccessDetails && pollQrCodes[resolvedPoll.id] ? (
                                <div className="form-stack">
                                  <img alt={`QR code for ${resolvedPoll.title}`} height={180} src={pollQrCodes[resolvedPoll.id]} width={180} />
                                </div>
                              ) : null}
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </article>
                  );
                }

                return (
                  <details className="question-card result-card" key={`merged-poll-${poll.id}`}>
                    <summary className="result-card-summary">
                      <div className="result-card-summary-main">
                        <strong>{resolvedPoll.title}</strong>
                        <span className="result-card-summary-meta">{formatShortDateTime(resolvedPoll.startsAt)}</span>
                      </div>
                      <span className={`status-chip ${resolvedPoll.status === "live" ? "success" : "warning"}`}>
                        {resolvedPoll.status}
                      </span>
                    </summary>
                    <div className="result-card-body">
                      {resolvedPoll.branding?.imageDataUrl || resolvedPoll.branding?.instituteName ? (
                        <div className="assessment-branding">
                          {resolvedPoll.branding.imageDataUrl ? (
                            <img alt="Institute branding" className="assessment-branding-image" src={resolvedPoll.branding.imageDataUrl} />
                          ) : null}
                          {resolvedPoll.branding.instituteName ? (
                            <div>
                              <p className="eyebrow">Institute</p>
                              <strong>{resolvedPoll.branding.instituteName}</strong>
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                      <div className="question-head">
                        <strong>{resolvedPoll.title}</strong>
                        <div className="inline-actions">
                          <span className="status-chip success">{scopeLabel}</span>
                          <span className={`status-chip ${resolvedPoll.status === "live" ? "success" : "warning"}`}>
                            {resolvedPoll.status}
                          </span>
                        </div>
                      </div>
                      <p className="muted-text">Starts: {formatShortDateTime(resolvedPoll.startsAt)}</p>
                      <p className="muted-text">Ends: {formatShortDateTime(resolvedPoll.endsAt)}</p>
                      <p className="muted-text">Questions: {resolvedPoll.questionIds.length}</p>
                      <p className="muted-text">Participant type: {resolvedPoll.participantType === "registered" ? "Shared with groups" : "Open to all"}</p>
                      <p className="muted-text">Anonymity: {resolvedPoll.anonymous ? "Anonymous" : "Named"}</p>
                      {resolvedPoll.participantType === "registered" ? (
                        <p className="muted-text">
                          Groups: {resolvedPoll.participantGroupIds.length
                            ? resolvedPoll.participantGroupIds
                                .map((groupId) => participantGroups.find((group) => group.id === groupId)?.name ?? "Unknown group")
                                .join(", ")
                            : "None"}
                        </p>
                      ) : null}
                      {showResolvedPollAccessDetails ? <p className="muted-text">Access code: {resolvedPollShareCode}</p> : null}
                      {showResolvedPollAccessDetails ? (
                        <p className="muted-text">
                          URL: <a href={resolvedPollAccessUrl ?? undefined} target="_blank" rel="noreferrer">{resolvedPollAccessUrl}</a>
                        </p>
                      ) : null}
                      {showResolvedPollOpenAction ? (
                        <div className="form-stack">
                          <div className="inline-actions">
                            <a
                              className="button-secondary small-button"
                              href={resolvedPollAccessUrl ?? undefined}
                              target="_blank"
                              rel="noreferrer"
                            >
                              {resolvedPoll.status === "live" ? "Respond to poll" : "Open poll page"}
                            </a>
                          </div>
                          {showResolvedPollAccessDetails && pollQrCodes[resolvedPoll.id] ? (
                            <img alt={`QR code for ${resolvedPoll.title}`} height={180} src={pollQrCodes[resolvedPoll.id]} width={180} />
                          ) : null}
                        </div>
                      ) : null}
                      {pollResultsCopy ? <p className="muted-text">{pollResultsCopy}</p> : null}
                    </div>
                  </details>
                );
              })}
            </div>
          ) : (
            <div className="empty-state">
              <p className="muted-text">No polls match this view yet.</p>
            </div>
          )}
        </div>
      </CollapsibleWorkspaceSection>

      {!activeParticipantTestId ? (
      <CollapsibleWorkspaceSection
        eyebrow=""
        isOpen={openSection === "join-groups"}
        sectionId="admin-join-groups"
        title="Join Groups"
        onToggle={() => toggleSection("join-groups")}
      >
        <div className="form-stack">
          <div className="field-row align-end">
            <div className="field grow-field">
              <label htmlFor="admin-dashboard-phone-search">Admin phone number</label>
              <input
                id="admin-dashboard-phone-search"
                placeholder="Search using the admin account phone number"
                value={groupSearchPhoneNumber}
                onChange={(event) => setGroupSearchPhoneNumber(event.target.value)}
              />
            </div>
            <button className="button" disabled={isSearchingGroups} type="button" onClick={() => void handleSearchGroups()}>
              {isSearchingGroups ? "Searching..." : "Search groups"}
            </button>
          </div>

          {groupSearchFeedback ? <p className="muted-text">{groupSearchFeedback}</p> : null}

          {groupSearchResults.length ? (
            <div className="question-list">
              {groupSearchResults.map((group) => {
                const latestRequest = getLatestOutgoingGroupRequest(group.id);

                return (
                  <article className="question-card nested-card" key={`admin-group-search-${group.id}`}>
                    <div className="question-head">
                      <strong>{group.name}</strong>
                      {latestRequest ? (
                        <span className={`status-chip ${latestRequest.status === "accepted" ? "success" : latestRequest.status === "rejected" ? "warning" : ""}`}>
                          {latestRequest.status}
                        </span>
                      ) : null}
                    </div>
                    <p className="muted-text">
                      {group.participantIds.length} current member{group.participantIds.length === 1 ? "" : "s"}
                    </p>
                    <div className="inline-actions">
                      <button
                        className="button"
                        disabled={Boolean(latestRequest) || isSendingGroupRequest === group.id}
                        type="button"
                        onClick={() => void handleRequestGroup(group.id)}
                      >
                        {isSendingGroupRequest === group.id
                          ? "Sending..."
                          : latestRequest
                            ? latestRequest.status === "pending"
                              ? "Request pending"
                              : latestRequest.status === "accepted"
                                ? "Request accepted"
                                : "Request sent"
                            : "Request access"}
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : null}

          {outgoingGroupJoinRequests.length ? (
            <div className="question-card">
              <div className="question-head">
                <strong>My group requests</strong>
                <span className="status-chip success">{outgoingGroupJoinRequests.length}</span>
              </div>
              <div className="request-list">
                {outgoingGroupJoinRequests.map((request) => (
                  <article className="request-card" key={`admin-request-${request.id}`}>
                    <div>
                      <strong>{request.adminGroupName}</strong>
                      {request.requestType === "admin-invite" ? (
                        <>
                          <p className="muted-text">Invited by {request.adminLabel}</p>
                          <p className="muted-text">Contact: {request.adminIdentifier}</p>
                          <p className="muted-text">Invitation sent {formatShortDateTime(request.requestedAt)}</p>
                        </>
                      ) : (
                        <>
                          <p className="muted-text">Requested as {request.requesterLabel}</p>
                          <p className="muted-text">Requested {formatShortDateTime(request.requestedAt)}</p>
                        </>
                      )}
                    </div>
                    <div className="inline-actions">
                      <span className={`status-chip ${request.status === "accepted" ? "success" : request.status === "rejected" ? "warning" : ""}`}>
                        {request.status}
                      </span>
                      {request.status === "pending" && request.requestType === "admin-invite" ? (
                        <>
                          <button
                            className="button-secondary small-button"
                            type="button"
                            onClick={() => void handleResolveOwnGroupInvite(request.id, "accept")}
                          >
                            Accept
                          </button>
                          <button
                            className="button-secondary small-button"
                            type="button"
                            onClick={() => void handleResolveOwnGroupInvite(request.id, "reject")}
                          >
                            Reject
                          </button>
                        </>
                      ) : null}
                    </div>
                  </article>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </CollapsibleWorkspaceSection>
      ) : null}

        </div>
      </div>

    </div>
  );
}
