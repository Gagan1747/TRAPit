import "server-only";

import {
  getNormalUserCategoryDefinition,
  getNextNormalUserCategory,
  normalUserCategoryLabels,
  type NormalUserCategory,
} from "@trapit/auth";

import { getUpgradeTargetCategory } from "./user-category-store";

function formatLimitMessage(featureName: string, category: NormalUserCategory, nextCategory: NormalUserCategory | null) {
  if (!nextCategory) {
    return `You have utilized all allowable limits of ${featureName}.`;
  }

  return `You have utilized all allowable limits of ${featureName} - upgrade to ${normalUserCategoryLabels[nextCategory]} to extend your limits`;
}

function throwLimitExceeded(featureName: string, category: NormalUserCategory, nextCategory: NormalUserCategory | null) {
  throw new Error(formatLimitMessage(featureName, category, nextCategory));
}

function getEffectiveSelfTestLimit(category: NormalUserCategory) {
  const definition = getNormalUserCategoryDefinition(category);

  return definition.test.maxSelfTestsPerMonth > 0
    ? definition.test.maxSelfTestsPerMonth
    : definition.test.maxScheduledTestsPerMonth;
}

export function assertCanCreateQuestionPool(category: NormalUserCategory, existingPoolCount: number) {
  const definition = getNormalUserCategoryDefinition(category);

  if (existingPoolCount >= definition.test.maxQuestionPools) {
    throwLimitExceeded(
      "Test - Question pool",
      category,
      getUpgradeTargetCategory(category, (candidateDefinition) =>
        candidateDefinition.test.maxQuestionPools > definition.test.maxQuestionPools,
      ) ?? getNextNormalUserCategory(category),
    );
  }
}

export function assertCanAddQuestionsToPools(
  category: NormalUserCategory,
  poolQuestionCountsAfterSave: number[],
) {
  const definition = getNormalUserCategoryDefinition(category);

  if (!definition.test.addQuestion || !definition.test.maxQuestionsPerPool) {
    throwLimitExceeded(
      "Test - Add question",
      category,
      getUpgradeTargetCategory(category, (candidateDefinition) =>
        candidateDefinition.test.addQuestion,
      ) ?? getNextNormalUserCategory(category),
    );
  }

  if (poolQuestionCountsAfterSave.some((count) => count > definition.test.maxQuestionsPerPool!)) {
    throwLimitExceeded(
      "Test - Add question",
      category,
      getUpgradeTargetCategory(category, (candidateDefinition) => {
        if (!candidateDefinition.test.maxQuestionsPerPool) {
          return false;
        }

        return candidateDefinition.test.maxQuestionsPerPool > definition.test.maxQuestionsPerPool!;
      }) ?? getNextNormalUserCategory(category),
    );
  }
}

export function assertCanCreateGroup(category: NormalUserCategory) {
  const definition = getNormalUserCategoryDefinition(category);

  if (!definition.group.create) {
    throwLimitExceeded(
      "Group - Create",
      category,
      getUpgradeTargetCategory(category, (candidateDefinition) => candidateDefinition.group.create) ?? getNextNormalUserCategory(category),
    );
  }
}

export function assertCanManageGroup(category: NormalUserCategory) {
  const definition = getNormalUserCategoryDefinition(category);

  if (!definition.group.manage) {
    throwLimitExceeded(
      "Group - Manage",
      category,
      getUpgradeTargetCategory(category, (candidateDefinition) => candidateDefinition.group.manage) ?? getNextNormalUserCategory(category),
    );
  }
}

export function assertCanCreatePollQuestions(category: NormalUserCategory) {
  const definition = getNormalUserCategoryDefinition(category);

  if (!definition.poll.addQuestion) {
    throwLimitExceeded(
      "Poll - Add question",
      category,
      getUpgradeTargetCategory(category, (candidateDefinition) => candidateDefinition.poll.addQuestion) ?? getNextNormalUserCategory(category),
    );
  }
}

export function assertCanSchedulePoll(category: NormalUserCategory, participantType: "open" | "registered") {
  const definition = getNormalUserCategoryDefinition(category);

  if (!definition.poll.schedule) {
    throwLimitExceeded(
      "Poll - Schedule Poll",
      category,
      getUpgradeTargetCategory(category, (candidateDefinition) => candidateDefinition.poll.schedule) ?? getNextNormalUserCategory(category),
    );
  }

  if (participantType === "open" && !definition.poll.shareOpenToAll) {
    throwLimitExceeded(
      "Poll - Schedule Poll",
      category,
      getUpgradeTargetCategory(category, (candidateDefinition) => candidateDefinition.poll.shareOpenToAll) ?? getNextNormalUserCategory(category),
    );
  }

  if (participantType === "registered" && !definition.poll.shareWithGroups) {
    throwLimitExceeded(
      "Poll - Schedule Poll",
      category,
      getUpgradeTargetCategory(category, (candidateDefinition) => candidateDefinition.poll.shareWithGroups) ?? getNextNormalUserCategory(category),
    );
  }
}

export function assertCanScheduleTest(category: NormalUserCategory, scheduledTestsThisMonth: number) {
  const definition = getNormalUserCategoryDefinition(category);

  if (scheduledTestsThisMonth >= definition.test.maxScheduledTestsPerMonth) {
    throwLimitExceeded(
      "Test - Schedule Test",
      category,
      getUpgradeTargetCategory(category, (candidateDefinition) =>
        candidateDefinition.test.maxScheduledTestsPerMonth > definition.test.maxScheduledTestsPerMonth,
      ) ?? getNextNormalUserCategory(category),
    );
  }
}

export function assertCanScheduleSelfTest(category: NormalUserCategory, selfTestsThisMonth: number) {
  const selfTestLimit = getEffectiveSelfTestLimit(category);

  if (selfTestsThisMonth >= selfTestLimit) {
    throwLimitExceeded(
      "Test - Self-Test",
      category,
      getUpgradeTargetCategory(category, (candidateDefinition) => {
        const nextSelfTestLimit = candidateDefinition.test.maxSelfTestsPerMonth > 0
          ? candidateDefinition.test.maxSelfTestsPerMonth
          : candidateDefinition.test.maxScheduledTestsPerMonth;

        return nextSelfTestLimit > selfTestLimit;
      }) ?? getNextNormalUserCategory(category),
    );
  }
}