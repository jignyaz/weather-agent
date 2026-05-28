// ============================================
// App.js — Main Application Logic
// ============================================

const App = {
  currentWeatherData: null,
  currentCity: null,
  searchTimeout: null,
  activeView: 'dashboard',

  // ---------- Initialize ----------
  async init() {
    WeatherCharts.init();
    this.bindEvents();
    this.bindSettingsEvents();
    this.bindHelpEvents();
    this.renderSavedCitiesView();
    this.setActiveNav('dashboard');
    this.updateUnitButton();
    this.updateLLMBadge();
    this.restoreChatHistory();

    // Load last city or default
    const lastCity = Storage.getLastCity();
    if (lastCity) {
      await this.loadWeather(lastCity);
    } else {
      // Try geolocation, fallback to Delhi
      try {
        const pos = await WeatherAPI.getUserLocation();
        const city = await WeatherAPI.reverseGeocode(pos.latitude, pos.longitude);
        await this.loadWeather(city);
      } catch {
        await this.loadDefaultCity();
      }
    }
  },

  async loadDefaultCity() {
    const results = await WeatherAPI.geocodeCity('New Delhi');
    if (results.length > 0) {
      await this.loadWeather(results[0]);
    }
  },

  // ---------- Event Bindings ----------
  bindEvents() {
    // Search
    const searchBox = document.getElementById('searchBox');
    searchBox.addEventListener('input', (e) => this.onSearchInput(e.target.value));
    searchBox.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const items = document.querySelectorAll('.suggestion-item');
        if (items.length > 0) items[0].click();
      }
      if (e.key === 'Escape') this.closeSuggestions();
    });

    // Close suggestions on click outside
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.search-container')) this.closeSuggestions();
    });

    // Geolocation button
    document.getElementById('geoBtn').addEventListener('click', () => this.onGeolocate());

    // Navigation
    document.querySelectorAll('.nav-btn[data-view]').forEach(btn => {
      btn.addEventListener('click', () => this.switchView(btn.dataset.view));
    });

    // Unit toggle
    document.getElementById('unitToggle').addEventListener('click', () => this.onToggleUnit());

    // Chat
    document.getElementById('chatInput').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.onChatSend();
      }
    });
    document.getElementById('chatSendBtn').addEventListener('click', () => this.onChatSend());

    // Quick prompts
    document.querySelectorAll('.quick-prompt').forEach(btn => {
      btn.addEventListener('click', () => {
        const query = btn.dataset.query;
        document.getElementById('chatInput').value = query;
        this.onChatSend();
      });
    });
  },

  // ---------- Navigation ----------
  switchView(view) {
    this.activeView = view;
    document.querySelectorAll('.view-section').forEach(el => el.classList.remove('active'));
    document.getElementById(`view-${view}`).classList.add('active');
    this.setActiveNav(view);

    // Refresh cities view when switching to it
    if (view === 'cities') {
      this.renderSavedCitiesView();
    }
  },

  setActiveNav(view) {
    document.querySelectorAll('.nav-btn[data-view]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.view === view);
    });
  },

  // ---------- Search ----------
  onSearchInput(value) {
    clearTimeout(this.searchTimeout);
    if (value.trim().length < 2) {
      this.closeSuggestions();
      return;
    }

    this.searchTimeout = setTimeout(async () => {
      const results = await WeatherAPI.geocodeCity(value.trim());
      this.renderSuggestions(results);
    }, 300);
  },

  renderSuggestions(results) {
    const container = document.getElementById('searchSuggestions');
    if (results.length === 0) {
      container.innerHTML = '<div class="suggestion-item"><span class="city-name">No cities found</span></div>';
      container.classList.add('active');
      return;
    }

    container.innerHTML = results.map((r, i) => `
      <div class="suggestion-item" data-index="${i}">
        <span>📍</span>
        <div>
          <div class="city-name">${r.name}</div>
          <div class="country">${r.admin1 ? r.admin1 + ', ' : ''}${r.country || ''}</div>
        </div>
      </div>
    `).join('');

    container.querySelectorAll('.suggestion-item').forEach((item, i) => {
      item.addEventListener('click', () => {
        this.loadWeather(results[i]);
        this.closeSuggestions();
        document.getElementById('searchBox').value = results[i].name;
      });
    });

    container.classList.add('active');
  },

  closeSuggestions() {
    document.getElementById('searchSuggestions').classList.remove('active');
  },

  // ---------- Geolocation ----------
  async onGeolocate() {
    const btn = document.getElementById('geoBtn');
    btn.classList.add('loading');

    try {
      const pos = await WeatherAPI.getUserLocation();
      const city = await WeatherAPI.reverseGeocode(pos.latitude, pos.longitude);
      await this.loadWeather(city);
      document.getElementById('searchBox').value = city.name;
    } catch (err) {
      this.showAlert('warning', '📍', 'Location Access', 'Unable to get your location. Please enable location access or search manually.');
    } finally {
      btn.classList.remove('loading');
    }
  },

  // ---------- Load Weather Data ----------
  async loadWeather(city) {
    this.currentCity = city;
    Storage.setLastCity(city);
    this.showDashboardLoading();

    try {
      const unit = Storage.getUnit();
      const data = await WeatherAPI.fetchWeather(city.latitude, city.longitude, unit);
      this.currentWeatherData = data;

      // Render everything
      this.renderCurrentWeather(city, data);
      this.renderAgentInsight(data);
      this.renderMetrics(data);
      this.renderHourly(data);
      this.renderDaily(data);
      this.renderCharts(data);
      this.updateBackground(data.current);
      this.checkAlerts(data);

    } catch (err) {
      console.error('Failed to load weather:', err);
      this.showAlert('danger', '❌', 'Error', 'Failed to load weather data. Please try again.');
    }
  },

  showDashboardLoading() {
    // Simple loading state
    const hero = document.getElementById('weatherHero');
    if (hero) {
      hero.innerHTML = `<div class="loading-spinner"></div>`;
    }
  },

  // ---------- Render Current Weather ----------
  renderCurrentWeather(city, data) {
    const { current } = data;
    const hero = document.getElementById('weatherHero');

    hero.innerHTML = `
      <div>
        <div class="weather-location">
          <span class="pin-icon">📍</span>
          <span class="city">${city.name}</span>
          <span class="region">${city.admin1 ? city.admin1 + ', ' : ''}${city.country || ''}</span>
        </div>
        <div class="weather-temp-group">
          <span class="weather-temp">${current.temp}${data.unitSymbol}</span>
          <span class="weather-icon-large">${current.weatherInfo.icon}</span>
        </div>
        <div class="weather-desc">${current.weatherInfo.desc}</div>
        <div class="weather-feels">Feels like ${current.feelsLike}${data.unitSymbol}</div>
      </div>
    `;
  },

  // ---------- Render Agent Insight ----------
  renderAgentInsight(data) {
    const insight = WeatherAgent.generateInsight(data);
    const container = document.getElementById('agentInsight');

    container.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: flex-start; width: 100%;">
        <div class="agent-badge">
          <span class="pulse-dot"></span>
          WeatherMind Agent
        </div>
        <button class="speak-btn-card" onclick="App.speakInsightText(this)" title="Read aloud" style="background: none; border: none; color: var(--text-secondary); cursor: pointer; font-size: 1.1rem; opacity: 0.6; transition: var(--transition-fast);">🔊</button>
      </div>
      <div class="agent-insight-title">${insight.title}</div>
      <div class="agent-insight-text">${insight.text}</div>
      <div class="agent-recommendations">
        ${insight.tags.map(t => `<span class="agent-rec-tag">${t}</span>`).join('')}
      </div>
    `;
  },

  // ---------- Render Metrics ----------
  renderMetrics(data) {
    const { current } = data;
    const grid = document.getElementById('metricsGrid');

    const metrics = [
      { icon: '💧', value: `${current.humidity}%`, label: 'Humidity' },
      { icon: '💨', value: `${current.windSpeed}`, label: data.windSymbol },
      { icon: '☀️', value: current.uvIndex, label: 'UV Index' },
      { icon: '🔵', value: `${current.pressure}`, label: 'hPa' },
      { icon: '☁️', value: `${current.cloudCover}%`, label: 'Cloud Cover' },
      { icon: '🌧️', value: `${current.precipitation}`, label: data.precipSymbol },
      { icon: '🌬️', value: `${current.windGusts}`, label: `Gusts ${data.windSymbol}` },
      { icon: current.isDay ? '☀️' : '🌙', value: current.isDay ? 'Day' : 'Night', label: 'Time of Day' }
    ];

    grid.innerHTML = metrics.map((m, i) => `
      <div class="glass-card metric-card stagger-${i + 1}" style="animation: fadeSlideUp 0.4s ease both; animation-delay: ${i * 0.05}s">
        <div class="metric-icon">${m.icon}</div>
        <div class="metric-value">${m.value}</div>
        <div class="metric-label">${m.label}</div>
      </div>
    `).join('');
  },

  // ---------- Render Hourly ----------
  renderHourly(data) {
    const scroll = document.getElementById('hourlyScroll');
    scroll.innerHTML = data.hourly.map(h => `
      <div class="hourly-item ${h.isNow ? 'now' : ''}">
        <div class="hourly-time">${h.timeStr}</div>
        <div class="hourly-icon">${h.isDay ? h.weatherInfo.icon : (h.weatherInfo.group === 'sunny' ? '🌙' : h.weatherInfo.icon)}</div>
        <div class="hourly-temp">${h.temp}°</div>
        ${h.precipProb > 0 ? `<div class="hourly-precip">💧${h.precipProb}%</div>` : ''}
      </div>
    `).join('');
  },

  // ---------- Render Daily ----------
  renderDaily(data) {
    const list = document.getElementById('dailyList');
    list.innerHTML = data.daily.map(d => `
      <div class="daily-item">
        <div class="daily-day">
          ${d.dayName}
          <div class="date">${d.dateStr}</div>
        </div>
        <div class="daily-icon">${d.weatherInfo.icon}</div>
        <div class="daily-temp-bar">
          <span>${d.tempMin}°</span>
          <div class="temp-range-bar">
            <div class="temp-range-fill" style="left: ${d.barLeft}%; width: ${Math.max(d.barWidth, 5)}%"></div>
          </div>
          <span>${d.tempMax}°</span>
        </div>
        <div class="daily-precip">${d.precipProb > 0 ? `💧 ${d.precipProb}%` : ''}</div>
      </div>
    `).join('');
  },

  // ---------- Render Charts ----------
  renderCharts(data) {
    // Small delay to ensure DOM is ready
    requestAnimationFrame(() => {
      WeatherCharts.renderHourlyTemp('chartHourlyTemp', data.hourly, data.unitSymbol);
      WeatherCharts.renderPrecipitation('chartPrecip', data.hourly);
      WeatherCharts.renderDailyTemp('chartDailyTemp', data.daily, data.unitSymbol);
      WeatherCharts.renderWindSpeed('chartWind', data.hourly, data.windSymbol);
    });
  },

  // ---------- Update Background ----------
  updateBackground(current) {
    const bg = document.getElementById('appBg');
    bg.className = 'app-bg';

    if (!current.isDay) {
      bg.classList.add('weather-night');
    } else if (current.weatherInfo.group === 'rainy') {
      bg.classList.add('weather-rainy');
    } else if (current.weatherInfo.group === 'snowy') {
      bg.classList.add('weather-snowy');
    } else if (current.weatherInfo.group === 'cloudy') {
      bg.classList.add('weather-cloudy');
    } else {
      bg.classList.add('weather-sunny');
    }
  },

  // ---------- Alerts ----------
  checkAlerts(data) {
    const alerts = WeatherAgent.generateAlerts(data);
    alerts.forEach((alert, i) => {
      setTimeout(() => this.showAlert(alert.type, alert.icon, alert.title, alert.text), i * 800);
    });
  },

  showAlert(type, icon, title, text) {
    const container = document.getElementById('alertsContainer');
    const toast = document.createElement('div');
    toast.className = `alert-toast ${type}`;
    toast.innerHTML = `
      <span class="alert-icon">${icon}</span>
      <div class="alert-content">
        <div class="alert-title">${title}</div>
        <div class="alert-text">${text}</div>
      </div>
      <button class="alert-close" onclick="this.parentElement.remove()">✕</button>
    `;

    container.appendChild(toast);

    // Auto-remove after 6 seconds
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(30px)';
      toast.style.transition = 'all 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 6000);
  },

  // ---------- Unit Toggle ----------
  onToggleUnit() {
    const newUnit = Storage.toggleUnit();
    this.updateUnitButton();
    if (this.currentCity) {
      this.loadWeather(this.currentCity);
    }
    // Refresh all saved city cards
    this.renderSavedCitiesView();
  },

  updateUnitButton() {
    const btn = document.getElementById('unitToggle');
    const unit = Storage.getUnit();
    btn.textContent = unit === 'celsius' ? '°C' : '°F';
    btn.title = `Switch to ${unit === 'celsius' ? 'Fahrenheit' : 'Celsius'}`;
  },

  // ---------- Chat ----------
  _getActiveProvider() {
    const provider = Storage.getLLMProvider();
    if (provider === 'groq' && GroqAPI.isAvailable()) return 'groq';
    if (provider === 'gemini' && GeminiAPI.isAvailable()) return 'gemini';
    // Auto-detect if preferred provider has no key
    if (GeminiAPI.isAvailable()) return 'gemini';
    if (GroqAPI.isAvailable()) return 'groq';
    return null;
  },

  async onChatSend() {
    const input = document.getElementById('chatInput');
    const query = input.value.trim();
    if (!query) return;

    // Add user message
    this.addChatMessage('user', query);
    Storage.addChatMessage('user', query);
    input.value = '';

    // Show typing indicator
    const typing = this.showTypingIndicator();

    const activeProvider = this._getActiveProvider();

    if (activeProvider) {
      const api = activeProvider === 'groq' ? GroqAPI : GeminiAPI;
      const providerName = activeProvider === 'groq'
        ? `Groq (${GroqAPI.getModelInfo().name})`
        : 'Gemini';

      try {
        const chatHistory = Storage.getChatHistory().slice(-6);
        const response = await api.chat(
          query,
          this.currentWeatherData,
          this.currentCity,
          chatHistory
        );
        typing.remove();
        this.addChatMessage('agent', response);
        Storage.addChatMessage('agent', response);
      } catch (err) {
        typing.remove();
        let errMsg;
        switch (err.message) {
          case 'NO_API_KEY':
            errMsg = `🔑 No API key configured for ${providerName}. Go to **Settings** to add your key, or I'll use my built-in intelligence!`;
            const fallback = WeatherAgent.handleChat(query, this.currentWeatherData);
            this.addChatMessage('agent', fallback);
            Storage.addChatMessage('agent', fallback);
            return;
          case 'INVALID_API_KEY':
            errMsg = `❌ Your ${providerName} API key is invalid. Please check it in **Settings**.`;
            break;
          case 'RATE_LIMITED':
            errMsg = `⏳ Rate limit reached on ${providerName}. Falling back to built-in mode...`;
            const rlFallback = WeatherAgent.handleChat(query, this.currentWeatherData);
            this.addChatMessage('agent', rlFallback);
            Storage.addChatMessage('agent', rlFallback);
            return;
          case 'NETWORK_ERROR':
            errMsg = '🌐 Network error. Check your internet connection and try again.';
            break;
          default:
            errMsg = `⚠️ Something went wrong: ${err.message}. Falling back to built-in mode...`;
            const defFallback = WeatherAgent.handleChat(query, this.currentWeatherData);
            this.addChatMessage('agent', defFallback);
            Storage.addChatMessage('agent', defFallback);
            return;
        }
        this.addChatMessage('agent', errMsg);
      }
    } else {
      // Rule-based fallback
      setTimeout(() => {
        typing.remove();
        const response = WeatherAgent.handleChat(query, this.currentWeatherData);
        this.addChatMessage('agent', response);
        Storage.addChatMessage('agent', response);
      }, 500 + Math.random() * 800);
    }
  },

  addChatMessage(role, text) {
    const container = document.getElementById('chatMessages');
    const quickPrompts = document.getElementById('quickPrompts');

    // Hide quick prompts once chat starts
    if (quickPrompts) quickPrompts.style.display = 'none';

    const msg = document.createElement('div');
    msg.className = `chat-msg ${role}`;

    // Simple markdown-like formatting
    const formatted = text
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\n/g, '<br>');

    const speakButton = role === 'agent'
      ? `<button class="speak-btn" onclick="App.speakText(this)" title="Read aloud" style="background: none; border: none; color: var(--text-muted); cursor: pointer; font-size: 0.8rem; margin-top: var(--space-xs); opacity: 0.6; display: block; transition: var(--transition-fast);">🔊 Read Aloud</button>`
      : '';

    msg.innerHTML = `
      <div class="chat-avatar">${role === 'agent' ? '🤖' : '👤'}</div>
      <div class="chat-bubble">
        <div>${formatted}</div>
        ${speakButton}
      </div>
    `;

    container.appendChild(msg);
    container.scrollTop = container.scrollHeight;
  },

  showTypingIndicator() {
    const container = document.getElementById('chatMessages');
    const typing = document.createElement('div');
    typing.className = 'chat-msg agent';
    typing.innerHTML = `
      <div class="chat-avatar">🤖</div>
      <div class="chat-bubble">
        <div class="chat-typing">
          <span class="dot"></span>
          <span class="dot"></span>
          <span class="dot"></span>
        </div>
      </div>
    `;
    container.appendChild(typing);
    container.scrollTop = container.scrollHeight;
    return typing;
  },

  restoreChatHistory() {
    const history = Storage.getChatHistory();
    if (history.length > 0) {
      const quickPrompts = document.getElementById('quickPrompts');
      if (quickPrompts) quickPrompts.style.display = 'none';
      history.forEach(msg => this.addChatMessage(msg.role, msg.text));
    }
  },

  // ---------- Multi-City View ----------
  async renderSavedCitiesView() {
    const grid = document.getElementById('citiesGrid');
    const cities = Storage.getCities();

    let html = '';

    // Fetch weather for each saved city
    for (const city of cities) {
      try {
        const unit = Storage.getUnit();
        const data = await WeatherAPI.fetchWeather(city.latitude, city.longitude, unit);
        const { current } = data;

        html += `
          <div class="glass-card city-card" onclick="App.onCityCardClick(${city.latitude}, ${city.longitude}, '${city.name.replace(/'/g, "\\'")}', '${(city.country || '').replace(/'/g, "\\'")}', '${(city.admin1 || '').replace(/'/g, "\\'")}')" style="animation: fadeSlideUp 0.4s ease both">
            <div class="city-card-header">
              <div>
                <div class="city-name">${city.name}</div>
                <div class="city-country">${city.admin1 ? city.admin1 + ', ' : ''}${city.country}</div>
              </div>
              <button class="city-remove" onclick="event.stopPropagation(); App.onRemoveCity(${city.latitude}, ${city.longitude})" title="Remove city">✕</button>
            </div>
            <div class="city-temp">${current.weatherInfo.icon} ${current.temp}${data.unitSymbol}</div>
            <div class="city-desc">${current.weatherInfo.desc}</div>
            <div class="city-metrics">
              <div class="city-metric">💧 <span>${current.humidity}%</span></div>
              <div class="city-metric">💨 <span>${current.windSpeed} ${data.windSymbol}</span></div>
              <div class="city-metric">🌡️ <span>Feels ${current.feelsLike}°</span></div>
            </div>
          </div>
        `;
      } catch (err) {
        html += `
          <div class="glass-card city-card">
            <div class="city-card-header">
              <div class="city-name">${city.name}</div>
              <button class="city-remove" onclick="App.onRemoveCity(${city.latitude}, ${city.longitude})" title="Remove city">✕</button>
            </div>
            <div class="city-desc" style="color: var(--accent-red)">Failed to load</div>
          </div>
        `;
      }
    }

    // Add city button
    html += `
      <div class="glass-card add-city-card" onclick="App.onAddCityClick()">
        <div class="add-city-icon">+</div>
        <div class="add-city-text">Add a city</div>
      </div>
    `;

    grid.innerHTML = html;
  },

  onCityCardClick(lat, lon, name, country, admin1) {
    const city = { latitude: lat, longitude: lon, name, country, admin1 };
    this.loadWeather(city);
    this.switchView('dashboard');
    document.getElementById('searchBox').value = name;
  },

  onRemoveCity(lat, lon) {
    Storage.removeCity(lat, lon);
    this.renderSavedCitiesView();
  },

  onAddCityClick() {
    // If we have current city, save it
    if (this.currentCity) {
      const added = Storage.saveCity(this.currentCity);
      if (added) {
        this.showAlert('success', '✅', 'City Saved', `${this.currentCity.name} has been added to your cities.`);
        this.renderSavedCitiesView();
      } else {
        this.showAlert('info', 'ℹ️', 'Already Saved', `${this.currentCity.name} is already in your cities. Search for a different city first.`);
      }
    } else {
      this.showAlert('info', 'ℹ️', 'Search First', 'Search for a city in the dashboard, then come back to add it.');
    }
  },

  // ---------- Speech Synthesis ----------
  speakText(btn) {
    const bubble = btn.parentElement;
    const text = bubble.firstElementChild.innerText.trim();
    
    if (window.speechSynthesis.speaking) {
      window.speechSynthesis.cancel();
      if (btn.textContent.includes('🔇')) {
        btn.innerHTML = '🔊 Read Aloud';
        btn.title = 'Read aloud';
        return;
      }
    }
    
    // Reset other buttons
    document.querySelectorAll('.speak-btn').forEach(b => {
      b.innerHTML = '🔊 Read Aloud';
      b.title = 'Read aloud';
    });
    document.querySelectorAll('.speak-btn-card').forEach(b => {
      b.textContent = '🔊';
      b.title = 'Read aloud';
    });

    const utterance = new SpeechSynthesisUtterance(text);
    const voices = window.speechSynthesis.getVoices();
    const naturalVoice = voices.find(v => v.lang.startsWith('en') && (v.name.includes('Google') || v.name.includes('Natural') || v.name.includes('Microsoft')));
    if (naturalVoice) utterance.voice = naturalVoice;

    utterance.onstart = () => {
      btn.innerHTML = '🔇 Stop Reading';
      btn.title = 'Stop reading';
    };

    utterance.onend = () => {
      btn.innerHTML = '🔊 Read Aloud';
      btn.title = 'Read aloud';
    };

    utterance.onerror = () => {
      btn.innerHTML = '🔊 Read Aloud';
      btn.title = 'Read aloud';
    };

    window.speechSynthesis.speak(utterance);
  },

  // ---------- Settings Modal ----------
  bindSettingsEvents() {
    document.getElementById('settingsBtn').addEventListener('click', () => this.openSettings());
    document.getElementById('settingsClose').addEventListener('click', () => this.closeSettings());
    document.getElementById('settingsModal').addEventListener('click', (e) => {
      if (e.target.id === 'settingsModal') this.closeSettings();
    });

    // Provider tabs
    document.querySelectorAll('.provider-tab').forEach(tab => {
      tab.addEventListener('click', () => this.onProviderTabClick(tab.dataset.provider));
    });

    // Gemini: Save key
    document.getElementById('saveKeyBtn').addEventListener('click', () => this.onSaveGeminiKey());
    // Gemini: Clear key
    document.getElementById('clearKeyBtn').addEventListener('click', () => this.onClearGeminiKey());
    // Gemini: Toggle key visibility
    document.getElementById('keyToggleBtn').addEventListener('click', () => {
      const input = document.getElementById('geminiKeyInput');
      const btn = document.getElementById('keyToggleBtn');
      if (input.type === 'password') {
        input.type = 'text';
        btn.textContent = '🔒';
      } else {
        input.type = 'password';
        btn.textContent = '👁️';
      }
    });

    // Groq: Save key
    document.getElementById('saveGroqKeyBtn').addEventListener('click', () => this.onSaveGroqKey());
    // Groq: Clear key
    document.getElementById('clearGroqKeyBtn').addEventListener('click', () => this.onClearGroqKey());
    // Groq: Toggle key visibility
    document.getElementById('groqKeyToggleBtn').addEventListener('click', () => {
      const input = document.getElementById('groqKeyInput');
      const btn = document.getElementById('groqKeyToggleBtn');
      if (input.type === 'password') {
        input.type = 'text';
        btn.textContent = '🔒';
      } else {
        input.type = 'password';
        btn.textContent = '👁️';
      }
    });

    // Groq: Model selection
    document.querySelectorAll('input[name="groqModel"]').forEach(radio => {
      radio.addEventListener('change', (e) => {
        Storage.setGroqModel(e.target.value);
        // Update active state on model options
        document.querySelectorAll('.model-option').forEach(opt => opt.classList.remove('active'));
        e.target.closest('.model-option').classList.add('active');
        this.updateLLMBadge();
      });
    });
  },

  bindHelpEvents() {
    // Tab switching inside help view
    document.querySelectorAll('.help-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        const targetTab = tab.dataset.helpTab;
        
        // Update tab buttons active state
        document.querySelectorAll('.help-tab').forEach(t => {
          t.classList.toggle('active', t === tab);
          t.setAttribute('aria-selected', t === tab ? 'true' : 'false');
        });

        // Update active panel content
        document.querySelectorAll('.help-panel').forEach(panel => {
          const isTarget = panel.id === `helpPanel${targetTab.charAt(0).toUpperCase() + targetTab.slice(1)}`;
          panel.classList.toggle('active', isTarget);
        });
      });
    });
  },

  // ---------- Provider Tab Switching ----------
  onProviderTabClick(provider) {
    // Update tab UI
    document.querySelectorAll('.provider-tab').forEach(t => t.classList.remove('active'));
    document.querySelector(`.provider-tab[data-provider="${provider}"]`).classList.add('active');

    // Update panel visibility
    document.querySelectorAll('.provider-panel').forEach(p => p.classList.remove('active'));
    document.getElementById(`panel${provider.charAt(0).toUpperCase() + provider.slice(1)}`).classList.add('active');

    // Save selection
    Storage.setLLMProvider(provider);
    this.updateLLMBadge();
  },

  openSettings() {
    const modal = document.getElementById('settingsModal');

    // Restore provider tab state
    const currentProvider = Storage.getLLMProvider();
    this.onProviderTabClick(currentProvider);

    // Gemini key
    const geminiInput = document.getElementById('geminiKeyInput');
    const existingGeminiKey = Storage.getGeminiKey();
    if (existingGeminiKey) {
      geminiInput.value = existingGeminiKey;
      geminiInput.type = 'password';
    } else {
      geminiInput.value = '';
    }

    // Groq key
    const groqInput = document.getElementById('groqKeyInput');
    const existingGroqKey = Storage.getGroqKey();
    if (existingGroqKey) {
      groqInput.value = existingGroqKey;
      groqInput.type = 'password';
    } else {
      groqInput.value = '';
    }

    // Groq model
    const savedModel = Storage.getGroqModel();
    const modelRadio = document.querySelector(`input[name="groqModel"][value="${savedModel}"]`);
    if (modelRadio) {
      modelRadio.checked = true;
      document.querySelectorAll('.model-option').forEach(opt => opt.classList.remove('active'));
      modelRadio.closest('.model-option').classList.add('active');
    }

    this.updateGeminiStatusBadge();
    this.updateGroqStatusBadge();
    document.getElementById('settingsStatus').innerHTML = '';
    document.getElementById('groqSettingsStatus').innerHTML = '';
    modal.classList.add('active');
  },

  closeSettings() {
    document.getElementById('settingsModal').classList.remove('active');
  },

  // ---------- Gemini Key Management ----------
  async onSaveGeminiKey() {
    const input = document.getElementById('geminiKeyInput');
    const key = input.value.trim();
    const statusEl = document.getElementById('settingsStatus');
    const saveBtn = document.getElementById('saveKeyBtn');

    if (!key) {
      statusEl.innerHTML = '<span class="status-error">❌ Please enter an API key</span>';
      return;
    }

    saveBtn.disabled = true;
    saveBtn.textContent = 'Testing...';
    statusEl.innerHTML = '<span class="status-info">🔄 Validating your API key...</span>';

    const result = await GeminiAPI.testConnection(key);

    if (result.ok) {
      Storage.setGeminiKey(key);
      statusEl.innerHTML = '<span class="status-success">✅ Connected! Gemini AI is now active.</span>';
      this.updateGeminiStatusBadge();
      this.updateLLMBadge();
    } else {
      statusEl.innerHTML = `<span class="status-error">❌ ${result.error}</span>`;
    }

    saveBtn.disabled = false;
    saveBtn.textContent = 'Save & Test';
  },

  onClearGeminiKey() {
    Storage.clearGeminiKey();
    document.getElementById('geminiKeyInput').value = '';
    document.getElementById('settingsStatus').innerHTML = '<span class="status-info">🗑️ API key cleared.</span>';
    this.updateGeminiStatusBadge();
    this.updateLLMBadge();
  },

  // ---------- Groq Key Management ----------
  async onSaveGroqKey() {
    const input = document.getElementById('groqKeyInput');
    const key = input.value.trim();
    const statusEl = document.getElementById('groqSettingsStatus');
    const saveBtn = document.getElementById('saveGroqKeyBtn');

    if (!key) {
      statusEl.innerHTML = '<span class="status-error">❌ Please enter an API key</span>';
      return;
    }

    saveBtn.disabled = true;
    saveBtn.textContent = 'Testing...';
    statusEl.innerHTML = '<span class="status-info">🔄 Validating your API key...</span>';

    const model = Storage.getGroqModel();
    const result = await GroqAPI.testConnection(key, model);

    if (result.ok) {
      Storage.setGroqKey(key);
      const modelInfo = GroqAPI.MODELS[model];
      statusEl.innerHTML = `<span class="status-success">✅ Connected! ${modelInfo.name} is ready.</span>`;
      this.updateGroqStatusBadge();
      this.updateLLMBadge();
    } else {
      statusEl.innerHTML = `<span class="status-error">❌ ${result.error}</span>`;
    }

    saveBtn.disabled = false;
    saveBtn.textContent = 'Save & Test';
  },

  onClearGroqKey() {
    Storage.clearGroqKey();
    document.getElementById('groqKeyInput').value = '';
    document.getElementById('groqSettingsStatus').innerHTML = '<span class="status-info">🗑️ API key cleared.</span>';
    this.updateGroqStatusBadge();
    this.updateLLMBadge();
  },

  // ---------- Status Badges ----------
  updateGeminiStatusBadge() {
    const badge = document.getElementById('geminiStatus');
    if (Storage.getGeminiKey()) {
      badge.textContent = 'Connected';
      badge.className = 'settings-badge connected';
    } else {
      badge.textContent = 'Not configured';
      badge.className = 'settings-badge';
    }
  },

  updateGroqStatusBadge() {
    const badge = document.getElementById('groqStatus');
    if (Storage.getGroqKey()) {
      const modelInfo = GroqAPI.getModelInfo();
      badge.textContent = `${modelInfo.name}`;
      badge.className = 'settings-badge connected';
    } else {
      badge.textContent = 'Not configured';
      badge.className = 'settings-badge';
    }
  },

  updateLLMBadge() {
    const badge = document.getElementById('llmBadge');
    const label = badge.querySelector('.llm-label');
    const activeProvider = this._getActiveProvider();

    if (activeProvider === 'groq') {
      badge.classList.add('active');
      const modelInfo = GroqAPI.getModelInfo();
      label.textContent = `${modelInfo.badge} ${modelInfo.name}`;
    } else if (activeProvider === 'gemini') {
      badge.classList.add('active');
      label.textContent = '✨ Gemini AI Active';
    } else {
      badge.classList.remove('active');
      label.textContent = 'Rule-based Mode';
    }
  },

  speakInsightText(btn) {
    const container = document.getElementById('agentInsight');
    const title = container.querySelector('.agent-insight-title').innerText;
    const text = container.querySelector('.agent-insight-text').innerText;
    const combined = `${title}. ${text}`;
    
    if (window.speechSynthesis.speaking) {
      window.speechSynthesis.cancel();
      if (btn.textContent === '🔇') {
        btn.textContent = '🔊';
        btn.title = 'Read aloud';
        return;
      }
    }
    
    // Reset other buttons
    document.querySelectorAll('.speak-btn').forEach(b => {
      b.innerHTML = '🔊 Read Aloud';
      b.title = 'Read aloud';
    });
    document.querySelectorAll('.speak-btn-card').forEach(b => {
      b.textContent = '🔊';
      b.title = 'Read aloud';
    });

    const utterance = new SpeechSynthesisUtterance(combined);
    const voices = window.speechSynthesis.getVoices();
    const naturalVoice = voices.find(v => v.lang.startsWith('en') && (v.name.includes('Google') || v.name.includes('Natural') || v.name.includes('Microsoft')));
    if (naturalVoice) utterance.voice = naturalVoice;

    utterance.onstart = () => {
      btn.textContent = '🔇';
      btn.title = 'Stop reading';
    };

    utterance.onend = () => {
      btn.textContent = '🔊';
      btn.title = 'Read aloud';
    };

    utterance.onerror = () => {
      btn.textContent = '🔊';
      btn.title = 'Read aloud';
    };

    window.speechSynthesis.speak(utterance);
  }
};

// ---------- Start the app ----------
document.addEventListener('DOMContentLoaded', () => App.init());
