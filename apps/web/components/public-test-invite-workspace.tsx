"use client";

import { useEffect, useState } from "react";

import { formatShortDateTime } from "../lib/date-format";

type InvitePayload = {
  actor: {
    displayName: string | null;
    identifier: string | null;
    isRegistered: boolean;
  };
  access: {
    canRequestAccess: boolean;
    isGroupMember: boolean;
    requestStatus: "accepted" | "pending" | "rejected" | null;
  };
  group: {
    description: string;
    id: string;
    name: string;
    ownerIdentifier: string | null;
  };
  test: {
    durationMinutes: number;
    id: string;
    inviteJoinMode: "approval-required" | "automatic";
    questionCount: number;
    shareCode: string | null;
    startsAt: string;
    status: "completed" | "live" | "scheduled";
    title: string;
  };
};

async function readJson<T>(response: Response): Promise<T> {
  const payload = (await response.json()) as T & { error?: string };

  if (!response.ok) {
    throw new Error((payload as { error?: string }).error ?? "Request failed.");
  }

  return payload;
}

type PublicTestInviteWorkspaceProps = {
  shareCode: string;
};

export function PublicTestInviteWorkspace({ shareCode }: PublicTestInviteWorkspaceProps) {
  const [feedback, setFeedback] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRequestingAccess, setIsRequestingAccess] = useState(false);
  const [payload, setPayload] = useState<InvitePayload | null>(null);
  const invitePath = `/test/${encodeURIComponent(shareCode)}`;
  const signInPath = `/sign-in?redirect=${encodeURIComponent(invitePath)}`;
  const signUpPath = `/sign-up?redirect=${encodeURIComponent(invitePath)}`;

  useEffect(() => {
    let isMounted = true;

    async function loadInvite() {
      setIsLoading(true);

      try {
        const nextPayload = await readJson<InvitePayload>(
          await fetch(`/api/public/tests/${encodeURIComponent(shareCode)}`),
        );

        if (!isMounted) {
          return;
        }

        setPayload(nextPayload);
        setFeedback(null);
      } catch (error) {
        if (isMounted) {
          setFeedback(error instanceof Error ? error.message : "Unable to load this test invite.");
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    void loadInvite();

    return () => {
      isMounted = false;
    };
  }, [shareCode]);

  useEffect(() => {
    if (
      !payload
      || !payload.actor.isRegistered
      || payload.access.isGroupMember
      || payload.access.requestStatus === "pending"
      || payload.test.inviteJoinMode !== "automatic"
      || isRequestingAccess
    ) {
      return;
    }

    void handleRequestAccess(true);
  }, [isRequestingAccess, payload]);

  async function handleRequestAccess(automatic = false) {
    setIsRequestingAccess(true);

    try {
      const nextPayload = await readJson<InvitePayload>(
        await fetch(`/api/public/tests/${encodeURIComponent(shareCode)}`, {
          method: "POST",
        }),
      );

      setPayload(nextPayload);
      setFeedback(
        automatic || nextPayload.access.isGroupMember
          ? "You have been added to the group. Open your dashboard to respond to the test when it is available."
          : "Access request sent. The test creator can approve you from the group requests list.",
      );
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Unable to request access to this test.");
    } finally {
      setIsRequestingAccess(false);
    }
  }

  if (isLoading) {
    return <div className="empty-state"><p className="muted-text">Loading test invite...</p></div>;
  }

  if (!payload) {
    return <div className="empty-state"><p className="muted-text">{feedback ?? "Unable to load this test invite."}</p></div>;
  }

  return (
    <div className="workspace-card-stack">
      <section className="workspace-card">
        <p className="eyebrow">Test invite</p>
        <h1>{payload.test.title}</h1>
        <p className="muted-text">Group: {payload.group.name}</p>
        {payload.group.description ? <p className="muted-text">{payload.group.description}</p> : null}
        <p className="muted-text">Starts: {formatShortDateTime(payload.test.startsAt)}</p>
        <p className="muted-text">Duration: {payload.test.durationMinutes} min</p>
        <p className="muted-text">Questions: {payload.test.questionCount}</p>
        <p className="muted-text">Status: {payload.test.status}</p>
      </section>

      <section className="workspace-card">
        <p className="eyebrow">Access</p>
        {feedback ? <p className="muted-text">{feedback}</p> : null}

        {!payload.actor.isRegistered ? (
          <div className="form-stack">
            <p className="muted-text">
              {payload.test.inviteJoinMode === "automatic"
                ? "Sign up with your phone number and full name, complete OTP verification, and sign in again. You will be added to the group automatically when you return to this invite."
                : "Sign up with your phone number and full name, complete OTP verification, then request access to this group. After the creator accepts your request, the test will appear in your dashboard."}
            </p>
            <div className="inline-actions">
              <a className="button" href={signUpPath}>Sign up</a>
              <a className="button-secondary" href={signInPath}>Already registered? Sign in</a>
            </div>
          </div>
        ) : payload.access.isGroupMember ? (
          <div className="form-stack">
            <p className="muted-text">You already belong to this group. Open your dashboard to respond to the test when it is available.</p>
            <div className="inline-actions">
              <a className="button" href="/user">Open dashboard</a>
            </div>
          </div>
        ) : payload.access.requestStatus === "pending" ? (
          <p className="muted-text">Your access request is pending approval from the test creator.</p>
        ) : (
          <div className="form-stack">
            <p className="muted-text">
              {payload.test.inviteJoinMode === "automatic"
                ? "We are adding you to the assigned group automatically. If this message stays here, refresh once."
                : "Request access to join the assigned group for this test. Once approved, the test will appear in your dashboard."}
            </p>
            <div className="inline-actions">
              <button className="button" disabled={!payload.access.canRequestAccess || isRequestingAccess || payload.test.inviteJoinMode === "automatic"} type="button" onClick={() => void handleRequestAccess()}>
                {isRequestingAccess
                  ? payload.test.inviteJoinMode === "automatic"
                    ? "Adding you to the group..."
                    : "Sending request..."
                  : payload.test.inviteJoinMode === "automatic"
                    ? "Joining automatically"
                    : payload.access.requestStatus === "rejected"
                      ? "Request access again"
                      : "Request access"}
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}