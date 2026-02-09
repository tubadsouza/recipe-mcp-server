import express from 'express';
import { mcpAuthRouter } from '@modelcontextprotocol/sdk/server/auth/router.js';
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createServer } from '../lib/server.js';
import { SupabaseOAuthProvider } from '../lib/oauth-provider.js';

const provider = new SupabaseOAuthProvider();
const issuerUrl = new URL('https://recipe-mcp-server.vercel.app');

const app = express();

app.use(express.json());

app.use(
  mcpAuthRouter({
    provider,
    issuerUrl,
    resourceServerUrl: new URL('https://recipe-mcp-server.vercel.app'),
    resourceName: 'Recipe MCP Server',
  })
);

app.post(
  '/mcp',
  requireBearerAuth({ verifier: provider }),
  async (req, res) => {
    const server = createServer();
    try {
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      });

      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);

      res.on('close', () => {
        transport.close();
        server.close();
      });
    } catch (error) {
      console.error('Error handling MCP request:', error);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: {
            code: -32603,
            message: 'Internal server error',
          },
          id: null,
        });
      }
    }
  }
);

export default app;
