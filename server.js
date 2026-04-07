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

console.log(`📊 Loaded ${API_KEYS.length} API keys`);

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
  
  // Build a more detailed prompt with actual user data
  const enhancedPrompt = `You are Monivo AI, a professional financial assistant. Use the user's actual financial data to provide personalized advice.

USER FINANCIAL DATA:
- Name: ${financialContext.userName}
- Monthly Income: ${financialContext.currency}${financialContext.monthlyIncome}
- Monthly Expenses: ${financialContext.currency}${financialContext.monthlyExpenses}
- Monthly Savings: ${financialContext.currency}${financialContext.monthlySavings}
- Savings Rate: ${financialContext.savingsRate}%
- Top Spending Category: ${financialContext.topCategory} (${financialContext.currency}${financialContext.topCategoryAmount})
- Active Budgets: ${financialContext.budgetCount} (${financialContext.budgetsExceeded} exceeded)
- Savings Goals: ${financialContext.goalNames || 'No goals set'}
- Goal Progress: ${financialContext.overallGoalProgress}%

USER QUESTION: ${prompt}

IMPORTANT RULES:
1. Keep response under 150 words
2. Be specific and reference their actual numbers
3. Give 2-3 actionable tips
4. End with: ⚠️ Educational advice.

RESPONSE:`;

  for (let attempt = 0; attempt < API_KEYS.length; attempt++) {
    const apiKey = getNextApiKey();
    const client = new GoogleGenerativeAI(apiKey);
    // Try different models - gemini-2.0-flash is most stable
    const model = client.getGenerativeModel({ model: "gemini-2.0-flash" });
    
    try {
      console.log(`📤 Attempt ${attempt + 1} with Key ${API_KEYS.indexOf(apiKey) + 1}`);
      const result = await model.generateContent(enhancedPrompt);
      const response = await result.response;
      const text = response.text();
      
      console.log(`✅ Success with Key ${API_KEYS.indexOf(apiKey) + 1}`);
      res.json({ 
        success: true, 
        text: text.trim(),
      });
      return;
      
    } catch (error) {
      console.log(`❌ Key ${API_KEYS.indexOf(apiKey) + 1} failed: ${error.message}`);
      markKeyFailed(apiKey);
      
      if (attempt === API_KEYS.length - 1) {
        console.log(`💀 All ${API_KEYS.length} keys failed`);
        res.status(503).json({ 
          success: false, 
          error: 'All API services are currently unavailable. Please try again in a few minutes.',
          details: error.message
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

module.exports = app;
