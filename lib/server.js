import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';

// ============================================================================
// CONFIGURATION
// ============================================================================

const GOOGLE_AI_API_KEY = process.env.GOOGLE_AI_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

if (!GOOGLE_AI_API_KEY || !SUPABASE_URL || !SUPABASE_KEY) {
  throw new Error(
    'Missing required environment variables: GOOGLE_AI_API_KEY, SUPABASE_URL, SUPABASE_KEY'
  );
}

// ============================================================================
// INITIALIZE CLIENTS
// ============================================================================

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Generate an embedding vector for a text query using Google Gemini.
 *
 * @param {string} text - The text to convert to an embedding
 * @returns {Promise<number[]>} - A 768-dimensional array of numbers
 */
async function generateEmbedding(text) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=${GOOGLE_AI_API_KEY}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      content: {
        parts: [{ text: text }]
      },
      output_dimensionality: 768
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to generate embedding: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  return data.embedding.values;
}

/**
 * Search for recipes in Supabase using vector similarity.
 *
 * @param {number[]} queryEmbedding - The 768-dimensional embedding of the search query
 * @param {number} matchThreshold - Minimum similarity score, default -0.1
 * @param {number} matchCount - Maximum number of results to return, default 10
 * @returns {Promise<Array>} - Array of recipe objects with similarity scores
 */
async function searchRecipes(queryEmbedding, matchThreshold = -0.1, matchCount = 10) {
  const embeddingString = `[${queryEmbedding.join(',')}]`;

  const { data, error } = await supabase.rpc('search_recipes', {
    query_embedding: embeddingString,
    match_threshold: matchThreshold,
    match_count: matchCount
  });

  if (error) {
    throw new Error(`Supabase search error: ${error.message}`);
  }

  return data || [];
}

/**
 * Format recipe results into a readable string.
 *
 * @param {Array} recipes - Array of recipe objects from the database
 * @returns {string} - Formatted text representation of the recipes
 */
function formatRecipeResults(recipes) {
  if (!recipes || recipes.length === 0) {
    return 'No recipes found matching your search criteria.';
  }

  let output = `Found ${recipes.length} recipe(s):\n\n`;

  recipes.forEach((recipe, index) => {
    const similarityPercent = (recipe.similarity * 100).toFixed(1);

    output += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    output += `📖 Recipe ${index + 1}: ${recipe.dish_name}\n`;
    output += `   Match: ${similarityPercent}%\n`;
    output += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

    if (recipe.cuisine_or_style) {
      output += `🌍 Cuisine/Style: ${recipe.cuisine_or_style}\n\n`;
    }

    if (recipe.summary) {
      output += `📝 Summary:\n${recipe.summary}\n\n`;
    }

    if (recipe.main_ingredients && recipe.main_ingredients.length > 0) {
      output += `🥘 Main Ingredients:\n`;
      recipe.main_ingredients.forEach(ing => {
        output += `   • ${ing.name}`;
        if (ing.evidence) {
          output += ` (${ing.evidence})`;
        }
        output += '\n';
      });
      output += '\n';
    }

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

    if (recipe.techniques && recipe.techniques.length > 0) {
      output += `👨‍🍳 Techniques: ${recipe.techniques.join(', ')}\n\n`;
    }

    if (recipe.video_url) {
      output += `🎬 Video: ${recipe.video_url}\n\n`;
    }
  });

  return output;
}

// ============================================================================
// SERVER FACTORY
// ============================================================================

/**
 * Create and configure an MCP server with the search_recipes tool registered.
 *
 * @returns {McpServer} - A configured MCP server ready to connect to a transport
 */
export function createServer() {
  const server = new McpServer({
    name: 'recipe-search',
    version: '1.0.0',
  });

  server.tool(
    'search_recipes',

    'Search for recipes using semantic similarity. The search understands meaning, ' +
    'so you can search for things like "quick weeknight dinner" or "spicy Asian noodles" ' +
    'and it will find relevant recipes even if they don\'t contain those exact words.',

    {
      query: z.string().describe(
        'The search query to find recipes. Can be ingredients, dish names, cuisines, ' +
        'cooking methods, or descriptive phrases like "healthy breakfast" or "comfort food".'
      ),

      match_threshold: z.number().min(-1).max(1).optional().describe(
        'Minimum similarity score between -1 and 1. Higher values return more relevant ' +
        'but fewer results. Default is -0.1.'
      ),

      match_count: z.number().min(1).max(50).optional().describe(
        'Maximum number of recipes to return. Default is 10.'
      ),
    },

    async ({ query, match_threshold, match_count }) => {
      try {
        console.error(`Searching for: "${query}"`);

        console.error('Generating embedding...');
        const embedding = await generateEmbedding(query);
        console.error(`Embedding generated (${embedding.length} dimensions)`);

        const threshold = match_threshold ?? 0.5;
        const count = match_count ?? 10;

        console.error(`Searching Supabase (threshold: ${threshold}, count: ${count})...`);
        const recipes = await searchRecipes(embedding, threshold, count);
        console.error(`Found ${recipes.length} recipes`);

        const formattedResults = formatRecipeResults(recipes);

        return {
          content: [
            {
              type: 'text',
              text: formattedResults
            }
          ]
        };

      } catch (error) {
        console.error('Error:', error.message);
        return {
          content: [
            {
              type: 'text',
              text: `Error searching recipes: ${error.message}`
            }
          ],
          isError: true
        };
      }
    }
  );

  return server;
}
