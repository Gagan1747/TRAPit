import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { createEmptyTestingWorkspaceState, type TestingWorkspaceState } from "../src/quiz";

vi.mock("server-only", () => ({}));
vi.mock("../../../apps/web/lib/notification-store", () => ({
  reconcileBrowserNotificationIntents: vi.fn(async () => undefined),
}));
vi.mock("../../../apps/web/lib/user-api", () => ({
  getUserActor: vi.fn(async () => ({ identifier: viewerIdentifier, usingFallbackIdentifier: false })),
}));

const owner = "creator@example.com";
const players = ["one@example.com", "two@example.com", "three@example.com", "four@example.com"];
let viewerIdentifier = players[0];
const initialTime = Date.parse("2026-10-01T10:00:00.000Z");
const storePath = path.join(process.cwd(), `.rapid-game-integration-${process.pid}.json`);
let store: typeof import("../../../apps/web/lib/testing-store");
let route: typeof import("../../../apps/web/app/api/user/games/[gameId]/route");

function fixture(): TestingWorkspaceState {
  const state = createEmptyTestingWorkspaceState();
  const timestamp = new Date(initialTime).toISOString();
  state.participants = players.map((identifier, index) => ({
    id: `p${index}`, identifier, label: `Player ${index}`, createdAt: timestamp, updatedAt: timestamp,
  }));
  state.participantGroups = [
    { id: "g1", participantIds: ["p0", "p1", "p2"], name: "First" },
    { id: "g2", participantIds: ["p1", "p2", "p3"], name: "Second" },
  ].map((group) => ({
    ...group, ownerIdentifier: owner, createdAt: timestamp, updatedAt: timestamp,
    description: "", inviteJoinMode: "automatic", shareCode: null,
  }));
  state.questions = Array.from({ length: 20 }, (_, index) => ({
    id: `q${index}`, prompt: `Question ${index}`, options: ["A", "B", "C", "D"],
    correctOptionIndex: 0, createdAt: timestamp, updatedAt: timestamp, createdBy: "owner-sub", topic: "General",
  }));
  state.pools = [{
    id: "pool", name: "Pool", description: "", createdAt: timestamp, updatedAt: timestamp,
    createdBy: "owner-sub", sharedWithIdentifiers: [], questionIds: state.questions.map((question) => question.id),
  }];
  return state;
}

async function persisted() {
  return JSON.parse(await readFile(storePath, "utf8")) as TestingWorkspaceState;
}

async function create() {
  return store.createScheduledGame({
    actorIdentifier: owner, createdBy: "owner-sub", participantGroupIds: ["g1", "g2"], poolId: "pool", title: "Rapid",
  });
}

async function launch() {
  const game = await create();
  for (const player of players) await store.acceptGame(game.id, player, player.split("@")[0]);
  await store.setGameCreatorRole(game.id, owner, "spectator");
  await store.startGame(game.id, owner);
  vi.setSystemTime(initialTime + 60_000);
  return (await store.getGameForParticipant(game.id, players[0]))!;
}

beforeAll(async () => {
  vi.stubEnv("TRAPIT_DATA_FILE", storePath);
  store = await import("../../../apps/web/lib/testing-store");
  route = await import("../../../apps/web/app/api/user/games/[gameId]/route");
});
beforeEach(async () => {
  viewerIdentifier = players[0];
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(initialTime);
  await writeFile(storePath, JSON.stringify(fixture()));
});
afterAll(async () => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  await rm(storePath, { force: true });
});

