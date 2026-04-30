import { createContext, useContext, useEffect, useState } from "react";

import { getMobileAuthSetupMessage, isMobileAuthConfigured } from "./auth-config";
import { mobileConfirmSignUp, mobileSignIn, mobileSignUp } from "./cognito";
import {
  clearStoredSession,
  persistSession,
  readStoredSession,
  type MobileAuthSession,
} from "./session";

type SignUpResult = {
  deliveryDestination?: string | null;
  requiresConfirmation?: boolean;
  warning?: string;
};

type AuthContextValue = {
  isLoading: boolean;
  session: MobileAuthSession | null;
  confirmSignUp: (phoneNumber: string, code: string) => Promise<void>;
  signIn: (phoneNumber: string, password: string) => Promise<MobileAuthSession>;
  signOut: () => Promise<void>;
  signUp: (fullName: string, phoneNumber: string, password: string) => Promise<SignUpResult>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [isLoading, setIsLoading] = useState(true);
  const [session, setSession] = useState<MobileAuthSession | null>(null);
  const authConfigured = isMobileAuthConfigured();

  useEffect(() => {
    if (!authConfigured) {
      setIsLoading(false);
      return;
    }

    let isMounted = true;

    void readStoredSession()
      .then((storedSession) => {
        if (isMounted) {
          setSession(storedSession);
        }
      })
      .finally(() => {
        if (isMounted) {
          setIsLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [authConfigured]);

  async function signIn(phoneNumber: string, password: string) {
    if (!authConfigured) {
      throw new Error(getMobileAuthSetupMessage());
    }

    const tokens = await mobileSignIn(phoneNumber, password);
    const nextSession = await persistSession(tokens);

    if (!nextSession) {
      throw new Error("Could not persist the mobile session.");
    }

    setSession(nextSession);
    return nextSession;
  }

  async function signUp(fullName: string, phoneNumber: string, password: string) {
    if (!authConfigured) {
      throw new Error(getMobileAuthSetupMessage());
    }

    return mobileSignUp(fullName, phoneNumber, password);
  }

  async function confirmSignUp(phoneNumber: string, code: string) {
    if (!authConfigured) {
      throw new Error(getMobileAuthSetupMessage());
    }

    await mobileConfirmSignUp(phoneNumber, code);
  }

  async function signOut() {
    await clearStoredSession();
    setSession(null);
  }

  return (
    <AuthContext.Provider
      value={{
        confirmSignUp,
        isLoading,
        session,
        signIn,
        signOut,
        signUp,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider.");
  }

  return context;
}