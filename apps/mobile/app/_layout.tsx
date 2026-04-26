import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";

import { AuthProvider } from "../src/auth/auth-context";
import { QuestionBankProvider } from "../src/testing/question-bank-context";

export default function RootLayout() {
  return (
    <AuthProvider>
      <QuestionBankProvider>
        <StatusBar style="dark" />
        <Stack
          screenOptions={{
            headerShown: false,
          }}
        />
      </QuestionBankProvider>
    </AuthProvider>
  );
}