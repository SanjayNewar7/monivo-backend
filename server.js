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

// Simple question detection
const SIMPLE_PATTERNS = [
  /^(hi|hello|hey|good morning|good afternoon|good evening)$/i,
  /^what('s| is) your name/i,
  /^who are you/i,
  /^how are you/i,
  /^thank(s| you)/i,
  /^thanks/i,
];

function isSimpleQuestion(prompt) {
  return SIMPLE_PATTERNS.some(pattern => pattern.test(prompt.trim()));
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
  const { prompt, financialContext, isRaw } = req.body;
  
  let enhancedPrompt;
  const isSimple = isRaw || isSimpleQuestion(prompt);
  
  if (isSimple) {
    enhancedPrompt = `You are Monivo AI. Answer briefly (max 30 words): "${prompt}"`;
  } else if (isRaw) {
    enhancedPrompt = prompt;
  } else {
    enhancedPrompt = `<system>You are Monivo AI, a professional financial assistant.</system>

<context>
<user>${financialContext.userName}</user>
<income>${financialContext.currency}${financialContext.monthlyIncome}</income>
<expenses>${financialContext.currency}${financialContext.monthlyExpenses}</expenses>
<savings_rate>${financialContext.savingsRate}%</savings_rate>
<top_category>${financialContext.topCategory}</top_category>
<budgets_exceeded>${financialContext.budgetsExceeded}</budgets_exceeded>
<goals>${financialContext.goalNames || 'No goals'}</goals>
</context>

<task>${prompt}</task>

<constraints>
- Max 150 words
- Reference actual numbers
- Give 2-3 actionable steps
- Be encouraging
</constraints>

<response>`;
  }

  for (let attempt = 0; attempt < API_KEYS.length; attempt++) {
    const apiKey = getNextApiKey();
    const client = new GoogleGenerativeAI(apiKey);
    const model = client.getGenerativeModel({ model: "gemini-2.0-flash" });
    
    try {
      console.log(`📤 Attempt ${attempt + 1} with Key ${API_KEYS.indexOf(apiKey) + 1}`);
      console.log(`   Type: ${isSimple ? 'Simple' : 'Financial'}`);
      
      const result = await model.generateContent(enhancedPrompt);
      const response = await result.response;
      let text = response.text();
      
      // Trim for simple questions
      if (isSimple) {
        const words = text.split(' ');
        if (words.length > 50) {
          text = words.slice(0, 40).join(' ') + '...';
        }
      }
      
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
