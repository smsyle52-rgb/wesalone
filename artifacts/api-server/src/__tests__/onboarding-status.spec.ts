import { describe, expect, it } from "vitest";
import {
  defaultAgentRolePrompt,
  hasMeaningfulAgentSetup,
  resolveCurrentOnboardingStep,
  resolveOnboardingCompletion,
} from "../services/onboarding-status";

describe("onboarding-status", () => {
  it("treats the auto-generated agent prompt as incomplete", () => {
    expect(hasMeaningfulAgentSetup({
      agentId: "a1",
      type: "support",
      dialect: "standard_arabic",
      agentUpdatedAt: new Date("2026-01-01T00:00:00.000Z"),
      rolePrompt: defaultAgentRolePrompt("support", "standard_arabic"),
      businessRules: null,
      forbiddenActions: null,
      escalationRules: null,
      instructionsCreatedAt: new Date("2026-01-01T00:00:00.000Z"),
      instructionsUpdatedAt: new Date("2026-01-01T00:00:00.000Z"),
    })).toBe(false);
  });

  it("treats edited instructions as complete", () => {
    expect(hasMeaningfulAgentSetup({
      agentId: "a1",
      type: "support",
      dialect: "standard_arabic",
      agentUpdatedAt: new Date("2026-01-01T00:00:00.000Z"),
      rolePrompt: "رحّب بالعميل واعتذر عند غياب المعلومة.",
      businessRules: "",
      forbiddenActions: "",
      escalationRules: "",
      instructionsCreatedAt: new Date("2026-01-01T00:00:00.000Z"),
      instructionsUpdatedAt: new Date("2026-01-02T00:00:00.000Z"),
    })).toBe(true);
  });

  it("moves through the three canonical onboarding steps", () => {
    expect(resolveCurrentOnboardingStep({
      steps: {
        agent: { completed: false, agentId: null, updatedAt: null },
        channel: { completed: false, channelAccountId: null, channelType: null, updatedAt: null },
        knowledge: { completed: false, knowledgeBaseId: null, documentId: null, updatedAt: null },
      },
    })).toBe(1);

    expect(resolveCurrentOnboardingStep({
      steps: {
        agent: { completed: true, agentId: "a1", updatedAt: null },
        channel: { completed: false, channelAccountId: null, channelType: null, updatedAt: null },
        knowledge: { completed: false, knowledgeBaseId: null, documentId: null, updatedAt: null },
      },
    })).toBe(2);

    expect(resolveCurrentOnboardingStep({
      steps: {
        agent: { completed: true, agentId: "a1", updatedAt: null },
        channel: { completed: true, channelAccountId: "c1", channelType: "whatsapp", updatedAt: null },
        knowledge: { completed: false, knowledgeBaseId: null, documentId: null, updatedAt: null },
      },
    })).toBe(3);
  });

  it("keeps onboarding complete after launch when the workspace has a persisted completion flag", () => {
    expect(resolveOnboardingCompletion({
      persistedCompleted: true,
      steps: {
        agent: { completed: true, agentId: "a1", updatedAt: null },
        channel: { completed: false, channelAccountId: "c1", channelType: "whatsapp", updatedAt: null },
        knowledge: { completed: true, knowledgeBaseId: "kb1", documentId: "doc1", updatedAt: null },
      },
      channelRows: [],
    })).toBe(true);
  });

  it("treats a previously connected workspace as already onboarded even after channel disconnect", () => {
    expect(resolveOnboardingCompletion({
      persistedCompleted: false,
      steps: {
        agent: { completed: true, agentId: "a1", updatedAt: null },
        channel: { completed: false, channelAccountId: "c1", channelType: "whatsapp", updatedAt: null },
        knowledge: { completed: true, knowledgeBaseId: "kb1", documentId: "doc1", updatedAt: null },
      },
      channelRows: [
        {
          id: "c1",
          channelType: "whatsapp",
          status: "disabled",
          credentialsSecretRef: "sm://meta-token",
          externalAccountId: null,
          externalBusinessId: null,
          externalPhoneId: null,
          updatedAt: new Date("2026-07-02T00:00:00.000Z"),
        },
      ],
    })).toBe(true);
  });
});
