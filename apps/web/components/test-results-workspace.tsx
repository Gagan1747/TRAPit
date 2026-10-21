"use client";

import { formatElapsedTime, type WorkspaceBranding } from "@trapit/testing";
import { Check, X } from "lucide-react";
import { useEffect, useState } from "react";

import { formatShortDateTime } from "../lib/date-format";

type TestResultsPayload = {
  assessmentKind?: "standard" | "instant";
  branding: WorkspaceBranding | null;
  correctMarks?: number;
  groupNames: string[];
  hasCreatorScope: boolean;
  hasParticipantScope: boolean;
  overallMarks?: number;
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

  return <TestResultsContent payload={payload} />;
}

export function TestResultsContent({ payload }: { payload: TestResultsPayload }) {
  const duration = `${payload.summary.durationMinutes} min`;
  const correctMarks = payload.correctMarks ?? (payload.assessmentKind === "instant" ? 4 : 1);
  const overallMarks = payload.overallMarks ?? payload.participantResult?.marks ?? 0;

  return (
    <div className="test-results-stack game-page-stack">
      <header className="game-user-banner">
        <div>
          <span className="eyebrow">Participant</span>
          <strong>{payload.summary.participantName || payload.participantResult?.participantName || "—"}</strong>
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

      <div className="test-results-layout">
        <section className="workspace-card test-results-question-panel">
          <h2>Questions ({payload.questions.length})</h2>
          <p className="muted-text">Responses {payload.questions.length}</p>
          <div className="test-results-question-list">
          {payload.questions.map((question, questionIndex) => {
            const questionMarks = payload.hasParticipantScope
              ? (question.marks !== undefined && question.marks !== null
                  ? question.marks
                  : question.selectedOptionIndex === question.correctOptionIndex
                    ? correctMarks
                    : -1)
              : null;

            return (
            <article className="test-results-question" key={question.questionId}>
              <div className="question-head">
                <h3>{questionIndex + 1}. {question.prompt}</h3>
                {questionMarks !== null ? <strong>{questionMarks >= 0 ? `+${questionMarks}` : questionMarks}</strong> : null}
              </div>
              <div className="test-results-options">
                {question.options.map((option, optionIndex) => {
                  const isCorrect = optionIndex === question.correctOptionIndex;
                  const isSelected = payload.hasParticipantScope && optionIndex === question.selectedOptionIndex;

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
              {payload.participants.map((participant, index) => (
                <div className={`game-leaderboard-row test-results-leaderboard-row${participant.isCurrentParticipant ? " is-current-participant" : ""}`} aria-current={participant.isCurrentParticipant ? "true" : undefined} key={`${participant.rank}-${participant.manualName}-${index}`}>
                  <strong>#{participant.rank} {participant.manualName}{participant.isCurrentParticipant ? " (You)" : ""}</strong>
                  <span>
                    {participant.maskedIdentifier}
                    <br />
                    <span className="test-results-leaderboard-time">{formatElapsedTime(participant.elapsedMs)} ({duration})</span>
                  </span>
                  <span>
                    {participant.marks} marks
                    <br />
                    <span className="muted-text">(+{participant.correctCount} / -{participant.incorrectCount + participant.unansweredCount})</span>
                  </span>
                </div>
              ))}
            </div>
          ) : <p className="muted-text">No participants appeared.</p>}
        </aside>
      </div>

      <p className="apportion-identity-mark">www.TRAPit.in</p>
    </div>
  );
}