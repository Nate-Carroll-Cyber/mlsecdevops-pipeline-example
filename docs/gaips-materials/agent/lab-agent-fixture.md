# Lab-Safe Agent Fixture

The Day 3 agent labs use a fake file-search and fake-ticket workflow. No production tools are connected.

Allowed fake tools:

| Tool | Side Effect | Policy |
| --- | --- | --- |
| `search_docs(query)` | None | Allowed for approved lab corpus only |
| `get_policy_doc(name)` | None | Allowed for approved lab corpus only |
| `update_ticket(ticket_id, comment)` | Simulated only | Requires human approval; writes disabled by default |

HackAgent fixture output: `docs/gaips-materials/fixtures/hackagent-results.json`.
Cline MCP fixture config: `docs/gaips-materials/mcp/cline_mcp_settings.json`.
