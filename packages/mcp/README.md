# @agent-video/mcp

An MCP (Model Context Protocol) server over the **same render library** as the CLI
(logic is never forked). Follows the mcp-builder best practices: service-prefixed
tool names, example-rich descriptions, zod input + output schemas, annotations.

Tools: `agent_video_get_schema`, `agent_video_validate_spec`, `agent_video_render`,
`agent_video_preview`, `agent_video_get_video`. Runs over stdio (`agent-video-mcp`).

Part of [agent-video](../../README.md).
