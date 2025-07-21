/**
 * Simplified ChatbotStatusOverlay - Clean automation assistant without control buttons
 * Persists only during active automation, clears when stopped
 */
class ChatbotStatusOverlay {
  constructor(options = {}) {
    this.options = {
      id: options.id || "chatbot-status-overlay",
      title: options.title || "Job Assistant",
      botName: options.botName || "FastApply Bot",
      platform: options.platform || "AUTOMATION",
      sessionId: options.sessionId || null,
      icon: options.icon || "🤖",
      position: options.position || { top: "20px", right: "20px" },
      width: options.width || "400px",
      maxHeight: options.maxHeight || "550px",
      ...options,
    };

    // State management
    this.container = null;
    this.chatContainer = null;
    this.statusBar = null;
    this.isVisible = true;
    this.isMinimized = false;
    this.messageCount = 0;
    this.currentStatus = "ready";
    this.messages = [];
    this.automationState = "ready"; // ready, searching, applying, paused, stopped
    this.isPaused = false;
    this.port = null;
    this.greetingShown = false; // Prevent duplicate greetings
    this.isDestroyed = false; // Track if overlay is destroyed
    this.pendingTimeouts = []; // Track timeouts for cleanup

    // Storage key
    this.storageKey = `chatbot_messages_${this.options.sessionId || "default"}`;

    // Initialize
    this.initializeStorage();
    this.injectStyles();
    this.setupMessageListener();

    if (!options.manual) {
      this.create();
    }
  }

  /**
   * Initialize storage and load persisted data
   */
  async initializeStorage() {
    if (!this.options.persistMessages) return;

    try {
      const result = await chrome.storage.local.get([this.storageKey]);
      if (result[this.storageKey]) {
        this.messages = result[this.storageKey];
        this.messageCount = this.messages.length;
      }
    } catch (error) {
      console.error("Error loading chatbot data:", error);
    }
  }

  /**
   * Save messages to storage
   */
  async saveMessages() {
    if (!this.options.persistMessages || this.isDestroyed) return;

    try {
      await chrome.storage.local.set({
        [this.storageKey]: this.messages,
      });
    } catch (error) {
      console.error("Error saving chatbot messages:", error);
    }
  }

  /**
   * Clear all messages and storage
   */
  async clearMessages() {
    if (this.isDestroyed) return;

    this.messages = [];
    this.messageCount = 0;
    this.greetingShown = false; // Reset greeting flag

    if (this.chatContainer) {
      this.chatContainer.innerHTML = "";
    }

    if (this.options.persistMessages) {
      try {
        await chrome.storage.local.remove([this.storageKey]);
      } catch (error) {
        console.error("Error clearing chatbot storage:", error);
      }
    }
  }

  /**
   * Setup cross-tab message listener
   */
  setupMessageListener() {
    if (!this.options.persistMessages) return;

    chrome.storage.onChanged.addListener((changes, namespace) => {
      if (namespace !== "local" || this.isDestroyed) return;

      if (changes[this.storageKey]) {
        const newMessages = changes[this.storageKey].newValue || [];
        if (newMessages.length > this.messages.length) {
          const newMessagesOnly = newMessages.slice(this.messages.length);
          this.messages = newMessages;
          this.messageCount = newMessages.length;

          newMessagesOnly.forEach((msg) => {
            if (msg.formatted) {
              this._createFormattedMessage(msg.content, msg.sender, false);
            } else {
              this._createMessage(msg.content, msg.sender, false);
            }
          });
          this._scrollToBottom();
        }
      }
    });
  }

