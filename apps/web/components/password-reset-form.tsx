"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import {
  getPublicWebAuthSetupMessage,
  isPublicWebAuthConfigured,
} from "../lib/public-auth-config";

export function PasswordResetForm() {
  const router = useRouter();
  const [confirmationCode, setConfirmationCode] = useState("");
  const [deliveryDestination, setDeliveryDestination] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isCodeSent, setIsCodeSent] = useState(false);
  const [isPending, setIsPending] = useState(false);
  const [password, setPassword] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const authConfigured = isPublicWebAuthConfigured();

  async function handleRequestCode() {
    setErrorMessage(null);

    if (!authConfigured) {
      setErrorMessage(getPublicWebAuthSetupMessage());
      return;
    }

    if (!phoneNumber) {
      setErrorMessage("Phone number is required.");
      return;
    }

    setIsPending(true);

    try {
      const response = await fetch("/api/auth/forgot-password", {
        body: JSON.stringify({ phoneNumber }),
        headers: {
          "Content-Type": "application/json",
        },
        method: "POST",
      });
      const payload = (await response.json()) as {
        deliveryDestination?: string | null;
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "Password reset request failed.");
      }

      setDeliveryDestination(payload.deliveryDestination ?? null);
      setIsCodeSent(true);
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Password reset request failed.",
      );
    } finally {
      setIsPending(false);
    }
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage(null);

    if (!authConfigured) {
      setErrorMessage(getPublicWebAuthSetupMessage());
      return;
    }

    if (!phoneNumber || !confirmationCode || !password) {
      setErrorMessage("Phone number, SMS code, and new password are required.");
      return;
    }

    setIsPending(true);

    try {
      const response = await fetch("/api/auth/confirm-forgot-password", {
        body: JSON.stringify({ code: confirmationCode, password, phoneNumber }),
        headers: {
          "Content-Type": "application/json",
        },
        method: "POST",
      });
      const payload = (await response.json()) as { error?: string };

      if (!response.ok) {
        throw new Error(payload.error ?? "Password reset failed.");
      }

      router.push("/sign-in?reset=1");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Password reset failed.");
    } finally {
      setIsPending(false);
    }
  }

  return (
    <form className="form-stack" onSubmit={handleSubmit}>
      <div>
        <h2>Reset password</h2>
        <p className="muted-text">
          Request an SMS code for this Cognito user, then set a new password.
        </p>
        {!authConfigured ? <p className="muted-text">{getPublicWebAuthSetupMessage()}</p> : null}
      </div>

      <div className="field">
        <label htmlFor="reset-phone-number">Phone number</label>
        <input
          id="reset-phone-number"
          type="tel"
          inputMode="tel"
          placeholder="+14155550123"
          disabled={!authConfigured}
          value={phoneNumber}
          onChange={(event) => setPhoneNumber(event.target.value)}
        />
      </div>

      {isCodeSent ? (
        <>
          <div className="field">
            <label htmlFor="reset-code">SMS code</label>
            <input
              id="reset-code"
              placeholder="Enter the code from SMS"
              disabled={!authConfigured}
              value={confirmationCode}
              onChange={(event) => setConfirmationCode(event.target.value)}
            />
          </div>

          <div className="field">
            <label htmlFor="reset-password">New password</label>
            <input
              id="reset-password"
              type="password"
              placeholder="At least 8 characters"
              disabled={!authConfigured}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </div>
        </>
      ) : null}

      {isCodeSent ? (
        <p className="muted-text">
          Reset code sent{deliveryDestination ? ` to ${deliveryDestination}` : ""}. Enter it below with your new password.
        </p>
      ) : null}

      {errorMessage ? <p className="muted-text">{errorMessage}</p> : null}

      {isCodeSent ? (
        <button className="button" disabled={isPending || !authConfigured} type="submit">
          {isPending ? "Working..." : "Update password"}
        </button>
      ) : (
        <button
          className="button"
          disabled={isPending || !authConfigured}
          type="button"
          onClick={handleRequestCode}
        >
          {isPending ? "Working..." : "Send reset code"}
        </button>
      )}

      <a className="button-secondary" href="/sign-in">
        Back to sign in
      </a>
    </form>
  );
}