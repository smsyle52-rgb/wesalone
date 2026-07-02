import { and, desc, eq, or, sql } from "drizzle-orm";
import {
  aiAgentInstructionsTable,
  aiAgentsTable,
  channelAccountsTable,
  db,
  knowledgeBasesTable,
  knowledgeChunksTable,
  knowledgeDocumentsTable,
  workspacesTable,
} from "@workspace/db";

export type OnboardingStatus = {
  completed: boolean;
  currentStep: 1 | 2 | 3;
  completedAt: string | null;
  steps: {
    agent: {
      completed: boolean;
      agentId: string | null;
      updatedAt: string | null;
    };
    channel: {
      completed: boolean;
      channelAccountId: string | null;
      channelType: "whatsapp" | "instagram" | null;
      updatedAt: string | null;
    };
    knowledge: {
      completed: boolean;
      knowledgeBaseId: string | null;
      documentId: string | null;
      updatedAt: string | null;
    };
  };
};

type AgentSnapshot = {
  agentId: string;
  type: string;
  dialect: string;
  agentUpdatedAt: Date;
  rolePrompt: string | null;
  businessRules: string | null;
  forbiddenActions: string | null;
  escalationRules: string | null;
  instructionsCreatedAt: Date | null;
  instructionsUpdatedAt: Date | null;
};

type WorkspaceSettingsRecord = Record<string, unknown>;

type ChannelSnapshot = {
  id: string;
  channelType: string;
  status: string;
  credentialsSecretRef: string | null;
  externalAccountId: string | null;
  externalBusinessId: string | null;
  externalPhoneId: string | null;
  updatedAt: Date;
};

function toIso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

export function defaultAgentRolePrompt(type: string, dialect: string): string {
  return `أنت وكيل ذكاء اصطناعي مساعد لنظام إدارة علاقات العملاء. نوعك: ${type}. لهجتك: ${dialect}.`;
}

function hasMeaningfulText(value: string | null | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

export function hasMeaningfulAgentSetup(agent: AgentSnapshot): boolean {
  if (!hasMeaningfulText(agent.rolePrompt)) return false;
  if (agent.rolePrompt!.trim() !== defaultAgentRolePrompt(agent.type, agent.dialect).trim()) return true;
  if (hasMeaningfulText(agent.businessRules)) return true;
  if (hasMeaningfulText(agent.forbiddenActions)) return true;
  if (hasMeaningfulText(agent.escalationRules)) return true;
  if (agent.instructionsCreatedAt && agent.instructionsUpdatedAt) {
    return agent.instructionsUpdatedAt.getTime() > agent.instructionsCreatedAt.getTime();
  }
  return false;
}

function latestIso(...values: Array<string | null>): string | null {
  const timestamps = values
    .filter((value): value is string => Boolean(value))
    .map((value) => new Date(value).getTime())
    .filter((value) => Number.isFinite(value));
  if (timestamps.length === 0) return null;
  return new Date(Math.max(...timestamps)).toISOString();
}

export function resolveCurrentOnboardingStep(status: Pick<OnboardingStatus, "steps">): 1 | 2 | 3 {
  if (!status.steps.agent.completed) return 1;
  if (!status.steps.channel.completed) return 2;
  if (!status.steps.knowledge.completed) return 3;
  return 3;
}

function readWorkspaceSettings(value: unknown): WorkspaceSettingsRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as WorkspaceSettingsRecord;
}

function hasHistoricalChannelEvidence(channel: Pick<ChannelSnapshot, "credentialsSecretRef" | "externalAccountId" | "externalBusinessId" | "externalPhoneId">): boolean {
  return hasMeaningfulText(channel.credentialsSecretRef)
    || hasMeaningfulText(channel.externalAccountId)
    || hasMeaningfulText(channel.externalBusinessId)
    || hasMeaningfulText(channel.externalPhoneId);
}

export function resolveOnboardingCompletion(params: {
  persistedCompleted: boolean;
  steps: OnboardingStatus["steps"];
  channelRows: ChannelSnapshot[];
}): boolean {
  const dynamicallyCompleted = params.steps.agent.completed && params.steps.channel.completed && params.steps.knowledge.completed;
  if (params.persistedCompleted || dynamicallyCompleted) return true;

  const hadConnectedChannelBefore = params.channelRows.some((row) =>
    (row.channelType === "whatsapp" || row.channelType === "instagram")
    && hasHistoricalChannelEvidence(row),
  );

  return params.steps.agent.completed && params.steps.knowledge.completed && hadConnectedChannelBefore;
}

