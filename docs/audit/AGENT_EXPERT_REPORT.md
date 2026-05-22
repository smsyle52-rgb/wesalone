# Agent Expert Closure Report

## Summary
Closure Phase 2 changed the Wesal One agent from a generic draft writer into a safer, context-rich service assistant. The model is not fine-tuned. Learning is implemented through controlled runtime context injection so behavior stays predictable, auditable, and affordable.

## Commits
- `9703de7` feat(agent): channel-aware response behavior
- `87d6ede` feat(agent): sector behavior profiles -- knowledge + how-to-serve
- `9d26981` feat(agent): safe escalation -- one clarifying question then handoff
- `8a73472` feat(agent): safe learning with review gate for sensitive topics
- `2c4a030` feat(location): Yemeni governorates handling without maps API
- `f99ebb6` feat(agent): image understanding + voice note transcription

## Agent Context Stack
The draft-reply flow assembles context in this order:

1. Sector base knowledge
2. Sector behavior profile
3. Sector service goals
4. Merchant knowledge base
5. Catalog products
6. Active ads
7. Recent posts
8. Conversation memory
9. Learned answers
10. Channel tone
11. Location context
12. Media context for images and voice notes
13. Escalation and guardrail rules

## Locked Red Lines
The agent still must never:

- Confirm a payment.
- Execute a financial transaction.
- Delete or modify business data.
- Invent a price, discount, guarantee, policy, or promise.
- Promise anything outside available knowledge.

## Channel Awareness
The prompt now includes the active channel and response guidance:

- WhatsApp: conversational, personal, can be slightly longer.
- Instagram: shorter, friendly, emoji-tolerant.
- Messenger: concise and helpful.

Agents can override tone per channel through `channel_tone`.

## Sector Behavior Profiles
The new `sector_profiles` table defines both knowledge and behavior. Seeded sectors:

- متجر بيع
- عيادات ومواعيد
- مطاعم وأغذية
- عطور وهدايا
- ملابس وأقمشة
- خدمات عامة

The merchant can select a sector in onboarding and can adjust service behavior from the agent detail page under "أسلوب الخدمة".

## Safe Escalation
When knowledge confidence is weak:

- First unclear turn: the agent asks one clarifying question.
- Second unclear turn: the agent produces a polite holding reply, marks the conversation as needing human intervention, creates a task, and logs `auto_reply_decisions.reason = 'knowledge_gap'`.

Inbox conversations needing review show the badge "يحتاج تدخل".

## Safe Learning
Learning is context injection only:

- Positive AI feedback and resolved conversations can produce `learned_answers`.
- Simple topics can become active automatically.
- Sensitive topics are held as `pending_review`.
- Draft replies only inject active learned answers, limited to three examples.

Merchant review is available from the agent detail page under "ما تعلّمه الوكيل".

## Location Context
No Google Maps API is used. The onboarding flow stores Yemeni governorate and optional district in workspace settings. Contact location notes can be captured from Meta location messages. If the customer asks about delivery and their area is unknown, the agent asks for the area first instead of guessing.

## Vision And Voice
Inbound Meta media references are stored in `messages.attachments`.

- Images: the agent receives media context and can ask a focused clarification when details are unavailable.
- Voice notes: the agent receives voice-note context and falls back politely if transcription is unavailable.
- DRY_RUN: external media downloads and transcription are skipped, while context still notes "صورة مستلمة" or "رسالة صوتية مستلمة".
- Live mode: media references are preserved so runtime media processing can use Meta media and Google Speech-to-Text credentials without blocking the conversation.

Media failure never blocks the flow.

## DRY_RUN vs Live
DRY_RUN remains safe:

- No Meta media download is required.
- No Speech-to-Text call is required.
- Mock AI still receives a clear media context block.
- Draft replies remain suggestions unless trust gates allow otherwise.

Live mode uses configured credentials and preserves the same fallback rules if any media processing fails.

## Deferred
- Voice replies / text-to-speech.
- WhatsApp calls.
- Map SDK or Google Maps integration.
- Model fine-tuning.

## Verification
- `corepack pnpm -r typecheck`: PASS
- `corepack pnpm run build:prod`: PASS
