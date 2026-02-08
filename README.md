# Recipe Search MCP Server

An MCP (Model Context Protocol) server that enables Claude to search a recipe database using semantic vector search.

## How It Works

1. Receives a search query from Claude (e.g. "spicy Asian noodles")
2. Converts the query to a 768-dimensional embedding using Google Gemini (`gemini-embedding-001`)
3. Searches a Supabase PostgreSQL database using pgvector cosine similarity
4. Returns formatted recipe results back to Claude

## Setup

### Prerequisites

- Node.js
- A [Google AI API key](https://makersuite.google.com/app/apikey)
- A [Supabase](https://supabase.com) project with pgvector enabled and a `search_recipes` RPC function

### Installation

```bash
npm install
```

### Configuration

Create a `.env` file:

```
GOOGLE_AI_API_KEY=your_google_ai_api_key
SUPABASE_URL=your_supabase_project_url
SUPABASE_KEY=your_supabase_api_key
```

### Claude Desktop Configuration

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "recipe-search": {
      "command": "node",
      "args": ["/path/to/recipe-mcp-server/index.js"],
      "env": {
        "GOOGLE_AI_API_KEY": "your_key",
        "SUPABASE_URL": "your_url",
        "SUPABASE_KEY": "your_key"
      }
    }
  }
}
```

## Vercel Deployment

You can deploy this server to Vercel so it's accessible over HTTP using the Streamable HTTP transport.

### Deploy

1. Install the [Vercel CLI](https://vercel.com/docs/cli) and log in:
   ```bash
   npm i -g vercel
   vercel login
   ```

2. Set environment variables on Vercel:
   ```bash
   vercel env add GOOGLE_AI_API_KEY
   vercel env add SUPABASE_URL
   vercel env add SUPABASE_KEY
   ```

3. Deploy:
   ```bash
   vercel --prod
   ```

### Connecting to the Deployed Server

Use any MCP client that supports Streamable HTTP transport and point it at:

```
https://<your-app>.vercel.app/mcp
```

For example, in Claude Desktop's `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "recipe-search": {
      "type": "streamable-http",
      "url": "https://<your-app>.vercel.app/mcp"
    }
  }
}
```

## Tool

### `search_recipes`

Search for recipes using semantic similarity.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `query` | string | Yes | Search query (ingredients, dish names, cuisines, cooking methods, or descriptive phrases) |
| `match_threshold` | number | No | Minimum similarity score (-1 to 1). Default: -0.1 |
| `match_count` | number | No | Max results to return (1-50). Default: 10 |

## Recipe Fields Returned

Each result includes: dish name, similarity score, cuisine/style, summary, main ingredients, secondary ingredients, cooking techniques, and video URL.
