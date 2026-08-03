#!/usr/bin/env node
/**
 * Test script to demonstrate the Vapi MCP server capabilities.
 * Sends JSON-RPC messages over stdio to list available tools.
 */
import { spawn } from "child_process";
import { setTimeout as delay } from "timers/promises";

const serverPath = "d:\\ARCHstudio\\mcp-servers\\vapi-mcp-server\\repo\\dist\\index.js";

const child = spawn("node", [serverPath], {
    stdio: ["pipe", "pipe", "pipe"],
});

let buffer = "";
const messages = [];

child.stdout.on("data", (data) => {
    buffer += data.toString();
    // Parse JSON-RPC messages (newline-delimited or content-length prefixed)
    let lines = buffer.split("\n");
    buffer = lines.pop(); // Keep incomplete line in buffer
    for (const line of lines) {
        if (line.trim()) {
            try {
                const msg = JSON.parse(line.trim());
                messages.push(msg);
            } catch {
                // Might be content-length header or other output
                if (line.includes("Content-Length:")) {
                    // Content-Length based framing - try to parse the body
                    continue;
                }
            }
        }
    }
});

child.stderr.on("data", (data) => {
    // Log stderr for debugging
    process.stderr.write(`[server stderr] ${data.toString()}`);
});

// Also try to read content-length framed messages
let fullBuffer = "";
child.stdout.on("data", (data) => {
    fullBuffer += data.toString();
    // Try to parse content-length framed messages
    while (true) {
        const headerEnd = fullBuffer.indexOf("\r\n\r\n");
        if (headerEnd === -1) break;
        const header = fullBuffer.substring(0, headerEnd);
        const match = header.match(/Content-Length:\s*(\d+)/i);
        if (!match) break;
        const contentLength = parseInt(match[1]);
        const bodyStart = headerEnd + 4;
        if (fullBuffer.length < bodyStart + contentLength) break;
        const body = fullBuffer.substring(bodyStart, bodyStart + contentLength);
        fullBuffer = fullBuffer.substring(bodyStart + contentLength);
        try {
            const msg = JSON.parse(body);
            // Only add if not already in messages (avoid duplicates)
            const exists = messages.some(m => m.id === msg.id);
            if (!exists) {
                messages.push(msg);
            }
        } catch (e) {
            // Ignore parse errors
        }
    }
});

function sendMessage(msg) {
    const json = JSON.stringify(msg);
    const frame = `Content-Length: ${Buffer.byteLength(json)}\r\n\r\n${json}`;
    child.stdin.write(frame);
}

async function waitForMessage(id, timeoutMs = 10000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        const found = messages.find(m => m.id === id);
        if (found) return found;
        await delay(100);
    }
    return null;
}

async function main() {
    console.log("=== Vapi MCP Server Test ===\n");
    console.log("Starting MCP server...");

    // Wait for server to start
    await delay(1000);

    // Step 1: Send initialize request
    console.log("\n--- Step 1: Initialize ---");
    const initRequest = {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
            protocolVersion: "2024-11-05",
            capabilities: {},
            clientInfo: {
                name: "test-client",
                version: "1.0.0",
            },
        },
    };
    console.log("Sending initialize request...");
    sendMessage(initRequest);

    const initResponse = await waitForMessage(1);
    if (initResponse) {
        console.log("Initialize response received:");
        console.log(JSON.stringify(initResponse, null, 2));
    } else {
        console.log("No initialize response received (timeout)");
    }

    // Step 2: Send initialized notification
    console.log("\n--- Step 2: Initialized Notification ---");
    const initializedNotification = {
        jsonrpc: "2.0",
        method: "notifications/initialized",
    };
    sendMessage(initializedNotification);
    console.log("Initialized notification sent.");

    await delay(500);

    // Step 3: List available tools
    console.log("\n--- Step 3: List Tools ---");
    const listToolsRequest = {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/list",
        params: {},
    };
    console.log("Sending tools/list request...");
    sendMessage(listToolsRequest);

    const toolsResponse = await waitForMessage(2);
    if (toolsResponse) {
        console.log("Tools list received:");
        if (toolsResponse.result && toolsResponse.result.tools) {
            console.log(`\nFound ${toolsResponse.result.tools.length} tools:\n`);
            for (const tool of toolsResponse.result.tools) {
                console.log(`  • ${tool.name}`);
                if (tool.description) {
                    console.log(`    ${tool.description}`);
                }
                console.log();
            }
        } else {
            console.log(JSON.stringify(toolsResponse, null, 2));
        }
    } else {
        console.log("No tools/list response received (timeout)");
    }

    // Step 4: Try calling vapi_list_assistants (may require auth)
    console.log("\n--- Step 4: Call vapi_list_assistants ---");
    const callToolRequest = {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: {
            name: "vapi_list_assistants",
            arguments: {},
        },
    };
    console.log("Sending tools/call request for vapi_list_assistants...");
    sendMessage(callToolRequest);

    const callResponse = await waitForMessage(3);
    if (callResponse) {
        console.log("Tool call response received:");
        console.log(JSON.stringify(callResponse, null, 2));
    } else {
        console.log("No tool call response received (timeout)");
    }

    // Clean up
    console.log("\n--- Done ---");
    child.kill();
    process.exit(0);
}

main().catch((err) => {
    console.error("Error:", err);
    child.kill();
    process.exit(1);
});