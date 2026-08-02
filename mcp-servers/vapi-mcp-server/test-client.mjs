#!/usr/bin/env node
/**
 * Test script using the MCP SDK client to connect to the Vapi MCP server.
 * This properly handles the JSON-RPC framing over stdio.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const serverPath = "d:\\ARCHstudio\\mcp-servers\\vapi-mcp-server\\repo\\dist\\index.js";

async function main() {
    console.log("=== Vapi MCP Server Test (SDK Client) ===\n");

    // Create a stdio client transport that spawns the server
    const transport = new StdioClientTransport({
        command: "node",
        args: [serverPath],
    });

    // Create the MCP client
    const client = new Client(
        {
            name: "test-client",
            version: "1.0.0",
        },
        {
            capabilities: {},
        }
    );

    try {
        // Connect to the server
        console.log("Connecting to Vapi MCP server...");
        await client.connect(transport);
        console.log("Connected!\n");

        // List available tools
        console.log("--- Listing Available Tools ---");
        const toolsResult = await client.listTools();
        console.log(`Found ${toolsResult.tools.length} tools:\n`);
        for (const tool of toolsResult.tools) {
            console.log(`  • ${tool.name}`);
            if (tool.description) {
                console.log(`    ${tool.description}`);
            }
            console.log();
        }

        // Try calling list_assistants (may require auth)
        console.log("--- Calling list_assistants ---");
        try {
            const result = await client.callTool({
                name: "list_assistants",
                arguments: {},
            });
            console.log("Tool call result:");
            console.log(JSON.stringify(result, null, 2));
        } catch (toolError) {
            console.log("Tool call error (expected if not authenticated):");
            console.log(toolError.message || toolError);
        }

        // Try calling vapi_login to show the auth flow
        console.log("\n--- Calling vapi_login ---");
        try {
            const loginResult = await client.callTool({
                name: "vapi_login",
                arguments: {},
            });
            console.log("Login tool result:");
            console.log(JSON.stringify(loginResult, null, 2));
        } catch (loginError) {
            console.log("Login tool error (expected on Windows - 'start' command issue):");
            console.log(loginError.message || loginError);
        }

        console.log("\n--- Test Complete ---");
    } catch (err) {
        console.error("Error:", err.message || err);
    } finally {
        await client.close();
        process.exit(0);
    }
}

main().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
});