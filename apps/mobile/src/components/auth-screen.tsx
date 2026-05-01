import {
  combinePhoneNumber,
  getMobileDashboardPath,
  sanitizeCountryCodeInput,
  sanitizeNationalPhoneInput,
} from "@trapit/auth";
import { Redirect, type Href, useRouter } from "expo-router";
import { useState } from "react";
import {
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { useAuth } from "../auth/auth-context";
import { getMobileAuthSetupMessage, isMobileAuthConfigured } from "../auth/auth-config";

type AuthScreenProps = {
  mode: "sign-in" | "sign-up";
};

export function AuthScreen({ mode }: AuthScreenProps) {
  const router = useRouter();
  const { confirmSignUp, isLoading, session, signIn, signUp } = useAuth();
  const authConfigured = isMobileAuthConfigured();
  const [confirmationCode, setConfirmationCode] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [fullName, setFullName] = useState("");
  const [isPending, setIsPending] = useState(false);
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);
  const [password, setPassword] = useState("");
  const [countryCode, setCountryCode] = useState("+91");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [signUpState, setSignUpState] = useState<{
    destination?: string | null;
    requiresConfirmation?: boolean;
    warning?: string;
  } | null>(null);
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

  if (!isLoading && session) {
    return <Redirect href={getMobileDashboardPath(session.role) as Href} />;
  }

  async function handleSubmit() {
    setErrorMessage(null);

    if (!authConfigured) {
      setErrorMessage(getMobileAuthSetupMessage());
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
        const result = await signUp(fullName, combinedPhoneNumber, password);
        setSignUpState({
          destination: result.deliveryDestination,
          requiresConfirmation: result.requiresConfirmation,
          warning: result.warning,
        });

        if (!result.requiresConfirmation) {
          router.push("/sign-in");
        }

        return;
      }

      const nextSession = await signIn(combinedPhoneNumber, password);
      router.replace(getMobileDashboardPath(nextSession.role) as Href);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Authentication failed.");
    } finally {
      setIsPending(false);
    }
  }

  async function handleConfirmSignUp() {
    setErrorMessage(null);

    if (!authConfigured) {
      setErrorMessage(getMobileAuthSetupMessage());
      return;
    }

    if (!phoneNumber || !confirmationCode) {
      setErrorMessage("Phone number and confirmation code are required.");
      return;
    }

    setIsPending(true);

    try {
      await confirmSignUp(combinedPhoneNumber, confirmationCode);
      router.push("/sign-in");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Confirmation failed.");
    } finally {
      setIsPending(false);
    }
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.screen}>
        <View style={styles.hero}>
          <Text style={styles.eyebrow}>TRAPit mobile</Text>
          <Text style={styles.title}>
            {mode === "sign-up" ? "Create your user account" : "Sign in to continue"}
          </Text>
          <Text style={styles.copy}>
            {mode === "sign-up"
              ? "Normal users can sign up here. Admins should be provisioned separately."
              : "Use your phone number and password. TRAPit will route you based on your Cognito access."}
          </Text>
          {!authConfigured ? <Text style={styles.metaText}>{getMobileAuthSetupMessage()}</Text> : null}
        </View>

        <View style={styles.card}>
          {mode === "sign-up" ? (
            <View style={styles.field}>
              <Text style={styles.label}>Full name</Text>
              <TextInput
                placeholder="Enter your full name"
                placeholderTextColor="#8e7d70"
                style={styles.input}
                editable={authConfigured}
                value={fullName}
                onChangeText={setFullName}
              />
            </View>
          ) : null}

          <View style={styles.field}>
            <Text style={styles.label}>Phone number</Text>
            <View style={styles.phoneRow}>
              <TextInput
                autoCapitalize="none"
                keyboardType="phone-pad"
                placeholder="+91"
                placeholderTextColor="#8e7d70"
                style={[styles.input, styles.countryCodeInput]}
                editable={authConfigured}
                value={countryCode}
                onChangeText={handleCountryCodeChange}
              />
              <TextInput
                autoCapitalize="none"
                keyboardType="phone-pad"
                placeholder="9876543210"
                placeholderTextColor="#8e7d70"
                style={[styles.input, styles.phoneInput]}
                editable={authConfigured}
                value={phoneNumber}
                onChangeText={handlePhoneNumberChange}
              />
            </View>
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Password</Text>
            <View style={styles.passwordRow}>
              <TextInput
                placeholder="At least 8 characters"
                placeholderTextColor="#8e7d70"
                secureTextEntry={!isPasswordVisible}
                style={[styles.input, styles.passwordInput]}
                editable={authConfigured}
                value={password}
                onChangeText={setPassword}
              />
              <Pressable
                style={styles.passwordToggle}
                disabled={!authConfigured}
                onPress={() => setIsPasswordVisible((currentValue) => !currentValue)}
              >
                <Text style={styles.passwordToggleText}>
                  {isPasswordVisible ? "Hide" : "Show"}
                </Text>
              </Pressable>
            </View>
          </View>

          {mode === "sign-up" && signUpState?.requiresConfirmation ? (
            <View style={styles.field}>
              <Text style={styles.label}>Confirmation code</Text>
              <TextInput
                placeholder="Enter the code from SMS"
                placeholderTextColor="#8e7d70"
                style={styles.input}
                editable={authConfigured}
                value={confirmationCode}
                onChangeText={setConfirmationCode}
              />
            </View>
          ) : null}

          {signUpState?.requiresConfirmation ? (
            <Text style={styles.metaText}>
              SMS code sent{signUpState.destination ? ` to ${signUpState.destination}` : ""}. Confirm the account before signing in.
            </Text>
          ) : null}

          {signUpState?.warning ? <Text style={styles.metaText}>{signUpState.warning}</Text> : null}

          {errorMessage ? <Text style={styles.metaText}>{errorMessage}</Text> : null}

          <Pressable style={styles.primaryButton} disabled={!authConfigured || isPending} onPress={handleSubmit}>
            <Text style={styles.primaryButtonText}>
              {isPending
                ? "Working..."
                : !authConfigured
                  ? "Auth setup pending"
                  : mode === "sign-up"
                    ? "Create user account"
                    : "Sign in"}
            </Text>
          </Pressable>

          {mode === "sign-up" && signUpState?.requiresConfirmation ? (
            <Pressable style={styles.secondaryButton} disabled={!authConfigured || isPending} onPress={handleConfirmSignUp}>
              <Text style={styles.secondaryButtonText}>Confirm account</Text>
            </Pressable>
          ) : null}

          <Pressable
            style={styles.secondaryButton}
            onPress={() => router.push(mode === "sign-up" ? "/sign-in" : "/sign-up")}
          >
            <Text style={styles.secondaryButtonText}>
              {mode === "sign-up" ? "Already have an account? Sign in" : "Need an account? Sign up"}
            </Text>
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#efe3d2",
  },
  screen: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 20,
    paddingVertical: 24,
    backgroundColor: "#efe3d2",
  },
  hero: {
    marginBottom: 18,
    gap: 8,
  },
  eyebrow: {
    textTransform: "uppercase",
    letterSpacing: 2,
    color: "#8e3f2c",
    fontSize: 12,
    fontWeight: "700",
  },
  title: {
    fontSize: 34,
    lineHeight: 38,
    color: "#231712",
    fontWeight: "700",
  },
  copy: {
    color: "#6d5a4e",
    fontSize: 15,
    lineHeight: 22,
  },
  card: {
    backgroundColor: "rgba(255, 248, 240, 0.92)",
    borderRadius: 24,
    padding: 18,
    gap: 16,
  },
  field: {
    gap: 8,
  },
  label: {
    fontSize: 14,
    fontWeight: "700",
    color: "#231712",
  },
  input: {
    minHeight: 48,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#d7c3af",
    backgroundColor: "#fffaf5",
    paddingHorizontal: 14,
    fontSize: 15,
  },
  passwordRow: {
    flexDirection: "row",
    gap: 10,
  },
  phoneRow: {
    flexDirection: "row",
    gap: 10,
  },
  countryCodeInput: {
    width: 88,
  },
  phoneInput: {
    flex: 1,
  },
  passwordInput: {
    flex: 1,
  },
  passwordToggle: {
    minWidth: 76,
    minHeight: 48,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#d7c3af",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255, 255, 255, 0.72)",
    paddingHorizontal: 14,
  },
  passwordToggleText: {
    color: "#6d5a4e",
    fontWeight: "600",
  },
  roleRow: {
    flexDirection: "row",
    gap: 10,
  },
  roleChip: {
    flex: 1,
    minHeight: 44,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#d7c3af",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#fffaf5",
  },
  roleChipActive: {
    borderColor: "#b44c2f",
    backgroundColor: "#b44c2f",
  },
  roleChipText: {
    color: "#3b2d26",
    fontWeight: "600",
  },
  roleChipTextActive: {
    color: "#ffffff",
  },
  primaryButton: {
    minHeight: 50,
    borderRadius: 999,
    backgroundColor: "#b44c2f",
    alignItems: "center",
    justifyContent: "center",
  },
  primaryButtonText: {
    color: "#ffffff",
    fontWeight: "700",
    fontSize: 15,
  },
  secondaryButton: {
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryButtonText: {
    color: "#6d5a4e",
    fontWeight: "600",
  },
  metaText: {
    color: "#6d5a4e",
    fontSize: 14,
    lineHeight: 20,
  },
});