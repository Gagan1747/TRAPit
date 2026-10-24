export const NORMAL_USER_CATEGORIES = [
  "trapit-normal",
  "trapit-pro",
  "trapit-pro-max",
] as const;

export const orderedNormalUserCategories = [...NORMAL_USER_CATEGORIES];

export type NormalUserCategory = (typeof NORMAL_USER_CATEGORIES)[number];

export type NormalUserCategoryDefinition = {
  apportion: {
    maxServicesPerAddress: number;
  };
  group: {
    create: boolean;
    join: boolean;
    manage: boolean;
  };
  home: boolean;
  label: string;
  poll: {
    addQuestion: boolean;
    maxOpenPollsPerMonth: number;
    schedule: boolean;
    shareOpenToAll: boolean;
    shareWithGroups: boolean;
  };
  test: {
    addQuestion: boolean;
    maxQuestionsPerPool: number | null;
    maxQuestionPools: number;
    maxScheduledTestsPerMonth: number;
    maxSelfTestsPerMonth: number;
  };
};

export const defaultNormalUserCategory: NormalUserCategory = "trapit-normal";

export const normalUserCategoryDefinitions: Record<NormalUserCategory, NormalUserCategoryDefinition> = {
  "trapit-normal": {
    apportion: {
      maxServicesPerAddress: 0,
    },
    group: {
      create: true,
      join: true,
      manage: true,
    },
    home: true,
    label: "TRAPit normal users",
    poll: {
      addQuestion: true,
      maxOpenPollsPerMonth: 0,
      schedule: true,
      shareOpenToAll: false,
      shareWithGroups: true,
    },
    test: {
      addQuestion: true,
      maxQuestionsPerPool: null,
      maxQuestionPools: Number.MAX_SAFE_INTEGER,
      maxScheduledTestsPerMonth: 0,
      maxSelfTestsPerMonth: 0,
    },
  },
  "trapit-pro": {
    apportion: {
      maxServicesPerAddress: 4,
    },
    group: {
      create: true,
      join: true,
      manage: true,
    },
    home: true,
    label: "TRAPit Pro users",
    poll: {
      addQuestion: true,
      maxOpenPollsPerMonth: 0,
      schedule: true,
      shareOpenToAll: false,
      shareWithGroups: true,
    },
    test: {
      addQuestion: true,
      maxQuestionsPerPool: null,
      maxQuestionPools: Number.MAX_SAFE_INTEGER,
      maxScheduledTestsPerMonth: 10,
      maxSelfTestsPerMonth: 0,
    },
  },
  "trapit-pro-max": {
    apportion: {
      maxServicesPerAddress: 10,
    },
    group: {
      create: true,
      join: true,
      manage: true,
    },
    home: true,
    label: "TRAPit Pro Max users",
    poll: {
      addQuestion: true,
      maxOpenPollsPerMonth: 10,
      schedule: true,
      shareOpenToAll: true,
      shareWithGroups: true,
    },
    test: {
      addQuestion: true,
      maxQuestionsPerPool: null,
      maxQuestionPools: Number.MAX_SAFE_INTEGER,
      maxScheduledTestsPerMonth: 20,
      maxSelfTestsPerMonth: 0,
    },
  },
};

export const normalUserCategoryLabels: Record<NormalUserCategory, string> = Object.fromEntries(
  Object.entries(normalUserCategoryDefinitions).map(([category, definition]) => [category, definition.label]),
) as Record<NormalUserCategory, string>;

export function resolveNormalUserCategory(value: unknown, fallback: NormalUserCategory = defaultNormalUserCategory): NormalUserCategory {
  if (value === "trapit-pro-limited") {
    return "trapit-pro";
  }

  return typeof value === "string" && NORMAL_USER_CATEGORIES.includes(value as NormalUserCategory)
    ? (value as NormalUserCategory)
    : fallback;
}

export function getNormalUserCategoryDefinition(category: NormalUserCategory) {
  return normalUserCategoryDefinitions[category];
}

export function getNextNormalUserCategory(category: NormalUserCategory) {
  const categoryIndex = orderedNormalUserCategories.indexOf(category);

  if (categoryIndex === -1 || categoryIndex === orderedNormalUserCategories.length - 1) {
    return null;
  }

  return orderedNormalUserCategories[categoryIndex + 1];
}

export function findNextNormalUserCategory(
  category: NormalUserCategory,
  predicate: (candidate: NormalUserCategory) => boolean,
) {
  const categoryIndex = orderedNormalUserCategories.indexOf(category);

  for (let nextIndex = categoryIndex + 1; nextIndex < orderedNormalUserCategories.length; nextIndex += 1) {
    const nextCategory = orderedNormalUserCategories[nextIndex];

    if (predicate(nextCategory)) {
      return nextCategory;
    }
  }

  return null;
}