describe("serialized Rapid store lifecycle", () => {
  it("creates version 4 from multiple owned groups with unique members and validates title/pool/membership", async () => {
    const game = await create();
    expect(game.rulesVersion).toBe(4);
    expect(game.participantGroupIds).toEqual(["g1", "g2"]);
    expect(game.participantGroupId).toBe("g1");
    expect(game.participants).toHaveLength(5);
    expect(game.questionIds).toHaveLength(20);
    await expect(store.createScheduledGame({
      actorIdentifier: owner, createdBy: "owner-sub", participantGroupIds: ["g1", "g2"], poolId: "pool", title: "x".repeat(31),
    })).rejects.toThrow("30");
    await expect(store.createScheduledGame({
      actorIdentifier: owner, createdBy: "owner-sub", participantGroupId: "g1", poolId: "pool",
    })).rejects.toThrow("4 unique");
    await expect(store.createScheduledGame({
      actorIdentifier: "other@example.com", createdBy: "owner-sub", participantGroupIds: ["g1", "g2"], poolId: "pool",
    })).rejects.toThrow("manage");
    const state = await persisted();
    state.pools[0].questionIds.pop();
    await writeFile(storePath, JSON.stringify(state));
    await expect(create()).rejects.toThrow("20 questions");
  });

  it("requires names and four accepts; creator participation counts and membership locks at Start", async () => {
    const game = await create();
    await expect(store.acceptGame(game.id, players[0], " ")).rejects.toThrow("name");
    for (const player of players.slice(0, 3)) await store.acceptGame(game.id, player, "Player");
    await store.setGameCreatorRole(game.id, owner, "spectator");
    await expect(store.startGame(game.id, owner)).rejects.toThrow("4 participants");
    await expect(store.setGameCreatorRole(game.id, owner, "participant", "")).rejects.toThrow("name");
    await store.setGameCreatorRole(game.id, owner, "participant", "Creator");
    await store.startGame(game.id, owner);
    await expect(store.acceptGame(game.id, players[3], "Late")).rejects.toThrow("already started");
    await expect(store.setGameCreatorRole(game.id, owner, "spectator")).rejects.toThrow("cannot change");
    const state = await persisted();
    state.participantGroups.forEach((group) => { group.participantIds = []; });
    await writeFile(storePath, JSON.stringify(state));
    expect((await store.getGameForParticipant(game.id, players[0]))?.acceptedCount).toBe(4);
  });

  it("enforces progression, persisted ready timers, timing bounds and idempotent answer retries", async () => {
    const game = await launch();
    const input = { gameId: game.id, participantIdentifier: players[0], questionIndex: 0 };
    await expect(store.recordGameAnswer({ ...input, optionIndex: 0 })).rejects.toThrow("no longer");
    await expect(store.recordGameQuestionReady({ ...input, questionIndex: 1 })).rejects.toThrow("not available");
    await store.recordGameQuestionReady(input);
    vi.setSystemTime(initialTime + 65_000);
    await store.recordGameQuestionReady(input);
    const restored = (await store.getGameForParticipant(game.id, players[0]))!;
    expect(restored.participantQuestionStartedAt).toBe(new Date(initialTime + 60_000).toISOString());
    const correct = game.presentedQuestions![0].correctOptionIndex;
    await expect(store.recordGameAnswer({ ...input, optionIndex: correct, elapsedMs: -1 })).rejects.toThrow("timing");
    await expect(store.recordGameAnswer({ ...input, optionIndex: correct, elapsedMs: Number.NaN })).rejects.toThrow("timing");
    await expect(store.recordGameAnswer({ ...input, optionIndex: correct, elapsedMs: 6000 })).rejects.toThrow("timing");
    const answers = await Promise.all([
      store.recordGameAnswer({ ...input, optionIndex: correct, elapsedMs: 4500 }),
      store.recordGameAnswer({ ...input, optionIndex: correct, elapsedMs: 4500 }),
    ]);
    expect(answers[0].answer).toEqual(answers[1].answer);
    expect((await persisted()).games[0].answers).toHaveLength(1);
    expect(answers[0].game.currentQuestionIndex).toBe(1);
    await expect(store.recordGameAnswer({ ...input, optionIndex: (correct + 1) % 4 })).rejects.toThrow("already resolved");
    vi.setSystemTime(initialTime + 90_000);
    const next = (await store.getGameForParticipant(game.id, players[0]))!;
    expect(next.currentQuestionIndex).toBe(1);
    expect((await store.getGameForParticipant(game.id, players[1]))?.currentQuestionIndex).toBe(0);
    expect((await store.recordGameAnswer({ ...input, optionIndex: correct })).answer).toEqual(answers[0].answer);
  });

  it("server-reconciles absent clients at the global cutoff and rejects late answers", async () => {
    const game = await launch();
    const input = { gameId: game.id, participantIdentifier: players[0], questionIndex: 0 };
    vi.setSystemTime(initialTime + 659_000);
    await store.recordGameQuestionReady(input);
    expect((await store.getGameForParticipant(game.id, players[0]))?.questionDeadline).toBe(new Date(initialTime + 660_000).toISOString());
    vi.setSystemTime(initialTime + 660_000);
    const complete = (await store.getGameForParticipant(game.id, players[0]))!;
    expect(complete.status).toBe("completed");
    expect(complete.answers).toHaveLength(80);
    expect(complete.completedAt).toBe(new Date(initialTime + 660_000).toISOString());
    await expect(store.recordGameAnswer({ ...input, optionIndex: 0, elapsedMs: 500 })).rejects.toThrow("already resolved");
    expect((await store.getGameForParticipant(game.id, players[0]))?.answers).toHaveLength(80);
  });

  it("accepts transport over two seconds without changing either hard deadline or elapsed-time ordering", async () => {
    const game = await launch();
    for (const participantIdentifier of players.slice(0, 3)) {
      await store.recordGameQuestionReady({ gameId: game.id, participantIdentifier, questionIndex: 0 });
    }
    const correct = game.presentedQuestions![0].correctOptionIndex;
    vi.setSystemTime(initialTime + 66_000);
    const first = await store.recordGameAnswer({
      gameId: game.id, participantIdentifier: players[0], questionIndex: 0, optionIndex: correct, elapsedMs: 1000,
    });
    expect(first.answer.elapsedMs).toBe(1000);
    expect(first.game.currentQuestionIndex).toBe(1);
    vi.setSystemTime(initialTime + 70_000);
    const laterArrival = await store.recordGameAnswer({
      gameId: game.id, participantIdentifier: players[1], questionIndex: 0, optionIndex: correct, elapsedMs: 500,
    });
    expect(laterArrival.answer.points).toBe(50);
    const storedAnswers = (await persisted()).games[0].answers;
    expect(storedAnswers.find((answer) => answer.participantIdentifier === players[0])?.points).toBe(30);
    vi.setSystemTime(initialTime + 90_000);
    await expect(store.recordGameAnswer({
      gameId: game.id, participantIdentifier: players[2], questionIndex: 0, optionIndex: correct, elapsedMs: 500,
    })).rejects.toThrow("already resolved");
  });

  it("labels the final Rapid log Results and identifies nonparticipants as absent rather than Missed", async () => {
    const game = await launch();
    const state = await persisted();
    viewerIdentifier = "absent@example.com";
    state.games[0].participants.push({ identifier: viewerIdentifier, label: "Absent player", acceptedAt: null });
    await writeFile(storePath, JSON.stringify(state));
    vi.setSystemTime(initialTime + 660_000);
    const dashboard = await import("../../../apps/web/app/api/user/dashboard/route");
    const response = await dashboard.GET(new Request("http://localhost/api/user/dashboard"));
    const body = await response.json();
    expect(response.status).toBe(200);
    const summary = body.availableGames.find((entry: { id: string }) => entry.id === game.id);
    expect(summary.displayStatus).toBe("Results");
    expect(summary.status).toBe("completed");
    expect(summary.participants.find((entry: { identifier: string }) => entry.identifier === viewerIdentifier).accepted).toBe(false);
  });

  it("does not leak correctness or other participants' answers before or after results", async () => {
    const game = await launch();
    for (const participantIdentifier of players.slice(0, 2)) {
      await store.recordGameQuestionReady({ gameId: game.id, participantIdentifier, questionIndex: 0 });
    }
    vi.setSystemTime(initialTime + 65_000);
    for (const participantIdentifier of players.slice(0, 2)) {
      await store.recordGameAnswer({
        gameId: game.id, participantIdentifier, questionIndex: 0, elapsedMs: 4900,
        optionIndex: game.presentedQuestions![0].correctOptionIndex,
      });
    }
    const response = await route.GET(new Request("http://localhost/api/user/games/game"), { params: { gameId: game.id } });
    const body = await response.json();
    expect(body.game.currentQuestion.correctOptionIndex).toBeUndefined();
    expect(body.game.leaderboard.length).toBeGreaterThan(0);
    expect(body.game.leaderboard.every((entry: Record<string, unknown>) => entry.answers === undefined)).toBe(true);
    expect(body.game.recentDeltas).toEqual([]);
    expect(body.game.reviewQuestions).toEqual([]);
    expect(body.game.ownAnswers).toHaveLength(1);
    expect(body.game.ownAnswers[0].points).toBeUndefined();
    expect(body.game.ownAnswers[0].isCorrect).toBeUndefined();
    vi.setSystemTime(initialTime + 660_000);
    await store.reconcileExpiredGames();
    const finalResponse = await route.GET(new Request("http://localhost/api/user/games/game"), { params: { gameId: game.id } });
    const final = await finalResponse.json();
    expect(final.game.reviewQuestions).toHaveLength(20);
    expect(final.game.ownAnswers).toHaveLength(20);
    expect(final.game.ownAnswers.every((answer: { participantIdentifier: string }) => answer.participantIdentifier === players[0])).toBe(true);
    expect(final.game.leaderboard.some((entry: { isSelf: boolean }) => entry.isSelf)).toBe(true);
    expect(final.game.leaderboard.every((entry: Record<string, unknown>) => entry.answers === undefined)).toBe(true);
  });

  it("returns top ten plus self for participants, but full final standings for creators", async () => {
    const game = await launch();
    const state = await persisted();
    state.games[0].participants[0].label = "Zulu";
    state.games[0].participants.push(...Array.from({ length: 10 }, (_, index) => ({
      identifier: `extra-${index}@example.com`, label: `Extra ${index}`, acceptedAt: new Date(initialTime).toISOString(),
    })));
    await writeFile(storePath, JSON.stringify(state));
    vi.setSystemTime(initialTime + 660_000);
    const participantResponse = await route.GET(new Request("http://localhost/api/user/games/game"), { params: { gameId: game.id } });
    const participantBody = await participantResponse.json();
    expect(participantBody.game.leaderboard).toHaveLength(11);
    expect(participantBody.game.leaderboard.at(-1).isSelf).toBe(true);
    expect(participantBody.game.leaderboard.every((entry: { rank: number }) => entry.rank === 1)).toBe(true);
    viewerIdentifier = owner;
    const creatorResponse = await route.GET(new Request("http://localhost/api/user/games/game"), { params: { gameId: game.id } });
    expect((await creatorResponse.json()).game.leaderboard).toHaveLength(14);
  });
});
