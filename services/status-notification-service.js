/**
 * ChatbotStatusOverlay - An interactive chatbot-style status notification system
 * Provides conversational feedback with a modern chat interface
 * BRANDED VERSION with custom color scheme
 */
//icon
class ChatbotStatusOverlay {
  constructor(options = {}) {
    this.options = {
      id: options.id || "chatbot-status-overlay",
      title: options.title || "Job Assistant",
      botName: options.botName || "FastApply Bot",
      platform: options.platform || "AUTOMATION",
      icon: options.icon || "🤖",
      position: options.position || { top: "20px", right: "20px" },
      width: options.width || "380px",
      maxHeight: options.maxHeight || "500px",
      maxMessages: options.maxMessages || 50,
      autoHide: options.autoHide || false,
      autoHideDelay: options.autoHideDelay || 8000,
      enableSound: options.enableSound || false,
      ...options,
    };

    // State
    this.container = null;
    this.chatContainer = null;
    this.statusBar = null;
    this.isVisible = true;
    this.isMinimized = false;
    this.messageCount = 0;
    this.currentStatus = "ready";
    this.typingTimeout = null;

    // Create styles first
    this.injectStyles();

    // Initialize if not set to manual
    if (!options.manual) {
      this.create();
    }
  }

  /**
   * Inject required CSS styles with BRAND COLORS
   */
  injectStyles() {
    if (document.getElementById("chatbot-overlay-styles")) return;

    const styles = document.createElement("style");
    styles.id = "chatbot-overlay-styles";
    styles.textContent = `
      @keyframes chatbotSlideIn {
        from { 
          opacity: 0; 
          transform: translateX(100%) scale(0.8); 
        }
        to { 
          opacity: 1; 
          transform: translateX(0) scale(1); 
        }
      }

      @keyframes chatbotSlideOut {
        from { 
          opacity: 1; 
          transform: translateX(0) scale(1); 
        }
        to { 
          opacity: 0; 
          transform: translateX(100%) scale(0.8); 
        }
      }

      @keyframes messageFadeIn {
        from { 
          opacity: 0; 
          transform: translateY(10px); 
        }
        to { 
          opacity: 1; 
          transform: translateY(0); 
        }
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
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
        line-height: 1.4;
        user-select: none;
      }

      .chatbot-overlay-container * {
        box-sizing: border-box;
      }

      .chatbot-message-bubble {
        max-width: 85%;
        margin: 8px 0;
        animation: messageFadeIn 0.3s ease-out;
      }

      .chatbot-message-content {
        padding: 10px 14px;
        border-radius: 18px;
        font-size: 13px;
        line-height: 1.3;
        position: relative;
        word-wrap: break-word;
      }

      .chatbot-message-bot .chatbot-message-content {
        background: linear-gradient(135deg, #0ea5e9 0%, #0284c7 100%);
        color: white;
        margin-left: 40px;
        border-bottom-left-radius: 4px;
        box-shadow: 0 2px 12px rgba(14, 165, 233, 0.3);
      }

      .chatbot-message-system .chatbot-message-content {
        background: #f0f9ff;
        color: #075985;
        margin: 4px 20px;
        border-radius: 12px;
        text-align: center;
        font-size: 12px;
        padding: 6px 12px;
        border: 1px solid #bae6fd;
      }

      .chatbot-bot-avatar {
        position: absolute;
        left: 0;
        bottom: 0;
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
      }

      .chatbot-message-timestamp {
        font-size: 11px;
        color: rgba(255,255,255,0.8);
        margin-top: 4px;
        margin-left: 40px;
      }

      .chatbot-message-system .chatbot-message-timestamp {
        margin-left: 0;
        text-align: center;
        color: #075985;
      }

      .chatbot-typing-indicator {
        display: flex;
        align-items: center;
        padding: 10px 14px;
        background: #f0f9ff;
        border-radius: 18px;
        border-bottom-left-radius: 4px;
        margin-left: 40px;
        max-width: 80px;
        margin-bottom: 8px;
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

      .chatbot-typing-dot:nth-child(2) {
        animation-delay: 0.2s;
      }

      .chatbot-typing-dot:nth-child(3) {
        animation-delay: 0.4s;
      }

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
        animation: statusPulse 2s infinite;
      }

      .chatbot-status-error .chatbot-status-dot { background: #ef4444; }
      .chatbot-status-warning .chatbot-status-dot { background: #f59e0b; }
      .chatbot-status-info .chatbot-status-dot { background: #0ea5e9; }
      .chatbot-status-applying .chatbot-status-dot { background: #7dd3fc; }
      .chatbot-status-success .chatbot-status-dot { background: #22c55e; }

      .chatbot-minimize-btn {
        background: none;
        border: none;
        color: rgba(255,255,255,0.8);
        cursor: pointer;
        padding: 4px;
        border-radius: 4px;
        transition: background 0.2s;
      }

      .chatbot-minimize-btn:hover {
        background: rgba(255,255,255,0.2);
        color: white;
      }

      .chatbot-header-actions {
        display: flex;
        gap: 4px;
        align-items: center;
      }

      .chatbot-platform-badge {
        background: rgba(255,255,255,0.25);
        color: white;
        padding: 2px 8px;
        border-radius: 10px;
        font-size: 10px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        border: 1px solid rgba(255,255,255,0.3);
      }
    `;
    document.head.appendChild(styles);
  }

