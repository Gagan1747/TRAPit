import { getSessionIdentifier } from "@trapit/auth";

import { UserTestRunner } from "../../../../components/user-test-runner";
import { isWebAuthConfigured } from "../../../../lib/auth-config";
import { requireWebSession } from "../../../../lib/session";

export default async function UserTestRunnerPage({
  params,
  searchParams,
}: {
  params: { testId: string };
  searchParams?: { participantName?: string };
}) {
  const session = await requireWebSession(["user", "admin"]);
  const authConfigured = isWebAuthConfigured();
  const sessionIdentifier = getSessionIdentifier(session);

  return (
    <main className="page-shell test-runner-page-shell">
      <section className="panel hero-copy test-runner-page-panel">
        <UserTestRunner
          authConfigured={authConfigured}
          defaultParticipantIdentifier={sessionIdentifier}
          initialParticipantName={searchParams?.participantName ?? ""}
          testId={params.testId}
        />
      </section>
    </main>
  );
}