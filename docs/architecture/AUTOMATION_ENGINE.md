# Automation Engine

Phase 3 introduces an event-driven automation engine without changing existing business flows.

## Event Flow

The API server publishes rows into `domain_events` when key workspace actions happen:

- `message.received`
- `conversation.opened`
- `contact.tag.added`
- `order.created`
- `payment.confirmed`

The outbox worker polls `domain_events` every 3 seconds, claims pending rows with `FOR UPDATE SKIP LOCKED`, and evaluates active automations whose trigger type matches the event.

## Conditions And Actions

Conditions are evaluated against the event payload using simple path lookup such as `contactId` or `order.total`.

Supported actions in Phase 3:

- `send.template`: queues a WhatsApp template outbox event. It does not send directly from the engine.
- `add.tag`: appends a contact tag when it is not already present.
- `assign.conversation`: assigns a conversation to a membership or team.
- `create.task`: creates a task linked to the event contact/conversation when available.
- `create.followup`: creates a follow-up linked to the event contact/conversation when available.

## Retry Policy

Failed domain events are retried with exponential backoff using `next_attempt_at`.
After 5 attempts the event is marked `failed` and an audit log entry is written.

## Extension Rules

New triggers should be published through `publishDomainEvent` in the API server.
New actions should be implemented in `automation-engine.ts` and must remain workspace-scoped.
Provider calls must continue to go through outbox events, not directly through the automation engine.
