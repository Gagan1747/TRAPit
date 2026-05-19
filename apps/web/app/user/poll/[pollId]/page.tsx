import { UserPollWorkspace } from "../../../../components/public-poll-workspace";
import { requireWebSession } from "../../../../lib/session";

export default async function UserPollPage({
  params,
}: {
  params: { pollId: string };
}) {
  await requireWebSession(["user", "admin"]);

  return <UserPollWorkspace pollId={params.pollId} />;
}