  /**
   * Create the chatbot overlay
   */
  create() {
    this.destroy(); // Remove existing overlay if any

    // Create main container
    this.container = document.createElement("div");
    this.container.id = this.options.id;
    this.container.className = "chatbot-overlay-container";
    this.container.style.cssText = `
      position: fixed;
      top: ${this.options.position.top};
      right: ${this.options.position.right};
      width: ${this.options.width};
      max-height: ${this.options.maxHeight};
      background: white;
      border-radius: 16px;
      box-shadow: 0 8px 30px rgba(14, 165, 233, 0.15), 0 0 0 1px rgba(14, 165, 233, 0.1);
      z-index: 9999999;
      overflow: hidden;
      animation: chatbotSlideIn 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
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
      position: relative;
    `;

    this.container.appendChild(this.chatContainer);
    document.body.appendChild(this.container);

    // Initial greeting
    this.addGreeting();
    this.updateStatus("ready");

    return this;
  }

  /**
   * Create the header section with BRAND COLORS
   */
  createHeader() {
    const header = document.createElement("div");
    header.style.cssText = `
      background: linear-gradient(135deg,rgb(9, 12, 13) 0%,rgb(23, 66, 88) 50%, #0369a1 100%);
      color: white;
      padding: 16px 20px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      cursor: pointer;
      border-bottom: 1px solid rgba(255,255,255,0.2);
    `;

    // Left side - Bot info
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
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
    `;
    avatar.textContent = this.options.icon;

    const textInfo = document.createElement("div");

    const botName = document.createElement("div");
    botName.style.cssText = `
      font-weight: 600;
      font-size: 16px;
      margin-bottom: 2px;
      text-shadow: 0 1px 2px rgba(0,0,0,0.1);
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

    botInfo.appendChild(avatar);
    botInfo.appendChild(textInfo);

    // Right side - Actions
    const actions = document.createElement("div");
    actions.className = "chatbot-header-actions";

    const platformBadge = document.createElement("span");
    platformBadge.className = "chatbot-platform-badge";
    platformBadge.textContent = this.options.platform;

    const minimizeBtn = document.createElement("button");
    minimizeBtn.className = "chatbot-minimize-btn";
    minimizeBtn.innerHTML = this.isMinimized ? "▲" : "▼";
    minimizeBtn.title = this.isMinimized ? "Expand" : "Minimize";

    actions.appendChild(platformBadge);
    actions.appendChild(minimizeBtn);

    header.appendChild(botInfo);
    header.appendChild(actions);

    // Add click handlers
    minimizeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.toggleMinimize();
    });

    header.addEventListener("click", () => {
      if (this.isMinimized) {
        this.toggleMinimize();
      }
    });

    return header;
  }

  /**
   * Add initial greeting message
   */
  addGreeting() {
    const greetings = [
      `Hi! I'm ${this.options.botName}, your automation assistant.`,
      "I'll keep you updated on the job application process.",
      "Let's find you some great opportunities! 🚀",
    ];

    // Add greeting with delay for natural feel
    setTimeout(() => {
      this.addBotMessage(greetings[0]);
      setTimeout(() => {
        this.addBotMessage(greetings[1]);
        setTimeout(() => {
          this.addBotMessage(greetings[2]);
        }, 1200);
      }, 800);
    }, 500);
  }

  /**
   * Add a bot message
   */
  addBotMessage(message, type = "info") {
    if (!this.chatContainer || this.isMinimized) return this;

    this.showTypingIndicator();

    setTimeout(() => {
      this.hideTypingIndicator();
      this._createMessage(message, "bot", type);
      this._scrollToBottom();
      this.messageCount++;
      this._enforceMessageLimit();
    }, 800 + Math.random() * 400); // Realistic typing delay

    return this;
  }

  /**
   * Add system message (like status updates)
   */
  addSystemMessage(message) {
    if (!this.chatContainer || this.isMinimized) return this;

    this._createMessage(message, "system");
    this._scrollToBottom();
    this.messageCount++;
    this._enforceMessageLimit();

    return this;
  }

  /**
   * Show typing indicator
   */
  showTypingIndicator() {
    this.hideTypingIndicator(); // Remove existing

    const indicator = document.createElement("div");
    indicator.className = "chatbot-typing-indicator";
    indicator.id = "chatbot-typing";

    const dots = document.createElement("div");
    dots.className = "chatbot-typing-dots";
    dots.innerHTML = `
      <div class="chatbot-typing-dot"></div>
      <div class="chatbot-typing-dot"></div>
      <div class="chatbot-typing-dot"></div>
    `;

    indicator.appendChild(dots);
    this.chatContainer.appendChild(indicator);
    this._scrollToBottom();
  }

  /**
   * Hide typing indicator
   */
  hideTypingIndicator() {
    const existing = document.getElementById("chatbot-typing");
    if (existing) {
      existing.remove();
    }
  }

  /**
   * Create message element
   */
  _createMessage(message, sender, type = "info") {
    const messageElement = document.createElement("div");
    messageElement.className = `chatbot-message-bubble chatbot-message-${sender}`;

    if (sender === "bot") {
      // Add bot avatar
      const avatar = document.createElement("div");
      avatar.className = "chatbot-bot-avatar";
      avatar.textContent = this.options.icon;
      messageElement.appendChild(avatar);
    }

    const content = document.createElement("div");
    content.className = "chatbot-message-content";
    content.textContent = message;

    // Add emoji based on message type
    const emoji = this._getEmojiForType(type);
    if (emoji && sender === "bot") {
      content.textContent = `${emoji} ${message}`;
    }

    messageElement.appendChild(content);

    // Add timestamp
    const timestamp = document.createElement("div");
    timestamp.className = "chatbot-message-timestamp";
    timestamp.textContent = new Date().toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
    messageElement.appendChild(timestamp);

    this.chatContainer.appendChild(messageElement);
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
   * Update status in header
   */
  updateStatus(status, details = "") {
    if (!this.statusBar) return this;

    this.currentStatus = status;
    const statusConfig = this._getStatusConfig(status);

    const dot = this.statusBar.querySelector(".chatbot-status-dot");
    const text = this.statusBar.querySelector("span:last-child");

    if (dot) {
      this.statusBar.className = `chatbot-status-indicator chatbot-status-${status}`;
    }

    if (text) {
      text.textContent = details || statusConfig.text;
    }

    return this;
  }

  /**
   * Get status configuration
   */
  _getStatusConfig(status) {
    const configs = {
      ready: { text: "Ready to help" },
      searching: { text: "Searching for jobs..." },
      applying: { text: "Applying to jobs..." },
      success: { text: "Application successful!" },
      error: { text: "Encountered an issue" },
      warning: { text: "Attention needed" },
      info: { text: "Processing..." },
      completed: { text: "All done!" },
    };

    return configs[status] || { text: status };
  }

  /**
   * Convenience methods for different message types
   */
  addError(error) {
    const message =
      typeof error === "string"
        ? error
        : error.message || "Something went wrong";
    this.addBotMessage(`Oops! ${message}`, "error");
    this.updateStatus("error", "Issue detected");
    this._playNotificationSound();
    return this;
  }

  addSuccess(message) {
    this.addBotMessage(`Great! ${message}`, "success");
    this.updateStatus("success");
    return this;
  }

  addWarning(message) {
    this.addBotMessage(`Heads up: ${message}`, "warning");
    this.updateStatus("warning");
    return this;
  }

  addInfo(message) {
    this.addBotMessage(message, "info");
    return this;
  }

  /**
   * Toggle minimize state
   */
  toggleMinimize() {
    this.isMinimized = !this.isMinimized;

    const minimizeBtn = this.container.querySelector(".chatbot-minimize-btn");
    if (minimizeBtn) {
      minimizeBtn.innerHTML = this.isMinimized ? "▲" : "▼";
      minimizeBtn.title = this.isMinimized ? "Expand" : "Minimize";
    }

    if (this.chatContainer) {
      this.chatContainer.style.display = this.isMinimized ? "none" : "block";
    }

    return this;
  }

  /**
   * Show/hide the entire overlay
   */
  show() {
    if (!this.container) return this;
    this.isVisible = true;
    this.container.style.display = "block";
    this.container.style.animation =
      "chatbotSlideIn 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)";
    return this;
  }

  hide() {
    if (!this.container) return this;
    this.isVisible = false;
    this.container.style.animation = "chatbotSlideOut 0.3s ease-in-out";
    setTimeout(() => {
      if (this.container) {
        this.container.style.display = "none";
      }
    }, 300);
    return this;
  }

  toggle() {
    return this.isVisible ? this.hide() : this.show();
  }

  /**
   * Clear all messages except greeting
   */
  clear() {
    if (this.chatContainer) {
      this.chatContainer.innerHTML = "";
      this.messageCount = 0;
      this.addGreeting();
    }
    return this;
  }

  /**
   * Internal helper methods
   */
  _scrollToBottom() {
    if (this.chatContainer) {
      setTimeout(() => {
        this.chatContainer.scrollTop = this.chatContainer.scrollHeight;
      }, 100);
    }
  }

  _enforceMessageLimit() {
    if (this.messageCount > this.options.maxMessages) {
      const messages = this.chatContainer.querySelectorAll(
        ".chatbot-message-bubble"
      );
      const toRemove = Math.min(10, messages.length - this.options.maxMessages);

      for (let i = 0; i < toRemove; i++) {
        if (messages[i]) {
          messages[i].remove();
          this.messageCount--;
        }
      }
    }
  }

  _playNotificationSound() {
    if (this.options.enableSound) {
      try {
        const audio = new Audio(
          "data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+XwwmwhBCdz0/LRfC0FP4R00g=="
        );
        audio.volume = 0.3;
        audio.play().catch(() => {}); // Ignore errors
      } catch (e) {
        // Silent fail
      }
    }
  }

  /**
   * Update position
   */
  setPosition(position) {
    if (!this.container) return this;

    if (position.top !== undefined) this.container.style.top = position.top;
    if (position.right !== undefined)
      this.container.style.right = position.right;
    if (position.bottom !== undefined)
      this.container.style.bottom = position.bottom;
    if (position.left !== undefined) this.container.style.left = position.left;

    return this;
  }

  /**
   * Update the title/bot name
   */
  setTitle(title) {
    this.options.title = title;
    this.options.botName = title;

    const botNameElement = this.container?.querySelector(
      "div:first-child div:last-child div:first-child"
    );
    if (botNameElement) {
      botNameElement.textContent = title;
    }
    return this;
  }

  /**
   * Destroy the overlay
   */
  destroy() {
    const existing = document.getElementById(this.options.id);
    if (existing) {
      existing.remove();
    }

    this.container = null;
    this.chatContainer = null;
    this.statusBar = null;
    this.messageCount = 0;

    return this;
  }

  /**
   * Check if overlay exists
   */
  exists() {
    return !!this.container && document.body.contains(this.container);
  }
}

// Export as StatusOverlay for backward compatibility
export default ChatbotStatusOverlay;
