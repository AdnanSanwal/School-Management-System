# AI

AI is used by the test maker to write a paper from a topic. A school can connect its own AI
account, and the platform admin can provide AI to chosen schools with limits.
Code: `backend/src/modules/ai`.

## Providers

| Provider | Default model | Where to get a key |
|---|---|---|
| Anthropic (Claude) | `claude-opus-5-5` | platform.claude.com/settings/keys |
| OpenAI (ChatGPT) | `gpt-5` | platform.openai.com/api-keys |
| Google (Gemini) | `gemini-2.5-flash` | aistudio.google.com/apikey |
| xAI (Grok) | `grok-4` | console.x.ai |

The model name can always be changed. Providers rename and retire models; if a connection
test fails with "does not know this model name", enter the provider's current name.

## A school's own account

Settings, AI (owner and admin). Choose the provider, paste the API key, optionally a model,
and Save. "Test the connection" sends one tiny request. The school pays its provider
directly, so platform limits do not apply. When a school has its own key saved, it is used
before anything the platform provides.

## AI provided by the platform

AI for schools (super admin only).

- **Platform keys.** One key per provider, billed to the platform. For Anthropic, an
  `ANTHROPIC_API_KEY` in the server environment is used when no key is saved here.
- **Per school.** Switch AI on, choose the provider and model, and set:
  - **Daily limit** and **monthly limit**: the most AI-written papers the school may draft
    on the platform's account. Empty means no limit; 0 means none. Days and months are
    counted in UTC; the monthly allowance starts again on the 1st.
  - **A key just for this school** (optional): bills that school's use to a separate key.
  - **Let this school use its own AI key**: switch off to make the school use only what the
    platform provides (or nothing).
- The table shows each school's use today and this month, and marks schools that have
  reached their monthly limit. The school sees what it has left on its own AI screen.

A draft takes its place in the allowance when it starts, so several drafts started at once
cannot pass a limit together. If the AI fails or returns nothing usable, the place is given
back. A draft left unfinished by a server crash stops counting after 10 minutes.

An AI request, retries included, is given up after 4.5 minutes, before the web app stops
waiting at 5, so a teacher is never shown an error for a draft that was in fact made.

## Keys and privacy

- Keys are stored encrypted with `AES_SECRET_KEY` and never sent back to a browser; screens
  show the last four characters. Changing `AES_SECRET_KEY` makes saved keys unreadable:
  they have to be entered again.
- What is sent to the provider: class name, subject name, kind of test, board, topic and the
  teacher's instructions. Nothing about pupils, staff or the school.
- Every change to keys and grants is written to the activity log.
