import { PublicPollWorkspace } from "../../../components/public-poll-workspace";

export default function PublicPollPage({ params }: { params: { shareCode: string } }) {
  return <PublicPollWorkspace shareCode={params.shareCode} />;
}