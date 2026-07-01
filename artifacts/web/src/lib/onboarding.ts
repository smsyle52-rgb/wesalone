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

export const DEFAULT_ONBOARDING_STATUS: OnboardingStatus = {
  completed: false,
  currentStep: 1,
  completedAt: null,
  steps: {
    agent: { completed: false, agentId: null, updatedAt: null },
    channel: { completed: false, channelAccountId: null, channelType: null, updatedAt: null },
    knowledge: { completed: false, knowledgeBaseId: null, documentId: null, updatedAt: null },
  },
};

export function normalizeOnboardingStatus(
  value: unknown,
  fallbackCompleted = false,
): OnboardingStatus {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return fallbackCompleted
      ? { ...DEFAULT_ONBOARDING_STATUS, completed: true, currentStep: 3 }
      : DEFAULT_ONBOARDING_STATUS;
  }

  const record = value as Record<string, unknown>;
  const stepsRecord = record.steps && typeof record.steps === "object" && !Array.isArray(record.steps)
    ? record.steps as Record<string, unknown>
    : {};
  const agentRecord = stepsRecord.agent && typeof stepsRecord.agent === "object" && !Array.isArray(stepsRecord.agent)
    ? stepsRecord.agent as Record<string, unknown>
    : {};
  const channelRecord = stepsRecord.channel && typeof stepsRecord.channel === "object" && !Array.isArray(stepsRecord.channel)
    ? stepsRecord.channel as Record<string, unknown>
    : {};
  const knowledgeRecord = stepsRecord.knowledge && typeof stepsRecord.knowledge === "object" && !Array.isArray(stepsRecord.knowledge)
    ? stepsRecord.knowledge as Record<string, unknown>
    : {};

  const completed = record.completed === true || fallbackCompleted;
  const currentStep = record.currentStep === 2 || record.currentStep === 3 ? record.currentStep : 1;
  const completedAt = typeof record.completedAt === "string" ? record.completedAt : null;

  return {
    completed,
    currentStep: completed ? 3 : currentStep,
    completedAt,
    steps: {
      agent: {
        completed: agentRecord.completed === true || completed,
        agentId: typeof agentRecord.agentId === "string" ? agentRecord.agentId : null,
        updatedAt: typeof agentRecord.updatedAt === "string" ? agentRecord.updatedAt : null,
      },
      channel: {
        completed: channelRecord.completed === true || completed,
        channelAccountId: typeof channelRecord.channelAccountId === "string" ? channelRecord.channelAccountId : null,
        channelType: channelRecord.channelType === "whatsapp" || channelRecord.channelType === "instagram"
          ? channelRecord.channelType
          : null,
        updatedAt: typeof channelRecord.updatedAt === "string" ? channelRecord.updatedAt : null,
      },
      knowledge: {
        completed: knowledgeRecord.completed === true || completed,
        knowledgeBaseId: typeof knowledgeRecord.knowledgeBaseId === "string" ? knowledgeRecord.knowledgeBaseId : null,
        documentId: typeof knowledgeRecord.documentId === "string" ? knowledgeRecord.documentId : null,
        updatedAt: typeof knowledgeRecord.updatedAt === "string" ? knowledgeRecord.updatedAt : null,
      },
    },
  };
}

export function routeForOnboardingStatus(status: OnboardingStatus): "/dashboard" | "/onboarding" {
  return status.completed ? "/dashboard" : "/onboarding";
}
