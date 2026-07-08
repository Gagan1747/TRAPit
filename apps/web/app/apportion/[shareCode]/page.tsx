import { PublicApportionBookingWorkspace } from "../../../components/public-apportion-booking-workspace";
import { requireWebSession } from "../../../lib/session";

export default async function PublicApportionBookingPage({ params }: { params: { shareCode: string } }) {
  await requireWebSession(["user", "admin"]);

  return (
    <main className="page-shell">
      <section className="panel hero-copy">
        <PublicApportionBookingWorkspace shareCode={params.shareCode} />
      </section>
    </main>
  );
}