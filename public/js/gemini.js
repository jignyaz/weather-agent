// ============================================
// Gemini API Module — Google Gemini 2.0 Flash
// Free tier: 15 RPM, 1500 RPD, 1M TPM
// ============================================

const GeminiAPI = {
  MODEL: 'gemini-2.0-flash',
  BASE_URL: 'https://generativelanguage.googleapis.com/v1beta/models',

  // ---------- Build Weather Context for System Prompt ----------
  _buildWeatherContext(weatherData, cityInfo) {
    if (!weatherData || !cityInfo) return 'No weather data available yet.';

    const { current, hourly, daily } = weatherData;
    const unitSym = weatherData.unitSymbol;
    const windSym = weatherData.windSymbol;
    const precipSym = weatherData.precipSymbol;

    // Current conditions
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

    // Hourly forecast (next 12 hours, condensed)
    ctx += `\n⏰ HOURLY FORECAST (next 12 hours):\n`;
    const hourlySlice = hourly.slice(0, 12);
    hourlySlice.forEach(h => {
      ctx += `  ${h.timeStr}: ${h.temp}${unitSym}, ${h.weatherInfo.desc}, Rain: ${h.precipProb}%, Wind: ${h.windSpeed} ${windSym}\n`;
    });

    // Daily forecast (7 days)
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
    const apiKey = Storage.getGeminiKey();
    if (!apiKey) {
      throw new Error('NO_API_KEY');
    }

    const systemPrompt = this._buildSystemPrompt(weatherData, cityInfo);

    // Build conversation contents
    const contents = [];

    // Add recent chat history (last 6 messages for context, to keep token usage low)
    const recentHistory = chatHistory.slice(-6);
    recentHistory.forEach(msg => {
      contents.push({
        role: msg.role === 'user' ? 'user' : 'model',
        parts: [{ text: msg.text }]
      });
    });

    // Add current user message
    contents.push({
      role: 'user',
      parts: [{ text: userMessage }]
    });

    const requestBody = {
      system_instruction: {
        parts: [{ text: systemPrompt }]
      },
      contents: contents,
      generationConfig: {
        temperature: 0.7,
        topP: 0.9,
        topK: 40,
        maxOutputTokens: 512
      },
      safetySettings: [
        { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_ONLY_HIGH' },
        { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_ONLY_HIGH' },
        { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_ONLY_HIGH' },
        { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_ONLY_HIGH' }
      ]
    };

    const url = `${this.BASE_URL}/${this.MODEL}:generateContent?key=${apiKey}`;

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        const errMsg = errData?.error?.message || `API error: ${res.status}`;

        if (res.status === 400 && errMsg.includes('API key')) {
          throw new Error('INVALID_API_KEY');
        }
        if (res.status === 403) {
          throw new Error('INVALID_API_KEY');
        }
        if (res.status === 429) {
          throw new Error('RATE_LIMITED');
        }
        throw new Error(errMsg);
      }

      const data = await res.json();

      // Extract text from response
      const candidate = data.candidates?.[0];
      if (!candidate) {
        throw new Error('No response generated. The query may have been blocked by safety filters.');
      }

      const text = candidate.content?.parts?.[0]?.text;
      if (!text) {
        throw new Error('Empty response from Gemini.');
      }

      return text.trim();

    } catch (err) {
      // Re-throw known errors
      if (['NO_API_KEY', 'INVALID_API_KEY', 'RATE_LIMITED'].includes(err.message)) {
        throw err;
      }

      // Network errors
      if (err.name === 'TypeError' && err.message.includes('fetch')) {
        throw new Error('NETWORK_ERROR');
      }

      throw err;
    }
  },

  // ---------- Test API Key ----------
  async testConnection(apiKey) {
    const url = `${this.BASE_URL}/${this.MODEL}:generateContent?key=${apiKey}`;

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: 'Say "connected" in one word.' }] }],
          generationConfig: { maxOutputTokens: 10 }
        })
      });

      if (!res.ok) {
        if (res.status === 403 || res.status === 400) return { ok: false, error: 'Invalid API key' };
        if (res.status === 429) return { ok: false, error: 'Rate limited — try again in a minute' };
        return { ok: false, error: `API error: ${res.status}` };
      }

      return { ok: true };
    } catch (err) {
      return { ok: false, error: 'Network error — check your internet connection' };
    }
  },

  // ---------- Check if Gemini is available ----------
  isAvailable() {
    return !!Storage.getGeminiKey();
  }
};
