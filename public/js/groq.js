// ============================================
// Groq API Module — Open Source LLMs
// Supports: Llama 3.3 70B, Mixtral 8x7B, Gemma 2 9B
// Free tier: 30 RPM, 14,400 RPD
// ============================================

const GroqAPI = {
  BASE_URL: 'https://api.groq.com/openai/v1/chat/completions',

  // Available open-source models
  MODELS: {
    'llama-3.3-70b-versatile': { name: 'Llama 3.3 70B', provider: 'Meta', badge: '🦙' },
    'mixtral-8x7b-32768': { name: 'Mixtral 8x7B', provider: 'Mistral', badge: '🌀' },
    'gemma2-9b-it': { name: 'Gemma 2 9B', provider: 'Google', badge: '💎' },
  },

  // ---------- Build Weather Context (same as Gemini) ----------
  _buildWeatherContext(weatherData, cityInfo) {
    if (!weatherData || !cityInfo) return 'No weather data available yet.';

    const { current, hourly, daily } = weatherData;
    const unitSym = weatherData.unitSymbol;
    const windSym = weatherData.windSymbol;
    const precipSym = weatherData.precipSymbol;

    let ctx = `📍 CURRENT WEATHER FOR ${cityInfo.name.toUpperCase()}`;
    if (cityInfo.admin1) ctx += `, ${cityInfo.admin1}`;
    if (cityInfo.country) ctx += `, ${cityInfo.country}`;
    ctx += `\n`;
    ctx += `• Temperature: ${current.temp}${unitSym} (feels like ${current.feelsLike}${unitSym})\n`;
    ctx += `• Condition: ${current.weatherInfo.desc}\n`;
    ctx += `• Humidity: ${current.humidity}%\n`;
    ctx += `• Wind: ${current.windSpeed} ${windSym} (gusts ${current.windGusts} ${windSym}) from ${this._getWindDir(current.windDir)}\n`;
    ctx += `• Pressure: ${current.pressure} hPa\n`;
    ctx += `• Cloud Cover: ${current.cloudCover}%\n`;
    ctx += `• UV Index: ${current.uvIndex}\n`;
    ctx += `• Precipitation: ${current.precipitation} ${precipSym}\n`;
    ctx += `• Time of Day: ${current.isDay ? 'Daytime' : 'Nighttime'}\n`;

    ctx += `\n⏰ HOURLY FORECAST (next 12 hours):\n`;
    const hourlySlice = hourly.slice(0, 12);
    hourlySlice.forEach(h => {
      ctx += `  ${h.timeStr}: ${h.temp}${unitSym}, ${h.weatherInfo.desc}, Rain: ${h.precipProb}%, Wind: ${h.windSpeed} ${windSym}\n`;
    });

    ctx += `\n📅 7-DAY FORECAST:\n`;
    daily.forEach(d => {
      ctx += `  ${d.dayName} (${d.dateStr}): ${d.weatherInfo.desc}, High: ${d.tempMax}${unitSym}, Low: ${d.tempMin}${unitSym}, Rain: ${d.precipProb}%, Wind: ${d.windMax} ${windSym}, UV: ${d.uvMax}\n`;
      ctx += `    Sunrise: ${d.sunrise} | Sunset: ${d.sunset}\n`;
    });

    return ctx;
  },

  _getWindDir(deg) {
    const dirs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
    return dirs[Math.round(deg / 22.5) % 16];
  },

  // ---------- Build System Prompt ----------
  _buildSystemPrompt(weatherData, cityInfo) {
    const weatherContext = this._buildWeatherContext(weatherData, cityInfo);

    return `You are WeatherMind, an intelligent and friendly weather assistant. You have access to real-time weather data provided below.

PERSONALITY:
- Warm, helpful, and concise
- Use relevant weather emojis naturally (don't overdo it)
- Give actionable advice (e.g., "Carry an umbrella", "Apply sunscreen")
- Use **bold** for key numbers and important info
- Keep responses focused and under 150 words unless the user asks for details
- If asked about something unrelated to weather, politely redirect to weather topics

CURRENT WEATHER DATA:
${weatherContext}

GUIDELINES:
- Always reference the actual data above when answering questions
- For outfit/clothing questions, consider temperature, rain probability, wind, and UV
- For activity questions, evaluate temperature + rain + wind + UV holistically
- When comparing days, use the 7-day forecast data
- For "best day" questions, score days by: low rain probability, comfortable temperature (18-28°C / 64-82°F), low wind, low UV
- Mention sunrise/sunset times when relevant (photography, planning)
- If the user asks about a different city than the one loaded, let them know they can search for that city using the search bar`;
  },

  // ---------- Main Chat Function ----------
  async chat(userMessage, weatherData, cityInfo, chatHistory = []) {
    const apiKey = Storage.getGroqKey();
    if (!apiKey) {
      throw new Error('NO_API_KEY');
    }

    const model = Storage.getGroqModel();
    const systemPrompt = this._buildSystemPrompt(weatherData, cityInfo);

    // Build messages array (OpenAI-compatible format)
    const messages = [
      { role: 'system', content: systemPrompt }
    ];

    // Add recent chat history
    const recentHistory = chatHistory.slice(-6);
    recentHistory.forEach(msg => {
      messages.push({
        role: msg.role === 'user' ? 'user' : 'assistant',
        content: msg.text
      });
    });

    // Add current user message
    messages.push({ role: 'user', content: userMessage });

    const requestBody = {
      model: model,
      messages: messages,
      temperature: 0.7,
      max_tokens: 512,
      top_p: 0.9,
    };

    try {
      const res = await fetch(this.BASE_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify(requestBody)
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        const errMsg = errData?.error?.message || `API error: ${res.status}`;

        if (res.status === 401) {
          throw new Error('INVALID_API_KEY');
        }
        if (res.status === 429) {
          throw new Error('RATE_LIMITED');
        }
        throw new Error(errMsg);
      }

      const data = await res.json();

      const text = data.choices?.[0]?.message?.content;
      if (!text) {
        throw new Error('Empty response from model.');
      }

      return text.trim();

    } catch (err) {
      if (['NO_API_KEY', 'INVALID_API_KEY', 'RATE_LIMITED'].includes(err.message)) {
        throw err;
      }

      if (err.name === 'TypeError' && err.message.includes('fetch')) {
        throw new Error('NETWORK_ERROR');
      }

      throw err;
    }
  },

  // ---------- Test API Key ----------
  async testConnection(apiKey, model) {
    try {
      const res = await fetch(this.BASE_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: model || 'llama-3.3-70b-versatile',
          messages: [{ role: 'user', content: 'Say "connected" in one word.' }],
          max_tokens: 10
        })
      });

      if (!res.ok) {
        if (res.status === 401) return { ok: false, error: 'Invalid API key' };
        if (res.status === 429) return { ok: false, error: 'Rate limited — try again in a minute' };
        return { ok: false, error: `API error: ${res.status}` };
      }

      return { ok: true };
    } catch (err) {
      return { ok: false, error: 'Network error — check your internet connection' };
    }
  },

  // ---------- Check if Groq is available ----------
  isAvailable() {
    return !!Storage.getGroqKey();
  },

  // ---------- Get current model info ----------
  getModelInfo() {
    const modelId = Storage.getGroqModel();
    return this.MODELS[modelId] || this.MODELS['llama-3.3-70b-versatile'];
  }
};
