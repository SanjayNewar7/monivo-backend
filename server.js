const express = require('express');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const cors = require('cors');

const app = express();

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Multiple API Keys for rotation
const API_KEYS = [
  process.env.GEMINI_API_KEY_1,
  process.env.GEMINI_API_KEY_2,
  process.env.GEMINI_API_KEY_3,
  process.env.GEMINI_API_KEY_4,
  process.env.GEMINI_API_KEY_5,
  process.env.GEMINI_API_KEY_6,
  process.env.GEMINI_API_KEY_7,
].filter(key => key && key.length > 0);

let currentKeyIndex = 0;
const keyCooldown = new Map();
const COOLDOWN_MS = 60000;

function getNextApiKey() {
  for (let i = 0; i < API_KEYS.length; i++) {
    currentKeyIndex = (currentKeyIndex + 1) % API_KEYS.length;
    const key = API_KEYS[currentKeyIndex];
    
    if (keyCooldown.has(key) && Date.now() < keyCooldown.get(key)) {
      continue;
    }
    
    return key;
  }
  
  let earliestKey = API_KEYS[0];
  let earliestTime = keyCooldown.get(earliestKey) || Infinity;
  
  for (const key of API_KEYS) {
    const cooldownTime = keyCooldown.get(key) || 0;
    if (cooldownTime < earliestTime) {
      earliestTime = cooldownTime;
      earliestKey = key;
    }
  }
  
  return earliestKey;
}

function markKeyFailed(apiKey) {
  keyCooldown.set(apiKey, Date.now() + COOLDOWN_MS);
}

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    availableKeys: API_KEYS.length
  });
});

// Chat endpoint
app.post('/api/chat', async (req, res) => {
  const { prompt, financialContext } = req.body;
  
  const enhancedPrompt = `You are Monivo AI, a friendly financial assistant. 
User financial data: ${JSON.stringify(financialContext)}
User question: ${prompt}

Keep response under 150 words. Be helpful and encouraging.`;

  for (let attempt = 0; attempt < API_KEYS.length; attempt++) {
    const apiKey = getNextApiKey();
    const client = new GoogleGenerativeAI(apiKey);
    const model = client.getGenerativeModel({ model: "gemini-1.5-flash" });
    
    try {
      const result = await model.generateContent(enhancedPrompt);
      const response = await result.response;
      const text = response.text();
      
      res.json({ 
        success: true, 
        text: text.trim(),
      });
      return;
      
    } catch (error) {
      markKeyFailed(apiKey);
      
      if (attempt === API_KEYS.length - 1) {
        res.status(503).json({ 
          success: false, 
          error: 'All API services are currently unavailable. Please try again in a few minutes.'
        });
        return;
      }
    }
  }
});

// Default route
app.get('/', (req, res) => {
  res.json({ message: 'Monivo Backend API is running', endpoints: ['/health', '/api/chat'] });
});

// For Vercel serverless deployment
module.exports = app;
