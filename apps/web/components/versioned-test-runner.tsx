"use client";

import { shuffleWithSeed, type TestParticipantSession } from "@trapit/testing";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { readJsonResponse } from "../lib/read-json-response";

type Question = { id: string; prompt: string; options: string[] };
type SessionPayload = {
  acceptedCount: number;
  isCreator: boolean;
  session: TestParticipantSession | null;
  test: {
    id: string;
    title: string;
    assessmentKind: "standard" | "instant";
    startsAt: string;
    startedAt?: string | null;
    countdownStartedAt?: string | null;
    durationMinutes: number;
    questionCount: number;
    status: "scheduled" | "live" | "completed";
    questions: Question[];
  };
};

function countdown(milliseconds: number) {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export function VersionedTestRunner({ testId, identifier, authConfigured, initialParticipantName }: {
  testId: string;
  identifier: string;
  authConfigured: boolean;
  initialParticipantName: string;
}) {
  const [payload, setPayload] = useState<SessionPayload | null>(null);
  const [name, setName] = useState(initialParticipantName);
  const [answers, setAnswers] = useState<Record<string, number | undefined>>({});
  const [index, setIndex] = useState(0);
  const [now, setNow] = useState(Date.now);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<"saved" | "saving" | "failed">("saved");
  const answersRef = useRef(answers);
  const revision = useRef(0);
  const savedRevision = useRef(0);
  const saving = useRef<Promise<boolean> | null>(null);
  const saveFailures = useRef(0);
  const hydrated = useRef(false);
  const query = !authConfigured ? `?participantId=${encodeURIComponent(identifier)}` : "";
  const base = `/api/user/tests/${encodeURIComponent(testId)}`;
  const test = payload?.test;
  const endsAt = test ? Date.parse(test.startsAt) + test.durationMinutes * 60_000 : 0;
  const active = Boolean(test && payload.session && !payload.session.submittedAt && test.status === "live" && now >= Date.parse(test.startsAt) && now < endsAt);
  const orderedQuestions = test ? shuffleWithSeed(test.questions, `${testId}:${identifier}:questions`) : [];
  const question = orderedQuestions[index];
  const optionIndexes = question ? shuffleWithSeed(question.options.map((_, optionIndex) => optionIndex), `${testId}:${identifier}:${question.id}`) : [];

  function receive(next: SessionPayload) {
    setPayload(next);
    if (!hydrated.current && next.session) {
      answersRef.current = next.session.answers;
      setAnswers(next.session.answers);
      revision.current = next.session.revision;
      savedRevision.current = next.session.revision;
      hydrated.current = true;
    }
  }

  useEffect(() => {
    let disposed = false;
    const controller = new AbortController();
    async function refresh() {
      try {
        const next = await readJsonResponse<SessionPayload>(await fetch(`${base}/session${query}`, { signal: controller.signal, cache: "no-store" }));
        if (!disposed) receive(next);
      } catch (failure) {
        if (!disposed) setError(failure instanceof Error ? failure.message : "Unable to refresh the test.");
      }
    }
    void refresh();
    const refreshTimer = window.setInterval(() => void refresh(), 2_000);
    const clockTimer = window.setInterval(() => setNow(Date.now()), 250);
    return () => {
      disposed = true;
      controller.abort();
      window.clearInterval(refreshTimer);
      window.clearInterval(clockTimer);
    };
  }, [base, query]);

  const flushAnswers = useCallback(async function flushAnswers(): Promise<boolean> {
    if (saving.current) {
      const succeeded = await saving.current;
      if (!succeeded) return false;
      return savedRevision.current < revision.current ? flushAnswers() : true;
    }
    if (savedRevision.current >= revision.current) return true;
    if (Date.now() >= endsAt) {
      setSaveState("failed");
      return false;
    }
    const sentRevision = revision.current;
    const sentAnswers = { ...answersRef.current };
    setSaveState("saving");
    const operation = (async () => {
      try {
        const next = await readJsonResponse<SessionPayload>(await fetch(`${base}/session${query}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ answers: sentAnswers, revision: sentRevision }),
        }));
        if (!next.session || next.session.revision < sentRevision) throw new Error("The server did not confirm this answer revision.");
        savedRevision.current = sentRevision;
        saveFailures.current = 0;
        setSaveState(revision.current === sentRevision ? "saved" : "saving");
        setPayload(next);
        return true;
      } catch (failure) {
        saveFailures.current += 1;
        if (saveFailures.current >= 3 || Date.now() >= endsAt) {
          setSaveState("failed");
          setError(failure instanceof Error ? `Answers could not be saved: ${failure.message}` : "Answers could not be saved. Check your connection.");
        }
        return false;
      }
    })();
    saving.current = operation;
    try {
      const succeeded = await operation;
      return succeeded;
    } finally {
      saving.current = null;
    }
  }, [base, endsAt, query]);

  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => {
      if (savedRevision.current < revision.current) void flushAnswers();
    }, 1_500);
    return () => window.clearInterval(timer);
  }, [active, flushAnswers]);

  async function action(path: "session" | "start" | "attempt") {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      if (path === "attempt") {
        while (savedRevision.current < revision.current) {
          if (!await flushAnswers()) throw new Error("Your latest selections have not been saved. Retry before the test ends.");
        }
      }
      const response = await fetch(`${base}/${path}${query}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(path === "session" ? { participantName: name } : {}),
      });
      if (path === "attempt") {
        await readJsonResponse(response);
        receive(await readJsonResponse<SessionPayload>(await fetch(`${base}/session${query}`, { cache: "no-store" })));
      } else receive(await readJsonResponse<SessionPayload>(response));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Unable to update this test.");
    } finally {
      setBusy(false);
    }
  }

  function selectAnswer(id: string, option: number) {
    if (!active || busy) return;
    const next = { ...answersRef.current, [id]: option };
    answersRef.current = next;
    revision.current += 1;
    setAnswers(next);
    setSaveState("saving");
  }

  if (!payload || !test) return <section className="workspace-card"><p role={error ? "alert" : "status"}>{error ?? "Loading test…"}</p></section>;
  const awaitingLaunch = test.assessmentKind === "instant" && !test.startedAt;
  const waitingForQuestions = !awaitingLaunch && now < Date.parse(test.startsAt);
  const finished = test.status === "completed" || (!awaitingLaunch && now >= endsAt);
  const submitted = Boolean(payload.session?.submittedAt);

  return <div className="test-runner-shell">
    <section className="workspace-card">
      <h1>{test.title}</h1>
      <p>{test.assessmentKind === "instant" ? "Instant Test" : "Test"} · {test.questionCount} questions · {test.durationMinutes} min</p>
      {error ? <p role="alert">{error}</p> : null}
      {finished ? <>
        <p>Results are available.{!payload.session ? " Absent." : " Your saved responses have been submitted."}</p>
        <a className="button" href={`/test-results/${encodeURIComponent(testId)}`}>View results</a>
      </> : submitted ? <p>Submitted. Results will be available when the test ends.</p> : <>
        {!payload.session ? <div className="field">
          <label htmlFor="participant-entry-name">Your name</label>
          <input id="participant-entry-name" value={name} onChange={(event) => setName(event.target.value)} disabled={busy} />
          <button className="button" type="button" disabled={busy || !name.trim() || Boolean(test.countdownStartedAt)} onClick={() => void action("session")}>Join test</button>
        </div> : <p>Joined as {payload.session.participantName}</p>}
        {awaitingLaunch ? <>
          <p>{payload.acceptedCount} participants accepted. Waiting for the creator to start.</p>
          {payload.isCreator ? <button className="button" type="button" disabled={busy || payload.acceptedCount < 4} onClick={() => void action("start")}>Start test</button> : null}
        </> : waitingForQuestions ? <p className="status-chip">Questions begin in {countdown(Date.parse(test.startsAt) - now)}</p> : null}
      </>}
      <a className="button-secondary" href="/user?view=tests">Back to tests</a>
    </section>
    {active && question ? <>
      <div className="test-runner-timer"><span>Time left</span><strong>{countdown(endsAt - now)}</strong></div>
      <article className="question-card">
        <div className="question-head"><strong>Question {index + 1} of {orderedQuestions.length}</strong><span role="status">{saveState === "saved" ? "Saved" : saveState === "saving" ? "Saving…" : "Not saved — retrying"}</span></div>
        <p>{question.prompt}</p>
        <div className="answer-grid">{optionIndexes.map((optionIndex) => <label className="role-option" key={optionIndex}>
          <input type="radio" name={question.id} checked={answers[question.id] === optionIndex} disabled={busy} onChange={() => selectAnswer(question.id, optionIndex)} />
          {question.options[optionIndex]}
        </label>)}</div>
        <div className="inline-actions">
          <button className="button-secondary icon-button" type="button" aria-label="Previous question" disabled={index === 0} onClick={() => setIndex((current) => current - 1)}><ChevronLeft aria-hidden="true" /></button>
          <button className="button-secondary icon-button" type="button" aria-label="Next question" disabled={index >= orderedQuestions.length - 1} onClick={() => setIndex((current) => current + 1)}><ChevronRight aria-hidden="true" /></button>
          <button className="button" type="button" disabled={busy} onClick={() => void action("attempt")}>{busy ? "Submitting…" : "Submit test"}</button>
          {saveState === "failed" ? <button className="button-secondary" type="button" onClick={() => void flushAnswers()}>Retry save</button> : null}
        </div>
      </article>
    </> : null}
  </div>;
}
