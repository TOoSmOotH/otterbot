# Otterbot API Reference

## REST API

### Public Endpoints

```
# Setup
GET    /api/setup/status               # Check if setup is complete
POST   /api/setup/probe-models          # Probe LLM provider for available models
POST   /api/setup/tts-preview           # Preview a TTS voice
POST   /api/setup/complete              # Complete the setup wizard

# Auth
POST   /api/auth/login                  # Login with passphrase
POST   /api/auth/logout                 # Logout
GET    /api/auth/check                  # Check auth status

# Assets (public)
GET    /api/model-packs                 # List 3D character model packs
GET    /api/environment-packs           # List 3D environment packs
GET    /api/scenes                      # List scene configurations
```

### Protected Endpoints (require authentication)

```
# Registry
GET    /api/registry                    # List all agent templates
GET    /api/registry/:id                # Get a specific template
POST   /api/registry                    # Create a new template
POST   /api/registry/:id/clone          # Clone a template
PATCH  /api/registry/:id                # Update a template
DELETE /api/registry/:id                # Delete a template

# Messages & Agents
GET    /api/messages                    # Message history (?projectId=&agentId=&limit=)
GET    /api/conversations               # List conversations
GET    /api/agents                      # List active agents

# Projects
POST   /api/projects                    # Create a project manually

# Packages
GET    /api/packages                    # List installed packages (apt/npm/repos)
POST   /api/packages                    # Install a package
DELETE /api/packages                    # Uninstall a package

# Todos
GET    /api/todos                       # List all todos
POST   /api/todos                       # Create a todo
PUT    /api/todos/:id                   # Update a todo
DELETE /api/todos/:id                   # Delete a todo

# Custom Tools
GET    /api/tools                       # List custom tools
GET    /api/tools/:id                   # Get a specific tool
GET    /api/tools/available             # List all available tool names
GET    /api/tools/examples              # Get tool examples
POST   /api/tools                       # Create a custom tool
POST   /api/tools/ai-generate           # AI-generate a tool
POST   /api/tools/:id                   # Execute a tool
PATCH  /api/tools/:id                   # Update a custom tool
DELETE /api/tools/:id                   # Delete a custom tool

# Skills
GET    /api/skills                      # List all skills
GET    /api/skills/:id                  # Get a specific skill
GET    /api/skills/:id/export           # Export a skill
POST   /api/skills                      # Create a skill
POST   /api/skills/:id/clone            # Clone a skill
POST   /api/skills/import               # Import a skill
POST   /api/skills/scan                 # Scan for skills
PUT    /api/skills/:id                  # Update a skill
DELETE /api/skills/:id                  # Delete a skill

# Usage Analytics
GET    /api/usage/summary               # Usage summary
GET    /api/usage/recent                # Recent usage
GET    /api/usage/by-model              # Usage by model
GET    /api/usage/by-agent              # Usage by agent

# Scenes & Profile
PUT    /api/scenes/:id                  # Save a scene configuration
GET    /api/profile                     # Get user profile
PUT    /api/profile/model-pack          # Update user 3D model pack

# Desktop
GET    /api/desktop/status              # Desktop environment status

# Google (Calendar & Gmail)
GET    /api/settings/google             # Get Google settings
PUT    /api/settings/google             # Update Google settings
POST   /api/settings/google/oauth/begin # Start OAuth flow
POST   /api/settings/google/disconnect  # Disconnect Google account
GET    /api/calendar/events             # List calendar events
POST   /api/calendar/events             # Create a calendar event
PUT    /api/calendar/events/:id         # Update a calendar event
DELETE /api/calendar/events/:id         # Delete a calendar event
GET    /api/gmail/labels                # List Gmail labels
GET    /api/gmail/messages              # List Gmail messages
GET    /api/gmail/messages/:id          # Read a Gmail message
POST   /api/gmail/send                  # Send an email
POST   /api/gmail/messages/:id/archive  # Archive a message

# Discord
GET    /api/settings/discord                  # Get Discord settings
PUT    /api/settings/discord                  # Update Discord settings
POST   /api/settings/discord/test             # Test Discord connection
POST   /api/settings/discord/pair/approve     # Approve pairing request
POST   /api/settings/discord/pair/reject      # Reject pairing request
DELETE /api/settings/discord/pair/:userId      # Remove a paired user

# Settings — LLM Providers
GET    /api/settings                    # Get provider settings
GET    /api/settings/providers          # List all providers
POST   /api/settings/providers          # Add a provider
PUT    /api/settings/providers/:id      # Update provider config
DELETE /api/settings/providers/:id      # Delete a provider
PUT    /api/settings/defaults           # Update tier defaults (COO/TL/Worker models)
POST   /api/settings/provider/:id/test  # Test a provider connection
GET    /api/settings/models/:id         # Fetch available models from a provider

# Settings — Search
GET    /api/settings/search                    # Get search settings
PUT    /api/settings/search/provider/:id       # Update search provider
PUT    /api/settings/search/active             # Set active search provider
POST   /api/settings/search/provider/:id/test  # Test search provider

# Settings — TTS
GET    /api/settings/tts                       # Get TTS settings
PUT    /api/settings/tts/enabled               # Enable/disable TTS
PUT    /api/settings/tts/active                # Set active TTS provider
PUT    /api/settings/tts/voice                 # Set voice
PUT    /api/settings/tts/speed                 # Set speed
PUT    /api/settings/tts/provider/:id          # Update TTS provider config
POST   /api/settings/tts/provider/:id/test     # Test TTS provider
POST   /api/settings/tts/preview               # Preview voice

# Settings — STT
GET    /api/settings/stt                       # Get STT settings
PUT    /api/settings/stt/enabled               # Enable/disable STT
PUT    /api/settings/stt/active                # Set active STT provider
PUT    /api/settings/stt/language              # Set language
PUT    /api/settings/stt/model                 # Set Whisper model
PUT    /api/settings/stt/provider/:id          # Update STT provider config
POST   /api/settings/stt/provider/:id/test     # Test STT provider

# Settings — Scheduled Tasks
GET    /api/settings/custom-tasks              # List scheduled tasks
POST   /api/settings/custom-tasks              # Create a scheduled task
PUT    /api/settings/custom-tasks/:id          # Update a scheduled task
DELETE /api/settings/custom-tasks/:id          # Delete a scheduled task

# Settings — Model Pricing
GET    /api/settings/pricing                   # Get model pricing config
PUT    /api/settings/pricing/:model            # Update pricing for a model

# Settings — Backup
GET    /api/settings/backup                    # Download database backup
POST   /api/settings/restore                   # Restore from backup

# Modules
GET    /api/modules                            # List installed modules
POST   /api/modules/install                    # Install a module
POST   /api/modules/:id/toggle                 # Enable/disable a module
DELETE /api/modules/:id                        # Remove a module
POST   /api/modules/:moduleId/webhook          # Module webhook endpoint

# Transcription
POST   /api/stt/transcribe                     # Transcribe audio
```

