"use client";

import { useState, type FormEvent } from "react";

export default function RazorpayPayoutOnboardingPage() {
  const [legalName, setLegalName] = useState("");
  const [panNumber, setPanNumber] = useState("");
  const [payoutMode, setPayoutMode] = useState<"bank" | "upi">("bank");
  const [accountNumber, setAccountNumber] = useState("");
  const [ifscCode, setIfscCode] = useState("");
  const [upiId, setUpiId] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) return;
    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      const response = await fetch("/api/user/payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "submit-onboarding-details",
          legalName,
          panNumber,
          payoutMode,
          accountNumber: payoutMode === "bank" ? accountNumber : undefined,
          ifscCode: payoutMode === "bank" ? ifscCode : undefined,
          upiId: payoutMode === "upi" ? upiId : undefined,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        callbackUrl?: string;
        error?: string;
        linkedAccountId?: string;
      };
      if (!response.ok || !payload.linkedAccountId) {
        throw new Error(payload.error || "Unable to verify payout details with Razorpay.");
      }

      window.location.assign(
        payload.callbackUrl
          || `/user?payoutOnboarding=callback&accountId=${encodeURIComponent(payload.linkedAccountId)}`,
      );
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Unable to complete onboarding.");
      setIsSubmitting(false);
    }
  }

  return (
    <main className="page-shell">
      <div className="workspace-card-stack" style={{ maxWidth: 560, margin: "40px auto", width: "100%" }}>
        <section className="panel workspace-card">
          <p className="eyebrow">Razorpay Route · Peer Payout Onboarding</p>
          <h1 className="section-title">Link Your Payout Bank Account</h1>
          <p className="muted-text">
            Enter your required payout details below. Razorpay executes an automated penny-drop test and compliance verification, and returns only a unique Linked Account ID (<code>acc_...</code>).
          </p>
          <p className="muted-text">
            <strong>Security Guarantee:</strong> Your PAN, Bank Account Number, IFSC Code, and UPI ID are transmitted only for verification and are <strong>never</strong> stored on TRAPit servers.
          </p>

          <form className="form-stack" onSubmit={(event) => void handleSubmit(event)}>
            <div className="field">
              <label htmlFor="onboarding-legal-name">Legal Business Name or Full Name</label>
              <input
                id="onboarding-legal-name"
                placeholder="Enter full name as per PAN / Bank Account"
                required
                type="text"
                value={legalName}
                onChange={(event) => setLegalName(event.target.value)}
              />
            </div>

            <div className="field">
              <label htmlFor="onboarding-pan">PAN Number</label>
              <input
                id="onboarding-pan"
                maxLength={10}
                placeholder="ABCDE1234F"
                required
                style={{ textTransform: "uppercase" }}
                type="text"
                value={panNumber}
                onChange={(event) => setPanNumber(event.target.value.toUpperCase())}
              />
            </div>

            <div className="field">
              <span className="field-label">Payout Method</span>
              <div className="business-choice-row" role="group" aria-label="Payout method">
                <button
                  aria-pressed={payoutMode === "bank"}
                  className="business-choice-button"
                  type="button"
                  onClick={() => setPayoutMode("bank")}
                >
                  Bank Account &amp; IFSC
                </button>
                <button
                  aria-pressed={payoutMode === "upi"}
                  className="business-choice-button"
                  type="button"
                  onClick={() => setPayoutMode("upi")}
                >
                  UPI ID
                </button>
              </div>
            </div>

            {payoutMode === "bank" ? (
              <>
                <div className="field">
                  <label htmlFor="onboarding-account-number">Bank Account Number</label>
                  <input
                    id="onboarding-account-number"
                    inputMode="numeric"
                    placeholder="Enter 9 to 18 digit account number"
                    required
                    type="text"
                    value={accountNumber}
                    onChange={(event) => setAccountNumber(event.target.value.replace(/[^\d]/g, ""))}
                  />
                </div>
                <div className="field">
                  <label htmlFor="onboarding-ifsc">IFSC Code</label>
                  <input
                    id="onboarding-ifsc"
                    maxLength={11}
                    placeholder="HDFC0001234"
                    required
                    style={{ textTransform: "uppercase" }}
                    type="text"
                    value={ifscCode}
                    onChange={(event) => setIfscCode(event.target.value.toUpperCase())}
                  />
                </div>
              </>
            ) : (
              <div className="field">
                <label htmlFor="onboarding-upi">UPI ID</label>
                <input
                  id="onboarding-upi"
                  placeholder="yourname@okaxis"
                  required
                  type="text"
                  value={upiId}
                  onChange={(event) => setUpiId(event.target.value)}
                />
              </div>
            )}

            {errorMessage ? (
              <p className="form-error" role="alert">
                {errorMessage}
              </p>
            ) : null}

            <div className="inline-actions">
              <button className="button" disabled={isSubmitting} type="submit">
                {isSubmitting ? "Verifying via Razorpay Penny-Drop..." : "Verify & Link Account"}
              </button>
              <a className="button-secondary" href="/user">
                Cancel
              </a>
            </div>
          </form>
        </section>
      </div>
    </main>
  );
}
