"use client";

import { combinePhoneNumber, sanitizeCountryCodeInput, sanitizeNationalPhoneInput } from "@trapit/auth";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

import {
  getPublicWebAuthSetupMessage,
  isPublicWebAuthConfigured,
} from "../lib/public-auth-config";

type AuthFormProps = {
  mode: "sign-in" | "sign-up";
};

async function readAuthResponse<T>(response: Response, fallbackMessage: string): Promise<T> {
  const contentType = response.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    return (await response.json()) as T;
  }

  const payload = await response.text();
  const htmlTitleMatch = payload.match(/<h1[^>]*>(.*?)<\/h1>/i);
  const htmlText = htmlTitleMatch?.[1]?.trim();
  const textPayload = payload.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

  throw new Error(htmlText || textPayload || fallbackMessage);
}

export function AuthForm({ mode }: AuthFormProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [confirmationCode, setConfirmationCode] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [fullName, setFullName] = useState("");
  const [isPending, setIsPending] = useState(false);
  const [password, setPassword] = useState("");
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);
  const [countryCode, setCountryCode] = useState("+91");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [signUpState, setSignUpState] = useState<{
    destination: string | null;
    requiresConfirmation: boolean;
    warning?: string;
  } | null>(null);
  const authConfigured = isPublicWebAuthConfigured();
  const infoMessage =
    mode !== "sign-in"
      ? null
      : searchParams.get("error") === "session"
        ? "Your session is missing or expired. Sign in to open the requested page."
        : searchParams.get("reset")
        ? "Password updated. Sign in with the new password."
        : searchParams.get("confirmed")
          ? "Account confirmed. You can sign in now."
          : searchParams.get("created")
            ? "Account created. Sign in after confirmation completes."
            : null;

  const combinedPhoneNumber = combinePhoneNumber(countryCode, phoneNumber);

    function handlePhoneNumberChange(nextPhoneNumber: string) {
    const sanitizedPhoneNumber = sanitizeNationalPhoneInput(nextPhoneNumber);

    if (sanitizedPhoneNumber === phoneNumber) {
        return;
      }

    setPhoneNumber(sanitizedPhoneNumber);
      setPassword("");
      setIsPasswordVisible(false);
      setConfirmationCode("");
      setSignUpState(null);
      setErrorMessage(null);
    }

  function handleCountryCodeChange(nextCountryCode: string) {
    const sanitizedCountryCode = sanitizeCountryCodeInput(nextCountryCode);

    if (sanitizedCountryCode === countryCode) {
      return;
    }

    setCountryCode(sanitizedCountryCode);
    setPassword("");
    setIsPasswordVisible(false);
    setConfirmationCode("");
    setSignUpState(null);
    setErrorMessage(null);
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage(null);

    if (!authConfigured) {
      setErrorMessage(getPublicWebAuthSetupMessage());
      return;
    }

    if (mode === "sign-up" && !fullName.trim()) {
      setErrorMessage("Full name, phone number, and password are required.");
      return;
    }

    if (!phoneNumber || !password) {
      setErrorMessage(
        mode === "sign-up"
          ? "Full name, phone number, and password are required."
          : "Phone number and password are required.",
      );
      return;
    }

    setIsPending(true);

    try {
      if (mode === "sign-up") {
        const response = await fetch("/api/auth/sign-up", {
          body: JSON.stringify({ fullName, phoneNumber: combinedPhoneNumber, password }),
          headers: {
            "Content-Type": "application/json",
          },
          method: "POST",
        });
        const payload = await readAuthResponse<{
          deliveryDestination?: string | null;
          error?: string;
          requiresConfirmation?: boolean;
          warning?: string;
        }>(response, "Sign-up failed.");

        if (!response.ok) {
          throw new Error(payload.error ?? "Sign-up failed.");
        }

        setSignUpState({
          destination: payload.deliveryDestination ?? null,
          requiresConfirmation: payload.requiresConfirmation ?? true,
          warning: payload.warning,
        });

        if (!(payload.requiresConfirmation ?? true)) {
          router.push("/sign-in?created=1");
        }

        return;
      }

      const response = await fetch("/api/auth/sign-in", {
        body: JSON.stringify({ phoneNumber: combinedPhoneNumber, password }),
        headers: {
          "Content-Type": "application/json",
        },
        method: "POST",
      });
      const payload = await readAuthResponse<{
        error?: string;
        redirectTo?: string;
      }>(response, "Sign-in failed.");

      if (!response.ok || !payload.redirectTo) {
        throw new Error(payload.error ?? "Sign-in failed.");
      }

      router.push(payload.redirectTo);
      router.refresh();
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Authentication failed.",
      );
    } finally {
      setIsPending(false);
    }
  }

  async function handleConfirmSignUp() {
    setErrorMessage(null);

    if (!authConfigured) {
      setErrorMessage(getPublicWebAuthSetupMessage());
      return;
    }

    if (!phoneNumber || !confirmationCode) {
      setErrorMessage("Phone number and confirmation code are required.");
      return;
    }

    setIsPending(true);

    try {
      const response = await fetch("/api/auth/confirm-sign-up", {
        body: JSON.stringify({ code: confirmationCode, phoneNumber: combinedPhoneNumber }),
        headers: {
          "Content-Type": "application/json",
        },
        method: "POST",
      });
      const payload = await readAuthResponse<{ error?: string }>(
        response,
        "Confirmation failed.",
      );

      if (!response.ok) {
        throw new Error(payload.error ?? "Confirmation failed.");
      }

      router.push("/sign-in?confirmed=1");
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Confirmation failed.",
      );
    } finally {
      setIsPending(false);
    }
  }

  return (
    <form className="form-stack" onSubmit={handleSubmit}>
      <div>
        <h2>{mode === "sign-up" ? "Create account" : "Welcome back"}</h2>
        {mode === "sign-up" ? (
          <p className="muted-text">
            Public sign-up is enabled for normal users. Admins should be provisioned separately.
          </p>
        ) : null}
        {!authConfigured ? <p className="muted-text">{getPublicWebAuthSetupMessage()}</p> : null}
      </div>

      {mode === "sign-up" ? (
        <div className="field">
          <label htmlFor="full-name">Full name</label>
          <input
            id="full-name"
            type="text"
            placeholder="Enter your full name"
            disabled={!authConfigured}
            value={fullName}
            onChange={(event) => setFullName(event.target.value)}
          />
        </div>
      ) : null}

      <div className="field">
        <label htmlFor="phone-number">Phone number</label>
        <div className="field-row phone-input-row">
          <input
            id="phone-country-code"
            type="tel"
            inputMode="tel"
            placeholder="+91"
            disabled={!authConfigured}
            value={countryCode}
            onChange={(event) => handleCountryCodeChange(event.target.value)}
          />
          <input
            id="phone-number"
            type="tel"
            inputMode="tel"
            placeholder="9876543210"
            disabled={!authConfigured}
            value={phoneNumber}
            onChange={(event) => handlePhoneNumberChange(event.target.value)}
          />
        </div>
      </div>

      <div className="field">
        <label htmlFor="password">Password</label>
        <div className="field-row auth-password-row">
          <input
            id="password"
            type={isPasswordVisible ? "text" : "password"}
            placeholder="At least 8 characters"
            disabled={!authConfigured}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          <button
            className="button-secondary small-button"
            disabled={!authConfigured}
            type="button"
            onClick={() => setIsPasswordVisible((currentValue) => !currentValue)}
          >
            {isPasswordVisible ? "Hide" : "Show"}
          </button>
        </div>
      </div>

      {mode === "sign-up" && signUpState?.requiresConfirmation ? (
        <div className="field">
          <label htmlFor="confirmation-code">Confirmation code</label>
          <input
            id="confirmation-code"
            placeholder="Enter the code from SMS"
            disabled={!authConfigured}
            value={confirmationCode}
            onChange={(event) => setConfirmationCode(event.target.value)}
          />
        </div>
      ) : null}

      {signUpState?.requiresConfirmation ? (
        <p className="muted-text">
          SMS code sent{signUpState.destination ? ` to ${signUpState.destination}` : ""}. Confirm the account before signing in.
        </p>
      ) : null}

      {signUpState?.warning ? (
        <p className="muted-text">{signUpState.warning}</p>
      ) : null}

      {infoMessage ? <p className="muted-text">{infoMessage}</p> : null}

      {errorMessage ? <p className="muted-text">{errorMessage}</p> : null}

      <button className="button" disabled={isPending || !authConfigured} type="submit">
        {isPending
          ? "Working..."
          : !authConfigured
            ? "Auth setup pending"
          : mode === "sign-up"
            ? "Create user account"
            : "Sign in"}
      </button>

      {mode === "sign-in" ? (
        <a className="button-secondary" href="/reset-password">
          Reset password
        </a>
      ) : null}

      {mode === "sign-up" && signUpState?.requiresConfirmation ? (
        <button
          className="button-secondary"
          disabled={isPending || !authConfigured}
          type="button"
          onClick={handleConfirmSignUp}
        >
          Confirm account
        </button>
      ) : null}

      {mode === "sign-in" ? null : (
        <a className="button-secondary" href="/sign-in">
          Already confirmed? Sign in
        </a>
      )}
    </form>
  );
}