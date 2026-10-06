import { getDashboardPath } from "@trapit/auth";
import { redirect } from "next/navigation";

import { PublicApportionBookingWorkspace } from "../../../components/public-apportion-booking-workspace";
import { buildApportionBookingPath } from "../../../lib/apportion-booking-path";
import { getWebSession } from "../../../lib/session";

export default async function PublicApportionBookingPage({
  params,
  searchParams,
}: {
  params: { shareCode: string };
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const session = await getWebSession();
  const bookingPath = buildApportionBookingPath(params.shareCode, searchParams);

  if (!session) {
    redirect(`/?redirect=${encodeURIComponent(bookingPath)}`);
  }

  if (session.role !== "user" && session.role !== "admin") {
    redirect(getDashboardPath(session.role));
  }

  return (
    <main className="page-shell">
      <section className="panel hero-copy">
        <PublicApportionBookingWorkspace
          initialLocationId={typeof searchParams?.locationId === "string" ? searchParams.locationId : typeof searchParams?.addressId === "string" ? searchParams.addressId : undefined}
          initialOwnerIdentifier={typeof searchParams?.ownerIdentifier === "string" ? searchParams.ownerIdentifier : undefined}
          initialServiceId={typeof searchParams?.serviceId === "string" ? searchParams.serviceId : undefined}
          shareCode={params.shareCode}
        />
      </section>
    </main>
  );
}