#!/usr/bin/env bun

import { startProxyServer } from "../src/proxy/server"

const port = parseInt(process.env.CLAUDE_PROXY_PORT || "3456", 10)
const host = process.env.CLAUDE_PROXY_HOST || "127.0.0.1"

await startProxyServer({ port, host })
