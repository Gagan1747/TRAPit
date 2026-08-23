import { getSessionIdentifier } from "@trapit/auth";

import { UserGameRunner } from "../../../../components/user-game-runner";
import { isWebAuthConfigured } from "../../../../lib/auth-config";
import { requireWebSession } from "../../../../lib/session";

export default async function UserGamePage({ params }: { params: { gameId: string } }) {
  const session = await requireWebSession(["user", "admin"]);

  return (
    <main className="page-shell test-runner-page-shell">
      <UserGameRunner
        authConfigured={isWebAuthConfigured()}
        defaultParticipantIdentifier={getSessionIdentifier(session)}
        gameId={params.gameId}
      />
    </main>
  );
}
