export const NORMAL_USER_CATEGORIES = [
  "trapit-normal",
  "trapit-self",
  "trapit-pro-limited",
  "trapit-pro",
  "trapit-pro-max",
] as const;

export const orderedNormalUserCategories = [...NORMAL_USER_CATEGORIES];

export type NormalUserCategory = (typeof NORMAL_USER_CATEGORIES)[number];

export type NormalUserCategoryDefinition = {
  group: {
    create: boolean;
    join: boolean;
    manage: boolean;
  };
  home: boolean;
  label: string;
  poll: {
    addQuestion: boolean;
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
    group: {
      create: false,
      join: true,
      manage: false,
    },
    home: true,
    label: "TRAPit normal users",
    poll: {
      addQuestion: false,
      schedule: false,
      shareOpenToAll: false,
      shareWithGroups: false,
    },
    test: {
      addQuestion: false,
      maxQuestionsPerPool: null,
      maxQuestionPools: 0,
      maxScheduledTestsPerMonth: 0,
      maxSelfTestsPerMonth: 0,
    },
  },
  "trapit-self": {
    group: {
      create: false,
      join: true,
      manage: false,
    },
    home: true,
    label: "TRAPit Self users",
    poll: {
      addQuestion: false,
      schedule: false,
      shareOpenToAll: false,
      shareWithGroups: false,
    },
    test: {
      addQuestion: true,
      maxQuestionsPerPool: 200,
      maxQuestionPools: 5,
      maxScheduledTestsPerMonth: 0,
      maxSelfTestsPerMonth: 5,
    },
  },
  "trapit-pro-limited": {
    group: {
      create: true,
      join: true,
      manage: true,
    },
    home: true,
    label: "TRAPit Pro limited users",
    poll: {
      addQuestion: true,
      schedule: true,
      shareOpenToAll: false,
      shareWithGroups: true,
    },
    test: {
      addQuestion: true,
      maxQuestionsPerPool: 400,
      maxQuestionPools: 10,
      maxScheduledTestsPerMonth: 10,
      maxSelfTestsPerMonth: 10,
    },
  },
  "trapit-pro": {
    group: {
      create: true,
      join: true,
      manage: true,
    },
    home: true,
    label: "TRAPit Pro users",
    poll: {
      addQuestion: true,
      schedule: true,
      shareOpenToAll: false,
      shareWithGroups: true,
    },
    test: {
      addQuestion: true,
      maxQuestionsPerPool: 400,
      maxQuestionPools: 50,
      maxScheduledTestsPerMonth: 50,
      maxSelfTestsPerMonth: 50,
    },
  },
  "trapit-pro-max": {
    group: {
      create: true,
      join: true,
      manage: true,
    },
    home: true,
    label: "TRAPit Pro Max users",
    poll: {
      addQuestion: true,
      schedule: true,
      shareOpenToAll: true,
      shareWithGroups: true,
    },
    test: {
      addQuestion: true,
      maxQuestionsPerPool: 1000,
      maxQuestionPools: 100,
      maxScheduledTestsPerMonth: 100,
      maxSelfTestsPerMonth: 100,
    },
  },
};

export const normalUserCategoryLabels: Record<NormalUserCategory, string> = Object.fromEntries(
  Object.entries(normalUserCategoryDefinitions).map(([category, definition]) => [category, definition.label]),
) as Record<NormalUserCategory, string>;

export function resolveNormalUserCategory(value: unknown, fallback: NormalUserCategory = defaultNormalUserCategory): NormalUserCategory {
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