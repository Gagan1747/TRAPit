"use client";

import { formatElapsedTime, type WorkspaceBranding } from "@trapit/testing";
import { Check, X } from "lucide-react";
import { useEffect, useState } from "react";

import { formatShortDateTime } from "../lib/date-format";

type CreatorParticipantResponse = {
  marks: number;
  marksByQuestionId: Record<string, number>;
  overallMarks: number;
  participantName: string;
  rank: number;
  selectedOptionByQuestionId: Record<string, number | null>;
};

type TestResultsPayload = {
  assessmentKind?: "standard" | "instant";
  branding: WorkspaceBranding | null;
  correctMarks?: number;
  creatorParticipantResponses?: CreatorParticipantResponse[];
  groupNames: string[];
  hasCreatorScope: boolean;
  hasParticipantScope: boolean;
  myReportedQuestionCount?: number;
  overallMarks?: number;
  reportedQuestionIds?: string[];
  participantResult: {
    correctCount: number;
    elapsedMs: number;
    incorrectCount: number;
    marks: number;
    participantName: string;
    rank: number;
    rankedParticipantCount: number;
    totalCount: number;
  } | null;
  participants: Array<{
    correctCount: number;
    elapsedMs: number;
    incorrectCount: number;
    isCurrentParticipant: boolean;
    marks: number;
    manualName: string;
    maskedIdentifier: string;
    rank: number;
    totalCount: number;
    unansweredCount: number;
  }>;
  poolName: string;
  questions: Array<{
    correctOptionIndex: number;
    imageDataUrl?: string | null;
    marks?: number | null;
    optionSelectionCounts: number[];
    options: string[];
    prompt: string;
    questionId: string;
    selectedOptionIndex: number | null;
  }>;
  summary: {
    creatorName: string;
    durationMinutes: number;
    participantName: string;
    poolName: string;
    startsAt: string;
    submittedCount: number;
    sharedCount: number;
    testId: string;
    title: string;
  };
};

type TestResultsWorkspaceProps = {
  testId: string;
};

async function readJson<T>(response: Response) {
  const payload = (await response.json()) as T & { error?: string };

  if (!response.ok) {
    throw new Error(payload.error ?? "Unable to load test results.");
  }

  return payload;
}

export function TestResultsWorkspace({ testId }: TestResultsWorkspaceProps) {
  const [error, setError] = useState<string | null>(null);
  const [payload, setPayload] = useState<TestResultsPayload | null>(null);

  useEffect(() => {
    let active = true;

    async function loadResults() {
      try {
        const nextPayload = await readJson<TestResultsPayload>(
          await fetch(`/api/test-results/${encodeURIComponent(testId)}`, { cache: "no-store" }),
        );

        if (active) {
          setPayload(nextPayload);
          setError(null);
        }
      } catch (loadError) {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : "Unable to load test results.");
        }
      }
    }

    void loadResults();

    return () => {
      active = false;
    };
  }, [testId]);

  if (error) {
    return <section className="workspace-card"><h1>Results unavailable</h1><p>{error}</p></section>;
  }

  if (!payload) {
    return <p className="muted-text">Loading test results...</p>;
  }

  return <TestResultsContent payload={payload} onPayloadUpdate={setPayload} />;
}