export async function getWorkspaceOnboardingStatus(workspaceId: string): Promise<OnboardingStatus> {
  const [workspaceRows, agentRows, channelRows, latestBaseRows, readyKnowledgeRows] = await Promise.all([
    db
      .select({ settings: workspacesTable.settings })
      .from(workspacesTable)
      .where(eq(workspacesTable.id, workspaceId))
      .limit(1),
    db
      .select({
        agentId: aiAgentsTable.id,
        type: aiAgentsTable.type,
        dialect: aiAgentsTable.dialect,
        agentUpdatedAt: aiAgentsTable.updatedAt,
        rolePrompt: aiAgentInstructionsTable.rolePrompt,
        businessRules: aiAgentInstructionsTable.businessRules,
        forbiddenActions: aiAgentInstructionsTable.forbiddenActions,
        escalationRules: aiAgentInstructionsTable.escalationRules,
        instructionsCreatedAt: aiAgentInstructionsTable.createdAt,
        instructionsUpdatedAt: aiAgentInstructionsTable.updatedAt,
      })
      .from(aiAgentsTable)
      .leftJoin(
        aiAgentInstructionsTable,
        and(
          eq(aiAgentInstructionsTable.agentId, aiAgentsTable.id),
          eq(aiAgentInstructionsTable.workspaceId, workspaceId),
        ),
      )
      .where(and(eq(aiAgentsTable.workspaceId, workspaceId), eq(aiAgentsTable.status, "active")))
      .orderBy(desc(aiAgentsTable.updatedAt), desc(aiAgentsTable.createdAt))
      .limit(20),
    db
      .select({
        id: channelAccountsTable.id,
        channelType: channelAccountsTable.channelType,
        status: channelAccountsTable.status,
        credentialsSecretRef: channelAccountsTable.credentialsSecretRef,
        externalAccountId: channelAccountsTable.externalAccountId,
        externalBusinessId: channelAccountsTable.externalBusinessId,
        externalPhoneId: channelAccountsTable.externalPhoneId,
        updatedAt: channelAccountsTable.updatedAt,
      })
      .from(channelAccountsTable)
      .where(
        and(
          eq(channelAccountsTable.workspaceId, workspaceId),
          or(eq(channelAccountsTable.channelType, "whatsapp"), eq(channelAccountsTable.channelType, "instagram")),
        ),
      )
      .orderBy(desc(channelAccountsTable.updatedAt), desc(channelAccountsTable.createdAt))
      .limit(10),
    db
      .select({
        knowledgeBaseId: knowledgeBasesTable.id,
        updatedAt: knowledgeBasesTable.updatedAt,
      })
      .from(knowledgeBasesTable)
      .where(and(eq(knowledgeBasesTable.workspaceId, workspaceId), eq(knowledgeBasesTable.status, "active")))
      .orderBy(desc(knowledgeBasesTable.updatedAt), desc(knowledgeBasesTable.createdAt))
      .limit(5),
    db
      .select({
        knowledgeBaseId: knowledgeDocumentsTable.knowledgeBaseId,
        documentId: knowledgeDocumentsTable.id,
        updatedAt: knowledgeDocumentsTable.updatedAt,
      })
      .from(knowledgeDocumentsTable)
      .innerJoin(
        knowledgeBasesTable,
        and(
          eq(knowledgeBasesTable.id, knowledgeDocumentsTable.knowledgeBaseId),
          eq(knowledgeBasesTable.workspaceId, workspaceId),
          eq(knowledgeBasesTable.status, "active"),
        ),
      )
      .innerJoin(
        knowledgeChunksTable,
        and(
          eq(knowledgeChunksTable.documentId, knowledgeDocumentsTable.id),
          eq(knowledgeChunksTable.workspaceId, workspaceId),
        ),
      )
      .where(
        and(
          eq(knowledgeDocumentsTable.workspaceId, workspaceId),
          eq(knowledgeDocumentsTable.status, "ready"),
          sql`char_length(trim(${knowledgeDocumentsTable.contentText})) > 0`,
        ),
      )
      .orderBy(desc(knowledgeDocumentsTable.updatedAt), desc(knowledgeDocumentsTable.createdAt))
      .limit(10),
  ]);

  const workspaceSettings = readWorkspaceSettings(workspaceRows[0]?.settings);
  const persistedCompleted = workspaceSettings.onboarding_completed === true;

  const latestAgent = agentRows[0] ?? null;
  const completedAgent = agentRows.find(hasMeaningfulAgentSetup) ?? null;
  const agentSource = completedAgent ?? latestAgent;

  const latestChannel = channelRows[0] ?? null;
  const completedChannel = channelRows.find(
    (row) =>
      (row.channelType === "whatsapp" || row.channelType === "instagram")
      && row.status === "active"
      && hasMeaningfulText(row.credentialsSecretRef),
  ) ?? null;
  const channelSource = completedChannel ?? latestChannel;

  const latestBase = latestBaseRows[0] ?? null;
  const completedKnowledge = readyKnowledgeRows[0] ?? null;

  const steps: OnboardingStatus["steps"] = {
    agent: {
      completed: Boolean(completedAgent),
      agentId: agentSource?.agentId ?? null,
      updatedAt: toIso(agentSource?.instructionsUpdatedAt ?? agentSource?.agentUpdatedAt ?? null),
    },
    channel: {
      completed: Boolean(completedChannel),
      channelAccountId: channelSource?.id ?? null,
      channelType: channelSource?.channelType === "whatsapp" || channelSource?.channelType === "instagram"
        ? channelSource.channelType
        : null,
      updatedAt: toIso(channelSource?.updatedAt ?? null),
    },
    knowledge: {
      completed: Boolean(completedKnowledge),
      knowledgeBaseId: completedKnowledge?.knowledgeBaseId ?? latestBase?.knowledgeBaseId ?? null,
      documentId: completedKnowledge?.documentId ?? null,
      updatedAt: toIso(completedKnowledge?.updatedAt ?? latestBase?.updatedAt ?? null),
    },
  };

  const completed = resolveOnboardingCompletion({
    persistedCompleted,
    steps,
    channelRows,
  });
  return {
    completed,
    currentStep: completed ? 3 : resolveCurrentOnboardingStep({ steps }),
    completedAt: completed
      ? latestIso(steps.agent.updatedAt, steps.channel.updatedAt, steps.knowledge.updatedAt)
      : null,
    steps,
  };
}
