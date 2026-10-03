# src/components/inbox

Read `/AGENTS.md` first.

Thread list plus operator chat. Suggested chips should stay askable against listing data. The agent is always presented as the operator's front desk, not as a generic chatbot.

Every thread here is the operator's agent, so the tab sits behind `GUEST_AGENT` (`src/lib/flags.ts`): off, it lists and counts nothing, `openChat` opens nothing, and the empty state does not promise a chat.