export function TestResultsContent({
  payload,
  onPayloadUpdate,
}: {
  payload: TestResultsPayload;
  onPayloadUpdate?: (nextPayload: TestResultsPayload) => void;
}) {
  const [selectedParticipantIndex, setSelectedParticipantIndex] = useState<number | null>(null);
  const [reportingQuestionId, setReportingQuestionId] = useState<string | null>(null);
  const [reportReason, setReportReason] = useState("");
  const [isReporting, setIsReporting] = useState(false);
  const [reportFeedback, setReportFeedback] = useState<string | null>(null);
  const [localReportedIds, setLocalReportedIds] = useState<string[]>([]);

  const duration = `${payload.summary.durationMinutes} min`;
  const correctMarks = payload.correctMarks ?? (payload.assessmentKind === "instant" ? 4 : 1);
  const selectedCreatorParticipant =
    payload.hasCreatorScope && selectedParticipantIndex !== null
      ? payload.creatorParticipantResponses?.[selectedParticipantIndex] ?? null
      : null;
  const activeParticipantName = selectedCreatorParticipant
    ? (selectedCreatorParticipant.participantName || payload.participants[selectedParticipantIndex!]?.manualName || "—")
    : (payload.summary.participantName || payload.participantResult?.participantName || "—");
  const overallMarks = selectedCreatorParticipant
    ? selectedCreatorParticipant.overallMarks
    : (payload.overallMarks ?? payload.participantResult?.marks ?? 0);
  const canInspectParticipantResponses = Boolean(payload.hasParticipantScope || selectedCreatorParticipant);
  const canReportQuestions = Boolean(payload.hasCreatorScope || payload.hasParticipantScope);
  const reportedSet = new Set([...(payload.reportedQuestionIds ?? []), ...localReportedIds]);
  const myReportedCount = payload.myReportedQuestionCount ?? localReportedIds.length;
  const hasReachedUserReviewLimit = myReportedCount >= 2;

  async function handleSubmitQuestionReport(questionId: string) {
    if (isReporting) return;
    setIsReporting(true);
    setReportFeedback(null);
    try {
      const nextPayload = await readJson<TestResultsPayload>(
        await fetch(`/api/test-results/${encodeURIComponent(payload.summary.testId)}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            questionId,
            reason: reportReason.trim(),
          }),
        }),
      );
      setLocalReportedIds((current) => [...new Set([...current, questionId])]);
      setReportingQuestionId(null);
      setReportReason("");
      setReportFeedback("Question submitted for review.");
      onPayloadUpdate?.(nextPayload);
    } catch (reportError) {
      setReportFeedback(reportError instanceof Error ? reportError.message : "Unable to submit question for review.");
    } finally {
      setIsReporting(false);
    }
  }

  return (
    <div className="test-results-stack game-page-stack">
      <header className="game-user-banner">
        <div>
          <span className="eyebrow">Participant</span>
          <strong>{activeParticipantName}</strong>
        </div>
        <div className="game-user-points">
          <span className="eyebrow">Overall marks</span>
          <strong>{overallMarks}</strong>
        </div>
      </header>

      <header className="test-results-header">
        {payload.branding?.instituteName?.trim() ? <p className="eyebrow">{payload.branding.instituteName}</p> : null}
        <h1>{payload.summary.title} ({payload.questions.length})</h1>
      </header>

      <div className="leaderboard-table-wrap test-results-summary-wrap">
        <table className="leaderboard-table test-results-summary-table">
          <thead><tr><th>Scheduled date</th><th>Question Pool</th><th>Groups</th><th>Test creator name</th></tr></thead>
          <tbody><tr>
            <td>{formatShortDateTime(payload.summary.startsAt)}</td>
            <td>{payload.summary.poolName}</td>
            <td>{payload.groupNames.length ? payload.groupNames.join(", ") : "None"}</td>
            <td>{payload.summary.creatorName}</td>
          </tr></tbody>
        </table>
      </div>

      {reportFeedback ? <p className="muted-text" role="status">{reportFeedback}</p> : null}

      <div className="test-results-layout">
        <section className="workspace-card test-results-question-panel">
          <h2>Questions ({payload.questions.length})</h2>
          <p className="muted-text">Responses {payload.questions.length}</p>
          <div className="test-results-question-list">
          {payload.questions.map((question, questionIndex) => {
            const effectiveSelectedOptionIndex = selectedCreatorParticipant
              ? (selectedCreatorParticipant.selectedOptionByQuestionId[question.questionId] ?? null)
              : (payload.hasParticipantScope ? question.selectedOptionIndex : null);
            const questionMarks = selectedCreatorParticipant
              ? (selectedCreatorParticipant.marksByQuestionId[question.questionId]
                  ?? (effectiveSelectedOptionIndex === question.correctOptionIndex ? correctMarks : -1))
              : payload.hasParticipantScope
                ? (question.marks !== undefined && question.marks !== null
                    ? question.marks
                    : effectiveSelectedOptionIndex === question.correctOptionIndex
                      ? correctMarks
                      : -1)
                : null;
            const isQuestionReported = reportedSet.has(question.questionId);

            return (
            <article className="test-results-question" key={question.questionId}>
              <div className="question-head">
                <h3>{questionIndex + 1}. {question.prompt}</h3>
                <div className="inline-actions">
                  {questionMarks !== null ? <strong>{questionMarks >= 0 ? `+${questionMarks}` : questionMarks}</strong> : null}
                  {canReportQuestions ? (
                    <button
                      className={isQuestionReported ? "button small-button" : "button-secondary small-button"}
                      disabled={isReporting || isQuestionReported || hasReachedUserReviewLimit}
                      type="button"
                      onClick={() => {
                        if (reportingQuestionId === question.questionId) {
                          setReportingQuestionId(null);
                          setReportReason("");
                        } else {
                          setReportingQuestionId(question.questionId);
                          setReportReason("");
                        }
                      }}
                    >
                      {isQuestionReported ? "Reviewed" : "Review"}
                    </button>
                  ) : null}
                </div>
              </div>
              {question.imageDataUrl ? (
                <div className="question-image-container">
                  <img alt={`Question ${questionIndex + 1} illustration`} className="question-illustration-image" loading="lazy" src={question.imageDataUrl} />
                </div>
              ) : null}
              {reportingQuestionId === question.questionId && !isQuestionReported && !hasReachedUserReviewLimit ? (
                <div className="field-row align-end test-results-report-box">
                  <div className="field grow-field">
                    <label htmlFor={`report-reason-${question.questionId}`}>Description (max 20 characters)</label>
                    <input
                      id={`report-reason-${question.questionId}`}
                      maxLength={20}
                      placeholder="Max 20 chars"
                      value={reportReason}
                      onChange={(event) => setReportReason(event.target.value.slice(0, 20))}
                    />
                  </div>
                  <button
                    className="button small-button"
                    disabled={isReporting}
                    type="button"
                    onClick={() => void handleSubmitQuestionReport(question.questionId)}
                  >
                    {isReporting ? "Submitting..." : "Submit review"}
                  </button>
                  <button
                    className="button-secondary small-button"
                    disabled={isReporting}
                    type="button"
                    onClick={() => {
                      setReportingQuestionId(null);
                      setReportReason("");
                    }}
                  >
                    Cancel
                  </button>
                </div>
              ) : null}
              <div className="test-results-options">
                {question.options.map((option, optionIndex) => {
                  const isCorrect = optionIndex === question.correctOptionIndex;
                  const isSelected = canInspectParticipantResponses && optionIndex === effectiveSelectedOptionIndex;

                  return (
                    <div className={`test-results-option${isCorrect ? " is-correct" : ""}${isSelected && !isCorrect ? " is-incorrect" : ""}`} key={`${question.questionId}-${optionIndex}`}>
                      <span>{option}</span>
                      <span className="test-results-option-meta">
                        <span>{question.optionSelectionCounts[optionIndex] ?? 0} participant{question.optionSelectionCounts[optionIndex] === 1 ? "" : "s"}</span>
                        {isSelected && !isCorrect ? <X aria-label="Selected incorrect option" className="answer-status-icon is-incorrect" /> : null}
                        {isSelected && isCorrect ? <Check aria-label="Selected correct option" className="answer-status-icon is-correct" /> : null}
                        {isCorrect ? <Check aria-label="Actual correct answer" className="answer-status-icon is-answer" /> : null}
                      </span>
                    </div>
                  );
                })}
              </div>
            </article>
            );
          })}
          </div>
        </section>

        <aside className="workspace-card game-leaderboard-panel test-results-leaderboard">
          <p className="eyebrow">Leaderboard</p>
          <h2>Final standings ({payload.summary.submittedCount}/{payload.summary.sharedCount})</h2>
          {payload.participants.length ? (
            <div className="game-leaderboard-list">
              {payload.participants.map((participant, index) => {
                const creatorParticipant = payload.creatorParticipantResponses?.[index];
                const displayManualName = payload.hasCreatorScope && creatorParticipant?.participantName
                  ? creatorParticipant.participantName
                  : participant.manualName;
                const isSelectedRow = payload.hasCreatorScope
                  ? (selectedParticipantIndex === index || (selectedParticipantIndex === null && participant.isCurrentParticipant))
                  : participant.isCurrentParticipant;

                return (
                <div
                  className={`game-leaderboard-row test-results-leaderboard-row${isSelectedRow ? " is-current-participant" : ""}`}
                  aria-current={isSelectedRow ? "true" : undefined}
                  key={`${participant.rank}-${participant.manualName}-${index}`}
                  role={payload.hasCreatorScope ? "button" : undefined}
                  tabIndex={payload.hasCreatorScope ? 0 : undefined}
                  style={payload.hasCreatorScope ? { cursor: "pointer" } : undefined}
                  onClick={payload.hasCreatorScope ? () => setSelectedParticipantIndex(index) : undefined}
                  onKeyDown={
                    payload.hasCreatorScope
                      ? (event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            setSelectedParticipantIndex(index);
                          }
                        }
                      : undefined
                  }
                >
                  <div className="test-results-leaderboard-left">
                    <strong>#{participant.rank} {displayManualName}{participant.isCurrentParticipant ? " (You)" : ""}</strong>
                    <span className="test-results-leaderboard-meta">{participant.maskedIdentifier}</span>
                    <span className="test-results-leaderboard-time">{formatElapsedTime(participant.elapsedMs)} ({duration})</span>
                  </div>
                  <div className="test-results-leaderboard-right">
                    <strong>{participant.marks} marks</strong>
                    <span className="test-results-leaderboard-meta">(+{participant.correctCount} / -{participant.incorrectCount + participant.unansweredCount})</span>
                  </div>
                </div>
                );
              })}
            </div>
          ) : <p className="muted-text">No participants appeared.</p>}
        </aside>
      </div>

      <p className="apportion-identity-mark">www.TRAPit.in</p>
    </div>
  );
}