### Updating User Email Settings

Otterbot is a single-user system. To update the user's email configuration (IMAP/SMTP), use the `PUT /api/settings/email` endpoint. After updating, you can verify the connection with `POST /api/settings/email/test`.

#### Authentication

All protected endpoints require a session cookie (`sb_session`) obtained by logging in first:

```bash
# Step 1: Log in and capture the session cookie
curl -k -c cookies.txt -X POST https://localhost:62626/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"passphrase": "your-passphrase"}'
```

#### Update Email Settings

| Detail      | Value                             |
|-------------|-----------------------------------|
| **Method**  | `PUT`                             |
| **URL**     | `/api/settings/email`             |
| **Auth**    | Session cookie (`sb_session`)     |
| **Content** | `application/json`                |

**Request body parameters:**

| Parameter    | Type    | Required | Description                        |
|--------------|---------|----------|------------------------------------|
| `enabled`    | boolean | No       | Enable or disable email integration |
| `imapServer` | string  | No       | IMAP server hostname               |
| `imapPort`   | number  | No       | IMAP server port (e.g. `993`)      |
| `imapTls`    | boolean | No       | Use TLS for IMAP                   |
| `smtpServer` | string  | No       | SMTP server hostname               |
| `smtpPort`   | number  | No       | SMTP server port (e.g. `587`)      |
| `smtpTls`    | boolean | No       | Use TLS for SMTP                   |
| `username`   | string  | No       | Email account username/address     |
| `password`   | string  | No       | Email account password or app password |
| `fromName`   | string  | No       | Display name for outgoing emails   |

**Example — update the email address and IMAP/SMTP settings:**

```bash
curl -k -b cookies.txt -X PUT https://localhost:62626/api/settings/email \
  -H "Content-Type: application/json" \
  -d '{
    "enabled": true,
    "username": "newuser@example.com",
    "password": "app-password-here",
    "imapServer": "imap.example.com",
    "imapPort": 993,
    "imapTls": true,
    "smtpServer": "smtp.example.com",
    "smtpPort": 587,
    "smtpTls": true,
    "fromName": "My Name"
  }'
```

