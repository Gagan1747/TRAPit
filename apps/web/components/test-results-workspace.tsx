"use client";

import { formatElapsedTime, type WorkspaceBranding } from "@trapit/testing";
import { Check, X } from "lucide-react";
import { useEffect, useState } from "react";

import { formatShortDateTime } from "../lib/date-format";
import { AssessmentLogTable, type AssessmentLogRow } from "./assessment-log-table";

type TestResultsPayload = {
  branding: WorkspaceBranding | null;
  groupNames: string[];
  hasCreatorScope: boolean;
  hasParticipantScope: boolean;
  participantResult: {
    correctCount: number;
    elapsedMs: number;
    incorrectCount: number;
    participantName: string;
    rank: number;
    rankedParticipantCount: number;
    totalCount: number;
  } | null;
  participants: Array<{
    correctCount: number;
    elapsedMs: number;
    identifier: string;
    incorrectCount: number;
    manualName: string;
    profileLabel: string;
    rank: number;
    totalCount: number;
  }>;
  poolName: string;
  questions: Array<{
    correctOptionIndex: number;
    optionSelectionCounts: number[] | null;
    options: string[];
    prompt: string;
    questionId: string;
    selectedOptionIndex: number | null;
  }>;
  summary: {
    durationMinutes: number;
    participantName: string;
    poolName: string;
    startsAt: string;
    submittedCount: number;
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

  const duration = `${payload.summary.durationMinutes} min`;
  const participantResult = payload.participantResult;
  const useParticipantSummary = payload.hasParticipantScope;
  const summaryRows: AssessmentLogRow[] = [{
    groups: payload.groupNames.length ? payload.groupNames.join(", ") : "None",
    id: payload.summary.testId,
    marksOrPoints: participantResult
      ? `${participantResult.correctCount} (${participantResult.incorrectCount}) / ${participantResult.totalCount}`
      : "—",
    participantName: useParticipantSummary ? payload.summary.participantName : "—",
    questionPool: payload.summary.poolName,
    rank: participantResult
      ? `${participantResult.rank} / ${participantResult.rankedParticipantCount}`
      : payload.hasCreatorScope
        ? `${payload.summary.submittedCount} appeared`
        : "—",
    scheduled: formatShortDateTime(payload.summary.startsAt),
    sortTime: new Date(payload.summary.startsAt).getTime(),
    status: <span className="status-chip success">Results</span>,
    test: payload.summary.title,
    time: participantResult ? `${formatElapsedTime(participantResult.elapsedMs)} / ${duration}` : duration,
  }];

  return (
    <div className="test-results-stack">
      <header className="test-results-header">
        {payload.branding?.instituteName?.trim() ? <p className="eyebrow">{payload.branding.instituteName}</p> : null}
        <h1>{payload.summary.title}</h1>
      </header>

      <AssessmentLogTable rows={summaryRows} />

      {payload.hasCreatorScope ? (
        <section className="workspace-card">
          <h2>Participant Results</h2>
          {payload.participants.length ? (
            <div className="leaderboard-table-wrap">
              <table className="leaderboard-table participant-results-table">
                <thead><tr><th>Rank</th><th>Participant Name</th><th>Marks</th><th>Time Taken</th></tr></thead>
                <tbody>
                  {payload.participants.map((participant) => (
                    <tr key={participant.identifier}>
                      <td>{participant.rank}</td>
                      <td>{participant.manualName} ({participant.profileLabel} / {participant.identifier})</td>
                      <td>{participant.correctCount} <span className="incorrect-count">({participant.incorrectCount})</span> / {participant.totalCount}</td>
                      <td>{formatElapsedTime(participant.elapsedMs)} / {duration}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="muted-text">No participants appeared.</p>}
        </section>
      ) : null}

      <section className="workspace-card">
        <h2>Questions &amp; Options</h2>
        <div className="test-results-question-list">
          {payload.questions.map((question, questionIndex) => (
            <article className="test-results-question" key={question.questionId}>
              <h3>{questionIndex + 1}. {question.prompt}</h3>
              <div className="test-results-options">
                {question.options.map((option, optionIndex) => {
                  const isCorrect = optionIndex === question.correctOptionIndex;
                  const isSelected = payload.hasParticipantScope && optionIndex === question.selectedOptionIndex;

                  return (
                    <div className={`test-results-option${isCorrect ? " is-correct" : ""}${isSelected && !isCorrect ? " is-incorrect" : ""}`} key={`${question.questionId}-${optionIndex}`}>
                      <span>{option}</span>
                      <span className="test-results-option-meta">
                        {payload.hasCreatorScope && question.optionSelectionCounts ? <span>{question.optionSelectionCounts[optionIndex]}</span> : null}
                        {isSelected && !isCorrect ? <X aria-label="Selected incorrect option" className="answer-status-icon is-incorrect" /> : null}
                        {isCorrect ? <Check aria-label="Correct option" className="answer-status-icon is-correct" /> : null}
                      </span>
                    </div>
                  );
                })}
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}