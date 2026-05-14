import { PublicTestInviteWorkspace } from "../../../components/public-test-invite-workspace";

export default function PublicTestInvitePage({ params }: { params: { shareCode: string } }) {
  return <PublicTestInviteWorkspace shareCode={params.shareCode} />;
}