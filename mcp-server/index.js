import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

// Конфигурация API
const API_BASE_URL = process.env.API_URL || 'http://localhost:3000';
let authToken = null;

// Хелпер для HTTP запросов
async function apiRequest(endpoint, options = {}) {
  const url = `${API_BASE_URL}${endpoint}`;
  const headers = {
    'Content-Type': 'application/json',
    ...(authToken && { Authorization: `Bearer ${authToken}` }),
    ...options.headers,
  };

  const response = await fetch(url, { ...options, headers });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`API Error ${response.status}: ${error}`);
  }

  return response.json();
}

// Создаём MCP сервер
const server = new McpServer({
  name: 'nest-api-server',
  version: '1.0.0',
});

// ==================== AUTH TOOLS ====================

// Login
server.tool(
  'auth_login',
  'Login to the API and get JWT token',
  {
    email: z.string().describe('User email'),
    password: z.string().describe('User password'),
  },
  async ({ email, password }) => {
    try {
      const result = await apiRequest('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      authToken = result.access_token;
      return {
        content: [{ type: 'text', text: `Login successful! Token saved.` }],
      };
    } catch (error) {
      return {
        content: [{ type: 'text', text: `Login failed: ${error.message}` }],
      };
    }
  },
);

// Registration
server.tool(
  'auth_register',
  'Register a new user',
  {
    email: z.string().describe('User email'),
    password: z.string().describe('User password'),
    name: z.string().optional().describe('User name'),
  },
  async ({ email, password, name }) => {
    try {
      const result = await apiRequest('/auth/registration', {
        method: 'POST',
        body: JSON.stringify({ email, password, name }),
      });
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    } catch (error) {
      return {
        content: [
          { type: 'text', text: `Registration failed: ${error.message}` },
        ],
      };
    }
  },
);

// Get Profile
server.tool(
  'auth_profile',
  'Get current user profile (requires login)',
  {},
  async () => {
    try {
      const result = await apiRequest('/auth/profile');
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    } catch (error) {
      return {
        content: [{ type: 'text', text: `Error: ${error.message}` }],
      };
    }
  },
);

// ==================== PRODUCT TOOLS ====================

// Get all products
server.tool(
  'products_list',
  'Get list of all products with pagination',
  {
    page: z.number().optional().describe('Page number (default: 1)'),
    limit: z
      .number()
      .optional()
      .describe('Items per page (default: 10, max: 100)'),
  },
  async ({ page = 1, limit = 10 }) => {
    try {
      const result = await apiRequest(`/product?page=${page}&limit=${limit}`);
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    } catch (error) {
      return {
        content: [{ type: 'text', text: `Error: ${error.message}` }],
      };
    }
  },
);

// Get product by ID
server.tool(
  'product_get',
  'Get a product by its ID',
  {
    id: z.string().describe('Product ID'),
  },
  async ({ id }) => {
    try {
      const result = await apiRequest(`/product/${id}`);
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    } catch (error) {
      return {
        content: [{ type: 'text', text: `Error: ${error.message}` }],
      };
    }
  },
);

// Create product
server.tool(
  'product_create',
  'Create a new product',
  {
    name: z.string().describe('Product name'),
    price: z.number().describe('Product price'),
    description: z.string().optional().describe('Product description'),
  },
  async ({ name, price, description }) => {
    try {
      const result = await apiRequest('/product', {
        method: 'POST',
        body: JSON.stringify({ name, price, description }),
      });
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    } catch (error) {
      return {
        content: [{ type: 'text', text: `Error: ${error.message}` }],
      };
    }
  },
);

// ==================== USER TOOLS ====================

// Get all users
server.tool('users_list', 'Get list of all users', {}, async () => {
  try {
    const result = await apiRequest('/user');
    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    };
  } catch (error) {
    return {
      content: [{ type: 'text', text: `Error: ${error.message}` }],
    };
  }
});

// Get user by ID
server.tool(
  'user_get',
  'Get a user by ID',
  {
    id: z.string().describe('User ID'),
  },
  async ({ id }) => {
    try {
      const result = await apiRequest(`/user/${id}`);
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    } catch (error) {
      return {
        content: [{ type: 'text', text: `Error: ${error.message}` }],
      };
    }
  },
);

// ==================== SHOPPING CART TOOLS ====================

// Get cart
server.tool(
  'cart_get',
  "Get current user's shopping cart (requires login)",
  {},
  async () => {
    try {
      const result = await apiRequest('/shoppingCart');
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    } catch (error) {
      return {
        content: [{ type: 'text', text: `Error: ${error.message}` }],
      };
    }
  },
);

// Add item to cart
server.tool(
  'cart_add_item',
  'Add item to shopping cart (requires login)',
  {
    itemID: z.string().describe('Product ID to add'),
    count: z.number().describe('Quantity'),
  },
  async ({ itemID, count }) => {
    try {
      const result = await apiRequest('/shoppingCart/addItem', {
        method: 'POST',
        body: JSON.stringify({ itemID, count }),
      });
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    } catch (error) {
      return {
        content: [{ type: 'text', text: `Error: ${error.message}` }],
      };
    }
  },
);

// Complete order
server.tool(
  'cart_checkout',
  'Complete the order (requires login)',
  {},
  async () => {
    try {
      const result = await apiRequest('/shoppingCart/completeOrder', {
        method: 'POST',
      });
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    } catch (error) {
      return {
        content: [{ type: 'text', text: `Error: ${error.message}` }],
      };
    }
  },
);

// ==================== EMAIL TOOLS ====================

// Send email
server.tool(
  'email_send',
  'Send an email',
  {
    email: z.string().describe('Recipient email'),
    message: z.string().describe('Email message'),
  },
  async ({ email, message }) => {
    try {
      const result = await apiRequest('/email/send', {
        method: 'POST',
        body: JSON.stringify({ email, message }),
      });
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    } catch (error) {
      return {
        content: [{ type: 'text', text: `Error: ${error.message}` }],
      };
    }
  },
);

// Запускаем сервер
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('NestJS API MCP Server running...');
}

main().catch(console.error);
