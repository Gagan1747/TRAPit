import { getDashboardPath } from "@trapit/auth";
import { redirect } from "next/navigation";

import { PublicApportionBookingWorkspace } from "../../../components/public-apportion-booking-workspace";
import { getWebSession } from "../../../lib/session";

export default async function PublicApportionBookingPage({ params }: { params: { shareCode: string } }) {
  const session = await getWebSession();
  const bookingPath = `/apportion/${params.shareCode}`;

  if (!session) {
    redirect(`/sign-up?redirect=${encodeURIComponent(bookingPath)}`);
  }

  if (session.role !== "user" && session.role !== "admin") {
    redirect(getDashboardPath(session.role));
  }

  return (
    <main className="page-shell">
      <section className="panel hero-copy">
        <PublicApportionBookingWorkspace shareCode={params.shareCode} />
      </section>
    </main>
  );
}