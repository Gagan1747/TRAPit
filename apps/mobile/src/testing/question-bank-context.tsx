import {
  createEntityId,
  createPersistentQuestion,
  sampleQuestions,
  type ObjectiveQuestion,
  type PersistentQuestion,
  type QuestionPool,
  type QuestionDraft,
} from "@trapit/testing";
import * as SecureStore from "expo-secure-store";
import { createContext, useContext, useEffect, useState } from "react";

const STORAGE_KEY = "trapit.mobile.question-bank";

type StoredQuestionBank = {
  pools: QuestionPool[];
  questions: PersistentQuestion[];
};

type QuestionBankContextValue = {
  createPool: (input: { description?: string; name: string }) => QuestionPool | null;
  isReady: boolean;
  pools: QuestionPool[];
  questions: PersistentQuestion[];
  addQuestion: (draft: QuestionDraft, poolIds: string[]) => void;
  clearQuestions: () => void;
  loadSamples: () => void;
  removeQuestion: (questionId: string) => void;
};

const QuestionBankContext = createContext<QuestionBankContextValue | null>(null);

function createLocalPool(input: { description?: string; name: string }): QuestionPool {
  const timestamp = new Date().toISOString();

  return {
    createdAt: timestamp,
    description: input.description?.trim() ?? "",
    id: createEntityId("pool"),
    name: input.name.trim(),
    questionIds: [],
    updatedAt: timestamp,
  };
}

function migrateLegacyQuestions(questions: ObjectiveQuestion[]): StoredQuestionBank {
  if (!questions.length) {
    return { pools: [], questions: [] };
  }

  const defaultPool = createLocalPool({
    description: "Imported from the existing mobile question bank.",
    name: "General pool",
  });
  const timestamp = new Date().toISOString();
  const nextQuestions: PersistentQuestion[] = questions.map((question) => ({
    ...question,
    createdAt: timestamp,
    createdBy: null,
    poolIds: [defaultPool.id],
    source: "manual",
    updatedAt: timestamp,
  }));

  return {
    pools: [
      {
        ...defaultPool,
        questionIds: nextQuestions.map((question) => question.id),
      },
    ],
    questions: nextQuestions,
  };
}

function parseStoredQuestionBank(value: string): StoredQuestionBank {
  const parsed = JSON.parse(value) as StoredQuestionBank | ObjectiveQuestion[];

  if (Array.isArray(parsed)) {
    return migrateLegacyQuestions(parsed);
  }

  return {
    pools: parsed.pools ?? [],
    questions: parsed.questions ?? [],
  };
}

export function QuestionBankProvider({ children }: { children: React.ReactNode }) {
  const [isReady, setIsReady] = useState(false);
  const [pools, setPools] = useState<QuestionPool[]>([]);
  const [questions, setQuestions] = useState<PersistentQuestion[]>([]);

  useEffect(() => {
    let isMounted = true;

    void SecureStore.getItemAsync(STORAGE_KEY)
      .then((value) => {
        if (!isMounted || !value) {
          return;
        }

        const stored = parseStoredQuestionBank(value);
        setPools(stored.pools);
        setQuestions(stored.questions);
      })
      .finally(() => {
        if (isMounted) {
          setIsReady(true);
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (!isReady) {
      return;
    }

    void SecureStore.setItemAsync(
      STORAGE_KEY,
      JSON.stringify({ pools, questions } satisfies StoredQuestionBank),
    );
  }, [isReady, pools, questions]);

  function createPool(input: { description?: string; name: string }) {
    if (!input.name.trim()) {
      return null;
    }

    const nextPool = createLocalPool(input);

    setPools((currentPools) => [nextPool, ...currentPools]);

    return nextPool;
  }

  function addQuestion(draft: QuestionDraft, poolIds: string[]) {
    const nextQuestion = createPersistentQuestion(draft, { poolIds });

    setQuestions((currentQuestions) => [nextQuestion, ...currentQuestions]);
    setPools((currentPools) =>
      currentPools.map((pool) =>
        poolIds.includes(pool.id)
          ? {
              ...pool,
              questionIds: [nextQuestion.id, ...pool.questionIds],
              updatedAt: new Date().toISOString(),
            }
          : pool,
      ),
    );
  }

  function removeQuestion(questionId: string) {
    setQuestions((currentQuestions) =>
      currentQuestions.filter((question) => question.id !== questionId),
    );
    setPools((currentPools) =>
      currentPools.map((pool) => ({
        ...pool,
        questionIds: pool.questionIds.filter((currentQuestionId) => currentQuestionId !== questionId),
        updatedAt: new Date().toISOString(),
      })),
    );
  }

  function clearQuestions() {
    setQuestions([]);
    setPools((currentPools) =>
      currentPools.map((pool) => ({
        ...pool,
        questionIds: [],
        updatedAt: new Date().toISOString(),
      })),
    );
  }

  function loadSamples() {
    const samplePool = createLocalPool({
      description: "Sample questions for quick mobile testing.",
      name: "Sample pool",
    });
    const sampleBank = sampleQuestions.map((question) => ({
      ...createPersistentQuestion(question, {
        poolIds: [samplePool.id],
        source: "sample",
      }),
      id: question.id,
    }));

    setPools([
      {
        ...samplePool,
        questionIds: sampleBank.map((question) => question.id),
      },
    ]);
    setQuestions(sampleBank);
  }

  return (
    <QuestionBankContext.Provider
      value={{
        addQuestion,
        clearQuestions,
        createPool,
        isReady,
        loadSamples,
        pools,
        questions,
        removeQuestion,
      }}
    >
      {children}
    </QuestionBankContext.Provider>
  );
}

export function useQuestionBank() {
  const context = useContext(QuestionBankContext);

  if (!context) {
    throw new Error("useQuestionBank must be used within a QuestionBankProvider.");
  }

  return context;
}