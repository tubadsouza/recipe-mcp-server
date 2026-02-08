#!/usr/bin/env node

/**
 * Recipe Search MCP Server
 *
 * This server allows Claude Desktop to search a recipe database using semantic
 * vector search. It works by:
 * 1. Receiving a search query from Claude
 * 2. Converting the query to a 768-dimensional embedding using Google Gemini
 * 3. Searching Supabase using vector similarity (pgvector)
 * 4. Returning formatted results back to Claude
 *
 * MCP (Model Context Protocol) is Anthropic's standard for connecting AI
 * assistants to external tools and data sources.
 */

// ============================================================================
// IMPORTS
// ============================================================================

// Load environment variables from .env file FIRST, before anything else
// This makes process.env.VARIABLE_NAME available throughout the code
import dotenv from 'dotenv';
dotenv.config();

// MCP SDK imports for building the server
// - McpServer: The main class that handles tool registration and requests
// - StdioServerTransport: Allows communication via stdin/stdout (how Claude Desktop talks to us)
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

// Supabase client for database operations
// This is the official JavaScript client for Supabase
import { createClient } from '@supabase/supabase-js';

// Zod is used by MCP SDK for schema validation
// It ensures the tool receives the correct parameter types
import { z } from 'zod';

// ============================================================================
// CONFIGURATION
// ============================================================================

// Read API keys and URLs from environment variables
// These are loaded from the .env file by dotenv
const GOOGLE_AI_API_KEY = process.env.GOOGLE_AI_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

// Validate that all required environment variables are set
// This prevents cryptic errors later if something is missing
if (!GOOGLE_AI_API_KEY || !SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing required environment variables!');
  console.error('Please ensure .env file contains:');
  console.error('  - GOOGLE_AI_API_KEY');
  console.error('  - SUPABASE_URL');
  console.error('  - SUPABASE_KEY');
  process.exit(1); // Exit with error code
}

// ============================================================================
// INITIALIZE CLIENTS
// ============================================================================

// Create Supabase client for database operations
// This client is used to call our search_recipes RPC function
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Generate an embedding vector for a text query using Google Gemini.
 *
 * Embeddings are numerical representations of text that capture semantic meaning.
 * Similar texts will have similar embedding vectors, which allows us to do
 * "semantic search" - finding recipes that match the meaning of a query,
 * not just exact keyword matches.
 *
 * @param {string} text - The text to convert to an embedding
 * @returns {Promise<number[]>} - A 768-dimensional array of numbers
 */
async function generateEmbedding(text) {
  // Construct the API URL with the API key as a query parameter
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=${GOOGLE_AI_API_KEY}`;

  // Make the API request to Google's embedding service
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      // Match exact format used for database embeddings
      content: {
        parts: [{ text: text }]
      },
      output_dimensionality: 768
    })
  });

  // Check if the request was successful
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to generate embedding: ${response.status} - ${errorText}`);
  }

  // Parse the JSON response
  const data = await response.json();

  // The embedding values are nested in the response structure
  // Returns an array of 768 floating-point numbers
  return data.embedding.values;
}

/**
 * Search for recipes in Supabase using vector similarity.
 *
 * This calls a PostgreSQL function (search_recipes) that uses pgvector's
 * cosine similarity to find recipes with embeddings similar to our query.
 *
 * @param {number[]} queryEmbedding - The 768-dimensional embedding of the search query
 * @param {number} matchThreshold - Minimum similarity score (0-1), default 0.5
 * @param {number} matchCount - Maximum number of results to return, default 10
 * @returns {Promise<Array>} - Array of recipe objects with similarity scores
 */
async function searchRecipes(queryEmbedding, matchThreshold = -0.1, matchCount = 10) {
  // Call the Supabase RPC (Remote Procedure Call) function
  // This executes the search_recipes function we created in PostgreSQL
  // Convert embedding array to pgvector string format: '[0.1,0.2,...]'
  const embeddingString = `[${queryEmbedding.join(',')}]`;

  console.error(`Embedding string length: ${embeddingString.length}`);
  console.error(`Embedding preview: ${embeddingString.substring(0, 100)}...`);

  const { data, error } = await supabase.rpc('search_recipes', {
    query_embedding: embeddingString,    // Our query as a vector string
    match_threshold: matchThreshold,     // Minimum similarity (0.5 = 50% similar)
    match_count: matchCount              // How many results to return
  });

  console.error(`Supabase response - data: ${JSON.stringify(data)}, error: ${JSON.stringify(error)}`);

  // If Supabase returns an error, throw it so we can handle it
  if (error) {
    throw new Error(`Supabase search error: ${error.message}`);
  }

  // Return the results (array of recipe objects)
  return data || [];
}

/**
 * Format recipe results into a readable string for Claude.
 *
 * This takes the raw database results and creates a nicely formatted
 * text output that Claude can present to the user.
 *
 * @param {Array} recipes - Array of recipe objects from the database
 * @returns {string} - Formatted text representation of the recipes
 */
