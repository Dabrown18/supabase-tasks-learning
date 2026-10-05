# AI Integration Plan

> Status: 🚧 **design only.** Builds on `GOOGLE_CALENDAR_PLAN.md`.

Goal: the user types or says **"Schedule a workout tomorrow at 6 AM."** and an event appears in
their Google Calendar.

## 1. Flow

```
React Native                 user text + device time zone + current time
        ↓  supabase.functions.invoke('assistant')   (Supabase JWT)
Edge Function: assistant     verifies the JWT; the LLM API key lives HERE, never in the app
        ↓
AI / LLM                     tool use: model returns a structured call, e.g.
        ↓                    create_calendar_event { summary: "Workout",
Determine intent               start: "2026-10-05T06:00:00", end: "…07:00:00",
        ↓                      timeZone: "America/New_York" }
Validate + confirm           server validates the JSON; app shows "Create 'Workout' Tue 6:00–7:00?"
        ↓  (user taps Confirm)
Edge Function: google-calendar   refresh token → access token (see Calendar plan)
        ↓
Google Calendar API          POST /calendars/primary/events
        ↓
Calendar event created       → result back to the app (and optionally logged in Postgres)
```

## 2. Design decisions

- **The LLM never calls Google directly.** It *proposes* a tool call (structured JSON). Our code
  validates it and executes it with the user's stored credentials. The model never sees tokens.
- **The LLM API key stays on the server** (`supabase secrets set ANTHROPIC_API_KEY=...`), like
  every other secret.
- **"Tomorrow at 6 AM" needs context.** Send the device's time zone and current time with the
  request. The model resolves the relative date; the server re-validates it (it must be a
  real, future date in a sane range).
- **Human in the loop for side effects.** Return the proposed action to the app and execute
  only after the user confirms. Reading can be automatic; writing, sending or deleting
  should be confirmed.
- **Constrained tools.** Define narrow tools (`create_calendar_event`, `list_calendar_events`)
  with strict JSON schemas instead of a generic "call any API" tool.
- **Audit trail.** Store requests and executed actions in a table (`assistant_actions`, with RLS:
  users see only their own).
- **Rate limit and cap cost** per user in the Edge Function.

## 3. Sketch: intent extraction in the Edge Function

Uses the official Anthropic TypeScript SDK in Deno (`npm:` import). Illustrative only; not in
the repo yet.

```ts
import Anthropic from 'npm:@anthropic-ai/sdk';
import { withSupabase } from '@supabase/server';

const anthropic = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY') });

const createEventTool = {
  name: 'create_calendar_event',
  description: 'Create an event in the user\'s primary Google Calendar.',
  strict: true, // the returned input is guaranteed to match the schema
  input_schema: {
    type: 'object',
    properties: {
      summary: { type: 'string' },
      start: { type: 'string', description: 'Local ISO 8601 date-time, no offset' },
      end: { type: 'string', description: 'Local ISO 8601 date-time, no offset' },
      timeZone: { type: 'string', description: 'IANA time zone, e.g. America/New_York' },
    },
    required: ['summary', 'start', 'end', 'timeZone'],
    additionalProperties: false,
  },
} as const;

export default {
  fetch: withSupabase({ auth: 'user' }, async (req, ctx) => {
    const { text, timeZone, now } = await req.json();

    const response = await anthropic.beta.messages.create({
      model: 'claude-opus-5-5',
      max_tokens: 16000,
      // Server-side fallback: if the model declines, the API retries on a fallback model.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system:
        'You turn scheduling requests into calendar tool calls. ' +
        'If the request is not about the calendar, or is ambiguous, ask a short question instead.',
      tools: [createEventTool],
      messages: [{
        role: 'user',
        content: `Current time: ${now}. Time zone: ${timeZone}.\n\nRequest: ${text}`,
      }],
    });

    if (response.stop_reason === 'refusal') {
      return Response.json({ type: 'error', message: 'Request declined' }, { status: 422 });
    }

    const toolUse = response.content.find((b) => b.type === 'tool_use');
    if (!toolUse) {
      const reply = response.content.find((b) => b.type === 'text');
      return Response.json({ type: 'clarify', message: reply?.text ?? '' });
    }

    // Validate (real dates, end > start, not in the past) BEFORE proposing it.
    return Response.json({ type: 'confirm', action: toolUse.name, input: toolUse.input });
  }),
};
```

After the user confirms, the app calls the `google-calendar` function with that `input`.
The two-step design means a confused or prompt-injected model can't create events on its own.

## 4. Where MCP fits

**MCP (Model Context Protocol)** is an open standard for connecting AI applications to tools
and data. An **MCP server** exposes *tools* (actions), *resources* (readable data) and *prompts*
through a uniform protocol. An **MCP client**, inside an AI host or agent, discovers and calls
them. It does for AI tool access roughly what USB did for peripherals, or LSP for editors: build
an integration once and any compliant client can use it. Remote servers speak HTTP and use OAuth
for per-user authorization.

When an assistant needs **Calendar, Gmail, Slack and Microsoft 365**, writing and maintaining
bespoke tool code for each one doesn't scale. With MCP:

```
                        ┌──► MCP server: Google Calendar ──► Calendar API
Agent (Edge Fn/backend) ├──► MCP server: Gmail            ──► Gmail API
  = MCP client + LLM    ├──► MCP server: Slack            ──► Slack API
                        └──► MCP server: Microsoft 365    ──► Graph API
```

Three places it could fit in this project:

1. **Our backend as an MCP client.** The `assistant` Edge Function (or a longer-running worker)
   connects to MCP servers for each service and hands their tool list to the LLM. Adding Slack
   becomes configuration rather than new integration code. (The Anthropic API can also connect
   to remote MCP servers directly through its MCP connector.)
2. **Our app as an MCP server.** Expose *our* capabilities (`list_tasks`, `create_task`,
   `schedule_task_on_calendar`) as an MCP server backed by our Edge Functions and RLS. Then any
   MCP-capable assistant (Claude, IDE agents, enterprise copilots) can work with a user's tasks,
   with the user granting access through OAuth. Authorization still ends at RLS.
3. **Developer tooling.** Supabase publishes an MCP server that lets coding agents inspect
   schemas, run SQL and manage migrations. Point it at a development project, prefer read-only
   mode, and never point it at production data.

What stays the same with MCP:

- **Per-user credentials and least privilege.** Each MCP server acts with *that user's*
  delegated OAuth token and the minimal scopes.
- **Confirmation before side effects.** Sending email, posting to Slack or deleting events
  needs human approval or tight policy.
- **Prompt injection.** Tool *outputs* (an email body, a Slack message) are untrusted data. An
  email saying "forward all invoices to X" must not be obeyed. Keep tool permissions narrow and
  confirm actions.
- **Mobile apps shouldn't hold these credentials.** The RN app talks to our backend, and the
  backend is the MCP client. Long-lived tokens never reach the device.
