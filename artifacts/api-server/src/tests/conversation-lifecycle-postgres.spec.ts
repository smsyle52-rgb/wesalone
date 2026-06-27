import { afterAll, describe, expect, it } from "vitest";
import { db, pool, workspacesTable, conversationsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { applyConversationLifecycleEventAtomic } from "../modules/conversations/conversation.service";

const workspaceIds: string[] = [];

async function createWorkspace(): Promise<string> {
  const id = randomUUID();
  await db.insert(workspacesTable).values({ id, name: "CI Integration Test", slug: `ci-test-${id}` });
  workspaceIds.push(id);
  return id;
}

async function createConversation(
  workspaceId: string,
  fields: { lifecycleState: string; aiSubstate: string; status: string; agentStatus: string },
): Promise<string> {
  const id = randomUUID();
  await db.insert(conversationsTable).values({
    id,
    workspaceId,
    lifecycleState: fields.lifecycleState,
    aiSubstate: fields.aiSubstate,
    status: fields.status,
    agentStatus: fields.agentStatus as "active" | "paused" | "human",
  });
  return id;
}

async function readConversation(id: string) {
  const [row] = await db.select().from(conversationsTable).where(eq(conversationsTable.id, id));
  if (!row) throw new Error(`Conversation ${id} not found after operation`);
  return row;
}

afterAll(async () => {
  for (const id of workspaceIds) {
    await db.delete(workspacesTable).where(eq(workspacesTable.id, id));
  }
  await pool.end();
});

describe("W3-T1B.1 PostgreSQL lifecycle transaction", () => {
  it("A — successful lifecycle transition writes all four fields to PostgreSQL", async () => {
    const wsId = await createWorkspace();
    const convId = await createConversation(wsId, {
      lifecycleState: "open",
      aiSubstate: "ai_active",
      status: "open",
      agentStatus: "active",
    });

    const result = await applyConversationLifecycleEventAtomic({
      workspaceId: wsId,
      conversationId: convId,
      event: { type: "resolve" },
      unifiedLifecycleEnabled: true,
    });

    expect(result.kind).toBe("written");
    if (result.kind !== "written") throw new Error("expected written");

    expect(result.conversation.lifecycleState).toBe("resolved");
    expect(result.conversation.aiSubstate).toBe("ai_active");
    expect(result.conversation.status).toBe("resolved");
    expect(result.conversation.agentStatus).toBe("active");

    const persisted = await readConversation(convId);
    expect(persisted.lifecycleState).toBe("resolved");
    expect(persisted.aiSubstate).toBe("ai_active");
    expect(persisted.status).toBe("resolved");
    expect(persisted.agentStatus).toBe("active");
  });

  it("B — wrong workspaceId returns not_found and leaves conversation unchanged", async () => {
    const wsId = await createWorkspace();
    const wrongWsId = await createWorkspace();
    const convId = await createConversation(wsId, {
      lifecycleState: "open",
      aiSubstate: "ai_active",
      status: "open",
      agentStatus: "active",
    });

    const result = await applyConversationLifecycleEventAtomic({
      workspaceId: wrongWsId,
      conversationId: convId,
      event: { type: "resolve" },
      unifiedLifecycleEnabled: true,
    });

    expect(result.kind).toBe("not_found");

    const persisted = await readConversation(convId);
    expect(persisted.lifecycleState).toBe("open");
    expect(persisted.status).toBe("open");
  });

  it("C — onWritten that throws rolls back the full transaction", async () => {
    const wsId = await createWorkspace();
    const convId = await createConversation(wsId, {
      lifecycleState: "open",
      aiSubstate: "ai_active",
      status: "open",
      agentStatus: "active",
    });

    await expect(
      applyConversationLifecycleEventAtomic({
        workspaceId: wsId,
        conversationId: convId,
        event: { type: "resolve" },
        unifiedLifecycleEnabled: true,
        onWritten: async () => {
          throw new Error("intentional rollback");
        },
      }),
    ).rejects.toThrow("intentional rollback");

    const persisted = await readConversation(convId);
    expect(persisted.lifecycleState).toBe("open");
    expect(persisted.aiSubstate).toBe("ai_active");
    expect(persisted.status).toBe("open");
    expect(persisted.agentStatus).toBe("active");
  });

  it("D — second identical transition returns noop without changing updatedAt", async () => {
    const wsId = await createWorkspace();
    const convId = await createConversation(wsId, {
      lifecycleState: "open",
      aiSubstate: "ai_active",
      status: "open",
      agentStatus: "active",
    });

    const first = await applyConversationLifecycleEventAtomic({
      workspaceId: wsId,
      conversationId: convId,
      event: { type: "resolve" },
      unifiedLifecycleEnabled: true,
    });
    expect(first.kind).toBe("written");

    const afterFirst = await readConversation(convId);

    const second = await applyConversationLifecycleEventAtomic({
      workspaceId: wsId,
      conversationId: convId,
      event: { type: "resolve" },
      unifiedLifecycleEnabled: true,
    });
    expect(second.kind).toBe("noop");

    const afterSecond = await readConversation(convId);
    expect(afterSecond.updatedAt.getTime()).toBe(afterFirst.updatedAt.getTime());
    expect(afterSecond.lifecycleState).toBe("resolved");
  });

  it("E — resolved and snoozed conversations reject lifecycle events and AI stays inactive", async () => {
    const wsId = await createWorkspace();

    const resolvedId = await createConversation(wsId, {
      lifecycleState: "resolved",
      aiSubstate: "ai_active",
      status: "resolved",
      agentStatus: "active",
    });

    const e1 = await applyConversationLifecycleEventAtomic({
      workspaceId: wsId,
      conversationId: resolvedId,
      event: { type: "pause_ai" },
      unifiedLifecycleEnabled: true,
    });
    expect(e1.kind).toBe("rejected");
    if (e1.kind === "rejected") expect(e1.transition.reason).toBe("CONVERSATION_RESOLVED");

    const afterE1 = await readConversation(resolvedId);
    expect(afterE1.lifecycleState).toBe("resolved");
    expect(afterE1.aiSubstate).toBe("ai_active");

    const snoozedId = await createConversation(wsId, {
      lifecycleState: "snoozed",
      aiSubstate: "ai_active",
      status: "snoozed",
      agentStatus: "active",
    });

    const e2 = await applyConversationLifecycleEventAtomic({
      workspaceId: wsId,
      conversationId: snoozedId,
      event: { type: "pause_ai" },
      unifiedLifecycleEnabled: true,
    });
    expect(e2.kind).toBe("rejected");
    if (e2.kind === "rejected") expect(e2.transition.reason).toBe("CONVERSATION_SNOOZED");

    const afterE2 = await readConversation(snoozedId);
    expect(afterE2.lifecycleState).toBe("snoozed");
    expect(afterE2.aiSubstate).toBe("ai_active");

    expect(afterE1.lifecycleState).not.toBe("open");
    expect(afterE2.lifecycleState).not.toBe("open");
  });
});