  /**
   * Inject simplified styles
   */
  injectStyles() {
    if (document.getElementById("chatbot-overlay-styles")) return;

    const styles = document.createElement("style");
    styles.id = "chatbot-overlay-styles";
    styles.textContent = `
      @keyframes chatbotSlideIn {
        from { opacity: 0; transform: translateX(100%); }
        to { opacity: 1; transform: translateX(0); }
      }

      @keyframes chatbotSlideInLeft {
        from { opacity: 0; transform: translateX(-100%); }
        to { opacity: 1; transform: translateX(0); }
      }

      @keyframes messageFadeIn {
        from { opacity: 0; transform: translateY(10px); }
        to { opacity: 1; transform: translateY(0); }
      }

      @keyframes typingDots {
        0%, 20% { opacity: 0.4; }
        50% { opacity: 1; }
        100% { opacity: 0.4; }
      }

      @keyframes statusPulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.7; }
      }

      .chatbot-overlay-container {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        line-height: 1.4;
        user-select: none;
      }

      .chatbot-overlay-container * {
        box-sizing: border-box;
      }

      .chatbot-message-bubble {
        display: flex;
        align-items: flex-start;
        margin: 12px 0;
        animation: messageFadeIn 0.3s ease-out;
        gap: 10px;
      }

      .chatbot-bot-avatar {
        width: 32px;
        height: 32px;
        border-radius: 50%;
        background: linear-gradient(135deg, #0ea5e9 0%, #0284c7 100%);
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 16px;
        color: white;
        border: 2px solid white;
        box-shadow: 0 2px 8px rgba(14, 165, 233, 0.4);
        flex-shrink: 0;
      }

      .chatbot-message-content {
        background: linear-gradient(135deg, #0ea5e9 0%, #0284c7 100%);
        color: white;
        padding: 12px 16px;
        border-radius: 18px;
        border-bottom-left-radius: 4px;
        font-size: 14px;
        line-height: 1.4;
        max-width: 280px;
        word-wrap: break-word;
        box-shadow: 0 2px 12px rgba(14, 165, 233, 0.3);
      }

      .chatbot-message-system .chatbot-message-content {
        background: #f0f9ff;
        color: #075985;
        border-radius: 12px;
        text-align: center;
        font-size: 13px;
        border: 1px solid #bae6fd;
        max-width: 100%;
      }

      .chatbot-message-system {
        justify-content: center;
      }

      .chatbot-message-system .chatbot-bot-avatar {
        display: none;
      }

      .chatbot-message-timestamp {
        font-size: 11px;
        color: rgba(255,255,255,0.8);
        margin-top: 4px;
      }

      .chatbot-typing-indicator {
        display: flex;
        align-items: center;
        gap: 10px;
        margin: 12px 0;
      }

      .chatbot-typing-content {
        display: flex;
        align-items: center;
        padding: 10px 14px;
        background: #f0f9ff;
        border-radius: 18px;
        border-bottom-left-radius: 4px;
        border: 1px solid #e0f2fe;
      }

      .chatbot-typing-dots {
        display: flex;
        gap: 3px;
      }

      .chatbot-typing-dot {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: #0ea5e9;
        animation: typingDots 1.4s infinite;
      }

      .chatbot-typing-dot:nth-child(2) { animation-delay: 0.2s; }
      .chatbot-typing-dot:nth-child(3) { animation-delay: 0.4s; }

      .chatbot-status-indicator {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        font-size: 12px;
        font-weight: 500;
      }

      .chatbot-status-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: #38bdf8;
      }

      .chatbot-status-searching .chatbot-status-dot { 
        background: #8b5cf6; 
        animation: statusPulse 2s infinite;
      }
      .chatbot-status-applying .chatbot-status-dot { 
        background: #0ea5e9; 
        animation: statusPulse 2s infinite;
      }
      .chatbot-status-paused .chatbot-status-dot { 
        background: #f59e0b; 
        animation: statusPulse 3s infinite;
      }
      .chatbot-status-ready .chatbot-status-dot { 
        background: #22c55e;
      }
      .chatbot-status-stopped .chatbot-status-dot { 
        background: #ef4444;
      }

      .chatbot-minimize-btn {
        background: none;
        border: none;
        color: rgba(255,255,255,0.8);
        cursor: pointer;
        padding: 4px;
        border-radius: 4px;
        transition: all 0.2s;
      }

      .chatbot-minimize-btn:hover {
        background: rgba(255,255,255,0.2);
        color: white;
      }
    `;
    document.head.appendChild(styles);
  }