function formatRecipeResults(recipes) {
  // Handle the case where no recipes were found
  if (!recipes || recipes.length === 0) {
    return 'No recipes found matching your search criteria.';
  }

  // Build the output string piece by piece
  let output = `Found ${recipes.length} recipe(s):\n\n`;

  // Loop through each recipe and format its details
  recipes.forEach((recipe, index) => {
    // Convert similarity (0-1) to percentage for readability
    // toFixed(1) rounds to 1 decimal place
    const similarityPercent = (recipe.similarity * 100).toFixed(1);

    // Add the recipe header with number, name, and match score
    output += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    output += `📖 Recipe ${index + 1}: ${recipe.dish_name}\n`;
    output += `   Match: ${similarityPercent}%\n`;
    output += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

    // Add cuisine/style if available
    if (recipe.cuisine_or_style) {
      output += `🌍 Cuisine/Style: ${recipe.cuisine_or_style}\n\n`;
    }

    // Add summary if available
    if (recipe.summary) {
      output += `📝 Summary:\n${recipe.summary}\n\n`;
    }

    // Format main ingredients
    // main_ingredients is a JSONB array of {name, evidence} objects
    if (recipe.main_ingredients && recipe.main_ingredients.length > 0) {
      output += `🥘 Main Ingredients:\n`;
      recipe.main_ingredients.forEach(ing => {
        // Show the ingredient name, and optionally the evidence
        output += `   • ${ing.name}`;
        if (ing.evidence) {
          output += ` (${ing.evidence})`;
        }
        output += '\n';
      });
      output += '\n';
    }

    // Format secondary ingredients
    if (recipe.secondary_ingredients && recipe.secondary_ingredients.length > 0) {
      output += `🧂 Secondary Ingredients:\n`;
      recipe.secondary_ingredients.forEach(ing => {
        output += `   • ${ing.name}`;
        if (ing.evidence) {
          output += ` (${ing.evidence})`;
        }
        output += '\n';
      });
      output += '\n';
    }

    // Format cooking techniques
    // techniques is a PostgreSQL text[] array
    if (recipe.techniques && recipe.techniques.length > 0) {
      output += `👨‍🍳 Techniques: ${recipe.techniques.join(', ')}\n\n`;
    }

    // Add video link if available
    if (recipe.video_url) {
      output += `🎬 Video: ${recipe.video_url}\n\n`;
    }
  });

  return output;
}

// ============================================================================
// MCP SERVER SETUP
// ============================================================================

/**
 * Create and configure the MCP server.
 *
 * The MCP server is the main entry point that Claude Desktop communicates with.
 * We register "tools" that Claude can call, similar to function calling.
 */
const server = new McpServer({
  name: 'recipe-search',        // Identifier for this server
  version: '1.0.0',             // Version number
});

// ============================================================================
// REGISTER THE SEARCH_RECIPES TOOL
// ============================================================================

/**
 * Register the search_recipes tool with the MCP server.
 *
 * This is the main tool that Claude will call when users want to search recipes.
 * We define:
 * - The tool name
 * - A description (helps Claude understand when to use it)
 * - Input parameters with types and descriptions
 * - The handler function that executes when the tool is called
 */
server.tool(
  // Tool name - this is what Claude uses to call the tool
  'search_recipes',

  // Description - helps Claude understand what this tool does
  'Search for recipes using semantic similarity. The search understands meaning, ' +
  'so you can search for things like "quick weeknight dinner" or "spicy Asian noodles" ' +
  'and it will find relevant recipes even if they don\'t contain those exact words.',

  // Input schema using Zod
  // This defines what parameters the tool accepts
  {
    // The search query (required)
    query: z.string().describe(
      'The search query to find recipes. Can be ingredients, dish names, cuisines, ' +
      'cooking methods, or descriptive phrases like "healthy breakfast" or "comfort food".'
    ),

    // Minimum similarity threshold (optional, defaults to -0.1)
    match_threshold: z.number().min(-1).max(1).optional().describe(
      'Minimum similarity score between -1 and 1. Higher values return more relevant ' +
      'but fewer results. Default is -0.1.'
    ),

    // Maximum number of results (optional, defaults to 10)
    match_count: z.number().min(1).max(50).optional().describe(
      'Maximum number of recipes to return. Default is 10.'
    ),
  },

  // Handler function - this runs when Claude calls the tool
  async ({ query, match_threshold, match_count }) => {
    try {
      // Log the search for debugging (writes to stderr, not stdout)
      console.error(`Searching for: "${query}"`);

      // Step 1: Generate embedding for the search query
      // This converts the text query into a 768-dimensional vector
      console.error('Generating embedding...');
      const embedding = await generateEmbedding(query);
      console.error(`Embedding generated (${embedding.length} dimensions)`);

      // Step 2: Search Supabase using vector similarity
      // Use provided values or fall back to defaults
      const threshold = match_threshold ?? 0.5;
      const count = match_count ?? 10;

      console.error(`Searching Supabase (threshold: ${threshold}, count: ${count})...`);
      const recipes = await searchRecipes(embedding, threshold, count);
      console.error(`Found ${recipes.length} recipes`);

      // Step 3: Format the results for Claude
      const formattedResults = formatRecipeResults(recipes);

      // Return the results in MCP's expected format
      // The "content" array contains the response data
      return {
        content: [
          {
            type: 'text',
            text: formattedResults
          }
        ]
      };

    } catch (error) {
      // If something goes wrong, return an error message
      console.error('Error:', error.message);
      return {
        content: [
          {
            type: 'text',
            text: `Error searching recipes: ${error.message}`
          }
        ],
        isError: true  // Flag this as an error response
      };
    }
  }
);

// ============================================================================
// START THE SERVER
// ============================================================================

/**
 * Main function to start the MCP server.
 *
 * This creates a StdioServerTransport, which allows the server to communicate
 * via stdin/stdout. This is how Claude Desktop sends requests and receives
 * responses from MCP servers.
 */
async function main() {
  // Create the transport layer for stdin/stdout communication
  const transport = new StdioServerTransport();

  // Connect the server to the transport
  // This starts listening for requests from Claude Desktop
  await server.connect(transport);

  // Log that we're running (to stderr so it doesn't interfere with MCP protocol)
  console.error('Recipe MCP Server running on stdio');
}

// Start the server and handle any fatal errors
main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