**Response:** Returns the updated email settings object.

#### Test Email Connection

After updating, verify that the IMAP and SMTP connections work:

```bash
curl -k -b cookies.txt -X POST https://localhost:62626/api/settings/email/test
```

**Response:**

```json
{ "imap": "ok", "smtp": "ok" }
```

If a connection fails, the corresponding field will contain an error message instead of `"ok"`.

## Socket.IO Events

### Server to Client

**Agent lifecycle:**
- `agent:spawned` — new agent created
- `agent:status` — agent status change (idle/thinking/acting/done/error)
- `agent:destroyed` — agent removed
- `agent:stream` — streaming token from a worker agent
- `agent:thinking` — extended thinking token from a worker
- `agent:thinking-end` — extended thinking complete for a worker
- `agent:tool-call` — agent invoked a tool
- `agent:move` — agent moved between 3D world zones

**COO:**
- `coo:response` — COO's response to the CEO
- `coo:stream` — streaming token from COO
- `coo:thinking` — extended thinking token (Anthropic models)
- `coo:thinking-end` — extended thinking complete
- `coo:audio` — TTS audio for COO response

**Admin Assistant:**
- `admin-assistant:stream` — streaming token from Admin Assistant
- `admin-assistant:thinking` — extended thinking token
- `admin-assistant:thinking-end` — extended thinking complete

**Bus:**
- `bus:message` — any message on the bus

**Conversations & Projects:**
- `conversation:created` — new conversation started
- `project:created` — new project created
- `project:updated` — project metadata changed
- `project:deleted` — project deleted

**Kanban:**
- `kanban:task-created` — new kanban task
- `kanban:task-updated` — kanban task changed
- `kanban:task-deleted` — kanban task removed

**Todos:**
- `todo:created` — new todo item
- `todo:updated` — todo changed
- `todo:deleted` — todo removed
- `reminder:fired` — todo reminder triggered

**Coding Agents:**
- `codeagent:session-start` — coding agent session started
- `codeagent:session-end` — session ended (includes file diffs)
- `codeagent:event` — generic coding agent event
- `codeagent:message` — message from coding agent
- `codeagent:part-delta` — streaming part delta (text/tool output)
- `codeagent:awaiting-input` — coding agent waiting for user input
- `codeagent:permission-request` — coding agent requesting tool permission

**Terminals:**
- `terminal:data` — terminal output data
- `terminal:replay` — terminal replay buffer (on subscribe)

**3D World:**
- `world:zone-added` — new zone added to 3D scene
- `world:zone-removed` — zone removed from 3D scene

**Discord:**
- `discord:pairing-request` — Discord user requesting to pair
- `discord:status` — Discord bot connection status

### Client to Server

**Chat:**
- `ceo:message` — send a message to the COO
- `ceo:new-chat` — start a new conversation
- `ceo:list-conversations` — request conversation list
- `ceo:load-conversation` — load a specific conversation

**Projects:**
- `project:list` — list all projects
- `project:get` — get a single project
- `project:enter` — enter a project (returns conversations + kanban tasks)
- `project:delete` — delete a project
- `project:recover` — recover a deleted project
- `project:conversations` — list conversations for a project
- `project:create-manual` — create a project manually (with GitHub repo, issue monitoring, etc.)
- `project:get-agent-assignments` — get agent type assignments for a project
- `project:set-agent-assignments` — set agent type assignments for a project

**Agents:**
- `registry:list` — request registry entries
- `agent:inspect` — request details about a specific agent
- `agent:activity` — get messages and activity for an agent
- `agent:stop` — stop a running agent

**Coding Agents:**
- `codeagent:respond` — send input to a coding agent session
- `codeagent:permission-respond` — respond to a permission request (once/always/reject)

**Terminals:**
- `terminal:input` — send input to a PTY terminal
- `terminal:resize` — resize a terminal
- `terminal:subscribe` — subscribe to terminal output
- `terminal:end` — end a terminal session

**Soul Documents:**
- `soul:list` — list all soul documents
- `soul:get` — get a soul document by role
- `soul:save` — create or update a soul document
- `soul:delete` — delete a soul document
- `soul:suggest` — get AI-generated soul document suggestions

**Memory:**
- `memory:list` — list memories (with optional filters)
- `memory:save` — save a memory
- `memory:delete` — delete a memory
- `memory:search` — semantic search over memories