  /**
   * Create the chatbot overlay
   */
  async create() {
    // Prevent duplicate creation or creation on destroyed overlay
    if (document.getElementById(this.options.id) || this.isDestroyed) {
      if (!this.isDestroyed) {
        console.warn("Chatbot overlay already exists, destroying old one");
        this.destroy();
      } else {
        return this;
      }
    }

    // Create main container
    this.container = document.createElement("div");
    this.container.id = this.options.id;
    this.container.className = "chatbot-overlay-container";
    // Determine animation based on position
    const animation = this.options.position.left
      ? "chatbotSlideInLeft 0.4s ease-out"
      : "chatbotSlideIn 0.4s ease-out";

    this.container.style.cssText = `
      position: fixed;
      ${this.options.position.top ? `top: ${this.options.position.top};` : ""}
      ${
        this.options.position.right
          ? `right: ${this.options.position.right};`
          : ""
      }
      ${
        this.options.position.left ? `left: ${this.options.position.left};` : ""
      }
      ${
        this.options.position.bottom
          ? `bottom: ${this.options.position.bottom};`
          : ""
      }
      width: ${this.options.width};
      max-height: ${this.options.maxHeight};
      background: white;
      border-radius: 16px;
      box-shadow: 0 8px 30px rgba(14, 165, 233, 0.15);
      z-index: 9999999;
      overflow: hidden;
      animation: ${animation};
      ${!this.isVisible ? "display: none;" : ""}
    `;

    // Create header
    const header = this.createHeader();
    this.container.appendChild(header);

    // Create chat container
    this.chatContainer = document.createElement("div");
    this.chatContainer.style.cssText = `
      max-height: 400px;
      overflow-y: auto;
      padding: 16px;
      background: linear-gradient(180deg, #f0f9ff 0%, #fafbfc 100%);
    `;

    this.container.appendChild(this.chatContainer);
    document.body.appendChild(this.container);

    // Initialize port connection
    this.initializePortConnection();

    // Load persisted messages or show greeting
    if (this.messages.length > 0) {
      this.loadPersistedMessages();
      this.greetingShown = true; // Mark greeting as shown if messages exist
    } else if (!this.greetingShown) {
      this.addGreeting();
      this.greetingShown = true;
    }

    this.updateStatus(this.currentStatus);

    return this;
  }

  /**
   * Initialize port connection
   */
  initializePortConnection() {
    if (!chrome.runtime || this.isDestroyed) return;

    try {
      this.port = chrome.runtime.connect({ name: `chatbot-${Date.now()}` });

      this.port.onMessage.addListener((message) => {
        if (!this.isDestroyed) {
          this.handlePortMessage(message);
        }
      });

      this.port.onDisconnect.addListener(() => {
        this.port = null;
        if (!this.isDestroyed) {
          const timeoutId = setTimeout(() => this.initializePortConnection(), 5000);
          this.pendingTimeouts.push(timeoutId);
        }
      });
    } catch (error) {
      console.warn("Could not establish port connection:", error);
    }
  }

  /**
   * Handle messages from automation system
   */
  handlePortMessage(message) {
    if (this.isDestroyed) return;

    const { type, data } = message;

    switch (type) {
      case "AUTOMATION_STATE_CHANGED":
        this.automationState = data.state;
        this.updateStatus(data.state);
        break;

      case "AUTOMATION_PAUSED":
        this.isPaused = true;
        this.automationState = "paused";
        this.updateStatus("paused");
        this.addMessage("Automation paused! 🤚");
        break;

      case "AUTOMATION_RESUMED":
        this.isPaused = false;
        this.automationState = "applying"; // Resume to applying state
        this.updateStatus("applying");
        this.addMessage("Automation resumed! 🚀");
        break;

      case "AUTOMATION_STOPPED":
        this.automationState = "stopped";
        this.isPaused = false; // Reset pause state
        this.addMessage("Automation stopped! 👋");
        // Clear messages when automation stops
        const timeoutId = setTimeout(() => {
          if (!this.isDestroyed) {
            this.clearMessages();
            // Reset to ready state after clearing
            this.automationState = "ready";
            this.updateStatus("ready");
          }
        }, 2000);
        this.pendingTimeouts.push(timeoutId);
        break;
    }
  }

  /**
   * Send message to automation system
   */
  sendToAutomation(message) {
    if (this.isDestroyed) return;

    if (this.port) {
      try {
        this.port.postMessage(message);
      } catch (error) {
        console.warn("Failed to send message to automation:", error);
      }
    }

    if (chrome.runtime && chrome.runtime.sendMessage) {
      try {
        chrome.runtime.sendMessage(message);
      } catch (error) {
        console.warn("Failed to send runtime message:", error);
      }
    }
  }

  /**
   * Load persisted messages
   */
  loadPersistedMessages() {
    if (!this.chatContainer || this.isDestroyed) return;

    this.chatContainer.innerHTML = "";

    this.messages.forEach((msg) => {
      if (msg.formatted) {
        this._createFormattedMessage(msg.content, msg.sender, false);
      } else {
        this._createMessage(msg.content, msg.sender, false);
      }
    });

    this._scrollToBottom();
  }

