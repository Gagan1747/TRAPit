"use client";

import { useEffect, useState } from "react";

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
    inviteJoinMode: "approval-required" | "automatic";
    name: string;
    ownerIdentifier: string | null;
    shareCode: string | null;
  };
};

async function readJson<T>(response: Response): Promise<T> {
  const payload = (await response.json()) as T & { error?: string };

  if (!response.ok) {
    throw new Error((payload as { error?: string }).error ?? "Request failed.");
  }

  return payload;
}

export function PublicGroupInviteWorkspace({ shareCode }: { shareCode: string }) {
  const [feedback, setFeedback] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isJoining, setIsJoining] = useState(false);
  const [payload, setPayload] = useState<InvitePayload | null>(null);
  const invitePath = `/group/${encodeURIComponent(shareCode)}`;
  const signInPath = `/sign-in?redirect=${encodeURIComponent(invitePath)}`;
  const signUpPath = `/sign-up?redirect=${encodeURIComponent(invitePath)}`;

  useEffect(() => {
    let isMounted = true;

    async function loadInvite() {
      setIsLoading(true);

      try {
        const nextPayload = await readJson<InvitePayload>(
          await fetch(`/api/public/groups/${encodeURIComponent(shareCode)}`),
        );

        if (!isMounted) {
          return;
        }

        setPayload(nextPayload);
        setFeedback(null);
      } catch (error) {
        if (isMounted) {
          setFeedback(error instanceof Error ? error.message : "Unable to load this group invite.");
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
      || payload.group.inviteJoinMode !== "automatic"
      || isJoining
    ) {
      return;
    }

    void handleJoin(true);
  }, [isJoining, payload]);

  async function handleJoin(automatic = false) {
    setIsJoining(true);

    try {
      const nextPayload = await readJson<InvitePayload>(
        await fetch(`/api/public/groups/${encodeURIComponent(shareCode)}`, {
          method: "POST",
        }),
      );

      setPayload(nextPayload);
      setFeedback(
        automatic || nextPayload.access.isGroupMember
          ? "You have been added to the group. Open your dashboard to use it."
          : "Join request sent. The group creator can approve you from the group requests list.",
      );
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Unable to join this group.");
    } finally {
      setIsJoining(false);
    }
  }

  if (isLoading) {
    return <div className="empty-state"><p className="muted-text">Loading group invite...</p></div>;
  }

  if (!payload) {
    return <div className="empty-state"><p className="muted-text">{feedback ?? "Unable to load this group invite."}</p></div>;
  }

  return (
    <div className="workspace-card-stack">
      <section className="workspace-card">
        <p className="eyebrow">Group invite</p>
        <h1>{payload.group.name}</h1>
        {payload.group.description ? <p className="muted-text">{payload.group.description}</p> : null}
        <p className="muted-text">
          Join mode: {payload.group.inviteJoinMode === "automatic" ? "Open for all" : "Approval required"}
        </p>
      </section>

      <section className="workspace-card">
        <p className="eyebrow">Access</p>
        {feedback ? <p className="muted-text">{feedback}</p> : null}

        {!payload.actor.isRegistered ? (
          <div className="form-stack">
            <p className="muted-text">
              {payload.group.inviteJoinMode === "automatic"
                ? "Sign up with your phone number and full name, complete OTP verification, and sign in again. You will be added to this group automatically when you return to this invite."
                : "Sign up with your phone number and full name, complete OTP verification, then request access to this group. After the creator accepts your request, the group will appear in your dashboard."}
            </p>
            <div className="inline-actions">
              <a className="button" href={signUpPath}>Sign up</a>
              <a className="button-secondary" href={signInPath}>Already registered? Sign in</a>
            </div>
          </div>
        ) : payload.access.isGroupMember ? (
          <div className="form-stack">
            <p className="muted-text">You already belong to this group. Open your dashboard to use it.</p>
            <div className="inline-actions">
              <a className="button" href="/user">Open dashboard</a>
            </div>
          </div>
        ) : payload.access.requestStatus === "pending" ? (
          <p className="muted-text">Your join request is pending approval from the group creator.</p>
        ) : (
          <div className="form-stack">
            <p className="muted-text">
              {payload.group.inviteJoinMode === "automatic"
                ? "We are adding you to this group automatically. If this message stays here, refresh once."
                : "Request access to join this group. Once approved, it will appear in your dashboard."}
            </p>
            <div className="inline-actions">
              <button className="button" disabled={!payload.access.canRequestAccess || isJoining || payload.group.inviteJoinMode === "automatic"} type="button" onClick={() => void handleJoin()}>
                {isJoining
                  ? payload.group.inviteJoinMode === "automatic"
                    ? "Joining..."
                    : "Sending request..."
                  : payload.group.inviteJoinMode === "automatic"
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