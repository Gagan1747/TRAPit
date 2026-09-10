"use client";

import { formatElapsedTime, type WorkspaceBranding } from "@trapit/testing";
import { Check, X } from "lucide-react";
import { useEffect, useState } from "react";

import { formatShortDateTime } from "../lib/date-format";

type TestResultsPayload = {
  branding: WorkspaceBranding | null;
  groupNames: string[];
  hasCreatorScope: boolean;
  hasParticipantScope: boolean;
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
    marks: number;
    manualName: string;
    rank: number;
    totalCount: number;
    unansweredCount: number;
  }>;
  poolName: string;
  questions: Array<{
    correctOptionIndex: number;
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

  return (
    <div className="test-results-stack">
      <header className="test-results-header">
        {payload.branding?.instituteName?.trim() ? <p className="eyebrow">{payload.branding.instituteName}</p> : null}
        <h1>{payload.summary.title}</h1>
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

      {participantResult ? (
        <section className="test-results-personal-summary" aria-label="Your result">
          <strong>Your result: {participantResult.marks} marks</strong>
          <span>Rank {participantResult.rank} of {participantResult.rankedParticipantCount}</span>
          <span>{formatElapsedTime(participantResult.elapsedMs)} / {duration}</span>
        </section>
      ) : null}

      <div className="test-results-layout">
        <section className="workspace-card test-results-question-panel">
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
          ))}
          </div>
        </section>

        <aside className="workspace-card game-leaderboard-panel test-results-leaderboard">
          <p className="eyebrow">Leaderboard</p>
          <h2>Final standings</h2>
          {payload.participants.length ? (
            <div className="game-leaderboard-list">
              {payload.participants.map((participant, index) => (
                <div className="game-leaderboard-row test-results-leaderboard-row" key={`${participant.rank}-${participant.manualName}-${index}`}>
                  <strong>#{participant.rank} {participant.manualName}</strong>
                  <span>{participant.marks} marks</span>
                  <span className="test-results-leaderboard-time">{formatElapsedTime(participant.elapsedMs)}</span>
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