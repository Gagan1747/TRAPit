import { TestResultsWorkspace } from "../../../components/test-results-workspace";
import { requireWebSession } from "../../../lib/session";

export default async function TestResultsPage({ params }: { params: { testId: string } }) {
  await requireWebSession(["user", "admin"]);

  return (
    <main className="page-shell test-results-page-shell">
      <TestResultsWorkspace testId={params.testId} />
    </main>
  );
}