  /**
   * Create header
   */
  createHeader() {
    const header = document.createElement("div");
    header.style.cssText = `
      background: linear-gradient(135deg, #0c4a6e 0%, #0369a1 100%);
      color: white;
      padding: 16px 20px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      cursor: pointer;
    `;

    const botInfo = document.createElement("div");
    botInfo.style.cssText = `
      display: flex;
      align-items: center;
      gap: 12px;
    `;

    const avatar = document.createElement("div");
    avatar.style.cssText = `
      width: 40px;
      height: 40px;
      border-radius: 50%;
      background: rgba(255,255,255,0.25);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 20px;
      border: 2px solid rgba(255,255,255,0.4);
    `;
    avatar.textContent = this.options.icon;

    const textInfo = document.createElement("div");

    const botName = document.createElement("div");
    botName.style.cssText = `
      font-weight: 600;
      font-size: 16px;
      margin-bottom: 2px;
    `;
    botName.textContent = this.options.botName;

    this.statusBar = document.createElement("div");
    this.statusBar.className = "chatbot-status-indicator";
    this.statusBar.innerHTML = `
      <span class="chatbot-status-dot"></span>
      <span>Ready to help</span>
    `;

    textInfo.appendChild(botName);
    textInfo.appendChild(this.statusBar);

    const minimizeBtn = document.createElement("button");
    minimizeBtn.className = "chatbot-minimize-btn";
    minimizeBtn.innerHTML = this.isMinimized ? "▲" : "▼";
    minimizeBtn.onclick = (e) => {
      e.stopPropagation();
      this.toggleMinimize();
    };

    botInfo.appendChild(avatar);
    botInfo.appendChild(textInfo);
    header.appendChild(botInfo);
    header.appendChild(minimizeBtn);

    header.addEventListener("click", () => {
      if (this.isMinimized) {
        this.toggleMinimize();
      }
    });

    return header;
  }

  /**
   * Add formatted message (preserves line breaks)
   */
  addFormattedMessage(message) {
    if (!this.chatContainer || this.isMinimized || this.isDestroyed) return this;

    this.showTypingIndicator();

    const timeoutId = setTimeout(() => {
      if (!this.isDestroyed) {
        this.hideTypingIndicator();
        this._createFormattedMessage(message, "bot", true);
        this._scrollToBottom();
        this.messageCount++;
      }
    }, 800 + Math.random() * 400);

    this.pendingTimeouts.push(timeoutId);
    return this;
  }

  /**
   * Add a message to the chat
   */
  addMessage(message) {
    if (!this.chatContainer || this.isMinimized || this.isDestroyed) return this;

    this.showTypingIndicator();

    const timeoutId = setTimeout(() => {
      if (!this.isDestroyed) {
        this.hideTypingIndicator();
        this._createMessage(message, "bot", true);
        this._scrollToBottom();
        this.messageCount++;
      }
    }, 800 + Math.random() * 400);

    this.pendingTimeouts.push(timeoutId);
    return this;
  }

  /**
   * Create formatted message element (preserves line breaks)
   */
  _createFormattedMessage(message, sender, persist = true) {
    if (this.isDestroyed || !this.chatContainer) return;

    const messageElement = document.createElement("div");
    messageElement.className = `chatbot-message-bubble chatbot-message-${sender}`;

    // Add bot avatar for all bot messages
    if (sender === "bot") {
      const avatar = document.createElement("div");
      avatar.className = "chatbot-bot-avatar";
      avatar.textContent = this.options.icon;
      messageElement.appendChild(avatar);
    }

    const content = document.createElement("div");
    content.className = "chatbot-message-content";
    content.style.whiteSpace = "pre-line"; // Preserve line breaks
    content.textContent = message;

    const messageWrapper = document.createElement("div");
    messageWrapper.appendChild(content);

    const timestamp = document.createElement("div");
    timestamp.className = "chatbot-message-timestamp";
    timestamp.textContent = new Date().toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
    messageWrapper.appendChild(timestamp);

    messageElement.appendChild(messageWrapper);
    
    if (this.chatContainer && !this.isDestroyed) {
      this.chatContainer.appendChild(messageElement);
    }

    // Persist message only if enabled and requested
    if (persist && this.options.persistMessages && !this.isDestroyed) {
      this.messages.push({
        content: message,
        sender: sender,
        timestamp: Date.now(),
        formatted: true,
      });
      this.saveMessages();
    }
  }

