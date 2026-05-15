import { PublicGroupInviteWorkspace } from "../../../components/public-group-invite-workspace";

export default function PublicGroupInvitePage({ params }: { params: { shareCode: string } }) {
  return <PublicGroupInviteWorkspace shareCode={params.shareCode} />;
}