  /**
   * Legacy API compatibility methods
   */
  addBotMessage(message, type = "info") {
    if (this.isDestroyed) return this;

    // Extract emoji based on type for visual consistency
    const emoji = this._getEmojiForType(type);
    const finalMessage = emoji ? `${emoji} ${message}` : message;
    return this.addMessage(finalMessage);
  }

  addError(message) {
    if (this.isDestroyed) return this;
    return this.addMessage(`❌ ${message}`);
  }

  addSuccess(message) {
    if (this.isDestroyed) return this;
    return this.addMessage(`✅ ${message}`);
  }

  addWarning(message) {
    if (this.isDestroyed) return this;
    return this.addMessage(`⚠️ ${message}`);
  }

  addInfo(message) {
    if (this.isDestroyed) return this;
    return this.addMessage(`ℹ️ ${message}`);
  }

  /**
   * Show action preview (simplified version)
   */
  showActionPreview(action, details = {}, countdown = 3) {
    if (this.isDestroyed) return this;
    const preview = details.url ? `${action}\n📍 ${details.url}` : action;
    return this.addMessage(`⏳ About to: ${preview}`);
  }

  /**
   * Get emoji for message type
   */
  _getEmojiForType(type) {
    const emojis = {
      success: "✅",
      error: "❌",
      warning: "⚠️",
      info: "ℹ️",
      applying: "🔄",
      searching: "🔍",
      completed: "🎉",
    };
    return emojis[type] || "";
  }

  /**
   * Create message element
   */
  _createMessage(message, sender, persist = true) {
    if (this.isDestroyed || !this.chatContainer) return;

    const messageElement = document.createElement("div");
    messageElement.className = `chatbot-message-bubble chatbot-message-${sender}`;

    // Add bot avatar for all bot messages
    if (sender === "bot") {
      const avatar = document.createElement("div");
      avatar.className = "chatbot-bot-avatar";
      avatar.textContent = this.options.icon;
      messageElement.appendChild(avatar);
    }

    const content = document.createElement("div");
    content.className = "chatbot-message-content";
    content.textContent = message;

    const messageWrapper = document.createElement("div");
    messageWrapper.appendChild(content);

    const timestamp = document.createElement("div");
    timestamp.className = "chatbot-message-timestamp";
    timestamp.textContent = new Date().toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
    messageWrapper.appendChild(timestamp);

    messageElement.appendChild(messageWrapper);
    
    if (this.chatContainer && !this.isDestroyed) {
      this.chatContainer.appendChild(messageElement);
    }

    // Persist message only if enabled and requested
    if (persist && this.options.persistMessages && !this.isDestroyed) {
      this.messages.push({
        content: message,
        sender: sender,
        timestamp: Date.now(),
      });
      this.saveMessages();
    }
  }

  /**
   * Update status
   */
  updateStatus(status) {
    if (!this.statusBar || this.isDestroyed) return this;

    this.currentStatus = status;

    const statusConfig = {
      ready: "Ready to help",
      searching: "Searching for jobs...",
      applying: "Applying to jobs...",
      paused: "Paused",
      stopped: "Stopped",
    };

    const dot = this.statusBar.querySelector(".chatbot-status-dot");
    const text = this.statusBar.querySelector("span:last-child");

    if (dot && text) {
      this.statusBar.className = `chatbot-status-indicator chatbot-status-${status}`;
      text.textContent = statusConfig[status] || status;
    }

    return this;
  }

  /**
   * Show typing indicator
   */
  showTypingIndicator() {
    if (this.isDestroyed || !this.chatContainer) return;

    this.hideTypingIndicator();

    const indicator = document.createElement("div");
    indicator.className = "chatbot-typing-indicator";
    indicator.id = "chatbot-typing";

    const avatar = document.createElement("div");
    avatar.className = "chatbot-bot-avatar";
    avatar.textContent = this.options.icon;

    const typingContent = document.createElement("div");
    typingContent.className = "chatbot-typing-content";

    const dots = document.createElement("div");
    dots.className = "chatbot-typing-dots";
    dots.innerHTML = `
      <div class="chatbot-typing-dot"></div>
      <div class="chatbot-typing-dot"></div>
      <div class="chatbot-typing-dot"></div>
    `;

    typingContent.appendChild(dots);
    indicator.appendChild(avatar);
    indicator.appendChild(typingContent);
    
    if (this.chatContainer && !this.isDestroyed) {
      this.chatContainer.appendChild(indicator);
      this._scrollToBottom();
    }
  }

  hideTypingIndicator() {
    if (this.isDestroyed) return;

    const existing = document.getElementById("chatbot-typing");
    if (existing) {
      existing.remove();
    }
  }

  /**
   * Initial greeting
   */
  addGreeting() {
    if (this.isDestroyed) return;

    const timeoutId1 = setTimeout(() => {
      if (!this.isDestroyed) {
        this.addMessage(
          `Hi! I'm ${this.options.botName}, your automation assistant! 👋`
        );
        const timeoutId2 = setTimeout(() => {
          if (!this.isDestroyed) {
            this.addMessage(
              "I'll keep you updated on the job application process! 🚀"
            );
          }
        }, 1200);
        this.pendingTimeouts.push(timeoutId2);
      }
    }, 500);
    this.pendingTimeouts.push(timeoutId1);
  }

  /**
   * Handle automation completion (called when automation stops)
   */
  async handleAutomationComplete() {
    if (this.isDestroyed) return;

    this.automationState = "completed";
    this.isPaused = false;
    this.updateStatus("completed", "All done!");

    // Clear messages after a delay
    const timeoutId = setTimeout(() => {
      if (!this.isDestroyed) {
        this.clearMessages();
        this.greetingShown = false;
      }
    }, 3000);
    this.pendingTimeouts.push(timeoutId);
  }

  /**
   * Simulate automation states for testing
   */
  startAutomation() {
    if (this.isDestroyed) return;

    this.automationState = "searching";
    this.updateStatus("searching");
    this.addMessage("Starting job search automation...");
  }

  simulateApplying() {
    if (this.isDestroyed) return;

    this.automationState = "applying";
    this.updateStatus("applying");
    this.addMessage("Now applying to jobs...");
  }

  /**
   * Toggle minimize state
   */
  toggleMinimize() {
    if (this.isDestroyed) return this;

    this.isMinimized = !this.isMinimized;

    const minimizeBtn = this.container?.querySelector(".chatbot-minimize-btn");
    if (minimizeBtn) {
      minimizeBtn.innerHTML = this.isMinimized ? "▲" : "▼";
    }

    if (this.chatContainer) {
      this.chatContainer.style.display = this.isMinimized ? "none" : "block";
    }

    return this;
  }

  /**
   * Helper methods
   */
  _scrollToBottom() {
    if (this.isDestroyed || !this.chatContainer) return;

    const timeoutId = setTimeout(() => {
      if (!this.isDestroyed && this.chatContainer) {
        this.chatContainer.scrollTop = this.chatContainer.scrollHeight;
      }
    }, 100);
    this.pendingTimeouts.push(timeoutId);
  }

  show() {
    if (!this.container || this.isDestroyed) return this;
    this.isVisible = true;
    this.container.style.display = "block";
    return this;
  }

  hide() {
    if (!this.container || this.isDestroyed) return this;
    this.isVisible = false;
    this.container.style.display = "none";
    return this;
  }

  /**
   * Destroy overlay - Enhanced cleanup
   */
  destroy() {
    // Mark as destroyed first to prevent further operations
    this.isDestroyed = true;

    // Clear all pending timeouts
    this.pendingTimeouts.forEach(timeoutId => {
      clearTimeout(timeoutId);
    });
    this.pendingTimeouts = [];

    // Disconnect port
    if (this.port) {
      try {
        this.port.disconnect();
      } catch (e) {}
      this.port = null;
    }

    // Remove DOM elements
    const existing = document.getElementById(this.options.id);
    if (existing) {
      existing.remove();
    }

    // Clear references
    this.container = null;
    this.chatContainer = null;
    this.statusBar = null;

    return this;
  }
}

// Export for use
export default ChatbotStatusOverlay;

// Add to window for testing
if (typeof window !== "undefined") {
  window.ChatbotStatusOverlay = ChatbotStatusOverlay;

  // Test function that mimics your initialization
  window.testChatbot = () => {
    const overlay = new ChatbotStatusOverlay({
      id: "test-platform-status-overlay",
      platform: "TESTPLATFORM",
      sessionId: "test-session-123",
      userId: "test-user-456",
      icon: "🤖",
      position: { top: "10px", left: "10px" },
      persistMessages: false,
    });

    // Simulate automation states for testing
    setTimeout(() => {
      overlay.startAutomation();
      console.log("Automation started - status updated");
    }, 3000);

    return overlay;
  };
}