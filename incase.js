// Platform-specific automation handlers

// class LeverAutomationHandler {
//   constructor(messageHandler) {
//     this.messageHandler = messageHandler;
//     this.portConnections = new Map();
//     this.sessionPorts = new Map();
//     this.activeConnections = new Set();
//     this.lastKeepalive = new Map();
//     this.errorCounts = new Map();
//     this.maxErrors = 5;
//     this.processingMessages = new Set();
//     this.processedCompletions = new Set();

//     // Start cleanup process
//     this.startPeriodicCleanup();
//   }

//   safePortDisconnect(port) {
//     try {
//       if (port && typeof port.disconnect === "function") {
//         port.disconnect();
//       }
//     } catch (error) {
//       // Ignore disconnection errors
//     }
//   }

//   startPeriodicCleanup() {
//     setInterval(() => {
//       const now = Date.now();
//       const staleThreshold = 120000; // 2 minutes

//       // Clean up stale ports
//       for (const [portName, lastSeen] of this.lastKeepalive.entries()) {
//         if (now - lastSeen > staleThreshold) {
//           console.log(`🧹 Cleaning up stale port: ${portName}`);
//           this.activeConnections.delete(portName);
//           this.lastKeepalive.delete(portName);
//         }
//       }

//       // Clean up old completions
//       if (this.processedCompletions.size > 100) {
//         const entries = Array.from(this.processedCompletions);
//         this.processedCompletions = new Set(entries.slice(-50));
//       }
//     }, 60000);
//   }

//   cleanup() {
//     console.log("🧹 Starting LeverAutomationHandler cleanup");

//     // Clear all port connections
//     for (const port of this.portConnections.values()) {
//       try {
//         this.activeConnections.delete(port.name);
//         port.disconnect();
//       } catch (e) {
//         // Ignore errors
//       }
//     }

//     this.portConnections.clear();
//     this.sessionPorts.clear();
//     this.activeConnections.clear();
//     this.lastKeepalive.clear();
//     this.errorCounts.clear();
//     this.processingMessages.clear();

//     if (this.processedCompletions) {
//       this.processedCompletions.clear();
//     }

//     console.log("✅ LeverAutomationHandler cleanup completed");
//   }

//   safePortSend(port, message) {
//     try {
//       // Check if port exists and is in active connections
//       if (!port || !port.name || !this.activeConnections.has(port.name)) {
//         console.warn(
//           `⚠️ Cannot send message to disconnected/invalid port: ${message.type}`
//         );
//         return false;
//       }

//       // Check if sender still exists (indicates port is alive)
//       if (!port.sender || !port.sender.tab) {
//         console.warn(`⚠️ Port sender no longer exists: ${message.type}`);
//         this.activeConnections.delete(port.name);
//         return false;
//       }

//       // Attempt to send message
//       port.postMessage(message);

//       // Update keepalive on successful send
//       this.lastKeepalive.set(port.name, Date.now());

//       return true;
//     } catch (error) {
//       console.warn(
//         `⚠️ Failed to send port message (${message.type}):`,
//         error.message
//       );

//       // Clean up failed port
//       if (port && port.name) {
//         this.activeConnections.delete(port.name);
//         this.lastKeepalive.delete(port.name);
//       }

//       return false;
//     }
//   }

//   isPortAlive(port) {
//     try {
//       // Check if port is still connected and hasn't been cleaned up
//       return (
//         port &&
//         port.sender &&
//         !chrome.runtime.lastError &&
//         this.activeConnections.has(port.name)
//       );
//     } catch (error) {
//       return false;
//     }
//   }

//   async sendSearchNextMessage(windowId, data, retryCount = 0) {
//     const maxRetries = 1; // Reduced retries

//     try {
//       console.log(
//         `📤 Sending SEARCH_NEXT message to Lever window ${windowId}:`,
//         data
//       );

//       const tabs = await chrome.tabs.query({ windowId: windowId });

//       for (const tab of tabs) {
//         if (tab.url && tab.url.includes("google.com/search")) {
//           // Try port first
//           const port = this.portConnections.get(tab.id);
//           if (port && this.isPortAlive(port)) {
//             try {
//               this.safePortSend(port, {
//                 type: "SEARCH_NEXT",
//                 data: data,
//               });
//               console.log(
//                 `✅ Sent SEARCH_NEXT via port to Lever tab ${tab.id}`
//               );
//               return true;
//             } catch (error) {
//               console.warn("⚠️ Port message failed, trying tabs API:", error);
//             }
//           }

//           // Fallback to tabs API
//           try {
//             await chrome.tabs.sendMessage(tab.id, {
//               type: "SEARCH_NEXT",
//               data: data,
//             });
//             console.log(
//               `✅ Sent SEARCH_NEXT via tabs API to Lever tab ${tab.id}`
//             );
//             return true;
//           } catch (error) {
//             console.warn("⚠️ Tabs API message failed:", error);
//             if (retryCount < maxRetries) {
//               // Retry after delay
//               setTimeout(() => {
//                 this.sendSearchNextMessage(windowId, data, retryCount + 1);
//               }, 3000 * (retryCount + 1));
//               return true;
//             }
//           }
//         }
//       }

//       console.warn(
//         "⚠️ Could not find Lever search tab to send SEARCH_NEXT message"
//       );
//       return false;
//     } catch (error) {
//       console.error("❌ Error sending Lever SEARCH_NEXT message:", error);
//       return false;
//     }
//   }

//   getSessionIdFromPort(port) {
//     const portName = port.name;
//     const parts = portName.split("-");
//     return parts.length > 3 ? parts[3] : null;
//   }

//   async handleSendCvTaskError(port, data) {
//     try {
//       const windowId = port.sender?.tab?.windowId;
//       const tabId = port.sender?.tab?.id;
//       const sessionId = this.getSessionIdFromPort(port);

//       console.log(`❌ Lever job application failed in tab ${tabId}:`, data);

//       // Prevent duplicate error processing
//       if (data && data.completionId) {
//         const completionKey = `error-${sessionId}-${data.completionId}`;
//         if (this.processedCompletions.has(completionKey)) {
//           console.log(
//             `⚠️ Error completion ${data.completionId} already processed`
//           );
//           return;
//         }
//         this.processedCompletions.add(completionKey);
//       }

//       // Track errors per session
//       const errorCount = (this.errorCounts.get(sessionId) || 0) + 1;
//       this.errorCounts.set(sessionId, errorCount);

//       // Find automation
//       let automation = null;
//       for (const [
//         sid,
//         auto,
//       ] of this.messageHandler.activeAutomations.entries()) {
//         if (auto.windowId === windowId) {
//           automation = auto;
//           break;
//         }
//       }

//       if (automation) {
//         // Update submitted links
//         const url = automation.platformState.currentJobUrl;
//         if (url && automation.platformState.submittedLinks) {
//           const linkIndex = automation.platformState.submittedLinks.findIndex(
//             (link) =>
//               this.messageHandler.normalizeUrl(link.url) ===
//               this.messageHandler.normalizeUrl(url)
//           );
//           if (linkIndex >= 0) {
//             automation.platformState.submittedLinks[linkIndex].status = "ERROR";
//             automation.platformState.submittedLinks[linkIndex].error = data;
//           }
//         }

//         // Close job tab
//         if (automation.platformState.currentJobTabId) {
//           try {
//             await chrome.tabs.remove(automation.platformState.currentJobTabId);
//           } catch (error) {
//             console.warn("⚠️ Error closing job tab:", error);
//           }
//         }

//         // Reset processing state
//         automation.platformState.isProcessingJob = false;
//         const oldUrl = automation.platformState.currentJobUrl;
//         automation.platformState.currentJobUrl = null;
//         automation.platformState.currentJobTabId = null;
//         automation.platformState.applicationStartTime = null;

//         // Continue with delay if not too many errors
//         if (errorCount < this.maxErrors) {
//           const delay = Math.min(3000 * errorCount, 15000);
//           console.log(
//             `⏳ Waiting ${delay}ms before continuing (error ${errorCount}/${this.maxErrors})`
//           );

//           setTimeout(async () => {
//             await this.sendSearchNextMessage(windowId, {
//               url: oldUrl,
//               status: "ERROR",
//               message: typeof data === "string" ? data : "Application error",
//               errorCount: errorCount,
//             });
//           }, delay);
//         } else {
//           console.error(
//             `🚨 Too many errors (${errorCount}) for session ${sessionId}, stopping automation`
//           );
//           this.safePortSend(port, {
//             type: "AUTOMATION_STOPPED",
//             message: `Too many errors (${errorCount}), automation stopped`,
//           });
//           this.errorCounts.delete(sessionId);
//           return;
//         }
//       }

//       this.safePortSend(port, {
//         type: "SUCCESS",
//         message: "Error acknowledged",
//       });
//     } catch (error) {
//       console.error("❌ Error handling SEND_CV_TASK_ERROR:", error);
//     }
//   }

//   async handleKeepalive(port, data) {
//     // Simply respond to keepalive
//     this.safePortSend(port, {
//       type: "KEEPALIVE_RESPONSE",
//       data: { timestamp: Date.now() },
//     });
//   }

//   cleanupPort(port, tabId, sessionId) {
//     if (port && port.name) {
//       this.activeConnections.delete(port.name);
//       this.lastKeepalive.delete(port.name);
//     }

//     if (tabId) {
//       this.portConnections.delete(tabId);
//     }

//     if (sessionId) {
//       const sessionPortSet = this.sessionPorts.get(sessionId);
//       if (sessionPortSet) {
//         sessionPortSet.delete(port);
//         if (sessionPortSet.size === 0) {
//           this.sessionPorts.delete(sessionId);
//         }
//       }
//     }
//   }

//   cleanupPortsForTab(tabId) {
//     const existingPort = this.portConnections.get(tabId);
//     if (existingPort) {
//       console.log(`🧹 Cleaning up existing port for tab ${tabId}`);

//       // Remove from active connections
//       this.activeConnections.delete(existingPort.name);

//       try {
//         existingPort.disconnect();
//       } catch (e) {
//         // Ignore errors when disconnecting
//       }
//       this.portConnections.delete(tabId);
//     }
//   }

//   extractSessionFromPortName(portName) {
//     // Extract session from port name like "lever-apply-123456-abc123"
//     const parts = portName.split("-");
//     return parts.length > 3 ? parts[3] : null;
//   }

//   handlePortConnection(port) {
//     const portNameParts = port.name.split("-");
//     const portType = portNameParts[1]; // 'search' or 'apply'
//     const timestamp = portNameParts[2];
//     const sessionId = portNameParts[3]; // Extract session ID
//     const tabId = port.sender?.tab?.id;

//     // Prevent duplicate connections
//     if (this.activeConnections.has(port.name)) {
//       console.log(`⚠️ Duplicate port connection attempt: ${port.name}`);
//       this.safePortDisconnect(port);
//       return;
//     }

//     console.log(
//       `📝 Registering Lever ${portType} port for tab ${tabId}, session ${sessionId}`
//     );

//     // Clean up existing port for this tab
//     if (tabId && this.portConnections.has(tabId)) {
//       const existingPort = this.portConnections.get(tabId);
//       this.cleanupPort(existingPort, tabId, sessionId);
//     }

//     // Register new port
//     this.activeConnections.add(port.name);
//     if (tabId) {
//       this.portConnections.set(tabId, port);
//     }

//     // Track by session
//     if (sessionId) {
//       if (!this.sessionPorts.has(sessionId)) {
//         this.sessionPorts.set(sessionId, new Set());
//       }
//       this.sessionPorts.get(sessionId).add(port);
//     }

//     // Set initial keepalive
//     this.lastKeepalive.set(port.name, Date.now());

//     // Set up message handler with error protection
//     port.onMessage.addListener((message) => {
//       const messageId = `${port.name}-${message.type}-${Date.now()}`;

//       if (this.processingMessages.has(messageId)) {
//         console.log(
//           `⚠️ Duplicate message ignored: ${message.type} from ${port.name}`
//         );
//         return;
//       }

//       this.processingMessages.add(messageId);

//       try {
//         this.handlePortMessage(message, port);
//       } catch (error) {
//         console.error(`❌ Error handling message ${message.type}:`, error);
//         this.safePortSend(port, {
//           type: "ERROR",
//           message: `Error processing ${message.type}: ${error.message}`,
//         });
//       } finally {
//         // Clean up after 1 second
//         setTimeout(() => this.processingMessages.delete(messageId), 1000);
//       }
//     });

//     // Handle disconnection
//     port.onDisconnect.addListener(() => {
//       console.log(`📪 Lever port disconnected: ${port.name}`);
//       this.cleanupPort(port, tabId, sessionId);
//     });

//     // Send connection confirmation - ONLY if port is still active
//     setTimeout(() => {
//       if (this.activeConnections.has(port.name)) {
//         this.safePortSend(port, {
//           type: "CONNECTION_ESTABLISHED",
//           data: { tabId, sessionId, portType },
//         });
//       }
//     }, 100);
//   }

//   async handleGetSearchTask(port, data) {
//     const tabId = port.sender?.tab?.id;
//     const windowId = port.sender?.tab?.windowId;

//     let sessionData = null;
//     for (const [
//       sessionId,
//       automation,
//     ] of this.messageHandler.activeAutomations.entries()) {
//       if (automation.windowId === windowId) {
//         const platformState = automation.platformState;
//         sessionData = {
//           tabId: tabId,
//           limit: platformState.searchData.limit,
//           current: platformState.searchData.current,
//           domain: platformState.searchData.domain,
//           submittedLinks: platformState.submittedLinks || [],
//           searchLinkPattern:
//             platformState.searchData.searchLinkPattern.toString(),
//         };

//         // Update search tab ID
//         platformState.searchTabId = tabId;
//         break;
//       }
//     }

//     this.messageHandler.sendPortResponse(port, {
//       type: "SUCCESS",
//       data: sessionData || {},
//     });
//   }

//   async handleGetSendCvTask(port, data) {
//     const tabId = port.sender?.tab?.id;
//     const windowId = port.sender?.tab?.windowId;

//     console.log(
//       `🔍 GET_SEND_CV_TASK request from tab ${tabId}, window ${windowId}`
//     );

//     let sessionData = null;
//     let automation = null;

//     // Find automation by window ID
//     for (const [
//       sessionId,
//       auto,
//     ] of this.messageHandler.activeAutomations.entries()) {
//       if (auto.windowId === windowId) {
//         automation = auto;
//         console.log(`✅ Found automation session: ${sessionId}`);
//         break;
//       }
//     }

//     if (automation) {
//       // FIXED: Ensure we have user profile data
//       let userProfile = automation.userProfile;

//       // If no user profile in automation, try to fetch from user service
//       if (!userProfile && automation.userId) {
//         try {
//           console.log(`📡 Fetching user profile for user ${automation.userId}`);

//           // Import UserService dynamically
//           const { default: UserService } = await import(
//             "../../services/user-service.js"
//           );
//           const userService = new UserService({ userId: automation.userId });
//           userProfile = await userService.getUserDetails();

//           // Cache it in automation for future use
//           automation.userProfile = userProfile;

//           console.log(`✅ User profile fetched and cached`);
//         } catch (error) {
//           console.error(`❌ Failed to fetch user profile:`, error);
//         }
//       }

//       sessionData = {
//         devMode: automation.params?.devMode || false,
//         profile: userProfile || null,
//         session: automation.sessionConfig || null,
//         avatarUrl: userProfile?.avatarUrl || null,
//         userId: automation.userId,
//         sessionId: automation.sessionId || null,
//       };

//       console.log(`📊 Session data prepared:`, {
//         hasProfile: !!sessionData.profile,
//         hasSession: !!sessionData.session,
//         userId: sessionData.userId,
//         devMode: sessionData.devMode,
//       });
//     } else {
//       console.warn(`⚠️ No automation found for window ${windowId}`);
//       sessionData = {
//         devMode: false,
//         profile: null,
//         session: null,
//         avatarUrl: null,
//         userId: null,
//         sessionId: null,
//       };
//     }

//     // Send response with detailed logging
//     const sent = this.safePortSend(port, {
//       type: "SUCCESS",
//       data: sessionData,
//     });

//     if (!sent) {
//       console.error(`❌ Failed to send CV task data to port ${port.name}`);
//     } else {
//       console.log(`✅ CV task data sent successfully to tab ${tabId}`);
//     }
//   }

//   async handleSendCvTask(port, data) {
//     try {
//       const { url, title } = data;
//       const windowId = port.sender?.tab?.windowId;

//       console.log(`🎯 Opening Lever job in new tab: ${url}`);

//       let automation = null;
//       for (const [
//         sessionId,
//         auto,
//       ] of this.messageHandler.activeAutomations.entries()) {
//         if (auto.windowId === windowId) {
//           automation = auto;
//           break;
//         }
//       }

//       if (!automation) {
//         throw new Error("No automation session found");
//       }

//       if (automation.platformState.isProcessingJob) {
//         this.messageHandler.sendPortResponse(port, {
//           type: "ERROR",
//           message: "Already processing another job",
//         });
//         return;
//       }

//       // Check for duplicates
//       const normalizedUrl = this.messageHandler.normalizeUrl(url);
//       if (
//         automation.platformState.submittedLinks?.some(
//           (link) => this.messageHandler.normalizeUrl(link.url) === normalizedUrl
//         )
//       ) {
//         this.messageHandler.sendPortResponse(port, {
//           type: "DUPLICATE",
//           message: "This job has already been processed",
//           data: { url },
//         });
//         return;
//       }

//       // Create new tab for job application
//       const tab = await chrome.tabs.create({
//         url: url.endsWith("/apply") ? url : url + "/apply",
//         windowId: windowId,
//         active: true,
//       });

//       // Update automation state
//       automation.platformState.isProcessingJob = true;
//       automation.platformState.currentJobUrl = url;
//       automation.platformState.currentJobTabId = tab.id;
//       automation.platformState.applicationStartTime = Date.now();

//       // Add to submitted links
//       if (!automation.platformState.submittedLinks) {
//         automation.platformState.submittedLinks = [];
//       }
//       automation.platformState.submittedLinks.push({
//         url: url,
//         status: "PROCESSING",
//         timestamp: Date.now(),
//       });

//       this.messageHandler.sendPortResponse(port, {
//         type: "SUCCESS",
//         message: "Apply tab will be created",
//       });

//       console.log(`✅ Lever job tab created: ${tab.id} for URL: ${url}`);
//     } catch (error) {
//       console.error("❌ Error handling Lever SEND_CV_TASK:", error);
//       this.messageHandler.sendPortResponse(port, {
//         type: "ERROR",
//         message: error.message,
//       });
//     }
//   }

//   async handleSendCvTaskDone(port, data) {
//     try {
//       const windowId = port.sender?.tab?.windowId;
//       const tabId = port.sender?.tab?.id;

//       console.log(
//         `✅ Lever job application completed successfully in tab ${tabId}`
//       );

//       let automation = null;
//       for (const [
//         sessionId,
//         auto,
//       ] of this.messageHandler.activeAutomations.entries()) {
//         if (auto.windowId === windowId) {
//           automation = auto;
//           break;
//         }
//       }

//       if (automation) {
//         const url = automation.platformState.currentJobUrl;
//         if (url && automation.platformState.submittedLinks) {
//           const linkIndex = automation.platformState.submittedLinks.findIndex(
//             (link) =>
//               this.messageHandler.normalizeUrl(link.url) ===
//               this.messageHandler.normalizeUrl(url)
//           );
//           if (linkIndex >= 0) {
//             automation.platformState.submittedLinks[linkIndex].status =
//               "SUCCESS";
//             automation.platformState.submittedLinks[linkIndex].details = data;
//           }
//         }

//         // Close the job tab
//         if (automation.platformState.currentJobTabId) {
//           try {
//             await chrome.tabs.remove(automation.platformState.currentJobTabId);
//           } catch (error) {
//             console.warn("⚠️ Error closing job tab:", error);
//           }
//         }

//         // Reset processing state
//         automation.platformState.isProcessingJob = false;
//         const oldUrl = automation.platformState.currentJobUrl;
//         automation.platformState.currentJobUrl = null;
//         automation.platformState.currentJobTabId = null;
//         automation.platformState.applicationStartTime = null;

//         // Increment current count
//         automation.platformState.searchData.current++;

//         // Notify search tab to continue
//         await this.sendSearchNextMessage(windowId, {
//           url: oldUrl,
//           status: "SUCCESS",
//           data: data,
//         });
//       }

//       this.messageHandler.sendPortResponse(port, {
//         type: "SUCCESS",
//         message: "Application completed",
//       });
//     } catch (error) {
//       console.error("❌ Error handling Lever SEND_CV_TASK_DONE:", error);
//       this.messageHandler.sendPortResponse(port, {
//         type: "ERROR",
//         message: error.message,
//       });
//     }
//   }

//   async handleSendCvTaskSkip(port, data) {
//     try {
//       const windowId = port.sender?.tab?.windowId;
//       const tabId = port.sender?.tab?.id;

//       console.log(`⏭️ Lever job application skipped in tab ${tabId}:`, data);

//       let automation = null;
//       for (const [
//         sessionId,
//         auto,
//       ] of this.messageHandler.activeAutomations.entries()) {
//         if (auto.windowId === windowId) {
//           automation = auto;
//           break;
//         }
//       }

//       if (automation) {
//         const url = automation.platformState.currentJobUrl;
//         if (url && automation.platformState.submittedLinks) {
//           const linkIndex = automation.platformState.submittedLinks.findIndex(
//             (link) =>
//               this.messageHandler.normalizeUrl(link.url) ===
//               this.messageHandler.normalizeUrl(url)
//           );
//           if (linkIndex >= 0) {
//             automation.platformState.submittedLinks[linkIndex].status =
//               "SKIPPED";
//             automation.platformState.submittedLinks[linkIndex].reason = data;
//           }
//         }

//         if (automation.platformState.currentJobTabId) {
//           try {
//             await chrome.tabs.remove(automation.platformState.currentJobTabId);
//           } catch (error) {
//             console.warn("⚠️ Error closing job tab:", error);
//           }
//         }

//         automation.platformState.isProcessingJob = false;
//         const oldUrl = automation.platformState.currentJobUrl;
//         automation.platformState.currentJobUrl = null;
//         automation.platformState.currentJobTabId = null;
//         automation.platformState.applicationStartTime = null;

//         await this.sendSearchNextMessage(windowId, {
//           url: oldUrl,
//           status: "SKIPPED",
//           message: data,
//         });
//       }

//       this.messageHandler.sendPortResponse(port, {
//         type: "SUCCESS",
//         message: "Skip acknowledged",
//       });
//     } catch (error) {
//       console.error("❌ Error handling Lever SEND_CV_TASK_SKIP:", error);
//     }
//   }

//   async handleVerifyApplicationStatus(port, data) {
//     const windowId = port.sender?.tab?.windowId;

//     let automation = null;
//     for (const [
//       sessionId,
//       auto,
//     ] of this.messageHandler.activeAutomations.entries()) {
//       if (auto.windowId === windowId) {
//         automation = auto;
//         break;
//       }
//     }

//     const isActive = automation
//       ? automation.platformState.isProcessingJob
//       : false;

//     this.messageHandler.sendPortResponse(port, {
//       type: "APPLICATION_STATUS_RESPONSE",
//       data: {
//         active: isActive,
//         url: automation?.platformState.currentJobUrl || null,
//         tabId: automation?.platformState.currentJobTabId || null,
//       },
//     });
//   }

//   async handleCheckJobTabStatus(port, data) {
//     const windowId = port.sender?.tab?.windowId;

//     let automation = null;
//     for (const [
//       sessionId,
//       auto,
//     ] of this.messageHandler.activeAutomations.entries()) {
//       if (auto.windowId === windowId) {
//         automation = auto;
//         break;
//       }
//     }

//     const isOpen = automation
//       ? automation.platformState.isProcessingJob
//       : false;

//     this.messageHandler.sendPortResponse(port, {
//       type: "JOB_TAB_STATUS",
//       data: {
//         isOpen: isOpen,
//         tabId: automation?.platformState.currentJobTabId || null,
//         isProcessing: isOpen,
//       },
//     });
//   }

//   async handleSearchNextReady(port, data) {
//     console.log("🔄 Lever search ready for next job");

//     this.messageHandler.sendPortResponse(port, {
//       type: "NEXT_READY_ACKNOWLEDGED",
//       data: { status: "success" },
//     });
//   }

//   async handleSearchTaskDone(port, data) {
//     const windowId = port.sender?.tab?.windowId;

//     console.log(`🏁 Lever search task completed for window ${windowId}`);

//     try {
//       chrome.notifications.create({
//         type: "basic",
//         iconUrl: "icons/icon48.png",
//         title: "Lever Job Search Completed",
//         message: "All job applications have been processed.",
//       });
//     } catch (error) {
//       console.warn("⚠️ Error showing notification:", error);
//     }

//     this.messageHandler.sendPortResponse(port, {
//       type: "SUCCESS",
//       message: "Search completion acknowledged",
//     });
//   }

//   handlePortConnection(port) {
//     const portNameParts = port.name.split("-");
//     const portType = portNameParts[1]; // 'search' or 'apply'
//     const tabId = parseInt(portNameParts[2]) || port.sender?.tab?.id;
//     const sessionId = this.extractSessionFromPortName(port.name);

//     console.log(
//       `📝 Registering Lever ${portType} port for tab ${tabId}, session ${sessionId}`
//     );

//     // Clean up existing ports for this tab
//     this.cleanupPortsForTab(tabId);

//     if (tabId) {
//       this.portConnections.set(tabId, port);

//       // Track by session
//       if (sessionId) {
//         if (!this.sessionPorts.has(sessionId)) {
//           this.sessionPorts.set(sessionId, new Set());
//         }
//         this.sessionPorts.get(sessionId).add(port);
//       }
//     }

//     // Set initial keepalive
//     this.lastKeepalive.set(port.name, Date.now());

//     port.onMessage.addListener((message) => {
//       this.handlePortMessage(message, port);
//     });

//     port.onDisconnect.addListener(() => {
//       console.log("📪 Lever port disconnected:", port.name);
//       this.cleanupPort(port, tabId, sessionId);
//     });

//     // Send initial connection confirmation
//     this.safePortSend(port, {
//       type: "CONNECTION_ESTABLISHED",
//       data: { tabId, sessionId, portType },
//     });
//   }

//   async handlePortMessage(message, port) {
//     const { type, data } = message || {};
//     if (!type) return;

//     // Update keepalive timestamp
//     this.lastKeepalive.set(port.name, Date.now());

//     try {
//       switch (type) {
//         case "KEEPALIVE":
//           await this.handleKeepalive(port, data);
//           break;

//         case "GET_SEARCH_TASK":
//           await this.handleGetSearchTask(port, data);
//           break;

//         case "GET_SEND_CV_TASK":
//           await this.handleGetSendCvTask(port, data);
//           break;

//         case "SEND_CV_TASK":
//           await this.handleSendCvTask(port, data);
//           break;

//         case "SEND_CV_TASK_DONE":
//           await this.handleSendCvTaskDone(port, data);
//           break;

//         case "SEND_CV_TASK_ERROR":
//           await this.handleSendCvTaskError(port, data);
//           break;

//         case "SEND_CV_TASK_SKIP":
//           await this.handleSendCvTaskSkip(port, data);
//           break;

//         case "SEARCH_TASK_DONE":
//           await this.handleSearchTaskDone(port, data);
//           break;

//         case "VERIFY_APPLICATION_STATUS":
//           await this.handleVerifyApplicationStatus(port, data);
//           break;

//         case "CHECK_JOB_TAB_STATUS":
//           await this.handleCheckJobTabStatus(port, data);
//           break;

//         case "SEARCH_NEXT_READY":
//           await this.handleSearchNextReady(port, data);
//           break;

//         default:
//           console.log(`❓ Unhandled Lever port message type: ${type}`);
//           this.safePortSend(port, {
//             type: "ERROR",
//             message: `Unknown message type: ${type}`,
//           });
//       }
//     } catch (error) {
//       console.error(
//         `❌ Error handling Lever port message type ${type}:`,
//         error
//       );
//       this.safePortSend(port, {
//         type: "ERROR",
//         message: `Error processing ${type}: ${error.message}`,
//       });
//     }
//   }

//   async handleSendCvTaskError(port, data) {
//     try {
//       const windowId = port.sender?.tab?.windowId;
//       const tabId = port.sender?.tab?.id;
//       const sessionId = this.getSessionIdFromPort(port);

//       console.log(`❌ Lever job application failed in tab ${tabId}:`, data);

//       // Increment error count
//       const errorCount = (this.errorCounts.get(sessionId) || 0) + 1;
//       this.errorCounts.set(sessionId, errorCount);

//       // Check if too many errors
//       if (errorCount >= this.maxErrors) {
//         console.error(
//           `🚨 Too many errors (${errorCount}) for session ${sessionId}, stopping automation`
//         );
//         this.safePortSend(port, {
//           type: "AUTOMATION_STOPPED",
//           message: "Too many errors, automation stopped",
//         });
//         return;
//       }

//       let automation = null;
//       for (const [
//         sid,
//         auto,
//       ] of this.messageHandler.activeAutomations.entries()) {
//         if (auto.windowId === windowId) {
//           automation = auto;
//           break;
//         }
//       }

//       if (automation) {
//         const url = automation.platformState.currentJobUrl;
//         if (url && automation.platformState.submittedLinks) {
//           const linkIndex = automation.platformState.submittedLinks.findIndex(
//             (link) =>
//               this.messageHandler.normalizeUrl(link.url) ===
//               this.messageHandler.normalizeUrl(url)
//           );
//           if (linkIndex >= 0) {
//             automation.platformState.submittedLinks[linkIndex].status = "ERROR";
//             automation.platformState.submittedLinks[linkIndex].error = data;
//           }
//         }

//         // Close job tab if it exists
//         if (automation.platformState.currentJobTabId) {
//           try {
//             await chrome.tabs.remove(automation.platformState.currentJobTabId);
//           } catch (error) {
//             console.warn("⚠️ Error closing job tab:", error);
//           }
//         }

//         // Reset processing state
//         automation.platformState.isProcessingJob = false;
//         const oldUrl = automation.platformState.currentJobUrl;
//         automation.platformState.currentJobUrl = null;
//         automation.platformState.currentJobTabId = null;
//         automation.platformState.applicationStartTime = null;

//         // Only send search next if error count is not too high
//         if (errorCount < this.maxErrors) {
//           // Add delay to prevent rapid fire errors
//           const delay = Math.min(5000 * errorCount, 30000); // Increasing delay up to 30s
//           setTimeout(async () => {
//             await this.sendSearchNextMessage(windowId, {
//               url: oldUrl,
//               status: "ERROR",
//               message: typeof data === "string" ? data : "Application error",
//               errorCount: errorCount,
//             });
//           }, delay);
//         }
//       }

//       this.safePortSend(port, {
//         type: "SUCCESS",
//         message: "Error acknowledged",
//       });
//     } catch (error) {
//       console.error("❌ Error handling Lever SEND_CV_TASK_ERROR:", error);
//       // Don't send another error response to avoid recursion
//     }
//   }

//   // Add the rest of the methods with similar error handling patterns...
//   async handleGetSearchTask(port, data) {
//     const tabId = port.sender?.tab?.id;
//     const windowId = port.sender?.tab?.windowId;

//     let sessionData = null;
//     for (const [
//       sessionId,
//       automation,
//     ] of this.messageHandler.activeAutomations.entries()) {
//       if (automation.windowId === windowId) {
//         const platformState = automation.platformState;
//         sessionData = {
//           tabId: tabId,
//           limit: platformState.searchData.limit,
//           current: platformState.searchData.current,
//           domain: platformState.searchData.domain,
//           submittedLinks: platformState.submittedLinks || [],
//           searchLinkPattern:
//             platformState.searchData.searchLinkPattern.toString(),
//         };

//         platformState.searchTabId = tabId;
//         break;
//       }
//     }

//     this.safePortSend(port, {
//       type: "SUCCESS",
//       data: sessionData || {},
//     });
//   }

//   async handleGetSendCvTask(port, data) {
//     const tabId = port.sender?.tab?.id;
//     const windowId = port.sender?.tab?.windowId;

//     let sessionData = null;
//     for (const [
//       sessionId,
//       automation,
//     ] of this.messageHandler.activeAutomations.entries()) {
//       console.log("AUTOMATION", automation.windowId, windowId);
//       if (automation.windowId === windowId) {
//         sessionData = {
//           devMode: automation.params?.devMode || false,
//           profile: automation.userProfile,
//           session: automation.sessionConfig,
//           avatarUrl: automation.userProfile?.avatarUrl,
//         };
//         break;
//       }
//     }
//     console.log("SESSION DATA", sessionData);
//     this.safePortSend(port, {
//       type: "SUCCESS",
//       data: sessionData || {},
//     });
//   }
// }

// export default LeverAutomationHandler;




// background/platforms/recruitee.js
// class RecruiteeAutomationHandler {
//   constructor(messageHandler) {
//     this.messageHandler = messageHandler;
//     this.portConnections = new Map();
//     this.sessionPorts = new Map();
//     this.activeConnections = new Set();
//     this.lastKeepalive = new Map();
//     this.errorCounts = new Map();
//     this.maxErrors = 5;
//     this.processingMessages = new Set();
//     this.processedCompletions = new Set();

//     // Start cleanup process
//     this.startPeriodicCleanup();
//   }

//   startPeriodicCleanup() {
//     setInterval(() => {
//       const now = Date.now();
//       const staleThreshold = 120000; // 2 minutes

//       // Clean up stale ports
//       for (const [portName, lastSeen] of this.lastKeepalive.entries()) {
//         if (now - lastSeen > staleThreshold) {
//           console.log(`🧹 Cleaning up stale Recruitee port: ${portName}`);
//           this.activeConnections.delete(portName);
//           this.lastKeepalive.delete(portName);
//         }
//       }

//       // Clean up old completions
//       if (this.processedCompletions.size > 100) {
//         const entries = Array.from(this.processedCompletions);
//         this.processedCompletions = new Set(entries.slice(-50));
//       }
//     }, 60000);
//   }

//   cleanup() {
//     console.log("🧹 Starting RecruiteeAutomationHandler cleanup");

//     // Clear all port connections
//     for (const port of this.portConnections.values()) {
//       try {
//         this.activeConnections.delete(port.name);
//         port.disconnect();
//       } catch (e) {
//         // Ignore errors
//       }
//     }

//     this.portConnections.clear();
//     this.sessionPorts.clear();
//     this.activeConnections.clear();
//     this.lastKeepalive.clear();
//     this.errorCounts.clear();
//     this.processingMessages.clear();

//     if (this.processedCompletions) {
//       this.processedCompletions.clear();
//     }

//     console.log("✅ RecruiteeAutomationHandler cleanup completed");
//   }

//   safePortSend(port, message) {
//     try {
//       if (!port || !port.name || !this.activeConnections.has(port.name)) {
//         console.warn(
//           `⚠️ Cannot send message to disconnected/invalid Recruitee port: ${message.type}`
//         );
//         return false;
//       }

//       if (!port.sender || !port.sender.tab) {
//         console.warn(
//           `⚠️ Recruitee port sender no longer exists: ${message.type}`
//         );
//         this.activeConnections.delete(port.name);
//         return false;
//       }

//       port.postMessage(message);
//       this.lastKeepalive.set(port.name, Date.now());
//       return true;
//     } catch (error) {
//       console.warn(
//         `⚠️ Failed to send Recruitee port message (${message.type}):`,
//         error.message
//       );

//       if (port && port.name) {
//         this.activeConnections.delete(port.name);
//         this.lastKeepalive.delete(port.name);
//       }

//       return false;
//     }
//   }

//   handlePortConnection(port) {
//     const portNameParts = port.name.split("-");
//     const portType = portNameParts[1]; // 'search' or 'apply'
//     const timestamp = portNameParts[2];
//     const sessionId = portNameParts[3];
//     const tabId = port.sender?.tab?.id;

//     // Prevent duplicate connections
//     if (this.activeConnections.has(port.name)) {
//       console.log(
//         `⚠️ Duplicate Recruitee port connection attempt: ${port.name}`
//       );
//       try {
//         port.disconnect();
//       } catch (e) {
//         // Ignore errors
//       }
//       return;
//     }

//     console.log(
//       `📝 Registering Recruitee ${portType} port for tab ${tabId}, session ${sessionId}`
//     );

//     // Clean up existing port for this tab
//     if (tabId && this.portConnections.has(tabId)) {
//       const existingPort = this.portConnections.get(tabId);
//       this.cleanupPort(existingPort, tabId, sessionId);
//     }

//     // Register new port
//     this.activeConnections.add(port.name);
//     if (tabId) {
//       this.portConnections.set(tabId, port);
//     }

//     // Track by session
//     if (sessionId) {
//       if (!this.sessionPorts.has(sessionId)) {
//         this.sessionPorts.set(sessionId, new Set());
//       }
//       this.sessionPorts.get(sessionId).add(port);
//     }

//     // Set initial keepalive
//     this.lastKeepalive.set(port.name, Date.now());

//     // Set up message handler
//     port.onMessage.addListener((message) => {
//       const messageId = `${port.name}-${message.type}-${Date.now()}`;

//       if (this.processingMessages.has(messageId)) {
//         console.log(
//           `⚠️ Duplicate Recruitee message ignored: ${message.type} from ${port.name}`
//         );
//         return;
//       }

//       this.processingMessages.add(messageId);

//       try {
//         this.handlePortMessage(message, port);
//       } catch (error) {
//         console.error(
//           `❌ Error handling Recruitee message ${message.type}:`,
//           error
//         );
//         this.safePortSend(port, {
//           type: "ERROR",
//           message: `Error processing ${message.type}: ${error.message}`,
//         });
//       } finally {
//         setTimeout(() => this.processingMessages.delete(messageId), 1000);
//       }
//     });

//     // Handle disconnection
//     port.onDisconnect.addListener(() => {
//       console.log(`📪 Recruitee port disconnected: ${port.name}`);
//       this.cleanupPort(port, tabId, sessionId);
//     });

//     // Send connection confirmation
//     setTimeout(() => {
//       if (this.activeConnections.has(port.name)) {
//         this.safePortSend(port, {
//           type: "CONNECTION_ESTABLISHED",
//           data: { tabId, sessionId, portType },
//         });
//       }
//     }, 100);
//   }

//   cleanupPort(port, tabId, sessionId) {
//     if (port && port.name) {
//       this.activeConnections.delete(port.name);
//       this.lastKeepalive.delete(port.name);
//     }

//     if (tabId) {
//       this.portConnections.delete(tabId);
//     }

//     if (sessionId) {
//       const sessionPortSet = this.sessionPorts.get(sessionId);
//       if (sessionPortSet) {
//         sessionPortSet.delete(port);
//         if (sessionPortSet.size === 0) {
//           this.sessionPorts.delete(sessionId);
//         }
//       }
//     }
//   }

//   async handlePortMessage(message, port) {
//     const { type, data } = message || {};
//     if (!type) return;

//     // Update keepalive timestamp
//     this.lastKeepalive.set(port.name, Date.now());

//     try {
//       switch (type) {
//         case "KEEPALIVE":
//           await this.handleKeepalive(port, data);
//           break;

//         case "GET_SEARCH_TASK":
//           await this.handleGetSearchTask(port, data);
//           break;

//         case "GET_APPLICATION_TASK":
//           await this.handleGetApplicationTask(port, data);
//           break;

//         case "START_APPLICATION":
//           await this.handleStartApplication(port, data);
//           break;

//         case "APPLICATION_COMPLETED":
//           await this.handleApplicationCompleted(port, data);
//           break;

//         case "APPLICATION_ERROR":
//           await this.handleApplicationError(port, data);
//           break;

//         case "APPLICATION_SKIPPED":
//           await this.handleApplicationSkipped(port, data);
//           break;

//         case "SEARCH_COMPLETED":
//           await this.handleSearchCompleted(port, data);
//           break;

//         case "CHECK_APPLICATION_STATUS":
//           await this.handleCheckApplicationStatus(port, data);
//           break;

//         case "SEARCH_NEXT_READY":
//           await this.handleSearchNextReady(port, data);
//           break;

//         case "GET_PROFILE_DATA":
//           await this.handleGetProfileData(port, data);
//           break;

//         default:
//           console.log(`❓ Unhandled Recruitee port message type: ${type}`);
//           this.safePortSend(port, {
//             type: "ERROR",
//             message: `Unknown message type: ${type}`,
//           });
//       }
//     } catch (error) {
//       console.error(
//         `❌ Error handling Recruitee port message type ${type}:`,
//         error
//       );
//       this.safePortSend(port, {
//         type: "ERROR",
//         message: `Error processing ${type}: ${error.message}`,
//       });
//     }
//   }

//   async handleKeepalive(port, data) {
//     this.safePortSend(port, {
//       type: "KEEPALIVE_RESPONSE",
//       data: { timestamp: Date.now() },
//     });
//   }

//   async handleGetSearchTask(port, data) {
//     const tabId = port.sender?.tab?.id;
//     const windowId = port.sender?.tab?.windowId;

//     let sessionData = null;
//     let automation = null;

//     // Find automation by window ID
//     for (const [
//       sessionId,
//       auto,
//     ] of this.messageHandler.activeAutomations.entries()) {
//       if (auto.windowId === windowId) {
//         automation = auto;
//         break;
//       }
//     }

//     if (automation) {
//       // FIXED: Ensure we have user profile data
//       let userProfile = automation.userProfile;

//       // If no user profile in automation, try to fetch from user service
//       if (!userProfile && automation.userId) {
//         try {
//           console.log(`📡 Fetching user profile for user ${automation.userId}`);

//           // Import UserService dynamically
//           const { default: UserService } = await import(
//             "../../services/user-service.js"
//           );
//           const userService = new UserService({ userId: automation.userId });
//           userProfile = await userService.getUserDetails();

//           // Cache it in automation for future use
//           automation.userProfile = userProfile;

//           console.log(`✅ User profile fetched and cached`);
//         } catch (error) {
//           console.error(`❌ Failed to fetch user profile:`, error);
//         }
//       }

//       const platformState = automation.platformState;
//       sessionData = {
//         tabId: tabId,
//         limit: platformState.searchData.limit,
//         current: platformState.searchData.current,
//         domain: platformState.searchData.domain,
//         submittedLinks: platformState.submittedLinks || [],
//         searchLinkPattern:
//           platformState.searchData.searchLinkPattern?.toString() ||
//           "/^https:\\/\\/.*\\.recruitee\\.com\\/(o|career)\\/([^\\/]+)\\/?.*$/",
//         // FIXED: Include user profile and session context
//         profile: userProfile || null,
//         session: automation.sessionConfig || null,
//         userId: automation.userId,
//         sessionId: automation.sessionId || null,
//       };

//       platformState.searchTabId = tabId;
//     }

//     this.safePortSend(port, {
//       type: "SEARCH_TASK_DATA",
//       data: sessionData || {},
//     });
//   }

//   async handleGetApplicationTask(port, data) {
//     const tabId = port.sender?.tab?.id;
//     const windowId = port.sender?.tab?.windowId;

//     console.log(
//       `🔍 GET_APPLICATION_TASK request from tab ${tabId}, window ${windowId}`
//     );

//     let sessionData = null;
//     let automation = null;

//     // Find automation by window ID
//     for (const [
//       sessionId,
//       auto,
//     ] of this.messageHandler.activeAutomations.entries()) {
//       if (auto.windowId === windowId) {
//         automation = auto;
//         console.log(`✅ Found automation session: ${sessionId}`);
//         break;
//       }
//     }

//     if (automation) {
//       // FIXED: Ensure we have user profile data
//       let userProfile = automation.userProfile;

//       // If no user profile in automation, try to fetch from user service
//       if (!userProfile && automation.userId) {
//         try {
//           console.log(`📡 Fetching user profile for user ${automation.userId}`);

//           // Import UserService dynamically
//           const { default: UserService } = await import(
//             "../../services/user-service.js"
//           );
//           const userService = new UserService({ userId: automation.userId });
//           userProfile = await userService.getUserDetails();

//           // Cache it in automation for future use
//           automation.userProfile = userProfile;

//           console.log(`✅ User profile fetched and cached`);
//         } catch (error) {
//           console.error(`❌ Failed to fetch user profile:`, error);
//         }
//       }

//       sessionData = {
//         devMode: automation.params?.devMode || false,
//         profile: userProfile || null,
//         session: automation.sessionConfig || null,
//         avatarUrl: userProfile?.avatarUrl || null,
//         userId: automation.userId,
//         sessionId: automation.sessionId || null,
//       };

//       console.log(`📊 Session data prepared:`, {
//         hasProfile: !!sessionData.profile,
//         hasSession: !!sessionData.session,
//         userId: sessionData.userId,
//         devMode: sessionData.devMode,
//       });
//     } else {
//       console.warn(`⚠️ No automation found for window ${windowId}`);
//       sessionData = {
//         devMode: false,
//         profile: null,
//         session: null,
//         avatarUrl: null,
//         userId: null,
//         sessionId: null,
//       };
//     }

//     // Send response with detailed logging
//     const sent = this.safePortSend(port, {
//       type: "APPLICATION_TASK_DATA",
//       data: sessionData,
//     });

//     if (!sent) {
//       console.error(
//         `❌ Failed to send application task data to port ${port.name}`
//       );
//     } else {
//       console.log(`✅ Application task data sent successfully to tab ${tabId}`);
//     }
//   }

//   async handleStartApplication(port, data) {
//     try {
//       const { url, title } = data;
//       const windowId = port.sender?.tab?.windowId;
//       console.log(`🎯 Opening Recruitee job in new tab: ${url}`);

//       let automation = null;
//       for (const [
//         sessionId,
//         auto,
//       ] of this.messageHandler.activeAutomations.entries()) {
//         if (auto.windowId === windowId) {
//           automation = auto;
//           break;
//         }
//       }

//       if (!automation) {
//         throw new Error("No automation session found");
//       }

//       if (automation.platformState.isProcessingJob) {
//         this.safePortSend(port, {
//           type: "ERROR",
//           message: "Already processing another job",
//         });
//         return;
//       }

//       // Check for duplicates
//       const normalizedUrl = this.messageHandler.normalizeUrl(url);
//       if (
//         automation.platformState.submittedLinks?.some(
//           (link) => this.messageHandler.normalizeUrl(link.url) === normalizedUrl
//         )
//       ) {
//         this.safePortSend(port, {
//           type: "DUPLICATE",
//           message: "This job has already been processed",
//           data: { url },
//         });
//         return;
//       }

//       // Create new tab for job application
//       const tab = await chrome.tabs.create({
//         url: url,
//         windowId: windowId,
//         active: true,
//       });

//       // Update automation state
//       automation.platformState.isProcessingJob = true;
//       automation.platformState.currentJobUrl = url;
//       automation.platformState.currentJobTabId = tab.id;
//       automation.platformState.applicationStartTime = Date.now();

//       // Add to submitted links
//       if (!automation.platformState.submittedLinks) {
//         automation.platformState.submittedLinks = [];
//       }
//       automation.platformState.submittedLinks.push({
//         url: url,
//         status: "PROCESSING",
//         timestamp: Date.now(),
//       });

//       this.safePortSend(port, {
//         type: "APPLICATION_STARTING",
//         data: { url },
//       });

//       console.log(`✅ Recruitee job tab created: ${tab.id} for URL: ${url}`);
//     } catch (error) {
//       console.error("❌ Error handling Recruitee START_APPLICATION:", error);
//       this.safePortSend(port, {
//         type: "ERROR",
//         message: error.message,
//       });
//     }
//   }

//   async handleApplicationCompleted(port, data) {
//     try {
//       const windowId = port.sender?.tab?.windowId;
//       const tabId = port.sender?.tab?.id;
//       console.log(
//         `✅ Recruitee job application completed successfully in tab ${tabId}`
//       );

//       let automation = null;
//       for (const [
//         sessionId,
//         auto,
//       ] of this.messageHandler.activeAutomations.entries()) {
//         if (auto.windowId === windowId) {
//           automation = auto;
//           break;
//         }
//       }

//       if (automation) {
//         const url = automation.platformState.currentJobUrl;
//         if (url && automation.platformState.submittedLinks) {
//           const linkIndex = automation.platformState.submittedLinks.findIndex(
//             (link) =>
//               this.messageHandler.normalizeUrl(link.url) ===
//               this.messageHandler.normalizeUrl(url)
//           );
//           if (linkIndex >= 0) {
//             automation.platformState.submittedLinks[linkIndex].status =
//               "SUCCESS";
//             automation.platformState.submittedLinks[linkIndex].details = data;
//           }
//         }

//         // Close the job tab
//         if (automation.platformState.currentJobTabId) {
//           try {
//             await chrome.tabs.remove(automation.platformState.currentJobTabId);
//           } catch (error) {
//             console.warn("⚠️ Error closing Recruitee job tab:", error);
//           }
//         }

//         // Reset processing state
//         automation.platformState.isProcessingJob = false;
//         const oldUrl = automation.platformState.currentJobUrl;
//         automation.platformState.currentJobUrl = null;
//         automation.platformState.currentJobTabId = null;
//         automation.platformState.applicationStartTime = null;

//         // Increment current count
//         automation.platformState.searchData.current++;

//         // Notify search tab to continue
//         await this.sendSearchNextMessage(windowId, {
//           url: oldUrl,
//           status: "SUCCESS",
//           data: data,
//         });
//       }

//       this.safePortSend(port, {
//         type: "SUCCESS",
//         message: "Application completed",
//       });
//     } catch (error) {
//       console.error(
//         "❌ Error handling Recruitee APPLICATION_COMPLETED:",
//         error
//       );
//       this.safePortSend(port, {
//         type: "ERROR",
//         message: error.message,
//       });
//     }
//   }

//   async handleApplicationError(port, data) {
//     try {
//       const windowId = port.sender?.tab?.windowId;
//       const tabId = port.sender?.tab?.id;
//       console.log(`❌ Recruitee job application failed in tab ${tabId}:`, data);

//       let automation = null;
//       for (const [
//         sessionId,
//         auto,
//       ] of this.messageHandler.activeAutomations.entries()) {
//         if (auto.windowId === windowId) {
//           automation = auto;
//           break;
//         }
//       }

//       if (automation) {
//         const url = automation.platformState.currentJobUrl;
//         if (url && automation.platformState.submittedLinks) {
//           const linkIndex = automation.platformState.submittedLinks.findIndex(
//             (link) =>
//               this.messageHandler.normalizeUrl(link.url) ===
//               this.messageHandler.normalizeUrl(url)
//           );
//           if (linkIndex >= 0) {
//             automation.platformState.submittedLinks[linkIndex].status = "ERROR";
//             automation.platformState.submittedLinks[linkIndex].error = data;
//           }
//         }

//         // Close the job tab
//         if (automation.platformState.currentJobTabId) {
//           try {
//             await chrome.tabs.remove(automation.platformState.currentJobTabId);
//           } catch (error) {
//             console.warn("⚠️ Error closing Recruitee job tab:", error);
//           }
//         }

//         // Reset processing state
//         automation.platformState.isProcessingJob = false;
//         const oldUrl = automation.platformState.currentJobUrl;
//         automation.platformState.currentJobUrl = null;
//         automation.platformState.currentJobTabId = null;
//         automation.platformState.applicationStartTime = null;

//         // Notify search tab to continue
//         await this.sendSearchNextMessage(windowId, {
//           url: oldUrl,
//           status: "ERROR",
//           message: typeof data === "string" ? data : "Application error",
//         });
//       }

//       this.safePortSend(port, {
//         type: "SUCCESS",
//         message: "Error acknowledged",
//       });
//     } catch (error) {
//       console.error("❌ Error handling Recruitee APPLICATION_ERROR:", error);
//     }
//   }

//   async handleApplicationSkipped(port, data) {
//     try {
//       const windowId = port.sender?.tab?.windowId;
//       const tabId = port.sender?.tab?.id;
//       console.log(
//         `⏭️ Recruitee job application skipped in tab ${tabId}:`,
//         data
//       );

//       let automation = null;
//       for (const [
//         sessionId,
//         auto,
//       ] of this.messageHandler.activeAutomations.entries()) {
//         if (auto.windowId === windowId) {
//           automation = auto;
//           break;
//         }
//       }

//       if (automation) {
//         const url = automation.platformState.currentJobUrl;
//         if (url && automation.platformState.submittedLinks) {
//           const linkIndex = automation.platformState.submittedLinks.findIndex(
//             (link) =>
//               this.messageHandler.normalizeUrl(link.url) ===
//               this.messageHandler.normalizeUrl(url)
//           );
//           if (linkIndex >= 0) {
//             automation.platformState.submittedLinks[linkIndex].status =
//               "SKIPPED";
//             automation.platformState.submittedLinks[linkIndex].reason = data;
//           }
//         }

//         if (automation.platformState.currentJobTabId) {
//           try {
//             await chrome.tabs.remove(automation.platformState.currentJobTabId);
//           } catch (error) {
//             console.warn("⚠️ Error closing Recruitee job tab:", error);
//           }
//         }

//         automation.platformState.isProcessingJob = false;
//         const oldUrl = automation.platformState.currentJobUrl;
//         automation.platformState.currentJobUrl = null;
//         automation.platformState.currentJobTabId = null;
//         automation.platformState.applicationStartTime = null;

//         await this.sendSearchNextMessage(windowId, {
//           url: oldUrl,
//           status: "SKIPPED",
//           message: data,
//         });
//       }

//       this.safePortSend(port, {
//         type: "SUCCESS",
//         message: "Skip acknowledged",
//       });
//     } catch (error) {
//       console.error("❌ Error handling Recruitee APPLICATION_SKIPPED:", error);
//     }
//   }

//   async handleSearchCompleted(port, data) {
//     const windowId = port.sender?.tab?.windowId;
//     console.log(`🏁 Recruitee search task completed for window ${windowId}`);

//     try {
//       chrome.notifications.create({
//         type: "basic",
//         iconUrl: "icons/icon48.png",
//         title: "Recruitee Job Search Completed",
//         message: "All job applications have been processed.",
//       });
//     } catch (error) {
//       console.warn("⚠️ Error showing notification:", error);
//     }

//     this.safePortSend(port, {
//       type: "SUCCESS",
//       message: "Search completion acknowledged",
//     });
//   }

//   async handleCheckApplicationStatus(port, data) {
//     const windowId = port.sender?.tab?.windowId;

//     let automation = null;
//     for (const [
//       sessionId,
//       auto,
//     ] of this.messageHandler.activeAutomations.entries()) {
//       if (auto.windowId === windowId) {
//         automation = auto;
//         break;
//       }
//     }

//     const isActive = automation
//       ? automation.platformState.isProcessingJob
//       : false;

//     this.safePortSend(port, {
//       type: "APPLICATION_STATUS",
//       data: {
//         inProgress: isActive,
//         url: automation?.platformState.currentJobUrl || null,
//         tabId: automation?.platformState.currentJobTabId || null,
//       },
//     });
//   }

//   async handleSearchNextReady(port, data) {
//     console.log("🔄 Recruitee search ready for next job");

//     this.safePortSend(port, {
//       type: "NEXT_READY_ACKNOWLEDGED",
//       data: { status: "success" },
//     });
//   }

//   async handleGetProfileData(port, data) {
//     const windowId = port.sender?.tab?.windowId;

//     let automation = null;
//     for (const [
//       sessionId,
//       auto,
//     ] of this.messageHandler.activeAutomations.entries()) {
//       if (auto.windowId === windowId) {
//         automation = auto;
//         break;
//       }
//     }

//     if (automation && automation.userProfile) {
//       this.safePortSend(port, {
//         type: "PROFILE_DATA",
//         data: automation.userProfile,
//       });
//     } else {
//       this.safePortSend(port, {
//         type: "ERROR",
//         message: "No profile data available",
//       });
//     }
//   }

//   async sendSearchNextMessage(windowId, data) {
//     try {
//       console.log(
//         `📤 Sending SEARCH_NEXT message to Recruitee window ${windowId}:`,
//         data
//       );

//       const tabs = await chrome.tabs.query({ windowId: windowId });

//       for (const tab of tabs) {
//         if (tab.url && tab.url.includes("google.com/search")) {
//           // Try port first
//           const port = this.portConnections.get(tab.id);
//           if (port && this.activeConnections.has(port.name)) {
//             try {
//               this.safePortSend(port, {
//                 type: "SEARCH_NEXT",
//                 data: data,
//               });
//               console.log(
//                 `✅ Sent SEARCH_NEXT via port to Recruitee tab ${tab.id}`
//               );
//               return true;
//             } catch (error) {
//               console.warn(
//                 "⚠️ Recruitee port message failed, trying tabs API:",
//                 error
//               );
//             }
//           }

//           // Fallback to tabs API
//           try {
//             await chrome.tabs.sendMessage(tab.id, {
//               type: "SEARCH_NEXT",
//               data: data,
//             });
//             console.log(
//               `✅ Sent SEARCH_NEXT via tabs API to Recruitee tab ${tab.id}`
//             );
//             return true;
//           } catch (error) {
//             console.warn("⚠️ Recruitee tabs API message failed:", error);
//           }
//         }
//       }

//       console.warn(
//         "⚠️ Could not find Recruitee search tab to send SEARCH_NEXT message"
//       );
//       return false;
//     } catch (error) {
//       console.error("❌ Error sending Recruitee SEARCH_NEXT message:", error);
//       return false;
//     }
//   }
// }

// export default RecruiteeAutomationHandler;



// import BasePlatform from "../base-platform.js";
// import LeverFormHandler from "./lever-form-handler.js";
// import LeverFileHandler from "./lever-file-handler.js";
// import {
//   AIService,
//   ApplicationTrackerService,
//   UserService,
//   StatusOverlay,
// } from "../../services/index.js";
// import { markLinkAsColor } from "../../utils/mark-links.js";

// export default class LeverPlatform extends BasePlatform {
//   constructor(config) {
//     super(config);
//     this.platform = "lever";
//     this.baseUrl = "https://jobs.lever.co";

//     // Initialize user profile from multiple sources
//     this.userProfile =
//       config.userProfile || config.sessionContext?.userProfile || null;
//     this.sessionContext = config.sessionContext || null;

//     console.log(
//       `🔧 Lever platform constructor - User profile available: ${!!this
//         .userProfile}`
//     );
//     if (this.userProfile) {
//       console.log(`👤 User profile details:`, {
//         name: this.userProfile.name || this.userProfile.firstName,
//         email: this.userProfile.email,
//         hasResumeUrl: !!this.userProfile.resumeUrl,
//         resumeUrls: this.userProfile.resumeUrls?.length || 0,
//       });
//     }

//     this.aiService = new AIService({ apiHost: this.getApiHost() });
//     this.applicationTracker = new ApplicationTrackerService({
//       userId: this.userId,
//     });
//     this.userService = new UserService({ userId: this.userId });

//     this.statusOverlay = new StatusOverlay({
//       id: "lever-status-overlay",
//       title: "LEVER AUTOMATION",
//       icon: "🤖",
//       position: { top: "10px", right: "10px" },
//     });

//     this.fileHandler = null;
//     this.formHandler = null;

//     // Communication state
//     this.port = null;
//     this.connectionRetries = 0;
//     this.maxRetries = 3;
//     this.hasSessionContext = !!this.sessionContext;

//     // Application state
//     this.applicationState = {
//       isApplicationInProgress: false,
//       applicationStartTime: null,
//       applicationUrl: null,
//       processedUrls: new Set(),
//       processedLinksCount: 0,
//     };

//     // Search data
//     this.searchData = {
//       limit: 0,
//       current: 0,
//       domain: ["lever.co"],
//       submittedLinks: [],
//       searchLinkPattern: null,
//     };

//     // Timers
//     this.healthCheckTimer = null;
//     this.keepAliveInterval = null;
//     this.sendCvPageNotRespondTimeout = null;
//     this.stuckStateTimer = null;
//     this.stateVerificationInterval = null;

//     this.markLinkAsColor = markLinkAsColor;
//   }

//   validateHandlers() {
//     const issues = [];

//     if (!this.statusOverlay) issues.push("Status overlay not initialized");
//     if (!this.fileHandler) issues.push("File handler not initialized");
//     if (!this.formHandler) issues.push("Form handler not initialized");
//     if (!this.userProfile) issues.push("User profile not available");

//     if (issues.length > 0) {
//       this.statusOverlay?.addError(
//         "Initialization issues: " + issues.join(", ")
//       );
//       return false;
//     }

//     console.log("✅ All handlers validated successfully");
//     return true;
//   }

//   async setSessionContext(sessionContext) {
//     try {
//       this.sessionContext = sessionContext;
//       this.hasSessionContext = true;

//       // Update basic properties
//       if (sessionContext.sessionId) this.sessionId = sessionContext.sessionId;
//       if (sessionContext.platform) this.platform = sessionContext.platform;
//       if (sessionContext.userId) this.userId = sessionContext.userId;

//       // Set user profile with priority handling
//       if (sessionContext.userProfile) {
//         if (!this.userProfile || Object.keys(this.userProfile).length === 0) {
//           this.userProfile = sessionContext.userProfile;
//         } else {
//           // Merge profiles, preferring non-null values
//           this.userProfile = {
//             ...this.userProfile,
//             ...sessionContext.userProfile,
//           };
//         }
//       }

//       // Fetch user profile if still missing
//       if (!this.userProfile && this.userId) {
//         try {
//           this.userProfile = await this.userService.getUserDetails();
//         } catch (error) {
//           this.statusOverlay?.addError(
//             "Failed to fetch user profile: " + error.message
//           );
//         }
//       }

//       // Update services with user context
//       if (this.userId) {
//         this.applicationTracker = new ApplicationTrackerService({
//           userId: this.userId,
//         });
//         this.userService = new UserService({ userId: this.userId });
//       }

//       // FIXED: Update form handler if it exists
//       if (this.formHandler && this.userProfile) {
//         this.formHandler.userData = this.userProfile;
//       }

//       // Store API host from session context
//       if (sessionContext.apiHost) {
//         this.sessionApiHost = sessionContext.apiHost;

//         if (this.fileHandler) {
//           this.fileHandler.apiHost = sessionContext.apiHost;
//         }
//       }
//     } catch (error) {
//       this.statusOverlay?.addError(
//         "❌ Error setting session context: " + error.message
//       );
//     }
//   }

//   async extractJobDescription() {
//     try {
//       console.log("🔍 Extracting job details...");
//       this.statusOverlay.addInfo("Extracting job details...");

//       let jobDescription = {
//         title: "",
//         location: "",
//         department: "",
//         commitment: "",
//         workplaceType: "",
//       };

//       // Extract job title from heading
//       const titleElement = document.querySelector(
//         ".posting-header h2, .section h2, h2"
//       );
//       if (titleElement) {
//         jobDescription.title = titleElement.textContent.trim();
//         console.log(`Job title: ${jobDescription.title}`);
//       }

//       // Extract categories (location, department, etc.) from the posting categories
//       const locationElement = document.querySelector(
//         ".posting-category.location, .location"
//       );
//       if (locationElement) {
//         jobDescription.location = locationElement.textContent.trim();
//       }

//       const departmentElement = document.querySelector(
//         ".posting-category.department, .department"
//       );
//       if (departmentElement) {
//         jobDescription.department = departmentElement.textContent.trim();
//       }

//       const commitmentElement = document.querySelector(
//         ".posting-category.commitment, .commitment"
//       );
//       if (commitmentElement) {
//         jobDescription.commitment = commitmentElement.textContent.trim();
//       }

//       const workplaceElement = document.querySelector(
//         ".posting-category.workplaceTypes, .workplaceTypes"
//       );
//       if (workplaceElement) {
//         jobDescription.workplaceType = workplaceElement.textContent.trim();
//       }

//       // If we couldn't find structured elements, try text-based extraction as fallback
//       if (!jobDescription.title) {
//         const possibleTitleElements = document.querySelectorAll("h1, h2, h3");
//         for (const element of possibleTitleElements) {
//           if (
//             element.textContent.length > 5 &&
//             element.textContent.length < 100
//           ) {
//             jobDescription.title = element.textContent.trim();
//             break;
//           }
//         }
//       }

//       // Extract company name from URL or page content if possible
//       const companyMatch = window.location.hostname.match(
//         /jobs\.lever\.co\/([^\/]+)/i
//       );
//       if (companyMatch && companyMatch[1]) {
//         jobDescription.company = companyMatch[1].replace(/-/g, " ");
//         // Capitalize the company name
//         jobDescription.company = jobDescription.company
//           .split(" ")
//           .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
//           .join(" ");
//       }

//       // Extract full job description text for better context
//       const fullDescriptionElement = document.querySelector(
//         ".posting-content, .posting-description, .job-description, .section-wrapper"
//       );
//       if (fullDescriptionElement) {
//         jobDescription.fullDescription =
//           fullDescriptionElement.textContent.trim();
//       }

//       console.log("✅ Job details extracted successfully:", {
//         title: jobDescription.title,
//         company: jobDescription.company,
//         location: jobDescription.location,
//       });

//       return jobDescription;
//     } catch (error) {
//       console.error("❌ Error extracting job details:", error);
//       this.statusOverlay.addError(
//         `Error extracting job details: ${error.message}`
//       );

//       // Return minimal info even if extraction fails
//       return {
//         title: document.title || "Job Position",
//       };
//     }
//   }

//   getApiHost() {
//     return (
//       this.sessionApiHost ||
//       this.sessionContext?.apiHost ||
//       this.config.apiHost ||
//       "http://localhost:3000"
//     );
//   }

//   async initialize() {
//     await super.initialize();

//     // Create status overlay FIRST
//     this.statusOverlay.create();

//     // Initialize file handler with the created status overlay
//     this.fileHandler = new LeverFileHandler({
//       statusService: this.statusOverlay,
//       apiHost: this.getApiHost(),
//     });

//     // Set up communication with background script
//     this.initializePortConnection();

//     // Set up health monitoring
//     this.startHealthCheck();
//     this.startStateVerification();

//     // FIXED: Initialize form handler with user profile validation
//     this.formHandler = new LeverFormHandler({
//       logger: (message) => this.statusOverlay.addInfo(message),
//       host: this.getApiHost(),
//       userData: this.userProfile || {},
//       jobDescription: "",
//     });

//     this.statusOverlay.addSuccess("Lever automation initialized");
//   }

//   initializePortConnection() {
//     try {
//       this.statusOverlay.addInfo(
//         "📡 Initializing port connection with background script"
//       );

//       // Disconnect existing port if any
//       if (this.port) {
//         try {
//           this.port.disconnect();
//         } catch (e) {
//           // Ignore errors when disconnecting
//         }
//       }

//       // Determine port name based on page type and session
//       const isApplyPage =
//         window.location.href.includes("/apply") ||
//         window.location.pathname.includes("/apply");

//       const sessionSuffix = this.sessionId
//         ? `-${this.sessionId.slice(-6)}`
//         : "";
//       const timestamp = Date.now();
//       const portName = isApplyPage
//         ? `lever-apply-${timestamp}${sessionSuffix}`
//         : `lever-search-${timestamp}${sessionSuffix}`;

//       this.log(`🔌 Creating connection with port name: ${portName}`);

//       // Create the connection
//       this.port = chrome.runtime.connect({ name: portName });

//       if (!this.port) {
//         throw new Error(
//           "Failed to establish connection with background script"
//         );
//       }

//       // Set up message handler
//       this.port.onMessage.addListener((message) => {
//         this.handlePortMessage(message);
//       });

//       // Handle port disconnection
//       this.port.onDisconnect.addListener(() => {
//         const error = chrome.runtime.lastError;
//         if (error) {
//           this.log("❌ Port disconnected due to error:", error);
//         } else {
//           this.log("🔌 Port disconnected");
//         }

//         this.port = null;

//         // Attempt to reconnect
//         if (this.connectionRetries < this.maxRetries) {
//           this.connectionRetries++;
//           this.log(
//             `🔄 Attempting to reconnect (${this.connectionRetries}/${this.maxRetries})...`
//           );
//           setTimeout(() => this.initializePortConnection(), 5000);
//         }
//       });

//       // Start keep-alive interval
//       this.startKeepAliveInterval();

//       this.connectionRetries = 0;
//       this.log("✅ Port connection established successfully");
//       this.statusOverlay.addSuccess("Connection established");
//     } catch (error) {
//       this.log("❌ Error initializing port connection:", error);
//       this.statusOverlay.addError("Connection failed: " + error.message);
//       if (this.connectionRetries < this.maxRetries) {
//         this.connectionRetries++;
//         setTimeout(() => this.initializePortConnection(), 5000);
//       }
//     }
//   }

//   isFormValid(form) {
//     try {
//       const inputs = form.querySelectorAll("input, select, textarea");
//       const visibleInputs = Array.from(inputs).filter(
//         (input) => input.type !== "hidden" && this.isElementVisible(input)
//       );

//       return visibleInputs.length >= 2;
//     } catch (e) {
//       return false;
//     }
//   }

//   isElementVisible(element) {
//     if (!element) return false;

//     try {
//       const style = window.getComputedStyle(element);
//       return (
//         style.display !== "none" &&
//         style.visibility !== "hidden" &&
//         style.opacity !== "0" &&
//         element.offsetWidth > 0 &&
//         element.offsetHeight > 0 &&
//         element.offsetParent !== null
//       );
//     } catch (error) {
//       return false;
//     }
//   }

//   isFormVisible(form) {
//     try {
//       if (!form || !form.offsetParent) return false;

//       const style = window.getComputedStyle(form);
//       return (
//         style.display !== "none" &&
//         style.visibility !== "hidden" &&
//         style.opacity !== "0" &&
//         form.offsetWidth > 0 &&
//         form.offsetHeight > 0
//       );
//     } catch (e) {
//       return false;
//     }
//   }

//   startKeepAliveInterval() {
//     if (this.keepAliveInterval) {
//       clearInterval(this.keepAliveInterval);
//     }

//     this.keepAliveInterval = setInterval(() => {
//       try {
//         if (this.port) {
//           this.safeSendPortMessage({ type: "KEEPALIVE" });
//         } else {
//           this.log("🔄 Port is null during keepalive, attempting to reconnect");
//           this.initializePortConnection();
//         }
//       } catch (error) {
//         this.log("❌ Error sending keepalive, reconnecting:", error);
//         this.initializePortConnection();
//       }
//     }, 25000);
//   }

//   startHealthCheck() {
//     if (this.healthCheckTimer) {
//       clearInterval(this.healthCheckTimer);
//     }

//     this.healthCheckTimer = setInterval(() => this.checkHealth(), 60000);
//   }

//   startStateVerification() {
//     if (this.stateVerificationInterval) {
//       clearInterval(this.stateVerificationInterval);
//     }

//     this.stateVerificationInterval = setInterval(() => {
//       if (this.applicationState.isApplicationInProgress && this.port) {
//         try {
//           this.log("Verifying application status with background script");
//           this.safeSendPortMessage({ type: "VERIFY_APPLICATION_STATUS" });
//         } catch (e) {
//           this.log("Error in periodic state verification:", e);
//         }
//       }
//     }, 30000);
//   }

//   checkHealth() {
//     try {
//       const now = Date.now();

//       // Check for stuck application
//       if (
//         this.applicationState.isApplicationInProgress &&
//         this.applicationState.applicationStartTime
//       ) {
//         const applicationTime =
//           now - this.applicationState.applicationStartTime;

//         if (applicationTime > 5 * 60 * 1000) {
//           this.log("🚨 Application stuck for over 5 minutes, forcing reset");
//           this.applicationState.isApplicationInProgress = false;
//           this.applicationState.applicationStartTime = null;
//           this.statusOverlay.addWarning(
//             "Application timeout detected - resetting state"
//           );
//           setTimeout(() => this.searchNext(), 1000);
//         }
//       }
//     } catch (error) {
//       this.log("❌ Health check error", error);
//     }
//   }

//   safeSendPortMessage(message) {
//     try {
//       if (!this.port) {
//         this.log("⚠️ Port not available, attempting to reconnect");
//         this.initializePortConnection();
//         return false;
//       }

//       this.port.postMessage(message);
//       return true;
//     } catch (error) {
//       this.log("❌ Error sending port message:", error);
//       this.initializePortConnection();
//       return false;
//     }
//   }

//   handlePortMessage(message) {
//     try {
//       this.log("📨 Received port message:", message);

//       const { type, data } = message || {};
//       if (!type) {
//         this.log("⚠️ Received message without type, ignoring");
//         return;
//       }

//       switch (type) {
//         case "APPLICATION_STATUS_RESPONSE":
//           this.handleApplicationStatusResponse(data);
//           break;

//         case "SUCCESS":
//           this.handleSuccessMessage(data);
//           break;

//         case "SEARCH_NEXT":
//           this.handleSearchNext(data);
//           break;

//         case "JOB_TAB_STATUS":
//           this.handleJobTabStatus(data);
//           break;

//         case "DUPLICATE":
//           this.handleDuplicateJob(data);
//           break;

//         case "ERROR":
//           this.handleErrorMessage(data);
//           break;

//         case "KEEPALIVE_RESPONSE":
//           // Just acknowledge keepalive
//           break;

//         default:
//           this.log(`❓ Unhandled message type: ${type}`);
//       }
//     } catch (error) {
//       this.log("❌ Error handling port message:", error);
//     }
//   }

//   handleApplicationStatusResponse(data) {
//     this.log("📊 Application status response:", data);

//     if (
//       data &&
//       data.active === false &&
//       this.applicationState.isApplicationInProgress
//     ) {
//       this.log(
//         "⚠️ State mismatch detected! Resetting application progress flag"
//       );
//       this.applicationState.isApplicationInProgress = false;
//       this.applicationState.applicationStartTime = null;
//       this.statusOverlay.addWarning(
//         "Detected state mismatch - resetting flags"
//       );

//       setTimeout(() => this.searchNext(), 1000);
//     }
//   }

//   handleSuccessMessage(data) {
//     if (data) {
//       if (data.submittedLinks !== undefined) {
//         this.processSearchTaskData(data);
//       } else if (data.profile !== undefined) {
//         // Only process if we don't have user profile
//         if (!this.userProfile) {
//           this.processSendCvTaskData(data);
//         } else {
//           this.log(
//             "✅ User profile already available, skipping CV task data processing"
//           );
//         }
//       }
//     }
//   }

//   handleSearchNext(data) {
//     this.log("🔄 Received search next notification", data);

//     // Clear timeout first
//     if (this.sendCvPageNotRespondTimeout) {
//       clearTimeout(this.sendCvPageNotRespondTimeout);
//       this.sendCvPageNotRespondTimeout = null;
//     }

//     // Reset application state
//     this.applicationState.isApplicationInProgress = false;
//     this.applicationState.applicationStartTime = null;
//     this.applicationState.processedLinksCount++;

//     // Notify background we're ready for next job
//     this.safeSendPortMessage({ type: "SEARCH_NEXT_READY" });

//     if (!data || !data.url) {
//       this.log("No URL data in handleSearchNext");
//       this.statusOverlay.addInfo("Job processed, searching next...");
//       setTimeout(() => this.searchNext(), 2500);
//       return;
//     }

//     const normalizedUrl = this.normalizeUrlFully(data.url);

//     // Update visual status of the processed link
//     const links = this.findAllLinksElements();
//     let linkFound = false;

//     for (let i = 0; i < links.length; i++) {
//       const linkUrl = this.normalizeUrlFully(links[i].href);

//       if (
//         linkUrl === normalizedUrl ||
//         linkUrl.includes(normalizedUrl) ||
//         normalizedUrl.includes(linkUrl)
//       ) {
//         if (data.status === "SUCCESS") {
//           this.markLinkAsColor(links[i], "orange");
//           this.statusOverlay.addSuccess("Successfully submitted: " + data.url);
//         } else if (data.status === "ERROR") {
//           this.markLinkAsColor(links[i], "red");
//           this.statusOverlay.addError(
//             "Error with: " +
//               data.url +
//               (data.message ? ` - ${data.message}` : "")
//           );
//         } else {
//           this.markLinkAsColor(links[i], "orange");
//           this.statusOverlay.addWarning(
//             "Skipped: " + data.url + (data.message ? ` - ${data.message}` : "")
//           );
//         }

//         linkFound = true;
//         break;
//       }
//     }

//     if (!linkFound) {
//       this.log("Link not found in current page:", normalizedUrl);
//     }

//     // Record submission if not already in the list
//     if (
//       !this.searchData.submittedLinks.some((link) => {
//         const linkUrl = this.normalizeUrlFully(link.url);
//         return (
//           linkUrl === normalizedUrl ||
//           linkUrl.includes(normalizedUrl) ||
//           normalizedUrl.includes(linkUrl)
//         );
//       })
//     ) {
//       this.searchData.submittedLinks.push({ ...data });
//     }

//     setTimeout(() => this.searchNext(), 2500);
//   }

//   handleJobTabStatus(data) {
//     this.log("📊 Job tab status:", data);

//     if (data.isOpen && data.isProcessing) {
//       this.applicationState.isApplicationInProgress = true;
//       this.statusOverlay.addInfo("Job application in progress, waiting...");

//       setTimeout(() => {
//         if (this.applicationState.isApplicationInProgress) {
//           this.safeSendPortMessage({ type: "CHECK_JOB_TAB_STATUS" });
//         }
//       }, 10000);
//     } else {
//       if (this.applicationState.isApplicationInProgress) {
//         this.log("🔄 Resetting application in progress flag");
//         this.applicationState.isApplicationInProgress = false;
//         this.applicationState.applicationStartTime = null;
//         this.statusOverlay.addInfo(
//           "No active job application, resuming search"
//         );

//         setTimeout(() => this.searchNext(), 1000);
//       }
//     }
//   }

//   handleDuplicateJob(data) {
//     this.log("⚠️ Duplicate job detected, resetting application state");
//     this.applicationState.isApplicationInProgress = false;
//     this.applicationState.applicationStartTime = null;
//     this.statusOverlay.addWarning(
//       `Job already processed: ${data?.url || "Unknown URL"}`
//     );

//     setTimeout(() => this.searchNext(), 1000);
//   }

//   handleErrorMessage(data) {
//     const errorMessage =
//       data && data.message
//         ? data.message
//         : "Unknown error from background script";
//     this.log("❌ Error from background script:", errorMessage);
//     this.statusOverlay.addError("Background error: " + errorMessage);
//   }

//   async start(params = {}) {
//     try {
//       this.isRunning = true;
//       this.log("🚀 Starting Lever automation");
//       this.statusOverlay.addInfo("Starting Lever automation");

//       // Update config with parameters
//       this.config = { ...this.config, ...params };

//       // Wait for page to be ready
//       await this.waitForPageLoad();

//       // Detect page type and start appropriate automation
//       await this.detectPageTypeAndStart();
//     } catch (error) {
//       this.reportError(error, { phase: "start" });
//     }
//   }

//   async detectPageTypeAndStart() {
//     const url = window.location.href;
//     this.log(`🔍 Detecting page type for: ${url}`);

//     if (url.includes("google.com/search")) {
//       this.log("📊 Google search page detected");
//       this.statusOverlay.addInfo("Google search page detected");
//       await this.startSearchProcess();
//     } else if (this.isLeverJobPage(url)) {
//       this.log("📋 Lever job page detected");
//       this.statusOverlay.addInfo("Lever job page detected");
//       await this.startApplicationProcess();
//     } else {
//       this.log("❓ Unknown page type, waiting for navigation");
//       await this.waitForValidPage();
//     }
//   }

//   isLeverJobPage(url) {
//     return /^https:\/\/jobs\.(eu\.)?lever\.co\/[^\/]+\/[^\/]+/.test(url);
//   }

//   isLeverJobListingPage(url) {
//     return /^https:\/\/jobs\.(eu\.)?lever\.co\/[^\/]+\/[^\/]+(?!\/apply)/.test(
//       url
//     );
//   }

//   isLeverApplicationPage(url) {
//     return /^https:\/\/jobs\.(eu\.)?lever\.co\/[^\/]+\/[^\/]+\/apply/.test(url);
//   }

//   findApplyButton() {
//     // Look for "Apply for this job" or similar buttons
//     const applySelectors = [
//       'a[href*="/apply"]',
//       "a.postings-btn",
//       'a.button[href*="/apply"]',
//       'a.btn[href*="/apply"]',
//       "a.btn-apply",
//       "a.apply-button",
//       'a[data-qa="btn-apply"]',
//       "div.apply-button a",
//       "div.application-action a",
//       ".postings-apply a",
//       ".posting-apply a",
//       ".posting-actions a",
//     ];

//     for (const selector of applySelectors) {
//       try {
//         const elements = document.querySelectorAll(selector);
//         console.log(
//           `Looking for apply button with selector: ${selector}, found: ${elements.length}`
//         );

//         for (const element of elements) {
//           if (
//             this.isElementVisible(element) &&
//             (element.href?.includes("/apply") ||
//               element.textContent.toLowerCase().includes("apply"))
//           ) {
//             return element;
//           }
//         }
//       } catch (e) {
//         console.warn(`Error with selector ${selector}:`, e);
//       }
//     }

//     // If selectors fail, try finding by text content
//     const allLinks = document.querySelectorAll("a");
//     for (const link of allLinks) {
//       if (this.isElementVisible(link)) {
//         const text = link.textContent.toLowerCase();
//         if (
//           (text.includes("apply") || text.includes("application")) &&
//           (link.href?.includes("/apply") ||
//             link.getAttribute("href")?.includes("/apply"))
//         ) {
//           return link;
//         }
//       }
//     }

//     return null;
//   }

//   async waitForApplicationPage(timeout = 10000) {
//     console.log("Waiting for application page...");
//     const startTime = Date.now();

//     while (Date.now() - startTime < timeout) {
//       // Check if URL contains /apply
//       if (window.location.href.includes("/apply")) {
//         console.log("URL contains /apply, checking for form...");
//         // Also check for application form presence
//         const form = this.findApplicationForm();
//         if (form) {
//           console.log("Application form found!");
//           return true;
//         }
//       }

//       await this.wait(500);
//     }

//     console.warn("Timeout waiting for application page");
//     throw new Error("Timeout waiting for application page to load");
//   }

//   async startSearchProcess() {
//     try {
//       this.statusOverlay.addInfo("Starting job search process");
//       this.statusOverlay.updateStatus("searching");

//       // Get search task data from background
//       await this.fetchSearchTaskData();

//       // Start job search loop
//       await this.searchNext();
//     } catch (error) {
//       this.reportError(error, { phase: "search" });
//     }
//   }

//   async fetchSearchTaskData() {
//     this.log("📡 Fetching search task data from background");
//     this.statusOverlay.addInfo("Fetching search task data...");

//     const success = this.safeSendPortMessage({ type: "GET_SEARCH_TASK" });
//     if (!success) {
//       throw new Error("Failed to request search task data");
//     }
//   }

//   processSearchTaskData(data) {
//     try {
//       this.log("📊 Processing search task data:", data);

//       if (!data) {
//         this.log("⚠️ No search task data provided");
//         return;
//       }

//       this.searchData = {
//         tabId: data.tabId,
//         limit: data.limit || 10,
//         current: data.current || 0,
//         domain: data.domain || ["https://jobs.lever.co"],
//         submittedLinks: data.submittedLinks
//           ? data.submittedLinks.map((link) => ({ ...link, tries: 0 }))
//           : [],
//         searchLinkPattern: data.searchLinkPattern
//           ? new RegExp(data.searchLinkPattern.replace(/^\/|\/[gimy]*$/g, ""))
//           : /^https:\/\/jobs\.(eu\.)?lever\.co\/([^\/]*)\/([^\/]*)\/?(.*)?$/,
//       };

//       this.log("✅ Search data initialized:", this.searchData);
//       this.statusOverlay.addSuccess("Search initialization complete");
//     } catch (error) {
//       this.log("❌ Error processing search task data:", error);
//       this.statusOverlay.addError(
//         "Error processing search task data: " + error.message
//       );
//     }
//   }

//   async searchNext() {
//     try {
//       this.log("Executing searchNext");

//       // Critical: If an application is in progress, do not continue
//       if (this.applicationState.isApplicationInProgress) {
//         this.log("Application in progress, not searching for next link");
//         this.statusOverlay.addInfo(
//           "Application in progress, waiting to complete..."
//         );

//         // Verify with background script
//         this.safeSendPortMessage({ type: "CHECK_JOB_TAB_STATUS" });
//         return;
//       }

//       this.statusOverlay.addInfo("Searching for job links...");

//       // Find all matching links
//       let links = this.findAllLinksElements();
//       this.log(`Found ${links.length} links`);

//       // If no links on page, try to load more
//       if (links.length === 0) {
//         this.log("No links found, trying to load more");
//         this.statusOverlay.addInfo("No links found, trying to load more...");

//         if (this.applicationState.isApplicationInProgress) {
//           this.log("Application became in progress, aborting navigation");
//           return;
//         }

//         await this.wait(2000);

//         if (this.applicationState.isApplicationInProgress) {
//           this.log("Application became in progress, aborting navigation");
//           return;
//         }

//         const loadMoreBtn = this.findLoadMoreElement();
//         if (loadMoreBtn) {
//           if (this.applicationState.isApplicationInProgress) {
//             this.log("Application became in progress, aborting navigation");
//             return;
//           }

//           this.statusOverlay.addInfo('Clicking "More results" button');
//           loadMoreBtn.click();
//           await this.wait(3000);

//           if (!this.applicationState.isApplicationInProgress) {
//             this.fetchSearchTaskData();
//           }
//           return;
//         } else {
//           this.statusOverlay.addWarning("No more results to load");
//           this.safeSendPortMessage({ type: "SEARCH_TASK_DONE" });
//           this.log("Search task completed");
//           return;
//         }
//       }

//       // Process links one by one - USE URL-BASED TRACKING!
//       let foundUnprocessedLink = false;

//       // First pass: mark all already processed links
//       for (let i = 0; i < links.length; i++) {
//         let url = this.normalizeUrlFully(links[i].href);

//         // Check if this URL is already in processed links
//         const processedLink = this.searchData.submittedLinks.find((link) => {
//           if (!link.url) return false;
//           const normalizedLinkUrl = this.normalizeUrlFully(link.url);
//           return (
//             normalizedLinkUrl === url ||
//             url.includes(normalizedLinkUrl) ||
//             normalizedLinkUrl.includes(url)
//           );
//         });

//         // Also check local cache
//         const inLocalCache =
//           this.applicationState.processedUrls &&
//           this.applicationState.processedUrls.has(url);

//         if (processedLink || inLocalCache) {
//           // Mark as already processed with the appropriate color
//           if (processedLink && processedLink.status === "SUCCESS") {
//             this.markLinkAsColor(links[i], "orange", "Completed");
//           } else if (processedLink && processedLink.status === "ERROR") {
//             this.markLinkAsColor(links[i], "red", "Skipped");
//           } else {
//             this.markLinkAsColor(links[i], "orange", "Completed");
//           }

//           this.statusOverlay.addInfo(`Skipping already processed: ${url}`);
//           continue;
//         }

//         // Check if URL matches pattern
//         if (this.searchData.searchLinkPattern) {
//           const pattern =
//             typeof this.searchData.searchLinkPattern === "string"
//               ? new RegExp(
//                   this.searchData.searchLinkPattern.replace(
//                     /^\/|\/[gimy]*$/g,
//                     ""
//                   )
//                 )
//               : this.searchData.searchLinkPattern;

//           if (!pattern.test(url)) {
//             this.log(`Link ${url} does not match pattern`);
//             this.markLinkAsColor(links[i], "red", "Invalid");

//             // Add to processed URLs to avoid rechecking
//             if (!this.applicationState.processedUrls)
//               this.applicationState.processedUrls = new Set();
//             this.applicationState.processedUrls.add(url);

//             // Add to search data to maintain consistency
//             this.searchData.submittedLinks.push({
//               url,
//               status: "SKIP",
//               message: "Link does not match pattern",
//             });

//             this.statusOverlay.addWarning(
//               `Skipping link that doesn't match pattern: ${url}`
//             );
//             continue;
//           }
//         }

//         // Found an unprocessed link that matches the pattern
//         foundUnprocessedLink = true;
//       }

//       // Check for application in progress before second pass
//       if (this.applicationState.isApplicationInProgress) {
//         this.log("Application became in progress during first pass, aborting");
//         return;
//       }

//       // Second pass: find the first unprocessed link that meets criteria
//       for (let i = 0; i < links.length; i++) {
//         let url = this.normalizeUrlFully(links[i].href);

//         // Check if this URL is already in processed links
//         const alreadyProcessed = this.searchData.submittedLinks.some((link) => {
//           if (!link.url) return false;
//           const normalizedLinkUrl = this.normalizeUrlFully(link.url);
//           return (
//             normalizedLinkUrl === url ||
//             url.includes(normalizedLinkUrl) ||
//             normalizedLinkUrl.includes(url)
//           );
//         });

//         // Also check local cache
//         const inLocalCache =
//           this.applicationState.processedUrls &&
//           this.applicationState.processedUrls.has(url);

//         if (alreadyProcessed || inLocalCache) {
//           continue;
//         }

//         // Check if URL matches pattern
//         if (this.searchData.searchLinkPattern) {
//           const pattern =
//             typeof this.searchData.searchLinkPattern === "string"
//               ? new RegExp(
//                   this.searchData.searchLinkPattern.replace(
//                     /^\/|\/[gimy]*$/g,
//                     ""
//                   )
//                 )
//               : this.searchData.searchLinkPattern;

//           if (!pattern.test(url)) {
//             continue;
//           }
//         }

//         // Found an unprocessed link that matches the pattern - process it!
//         this.statusOverlay.addSuccess("Found job to apply: " + url);

//         // Check one more time before proceeding
//         if (this.applicationState.isApplicationInProgress) {
//           this.log("Application became in progress, aborting new task");
//           return;
//         }

//         // Mark as processing and add to local cache immediately
//         this.markLinkAsColor(links[i], "green", "In Progress");

//         // Set the application flag BEFORE sending task
//         this.applicationState.isApplicationInProgress = true;
//         this.applicationState.applicationStartTime = Date.now();

//         // Add to local cache immediately to prevent double processing
//         if (!this.applicationState.processedUrls)
//           this.applicationState.processedUrls = new Set();
//         this.applicationState.processedUrls.add(url);

//         // Set timeout for detecting stuck applications BEFORE sending message
//         if (this.sendCvPageNotRespondTimeout) {
//           clearTimeout(this.sendCvPageNotRespondTimeout);
//         }

//         this.sendCvPageNotRespondTimeout = setTimeout(() => {
//           if (this.applicationState.isApplicationInProgress) {
//             this.statusOverlay.addWarning(
//               "No response from job page, resuming search"
//             );
//             this.safeSendPortMessage({ type: "SEND_CV_TAB_NOT_RESPOND" });
//             this.applicationState.isApplicationInProgress = false;
//             this.applicationState.applicationStartTime = null;
//             setTimeout(() => this.searchNext(), 2000);
//           }
//         }, 180000);

//         // Send message to the background script
//         try {
//           this.safeSendPortMessage({
//             type: "SEND_CV_TASK",
//             data: {
//               url,
//               title: links[i].textContent.trim() || "Job Application",
//             },
//           });
//         } catch (err) {
//           this.log(`Error sending CV task for ${url}:`, err);
//           this.statusOverlay.addError("Error sending CV task: " + err.message);

//           // Reset flags on error
//           this.applicationState.isApplicationInProgress = false;
//           this.applicationState.applicationStartTime = null;
//           if (this.sendCvPageNotRespondTimeout) {
//             clearTimeout(this.sendCvPageNotRespondTimeout);
//             this.sendCvPageNotRespondTimeout = null;
//           }

//           // Remove from processed URLs since we couldn't process it
//           if (this.applicationState.processedUrls) {
//             this.applicationState.processedUrls.delete(url);
//           }

//           // Mark as error and continue with next link
//           this.markLinkAsColor(links[i], "red", "Error");
//           continue;
//         }

//         // We found a suitable link and sent the message successfully
//         foundUnprocessedLink = true;
//         return; // Exit after sending one job for processing
//       }

//       // If we couldn't find any unprocessed links
//       if (!foundUnprocessedLink) {
//         // Check one more time before trying to navigate
//         if (this.applicationState.isApplicationInProgress) {
//           this.log("Application became in progress, aborting navigation");
//           return;
//         }

//         // Try to load more results
//         this.statusOverlay.addInfo(
//           "No new job links found, trying to load more..."
//         );
//         const loadMoreBtn = this.findLoadMoreElement();

//         if (loadMoreBtn) {
//           // Final check before clicking
//           if (this.applicationState.isApplicationInProgress) {
//             this.log("Application became in progress, aborting navigation");
//             return;
//           }

//           // Click the "More results" button and wait
//           this.statusOverlay.addInfo('Clicking "More results" button');
//           loadMoreBtn.click();

//           // Set a timeout to check again after page loads
//           // but only if we're not processing an application
//           setTimeout(() => {
//             if (!this.applicationState.isApplicationInProgress) {
//               this.searchNext();
//             }
//           }, 3000);
//         } else {
//           // No more results and no unprocessed links - we're done!
//           this.statusOverlay.addSuccess(
//             "All jobs processed, search completed!"
//           );
//           this.safeSendPortMessage({ type: "SEARCH_TASK_DONE" });
//         }
//       }
//     } catch (err) {
//       this.log("Error in searchNext:", err);
//       this.statusOverlay.addError("Error in search: " + err.message);

//       // Reset application state on error
//       this.applicationState.isApplicationInProgress = false;
//       this.applicationState.applicationStartTime = null;
//       if (this.sendCvPageNotRespondTimeout) {
//         clearTimeout(this.sendCvPageNotRespondTimeout);
//         this.sendCvPageNotRespondTimeout = null;
//       }

//       // Try again after a delay
//       setTimeout(() => this.searchNext(), 5000);
//     }
//   }

//   findAllLinksElements() {
//     try {
//       const domains = Array.isArray(this.searchData.domain)
//         ? this.searchData.domain
//         : [this.searchData.domain];

//       if (!domains || domains.length === 0) {
//         this.log("No domains specified for link search");
//         return [];
//       }

//       this.log("Searching for links with domains:", domains);

//       // Create a combined selector for all domains
//       const selectors = domains.map((domain) => {
//         // Handle missing protocol, clean domain
//         const cleanDomain = domain
//           .replace(/^https?:\/\//, "")
//           .replace(/\/$/, "");
//         return `#rso a[href*="${cleanDomain}"], #botstuff a[href*="${cleanDomain}"]`;
//       });

//       const selector = selectors.join(",");
//       const links = document.querySelectorAll(selector);

//       this.log(`Found ${links.length} matching links`);
//       return Array.from(links);
//     } catch (err) {
//       this.log("Error finding links:", err);
//       return [];
//     }
//   }

//   findLoadMoreElement() {
//     try {
//       // If we're on the last page (prev button but no next button)
//       if (
//         document.getElementById("pnprev") &&
//         !document.getElementById("pnnext")
//       ) {
//         return null;
//       }

//       // Method 1: Find "More results" button
//       const moreResultsBtn = Array.from(document.querySelectorAll("a")).find(
//         (a) => a.textContent.includes("More results")
//       );

//       if (moreResultsBtn) {
//         return moreResultsBtn;
//       }

//       // Method 2: Look for "Next" button
//       const nextBtn = document.getElementById("pnnext");
//       if (nextBtn) {
//         return nextBtn;
//       }

//       // Method 3: Try to find any navigation button at the bottom
//       const navLinks = [
//         ...document.querySelectorAll(
//           "#botstuff table a[href^='/search?q=site:']"
//         ),
//       ];
//       this.log(`Found ${navLinks.length} potential navigation links`);

//       // Return the last one (typically "More results" or similar)
//       return navLinks[navLinks.length - 1];
//     } catch (err) {
//       this.log("Error finding load more button:", err);
//       return null;
//     }
//   }

//   normalizeUrlFully(url) {
//     try {
//       if (!url) return "";

//       // Handle URLs with or without protocol
//       if (!url.startsWith("http")) {
//         url = "https://" + url;
//       }

//       // Remove /apply suffix commonly found in Lever job URLs
//       url = url.replace(/\/apply$/, "");

//       const urlObj = new URL(url);
//       // Remove trailing slashes and query parameters
//       return (urlObj.origin + urlObj.pathname)
//         .toLowerCase()
//         .trim()
//         .replace(/\/+$/, "");
//     } catch (e) {
//       this.log("Error normalizing URL:", e);
//       return url.toLowerCase().trim();
//     }
//   }

//   async startApplicationProcess() {
//     try {
//       console.log("📝 Starting application process");
//       this.statusOverlay.addInfo("Starting application process");

//       // FIXED: Comprehensive user profile validation and fetching
//       if (!this.userProfile) {
//         console.log(
//           "⚠️ No user profile available, attempting multiple fetch strategies..."
//         );

//         // Strategy 1: Try session context
//         if (this.sessionContext && this.sessionContext.userProfile) {
//           this.userProfile = this.sessionContext.userProfile;
//           console.log("✅ User profile loaded from session context");
//         }

//         // Strategy 2: Try user service if we have userId
//         if (!this.userProfile && this.userId) {
//           try {
//             console.log("📡 Fetching user profile via user service");
//             this.userProfile = await this.userService.getUserDetails();
//             console.log("✅ User profile fetched via user service");
//           } catch (error) {
//             console.error("❌ User service fetch failed:", error);
//           }
//         }

//         // Strategy 3: Try background script
//         if (!this.userProfile) {
//           console.log("📡 Requesting user profile from background script");
//           await this.fetchSendCvTaskData();
//         }

//         // Final validation
//         if (!this.userProfile) {
//           this.statusOverlay.addError(
//             "No user profile available - automation may fail"
//           );
//           console.error(
//             "❌ Failed to obtain user profile through all strategies"
//           );
//         } else {
//           this.statusOverlay.addSuccess("User profile loaded successfully");
//           console.log("✅ User profile finally available:", {
//             name: this.userProfile.name || this.userProfile.firstName,
//             email: this.userProfile.email,
//           });
//         }
//       } else {
//         console.log("✅ Using existing user profile");
//         this.statusOverlay.addSuccess("User profile already available");
//       }

//       // NEW: Check if we're on a job listing page and click the "Apply" button if needed
//       const currentUrl = window.location.href;
//       if (this.isLeverJobListingPage(currentUrl)) {
//         console.log("📋 On job listing page, need to click Apply button");
//         this.statusOverlay.addInfo(
//           "Job listing page detected - clicking Apply button"
//         );

//         // Extract job description while on the listing page
//         console.log("📄 Extracting job description from listing page");
//         this.cachedJobDescription = await this.extractJobDescription();
//         console.log("✅ Job description cached:", {
//           title: this.cachedJobDescription.title,
//           company: this.cachedJobDescription.company,
//         });

//         // Find and click the Apply button
//         const applyButton = this.findApplyButton();
//         if (!applyButton) {
//           throw new Error("Cannot find Apply button on job listing page");
//         }

//         console.log("🖱️ Clicking Apply button");
//         this.statusOverlay.addInfo("Clicking Apply button");
//         applyButton.click();

//         // Wait for the application page to load
//         console.log("⏳ Waiting for application page to load");
//         this.statusOverlay.addInfo("Waiting for application page to load");
//         await this.waitForApplicationPage();

//         console.log("✅ Application page loaded");
//         this.statusOverlay.addSuccess("Application page loaded successfully");
//       }

//       // Check for success page first
//       const applied = this.checkSubmissionSuccess();
//       if (applied) {
//         const jobId = this.extractJobIdFromUrl(window.location.href);
//         this.safeSendPortMessage({
//           type: "SEND_CV_TASK_DONE",
//           data: {
//             jobId: jobId,
//             title: document.title || "Job on Lever",
//             company:
//               this.extractCompanyFromUrl(window.location.href) ||
//               "Company on Lever",
//             location: "Not specified",
//             jobUrl: window.location.href,
//             salary: "Not specified",
//             workplace: "Not specified",
//             postedDate: "Not specified",
//             applicants: "Not specified",
//           },
//         });

//         this.applicationState.isApplicationInProgress = false;
//         this.statusOverlay.addSuccess("Application completed successfully");
//         return;
//       }

//       // Proceed with application process
//       await new Promise((resolve, reject) => {
//         setTimeout(async () => {
//           try {
//             await this.apply();
//             resolve();
//           } catch (e) {
//             reject(e);
//           }
//         }, 3000);
//       });
//     } catch (error) {
//       this.reportError(error, { phase: "application" });
//       if (error.name === "SendCvSkipError") {
//         this.statusOverlay.addWarning("Application skipped: " + error.message);
//         this.safeSendPortMessage({
//           type: "SEND_CV_TASK_SKIP",
//           data: error.message,
//         });
//       } else {
//         this.statusOverlay.addError("Application error: " + error.message);
//         this.safeSendPortMessage({
//           type: "SEND_CV_TASK_ERROR",
//           data: this.errorToString(error),
//         });
//       }
//       this.applicationState.isApplicationInProgress = false;
//     }
//   }

//   async fetchSendCvTaskData() {
//     // Only fetch if we don't have user profile
//     if (this.userProfile && this.hasSessionContext) {
//       this.log("✅ User profile already available from session context");
//       return;
//     }

//     this.log("📡 Fetching send CV task data from background");
//     this.statusOverlay.addInfo("Fetching CV task data...");

//     const success = this.safeSendPortMessage({ type: "GET_SEND_CV_TASK" });
//     if (!success) {
//       throw new Error("Failed to request send CV task data");
//     }
//   }

//   processSendCvTaskData(data) {
//     try {
//       console.log("📊 Processing send CV task data:", {
//         hasData: !!data,
//         hasProfile: !!data?.profile,
//         currentProfileStatus: !!this.userProfile,
//       });

//       if (!data) {
//         console.warn("⚠️ No send CV task data provided");
//         return;
//       }

//       // FIXED: Only update user profile if we don't have one or the new one is more complete
//       if (data.profile) {
//         if (!this.userProfile) {
//           this.userProfile = data.profile;
//           console.log("👤 User profile set from background response");
//         } else {
//           // Merge profiles, keeping non-null values
//           const mergedProfile = { ...this.userProfile };
//           Object.keys(data.profile).forEach((key) => {
//             if (
//               data.profile[key] &&
//               (!mergedProfile[key] || mergedProfile[key] === "")
//             ) {
//               mergedProfile[key] = data.profile[key];
//             }
//           });
//           this.userProfile = mergedProfile;
//           console.log("👤 User profile merged with background response");
//         }
//       }

//       // Update form handler
//       if (this.formHandler && this.userProfile) {
//         this.formHandler.userData = this.userProfile;
//         console.log("📝 Form handler updated with user profile");
//       }

//       console.log("✅ CV task data processed successfully", {
//         hasUserProfile: !!this.userProfile,
//         profileName: this.userProfile?.name || this.userProfile?.firstName,
//       });

//       this.statusOverlay.addSuccess("Apply initialization complete");
//     } catch (error) {
//       console.error("❌ Error processing send CV task data:", error);
//       this.statusOverlay.addError("Error processing CV data: " + error.message);
//     }
//   }

//   async apply() {
//     try {
//       this.statusOverlay.addInfo("Starting application process");
//       this.statusOverlay.updateStatus("applying");
//       console.log("Starting application process");

//       // FIXED: Validate all handlers are properly initialized
//       if (!this.validateHandlers()) {
//         throw new Error("Required handlers are not properly initialized");
//       }

//       // Check for page errors
//       if (
//         document.body.innerText.includes("Cannot GET") ||
//         document.location.search.includes("not_found=true")
//       ) {
//         throw new Error("Cannot start send cv: Page error");
//       }

//       const jobId = this.extractJobIdFromUrl(window.location.href);
//       console.log("Extracted job ID:", jobId);

//       // Check if already applied
//       const applied = this.checkSubmissionSuccess();
//       if (applied) {
//         this.safeSendPortMessage({
//           type: "SEND_CV_TASK_DONE",
//           data: {
//             jobId: jobId,
//             title: document.title || "Job on Lever",
//             company:
//               this.extractCompanyFromUrl(window.location.href) ||
//               "Company on Lever",
//             location: "Not specified",
//             jobUrl: window.location.href,
//             salary: "Not specified",
//             workplace: "Not specified",
//             postedDate: "Not specified",
//             applicants: "Not specified",
//           },
//         });

//         this.applicationState.isApplicationInProgress = false;
//         this.statusOverlay.addSuccess("Application completed successfully");
//         return true;
//       }

//       // Enhanced form detection
//       const form = this.findApplicationForm();
//       if (!form) {
//         // Try waiting for dynamic content
//         console.log(
//           "No form found immediately, waiting for dynamic content..."
//         );
//         await this.wait(2000);

//         const formAfterWait = this.findApplicationForm();
//         if (!formAfterWait) {
//           throw new Error("Cannot find application form");
//         }
//         return await this.processApplicationForm(formAfterWait);
//       }

//       return await this.processApplicationForm(form);
//     } catch (e) {
//       if (e.name === "SendCvSkipError") {
//         throw e;
//       } else {
//         console.error("Error in apply:", e);
//         throw new Error(
//           "Error during application process: " + this.errorToString(e)
//         );
//       }
//     }
//   }

//   findApplicationForm() {
//     try {
//       console.log("🔍 Searching for application form...");

//       // Strategy 1: Lever-specific selectors
//       const leverSelectors = [
//         'form[action*="lever"]',
//         'form[action*="apply"]',
//         "form.application-form",
//         "form#application-form",
//         "form.lever-apply-form",
//         'form[data-qa="application-form"]',
//         ".posting-apply form",
//         ".application-form form",
//         ".apply-form form",
//       ];

//       for (const selector of leverSelectors) {
//         const forms = document.querySelectorAll(selector);
//         console.log(
//           `Checking selector "${selector}": found ${forms.length} forms`
//         );

//         for (const form of forms) {
//           if (this.isFormVisible(form) && this.isFormValid(form)) {
//             console.log(`✅ Found valid Lever form with selector: ${selector}`);
//             return form;
//           }
//         }
//       }

//       // Strategy 2: Look for forms with file inputs (common in job applications)
//       const formsWithFiles = document.querySelectorAll("form");
//       console.log(
//         `Strategy 2: Checking ${formsWithFiles.length} forms for file inputs`
//       );

//       for (const form of formsWithFiles) {
//         if (this.isFormVisible(form)) {
//           const fileInputs = form.querySelectorAll('input[type="file"]');
//           const textInputs = form.querySelectorAll(
//             'input[type="text"], input[type="email"], textarea'
//           );

//           if (fileInputs.length > 0 && textInputs.length > 0) {
//             console.log(
//               `✅ Found form with ${fileInputs.length} file inputs and ${textInputs.length} text inputs`
//             );
//             return form;
//           }
//         }
//       }

//       // Strategy 3: Look for forms containing common job application fields
//       const applicationKeywords = [
//         "name",
//         "email",
//         "resume",
//         "cv",
//         "cover",
//         "phone",
//         "experience",
//       ];

//       for (const form of formsWithFiles) {
//         if (this.isFormVisible(form)) {
//           const formText = form.textContent.toLowerCase();
//           const matchingKeywords = applicationKeywords.filter((keyword) =>
//             formText.includes(keyword)
//           );

//           if (matchingKeywords.length >= 2) {
//             console.log(
//               `✅ Found form with application keywords: ${matchingKeywords.join(
//                 ", "
//               )}`
//             );
//             return form;
//           }
//         }
//       }

//       // Strategy 4: Return the first visible form as fallback
//       for (const form of formsWithFiles) {
//         if (this.isFormVisible(form) && this.isFormValid(form)) {
//           console.log("⚠️ Using first visible form as fallback");
//           return form;
//         }
//       }

//       console.log("❌ No suitable form found");
//       return null;
//     } catch (e) {
//       console.error("Error finding application form:", e);
//       return null;
//     }
//   }

//   async processApplicationForm(form) {
//     this.statusOverlay.addInfo("Found application form, beginning to fill out");
//     console.log("📝 Processing application form");

//     // Validate user profile
//     if (!this.userProfile) {
//       console.error("❌ No user profile available for form filling");
//       this.statusOverlay.addError("No user profile available for form filling");
//       throw new Error("User profile is required for form processing");
//     }

//     // Extract job description for AI context
//     const jobDescription =
//       this.cachedJobDescription || (await this.extractJobDescription());
//     console.log("📄 Job description extracted:", {
//       title: jobDescription.title,
//       location: jobDescription.location,
//       department: jobDescription.department,
//     });

//     // Update form handler with job description
//     if (this.formHandler) {
//       this.formHandler.jobDescription = jobDescription;
//       this.formHandler.userData = this.userProfile;
//       console.log("🔄 Updated form handler with job description and user data");
//     }

//     // FIXED: Enhanced file upload handling with validation
//     try {
//       // Validate file handler exists
//       if (!this.fileHandler) {
//         console.error("❌ File handler not initialized!");
//         this.statusOverlay.addError("File handler not available");
//         throw new Error("File handler not initialized");
//       }

//       // Validate user profile has file URLs
//       const hasResumeUrl = !!(
//         this.userProfile.resumeUrl ||
//         (this.userProfile.resumeUrls && this.userProfile.resumeUrls.length > 0)
//       );

//       if (!hasResumeUrl) {
//         this.statusOverlay.addWarning("No resume files available for upload");
//       } else {
//         // Pass the job description to the file handler
//         await this.fileHandler.handleFileUploads(
//           form,
//           this.userProfile,
//           jobDescription
//         );
//       }
//     } catch (error) {
//       this.statusOverlay.addError("File upload failed: " + error.message);
//     }

//     // Process form fields
//     try {
//       this.statusOverlay.addInfo("Filling form fields...");

//       if (!this.formHandler) {
//         console.error("❌ Form handler not initialized!");
//         throw new Error("Form handler not initialized");
//       }

//       // Pass job description to form filling method if available
//       await this.formHandler.fillFormWithProfile(
//         form,
//         this.userProfile,
//         jobDescription
//       );
//       this.statusOverlay.addSuccess("Form fields filled");
//     } catch (error) {
//       this.statusOverlay.addWarning("Form filling failed: " + error.message);
//     }

//     // Find and click submit button
//     const submitButton = this.findSubmitButton(form);
//     if (!submitButton) {
//       throw new Error("Cannot find submit button");
//     }

//     // Enable submit button if disabled
//     if (submitButton.disabled) {
//       submitButton.disabled = false;
//     }

//     // Submit the form
//     return await this.submitForm(submitButton);
//   }

//   findSubmitButton(form) {
//     const submitSelectors = [
//       'button[type="submit"]',
//       'input[type="submit"]',
//       'button[data-qa="submit-application-button"]',
//       'button[data-qa="btn-submit"]',
//       'button[data-qa="submit"]',
//       "button#btn-submit",
//       "button.submit-app-btn",
//       "button.submit-application",
//       ".posting-btn-submit",
//       "button.btn-primary:last-of-type",
//     ];

//     // Try specific selectors first
//     for (const selector of submitSelectors) {
//       try {
//         const buttons = form.querySelectorAll(selector);

//         for (const btn of buttons) {
//           if (
//             this.isElementVisible(btn) &&
//             !btn.disabled &&
//             !btn.classList.contains("disabled")
//           ) {
//             return btn;
//           }
//         }
//       } catch (e) {
//         console.warn(`Error checking selector ${selector}:`, e);
//       }
//     }

//     // Look for buttons with submit-like text
//     const allButtons = form.querySelectorAll(
//       'button, input[type="button"], input[type="submit"]'
//     );

//     for (const btn of allButtons) {
//       if (
//         !this.isElementVisible(btn) ||
//         btn.disabled ||
//         btn.classList.contains("disabled")
//       ) {
//         continue;
//       }

//       const text = (btn.textContent || btn.value || "").toLowerCase().trim();
//       const submitTexts = [
//         "submit",
//         "apply",
//         "send application",
//         "send",
//         "continue",
//         "next",
//       ];

//       if (submitTexts.some((submitText) => text.includes(submitText))) {
//         return btn;
//       }
//     }

//     // Last resort: return the last visible button in the form
//     const visibleButtons = Array.from(allButtons).filter(
//       (btn) =>
//         this.isElementVisible(btn) &&
//         !btn.disabled &&
//         !btn.classList.contains("disabled")
//     );

//     if (visibleButtons.length > 0) {
//       const lastButton = visibleButtons[visibleButtons.length - 1];
//       return lastButton;
//     }

//     return null;
//   }

//   async submitForm(submitButton) {
//     this.statusOverlay.addInfo("Submitting application...");

//     // Scroll to the button
//     this.scrollToTargetAdjusted(submitButton, 300);
//     await this.wait(600);

//     try {
//       submitButton.click();
//       this.statusOverlay.addSuccess("Clicked submit button");
//     } catch (e) {
//       this.statusOverlay.addError(
//         "Failed to click submit button: " + e.message
//       );
//     }
//     return true;
//   }

//   checkSubmissionSuccess() {
//     // Check if URL changed to a success/confirmation page
//     if (
//       window.location.href.includes("success") ||
//       window.location.href.includes("confirmation") ||
//       window.location.href.includes("thanks")
//     ) {
//       this.statusOverlay.addSuccess(
//         "URL indicates success page - application submitted"
//       );
//       return true;
//     }

//     // Check for error messages
//     const errorElements = document.querySelectorAll(
//       ".error, .error-message, .form-error, .alert-error, .validation-error"
//     );

//     if (errorElements.length > 0) {
//       const errorMessages = Array.from(errorElements)
//         .map((el) => el.textContent.trim())
//         .filter((text) => text.length > 0);

//       if (errorMessages.length > 0) {
//         this.statusOverlay.addError(
//           "Form has validation errors: " + errorMessages.join(", ")
//         );
//         return false;
//       }
//     }

//     // If we can't confirm success, report failure
//     this.statusOverlay.addWarning(
//       "Unable to confirm submission success - status uncertain"
//     );
//     return false; // Be cautious and report failure if we can't confirm success
//   }

//   extractJobIdFromUrl(url) {
//     try {
//       // Extract job ID from Lever URL format (e.g., jobs.lever.co/company/[JOB_ID])
//       const matches = url.match(/\/([a-f0-9-]{36})\/?$/);
//       if (matches && matches[1]) {
//         return matches[1];
//       }

//       // Fallback to a timestamp-based ID if we can't find a UUID
//       return "job-" + Date.now();
//     } catch (error) {
//       this.statusOverlay.addError("Error extracting job ID: " + error.message);
//       return "job-" + Date.now();
//     }
//   }

//   extractCompanyFromUrl(url) {
//     try {
//       // Pattern: https://jobs.lever.co/[COMPANY]/...
//       const matches = url.match(/\/\/jobs\.lever\.co\/([^\/]+)/);
//       if (matches && matches[1]) {
//         return matches[1].charAt(0).toUpperCase() + matches[1].slice(1); // Capitalize company name
//       }
//       return null;
//     } catch (error) {
//       return null;
//     }
//   }

//   scrollToTargetAdjusted(element, offset) {
//     if (!element) {
//       this.log("Warning: Attempted to scroll to null element");
//       return;
//     }

//     try {
//       // Handle case where element might be an array
//       if (Array.isArray(element)) {
//         this.log("Element is an array, using first element");
//         if (element.length > 0) {
//           element = element[0];
//         } else {
//           this.log("Empty array provided to scrollToTargetAdjusted");
//           return;
//         }
//       }

//       // Check if element has the necessary methods and properties
//       if (
//         !element.getBoundingClientRect ||
//         typeof element.getBoundingClientRect !== "function"
//       ) {
//         this.log(`Cannot scroll to element: ${typeof element}, ${element}`);
//         return;
//       }

//       const rect = element.getBoundingClientRect();
//       const scrollTop =
//         window.pageYOffset || document.documentElement.scrollTop;

//       window.scrollTo({
//         top: rect.top + scrollTop - offset,
//         behavior: "smooth",
//       });
//     } catch (err) {
//       this.log("Error scrolling to element:", err);
//       // Continue execution even if scrolling fails
//     }
//   }

//   errorToString(e) {
//     if (!e) return "Unknown error (no details)";

//     if (e instanceof Error) {
//       return e.message + (e.stack ? `\n${e.stack}` : "");
//     }

//     return String(e);
//   }

//   wait(timeout) {
//     return new Promise((resolve) => setTimeout(resolve, timeout));
//   }

//   async waitForPageLoad(timeout = 30000) {
//     return new Promise((resolve) => {
//       if (document.readyState === "complete") {
//         resolve(true);
//         return;
//       }

//       const checkComplete = () => {
//         if (document.readyState === "complete") {
//           resolve(true);
//         } else {
//           setTimeout(checkComplete, 100);
//         }
//       };

//       checkComplete();

//       setTimeout(() => resolve(false), timeout);
//     });
//   }

//   async waitForValidPage(timeout = 30000) {
//     const startTime = Date.now();

//     while (Date.now() - startTime < timeout) {
//       const url = window.location.href;

//       if (url.includes("google.com/search") || this.isLeverJobPage(url)) {
//         await this.detectPageTypeAndStart();
//         return;
//       }

//       await this.delay(1000);
//     }

//     throw new Error("Timeout waiting for valid page");
//   }

//   log(message, data = {}) {
//     const sessionInfo = this.sessionId
//       ? `[Session: ${this.sessionId.slice(-6)}]`
//       : "[No Session]";
//     const contextInfo = this.hasSessionContext
//       ? "[Context: ✓]"
//       : "[Context: ✗]";
//     const profileInfo = this.userProfile ? "[Profile: ✓]" : "[Profile: ✗]";

//     console.log(
//       `🤖 [Lever${sessionInfo}${contextInfo}${profileInfo}] ${message}`,
//       data
//     );
//   }

//   cleanup() {
//     super.cleanup();

//     // Clear timers
//     if (this.healthCheckTimer) {
//       clearInterval(this.healthCheckTimer);
//     }

//     if (this.keepAliveInterval) {
//       clearInterval(this.keepAliveInterval);
//     }

//     if (this.stateVerificationInterval) {
//       clearInterval(this.stateVerificationInterval);
//     }

//     if (this.sendCvPageNotRespondTimeout) {
//       clearTimeout(this.sendCvPageNotRespondTimeout);
//     }

//     // Disconnect port
//     if (this.port) {
//       try {
//         this.port.disconnect();
//       } catch (e) {
//         // Ignore errors
//       }
//       this.port = null;
//     }

//     // Cleanup status overlay
//     if (this.statusOverlay) {
//       this.statusOverlay.destroy();
//       this.statusOverlay = null;
//     }

//     // Reset state
//     this.applicationState.isApplicationInProgress = false;
//     this.applicationState.applicationStartTime = null;
//     this.applicationState.applicationUrl = null;

//     this.log("🧹 Lever platform cleanup completed");
//   }

//   // Required by base class
//   async findJobs() {
//     return this.findAllLinksElements();
//   }

//   async applyToJob(jobElement) {
//     // This method is called by base class if needed
//     return await this.apply();
//   }
// }



// // platforms/recruitee/recruitee.js
// import BasePlatform from "../base-platform.js";
// import { RecruiteeFormHandler } from "./recruitee-form-handler.js";
// import { RecruiteeFileHandler } from "./recruitee-file-handler.js";
// import {
//   AIService,
//   ApplicationTrackerService,
//   UserService,
//   StatusOverlay,
// } from "../../services/index.js";
// import { markLinkAsColor } from "../../utils/mark-links.js";
// import { API_HOST_URL } from "../../services/constants.js";

// // Custom error types
// class ApplicationError extends Error {
//   constructor(message, details) {
//     super(message);
//     this.name = "ApplicationError";
//     this.details = details;
//   }
// }

// class SkipApplicationError extends ApplicationError {
//   constructor(message) {
//     super(message);
//     this.name = "SkipApplicationError";
//   }
// }

// export default class RecruiteePlatform extends BasePlatform {
//   constructor(config) {
//     super(config);
//     this.platform = "recruitee";
//     this.baseUrl = "https://jobs.recruitee.co";

//     // Initialize user profile from multiple sources
//     this.userProfile =
//       config.userProfile || config.sessionContext?.userProfile || null;
//     this.sessionContext = config.sessionContext || null;

//     console.log(
//       `🔧 Recruitee platform constructor - User profile available: ${!!this
//         .userProfile}`
//     );
//     if (this.userProfile) {
//       console.log(`👤 User profile details:`, {
//         name: this.userProfile.name || this.userProfile.firstName,
//         email: this.userProfile.email,
//         hasResumeUrl: !!this.userProfile.resumeUrl,
//         resumeUrls: this.userProfile.resumeUrls?.length || 0,
//       });
//     }

//     this.aiService = new AIService({ apiHost: this.getApiHost() });
//     this.applicationTracker = new ApplicationTrackerService({
//       userId: this.userId,
//     });
//     this.userService = new UserService({ userId: this.userId });

//     this.statusOverlay = new StatusOverlay({
//       id: "recruitee-status-overlay",
//       title: "RECRUITEE AUTOMATION",
//       icon: "🤖",
//       position: { top: "10px", right: "10px" },
//     });

//     this.fileHandler = null;
//     this.formHandler = null;

//     // Communication state
//     this.port = null;
//     this.connectionRetries = 0;
//     this.maxRetries = 3;
//     this.hasSessionContext = !!this.sessionContext;

//     // Application state
//     this.applicationState = {
//       isApplicationInProgress: false,
//       applicationStartTime: null,
//       applicationUrl: null,
//       processedUrls: new Set(),
//       processedLinksCount: 0,
//     };

//     // Search data
//     this.searchData = {
//       limit: 0,
//       current: 0,
//       domain: ["recruitee.com"],
//       submittedLinks: [],
//       searchLinkPattern: null,
//     };

//     // Timers
//     this.healthCheckTimer = null;
//     this.keepAliveInterval = null;
//     this.sendCvPageNotRespondTimeout = null;
//     this.stuckStateTimer = null;
//     this.stateVerificationInterval = null;

//     this.markLinkAsColor = markLinkAsColor;
//   }

//   async setSessionContext(sessionContext) {
//     try {
//       this.sessionContext = sessionContext;
//       this.hasSessionContext = true;

//       // Update basic properties
//       if (sessionContext.sessionId) this.sessionId = sessionContext.sessionId;
//       if (sessionContext.platform) this.platform = sessionContext.platform;
//       if (sessionContext.userId) this.userId = sessionContext.userId;

//       // Set user profile with priority handling
//       if (sessionContext.userProfile) {
//         if (!this.userProfile || Object.keys(this.userProfile).length === 0) {
//           this.userProfile = sessionContext.userProfile;
//           console.log("👤 User profile loaded from session context");
//         } else {
//           // Merge profiles, preferring non-null values
//           this.userProfile = {
//             ...this.userProfile,
//             ...sessionContext.userProfile,
//           };
//           console.log("👤 User profile merged with session context");
//         }
//       }

//       // Fetch user profile if still missing
//       if (!this.userProfile && this.userId) {
//         try {
//           console.log("📡 Fetching user profile from user service...");
//           this.userProfile = await this.userService.getUserDetails();
//           console.log("✅ User profile fetched successfully");
//         } catch (error) {
//           console.error("❌ Failed to fetch user profile:", error);
//           this.statusOverlay?.addError(
//             "Failed to fetch user profile: " + error.message
//           );
//         }
//       }

//       // Update services with user context
//       if (this.userId) {
//         this.applicationTracker = new ApplicationTrackerService({
//           userId: this.userId,
//         });
//         this.userService = new UserService({ userId: this.userId });
//       }

//       // Store API host from session context
//       if (sessionContext.apiHost) {
//         this.sessionApiHost = sessionContext.apiHost;
//       }

//       // Update form handler if it exists
//       if (this.formHandler && this.userProfile) {
//         this.formHandler.userData = this.userProfile;
//       }

//       console.log("✅ Recruitee session context set successfully", {
//         hasUserProfile: !!this.userProfile,
//         userId: this.userId,
//         sessionId: this.sessionId,
//         profileName: this.userProfile?.name || this.userProfile?.firstName,
//         profileEmail: this.userProfile?.email,
//       });
//     } catch (error) {
//       console.error("❌ Error setting Recruitee session context:", error);
//       this.statusOverlay?.addError(
//         "❌ Error setting session context: " + error.message
//       );
//     }
//   }

//   async initialize() {
//     await super.initialize();

//     // Create status overlay FIRST
//     this.statusOverlay.create();

//     // Initialize file handler
//     this.fileHandler = new RecruiteeFileHandler({
//       statusService: this.statusOverlay,
//       apiHost: this.getApiHost(),
//     });

//     // Set up communication with background script
//     this.initializePortConnection();

//     // Set up health monitoring
//     this.startHealthCheck();
//     this.startStateVerification();

//     // Initialize form handler
//     this.formHandler = new RecruiteeFormHandler({
//       logger: (message) => this.statusOverlay.addInfo(message),
//       host: this.getApiHost(),
//       userData: this.userProfile || {},
//       jobDescription: "",
//     });

//     this.statusOverlay.addSuccess("Recruitee automation initialized");
//   }

//   initializePortConnection() {
//     try {
//       this.statusOverlay.addInfo(
//         "📡 Initializing port connection with background script"
//       );

//       // Disconnect existing port if any
//       if (this.port) {
//         try {
//           this.port.disconnect();
//         } catch (e) {
//           // Ignore errors when disconnecting
//         }
//       }

//       // Determine port name based on page type and session
//       const isApplyPage = window.location.href.match(
//         /(recruitee\.com\/(o|career))/i
//       );
//       const sessionSuffix = this.sessionId
//         ? `-${this.sessionId.slice(-6)}`
//         : "";
//       const timestamp = Date.now();
//       const portName = isApplyPage
//         ? `recruitee-apply-${timestamp}${sessionSuffix}`
//         : `recruitee-search-${timestamp}${sessionSuffix}`;

//       this.log(`🔌 Creating connection with port name: ${portName}`);

//       // Create the connection
//       this.port = chrome.runtime.connect({ name: portName });

//       if (!this.port) {
//         throw new Error(
//           "Failed to establish connection with background script"
//         );
//       }

//       // Set up message handler
//       this.port.onMessage.addListener((message) => {
//         this.handlePortMessage(message);
//       });

//       // Handle port disconnection
//       this.port.onDisconnect.addListener(() => {
//         const error = chrome.runtime.lastError;
//         if (error) {
//           this.log("❌ Port disconnected due to error:", error);
//         } else {
//           this.log("🔌 Port disconnected");
//         }

//         this.port = null;

//         // Attempt to reconnect
//         if (this.connectionRetries < this.maxRetries) {
//           this.connectionRetries++;
//           this.log(
//             `🔄 Attempting to reconnect (${this.connectionRetries}/${this.maxRetries})...`
//           );
//           setTimeout(() => this.initializePortConnection(), 5000);
//         }
//       });

//       // Start keep-alive interval
//       this.startKeepAliveInterval();

//       this.connectionRetries = 0;
//       this.log("✅ Port connection established successfully");
//       this.statusOverlay.addSuccess("Connection established");
//     } catch (error) {
//       this.log("❌ Error initializing port connection:", error);
//       this.statusOverlay.addError("Connection failed: " + error.message);
//       if (this.connectionRetries < this.maxRetries) {
//         this.connectionRetries++;
//         setTimeout(() => this.initializePortConnection(), 5000);
//       }
//     }
//   }

//   startKeepAliveInterval() {
//     if (this.keepAliveInterval) {
//       clearInterval(this.keepAliveInterval);
//     }

//     this.keepAliveInterval = setInterval(() => {
//       try {
//         if (this.port) {
//           this.safeSendPortMessage({ type: "KEEPALIVE" });
//         } else {
//           this.log("🔄 Port is null during keepalive, attempting to reconnect");
//           this.initializePortConnection();
//         }
//       } catch (error) {
//         this.log("❌ Error sending keepalive, reconnecting:", error);
//         this.initializePortConnection();
//       }
//     }, 25000);
//   }

//   startHealthCheck() {
//     if (this.healthCheckTimer) {
//       clearInterval(this.healthCheckTimer);
//     }

//     this.healthCheckTimer = setInterval(() => this.checkHealth(), 60000);
//   }

//   startStateVerification() {
//     if (this.stateVerificationInterval) {
//       clearInterval(this.stateVerificationInterval);
//     }

//     this.stateVerificationInterval = setInterval(() => {
//       if (this.applicationState.isApplicationInProgress && this.port) {
//         try {
//           this.log("Verifying application status with background script");
//           this.safeSendPortMessage({ type: "CHECK_APPLICATION_STATUS" });
//         } catch (e) {
//           this.log("Error in periodic state verification:", e);
//         }
//       }
//     }, 30000);
//   }

//   checkHealth() {
//     try {
//       const now = Date.now();

//       // Check for stuck application
//       if (
//         this.applicationState.isApplicationInProgress &&
//         this.applicationState.applicationStartTime
//       ) {
//         const applicationTime =
//           now - this.applicationState.applicationStartTime;

//         if (applicationTime > 5 * 60 * 1000) {
//           this.log("🚨 Application stuck for over 5 minutes, forcing reset");
//           this.applicationState.isApplicationInProgress = false;
//           this.applicationState.applicationStartTime = null;
//           this.statusOverlay.addWarning(
//             "Application timeout detected - resetting state"
//           );
//           setTimeout(() => this.searchNext(), 1000);
//         }
//       }
//     } catch (error) {
//       this.log("❌ Health check error", error);
//     }
//   }

//   safeSendPortMessage(message) {
//     try {
//       if (!this.port) {
//         this.log("⚠️ Port not available, attempting to reconnect");
//         this.initializePortConnection();
//         return false;
//       }

//       this.port.postMessage(message);
//       return true;
//     } catch (error) {
//       this.log("❌ Error sending port message:", error);
//       this.initializePortConnection();
//       return false;
//     }
//   }

//   handlePortMessage(message) {
//     try {
//       this.log("📨 Received port message:", message);

//       const { type, data } = message || {};
//       if (!type) {
//         this.log("⚠️ Received message without type, ignoring");
//         return;
//       }

//       switch (type) {
//         case "SEARCH_TASK_DATA":
//           this.handleSearchTaskData(data);
//           break;

//         case "APPLICATION_TASK_DATA":
//           this.handleApplicationTaskData(data);
//           break;

//         case "APPLICATION_STARTING":
//           this.handleApplicationStarting(data);
//           break;

//         case "APPLICATION_STATUS":
//           this.handleApplicationStatus(data);
//           break;

//         case "SEARCH_NEXT":
//           this.handleSearchNext(data);
//           break;

//         case "DUPLICATE":
//           this.handleDuplicateJob(data);
//           break;

//         case "ERROR":
//           this.handleErrorMessage(data);
//           break;

//         case "KEEPALIVE_RESPONSE":
//           // Just acknowledge keepalive
//           break;

//         default:
//           this.log(`❓ Unhandled message type: ${type}`);
//       }
//     } catch (error) {
//       this.log("❌ Error handling port message:", error);
//     }
//   }

//   handleSearchTaskData(data) {
//     try {
//       this.log("📊 Processing search task data:", data);

//       if (!data) {
//         this.log("⚠️ No search task data provided");
//         return;
//       }

//       this.searchData = {
//         limit: data.limit || 10,
//         current: data.current || 0,
//         domain: data.domain || ["recruitee.com"],
//         submittedLinks: data.submittedLinks
//           ? data.submittedLinks.map((link) => ({ ...link, tries: 0 }))
//           : [],
//         searchLinkPattern: data.searchLinkPattern
//           ? new RegExp(data.searchLinkPattern.replace(/^\/|\/[gimy]*$/g, ""))
//           : /^https:\/\/.*\.recruitee\.com\/(o|career)\/([^\/]+)\/?.*$/,
//       };

//       // Include user profile if available
//       if (data.profile && !this.userProfile) {
//         this.userProfile = data.profile;
//         this.log("👤 User profile loaded from search task data");
//       }

//       this.log("✅ Search data initialized:", this.searchData);
//       this.statusOverlay.addSuccess("Search initialization complete");

//       // Start search process
//       setTimeout(() => this.searchNext(), 1000);
//     } catch (error) {
//       this.log("❌ Error processing search task data:", error);
//       this.statusOverlay.addError(
//         "Error processing search task data: " + error.message
//       );
//     }
//   }

//   handleApplicationTaskData(data) {
//     try {
//       this.log("📊 Processing application task data:", data);

//       if (!data) {
//         this.log("⚠️ No application task data provided");
//         return;
//       }

//       // Store application data
//       this.applicationData = data;

//       // Ensure user profile is available
//       if (data.profile && !this.userProfile) {
//         this.userProfile = data.profile;
//         this.log("👤 User profile loaded from application task data");
//       }

//       // Update form handler
//       if (this.formHandler && this.userProfile) {
//         this.formHandler.userData = this.userProfile;
//       }

//       this.statusOverlay.addSuccess("Application initialization complete");

//       // Start application process
//       setTimeout(() => this.startApplicationProcess(), 1000);
//     } catch (error) {
//       this.log("❌ Error processing application task data:", error);
//       this.statusOverlay.addError(
//         "Error processing application task data: " + error.message
//       );
//     }
//   }

//   handleApplicationStarting(data) {
//     this.log("🎯 Application starting:", data);
//     this.applicationState.isApplicationInProgress = true;
//     this.applicationState.applicationStartTime = Date.now();
//     this.statusOverlay.addInfo("Application starting...");
//   }

//   handleApplicationStatus(data) {
//     this.log("📊 Application status:", data);

//     if (data.inProgress && !this.applicationState.isApplicationInProgress) {
//       this.applicationState.isApplicationInProgress = true;
//       this.applicationState.applicationStartTime = Date.now();
//       this.statusOverlay.addInfo("Application in progress, waiting...");
//     } else if (
//       !data.inProgress &&
//       this.applicationState.isApplicationInProgress
//     ) {
//       this.applicationState.isApplicationInProgress = false;
//       this.applicationState.applicationStartTime = null;
//       this.statusOverlay.addInfo("No active application, resuming search");
//       setTimeout(() => this.searchNext(), 1000);
//     }
//   }

//   handleSearchNext(data) {
//     this.log("🔄 Received search next notification", data);

//     // Reset application state
//     this.applicationState.isApplicationInProgress = false;
//     this.applicationState.applicationStartTime = null;
//     this.applicationState.processedLinksCount++;

//     // Clear timeout
//     if (this.sendCvPageNotRespondTimeout) {
//       clearTimeout(this.sendCvPageNotRespondTimeout);
//       this.sendCvPageNotRespondTimeout = null;
//     }

//     if (!data || !data.url) {
//       this.statusOverlay.addInfo("Job processed, searching next...");
//       setTimeout(() => this.searchNext(), 2500);
//       return;
//     }

//     const normalizedUrl = this.normalizeUrlFully(data.url);

//     // Update visual status of the processed link
//     const links = this.findAllLinksElements();
//     let linkFound = false;

//     for (let i = 0; i < links.length; i++) {
//       const linkUrl = this.normalizeUrlFully(links[i].href);

//       if (
//         linkUrl === normalizedUrl ||
//         linkUrl.includes(normalizedUrl) ||
//         normalizedUrl.includes(linkUrl)
//       ) {
//         if (data.status === "SUCCESS") {
//           this.markLinkAsColor(links[i], "orange", "Completed");
//           this.statusOverlay.addSuccess("Successfully submitted: " + data.url);
//         } else if (data.status === "ERROR") {
//           this.markLinkAsColor(links[i], "red", "Error");
//           this.statusOverlay.addError(
//             "Error with: " +
//               data.url +
//               (data.message ? ` - ${data.message}` : "")
//           );
//         } else {
//           this.markLinkAsColor(links[i], "orange", "Skipped");
//           this.statusOverlay.addWarning(
//             "Skipped: " + data.url + (data.message ? ` - ${data.message}` : "")
//           );
//         }

//         linkFound = true;
//         break;
//       }
//     }

//     // Record submission if not already in the list
//     if (
//       !this.searchData.submittedLinks.some((link) => {
//         const linkUrl = this.normalizeUrlFully(link.url);
//         return (
//           linkUrl === normalizedUrl ||
//           linkUrl.includes(normalizedUrl) ||
//           normalizedUrl.includes(linkUrl)
//         );
//       })
//     ) {
//       this.searchData.submittedLinks.push({ ...data });
//     }

//     setTimeout(() => this.searchNext(), 2500);
//   }

//   handleDuplicateJob(data) {
//     this.log("⚠️ Duplicate job detected, resetting application state");
//     this.applicationState.isApplicationInProgress = false;
//     this.applicationState.applicationStartTime = null;
//     this.statusOverlay.addWarning(
//       `Job already processed: ${data?.url || "Unknown URL"}`
//     );

//     setTimeout(() => this.searchNext(), 1000);
//   }

//   handleErrorMessage(data) {
//     const errorMessage =
//       data && data.message
//         ? data.message
//         : "Unknown error from background script";
//     this.log("❌ Error from background script:", errorMessage);
//     this.statusOverlay.addError("Background error: " + errorMessage);
//   }

//   async start(params = {}) {
//     try {
//       this.isRunning = true;
//       this.log("▶️ Starting Recruitee automation");

//       // FIXED: Ensure user profile is available before starting
//       if (!this.userProfile && this.userId) {
//         try {
//           console.log("🔄 Attempting to fetch user profile during start...");
//           this.userProfile = await this.userService.getUserDetails();
//           console.log("✅ User profile fetched during start");
//         } catch (error) {
//           console.error("❌ Failed to fetch user profile during start:", error);
//         }
//       }

//       // Update config with parameters
//       this.config = { ...this.config, ...params };

//       // Update progress
//       this.updateProgress({
//         total: params.jobsToApply || 0,
//         completed: 0,
//         current: "Starting automation...",
//       });

//       // Wait for page to be ready
//       await this.waitForPageLoad();

//       // Detect page type and start appropriate automation
//       await this.detectPageTypeAndStart();

//       return true;
//     } catch (error) {
//       this.reportError(error, { action: "start" });
//       return false;
//     }
//   }

//   async detectPageTypeAndStart() {
//     const url = window.location.href;
//     this.log(`🔍 Detecting page type for: ${url}`);

//     if (url.includes("google.com/search")) {
//       this.log("📊 Google search page detected");
//       this.statusOverlay.addInfo("Google search page detected");
//       await this.startSearchProcess();
//     } else if (this.isRecruiteeJobPage(url)) {
//       this.log("📋 Recruitee job page detected");
//       this.statusOverlay.addInfo("Recruitee job page detected");
//       await this.startApplicationProcess();
//     } else {
//       this.log("❓ Unknown page type, waiting for navigation");
//       await this.waitForValidPage();
//     }
//   }

//   isRecruiteeJobPage(url) {
//     return /recruitee\.com\/(o|career)\//.test(url);
//   }

//   async startSearchProcess() {
//     try {
//       this.statusOverlay.addInfo("Starting job search process");
//       this.statusOverlay.updateStatus("searching");

//       // Get search task data from background
//       await this.fetchSearchTaskData();
//     } catch (error) {
//       this.reportError(error, { phase: "search" });
//     }
//   }

//   async fetchSearchTaskData() {
//     this.log("📡 Fetching search task data from background");
//     this.statusOverlay.addInfo("Fetching search task data...");

//     const success = this.safeSendPortMessage({ type: "GET_SEARCH_TASK" });
//     if (!success) {
//       throw new Error("Failed to request search task data");
//     }
//   }

//   async searchNext() {
//     try {
//       this.log("Executing searchNext");

//       // Critical: If an application is in progress, do not continue
//       if (this.applicationState.isApplicationInProgress) {
//         this.log("Application in progress, not searching for next link");
//         this.statusOverlay.addInfo(
//           "Application in progress, waiting to complete..."
//         );

//         // Verify with background script
//         this.safeSendPortMessage({ type: "CHECK_APPLICATION_STATUS" });
//         return;
//       }

//       this.statusOverlay.addInfo("Searching for job links...");

//       // Find all matching links
//       let links = this.findAllLinksElements();
//       this.log(`Found ${links.length} links`);

//       // If no links on page, try to load more
//       if (links.length === 0) {
//         this.log("No links found, trying to load more");
//         this.statusOverlay.addInfo("No links found, trying to load more...");

//         if (this.applicationState.isApplicationInProgress) {
//           this.log("Application became in progress, aborting navigation");
//           return;
//         }

//         await this.wait(2000);

//         if (this.applicationState.isApplicationInProgress) {
//           this.log("Application became in progress, aborting navigation");
//           return;
//         }

//         const loadMoreBtn = this.findLoadMoreElement();
//         if (loadMoreBtn) {
//           if (this.applicationState.isApplicationInProgress) {
//             this.log("Application became in progress, aborting navigation");
//             return;
//           }

//           this.statusOverlay.addInfo('Clicking "More results" button');
//           loadMoreBtn.click();
//           await this.wait(3000);

//           if (!this.applicationState.isApplicationInProgress) {
//             this.fetchSearchTaskData();
//           }
//           return;
//         } else {
//           this.statusOverlay.addWarning("No more results to load");
//           this.safeSendPortMessage({ type: "SEARCH_COMPLETED" });
//           this.log("Search task completed");
//           return;
//         }
//       }

//       // Process links one by one
//       let foundUnprocessedLink = false;

//       // First pass: mark all already processed links
//       for (let i = 0; i < links.length; i++) {
//         let url = this.normalizeUrlFully(links[i].href);

//         // Check if this URL is already in processed links
//         const processedLink = this.searchData.submittedLinks.find((link) => {
//           if (!link.url) return false;
//           const normalizedLinkUrl = this.normalizeUrlFully(link.url);
//           return (
//             normalizedLinkUrl === url ||
//             url.includes(normalizedLinkUrl) ||
//             normalizedLinkUrl.includes(url)
//           );
//         });

//         // Also check local cache
//         const inLocalCache =
//           this.applicationState.processedUrls &&
//           this.applicationState.processedUrls.has(url);

//         if (processedLink || inLocalCache) {
//           // Mark as already processed
//           if (processedLink && processedLink.status === "SUCCESS") {
//             this.markLinkAsColor(links[i], "orange", "Completed");
//           } else if (processedLink && processedLink.status === "ERROR") {
//             this.markLinkAsColor(links[i], "red", "Skipped");
//           } else {
//             this.markLinkAsColor(links[i], "orange", "Completed");
//           }

//           this.statusOverlay.addInfo(`Skipping already processed: ${url}`);
//           continue;
//         }

//         // Check if URL matches pattern
//         if (this.searchData.searchLinkPattern) {
//           const pattern =
//             typeof this.searchData.searchLinkPattern === "string"
//               ? new RegExp(
//                   this.searchData.searchLinkPattern.replace(
//                     /^\/|\/[gimy]*$/g,
//                     ""
//                   )
//                 )
//               : this.searchData.searchLinkPattern;

//           if (!pattern.test(url)) {
//             this.log(`Link ${url} does not match pattern`);
//             this.markLinkAsColor(links[i], "red", "Invalid");

//             // Add to processed URLs to avoid rechecking
//             if (!this.applicationState.processedUrls)
//               this.applicationState.processedUrls = new Set();
//             this.applicationState.processedUrls.add(url);

//             // Add to search data to maintain consistency
//             this.searchData.submittedLinks.push({
//               url,
//               status: "SKIP",
//               message: "Link does not match pattern",
//             });

//             this.statusOverlay.addWarning(
//               `Skipping link that doesn't match pattern: ${url}`
//             );
//             continue;
//           }
//         }

//         foundUnprocessedLink = true;
//       }

//       // Check for application in progress before second pass
//       if (this.applicationState.isApplicationInProgress) {
//         this.log("Application became in progress during first pass, aborting");
//         return;
//       }

//       // Second pass: find the first unprocessed link that meets criteria
//       for (let i = 0; i < links.length; i++) {
//         let url = this.normalizeUrlFully(links[i].href);

//         // Check if this URL is already in processed links
//         const alreadyProcessed = this.searchData.submittedLinks.some((link) => {
//           if (!link.url) return false;
//           const normalizedLinkUrl = this.normalizeUrlFully(link.url);
//           return (
//             normalizedLinkUrl === url ||
//             url.includes(normalizedLinkUrl) ||
//             normalizedLinkUrl.includes(url)
//           );
//         });

//         // Also check local cache
//         const inLocalCache =
//           this.applicationState.processedUrls &&
//           this.applicationState.processedUrls.has(url);

//         if (alreadyProcessed || inLocalCache) {
//           continue;
//         }

//         // Check if URL matches pattern
//         if (this.searchData.searchLinkPattern) {
//           const pattern =
//             typeof this.searchData.searchLinkPattern === "string"
//               ? new RegExp(
//                   this.searchData.searchLinkPattern.replace(
//                     /^\/|\/[gimy]*$/g,
//                     ""
//                   )
//                 )
//               : this.searchData.searchLinkPattern;

//           if (!pattern.test(url)) {
//             continue;
//           }
//         }

//         // Found an unprocessed link that matches the pattern - process it!
//         this.statusOverlay.addSuccess("Found job to apply: " + url);

//         // Check one more time before proceeding
//         if (this.applicationState.isApplicationInProgress) {
//           this.log("Application became in progress, aborting new task");
//           return;
//         }

//         // Mark as processing and add to local cache immediately
//         this.markLinkAsColor(links[i], "green", "In Progress");

//         // Set the application flag BEFORE sending task
//         this.applicationState.isApplicationInProgress = true;
//         this.applicationState.applicationStartTime = Date.now();

//         // Add to local cache immediately to prevent double processing
//         if (!this.applicationState.processedUrls)
//           this.applicationState.processedUrls = new Set();
//         this.applicationState.processedUrls.add(url);

//         // Set timeout for detecting stuck applications
//         if (this.sendCvPageNotRespondTimeout) {
//           clearTimeout(this.sendCvPageNotRespondTimeout);
//         }

//         this.sendCvPageNotRespondTimeout = setTimeout(() => {
//           if (this.applicationState.isApplicationInProgress) {
//             this.statusOverlay.addWarning(
//               "No response from job page, resuming search"
//             );
//             this.applicationState.isApplicationInProgress = false;
//             this.applicationState.applicationStartTime = null;
//             setTimeout(() => this.searchNext(), 2000);
//           }
//         }, 180000);

//         // Send message to the background script
//         try {
//           this.safeSendPortMessage({
//             type: "START_APPLICATION",
//             data: {
//               url,
//               title: links[i].textContent.trim() || "Job Application",
//             },
//           });
//         } catch (err) {
//           this.log(`Error sending application task for ${url}:`, err);
//           this.statusOverlay.addError(
//             "Error sending application task: " + err.message
//           );

//           // Reset flags on error
//           this.applicationState.isApplicationInProgress = false;
//           this.applicationState.applicationStartTime = null;
//           if (this.sendCvPageNotRespondTimeout) {
//             clearTimeout(this.sendCvPageNotRespondTimeout);
//             this.sendCvPageNotRespondTimeout = null;
//           }

//           // Remove from processed URLs since we couldn't process it
//           if (this.applicationState.processedUrls) {
//             this.applicationState.processedUrls.delete(url);
//           }

//           // Mark as error and continue with next link
//           this.markLinkAsColor(links[i], "red", "Error");
//           continue;
//         }

//         // We found a suitable link and sent the message successfully
//         foundUnprocessedLink = true;
//         return; // Exit after sending one job for processing
//       }

//       // If we couldn't find any unprocessed links
//       if (!foundUnprocessedLink) {
//         // Check one more time before trying to navigate
//         if (this.applicationState.isApplicationInProgress) {
//           this.log("Application became in progress, aborting navigation");
//           return;
//         }

//         // Try to load more results
//         this.statusOverlay.addInfo(
//           "No new job links found, trying to load more..."
//         );
//         const loadMoreBtn = this.findLoadMoreElement();

//         if (loadMoreBtn) {
//           // Final check before clicking
//           if (this.applicationState.isApplicationInProgress) {
//             this.log("Application became in progress, aborting navigation");
//             return;
//           }

//           // Click the "More results" button and wait
//           this.statusOverlay.addInfo('Clicking "More results" button');
//           loadMoreBtn.click();

//           // Set a timeout to check again after page loads
//           setTimeout(() => {
//             if (!this.applicationState.isApplicationInProgress) {
//               this.searchNext();
//             }
//           }, 3000);
//         } else {
//           // No more results and no unprocessed links - we're done!
//           this.statusOverlay.addSuccess(
//             "All jobs processed, search completed!"
//           );
//           this.safeSendPortMessage({ type: "SEARCH_COMPLETED" });
//         }
//       }
//     } catch (err) {
//       this.log("Error in searchNext:", err);
//       this.statusOverlay.addError("Error in search: " + err.message);

//       // Reset application state on error
//       this.applicationState.isApplicationInProgress = false;
//       this.applicationState.applicationStartTime = null;
//       if (this.sendCvPageNotRespondTimeout) {
//         clearTimeout(this.sendCvPageNotRespondTimeout);
//         this.sendCvPageNotRespondTimeout = null;
//       }

//       // Try again after a delay
//       setTimeout(() => this.searchNext(), 5000);
//     }
//   }

//   findAllLinksElements() {
//     try {
//       const domains = Array.isArray(this.searchData.domain)
//         ? this.searchData.domain
//         : [this.searchData.domain];

//       if (!domains || domains.length === 0) {
//         this.log("No domains specified for link search");
//         return [];
//       }

//       this.log("Searching for links with domains:", domains);

//       // Create a combined selector for all domains
//       const selectors = domains.map((domain) => {
//         // Handle missing protocol, clean domain
//         const cleanDomain = domain
//           .replace(/^https?:\/\//, "")
//           .replace(/\/$/, "");
//         return `#rso a[href*="${cleanDomain}"], #botstuff a[href*="${cleanDomain}"]`;
//       });

//       const selector = selectors.join(",");
//       const links = document.querySelectorAll(selector);

//       this.log(`Found ${links.length} matching links`);
//       return Array.from(links);
//     } catch (err) {
//       this.log("Error finding links:", err);
//       return [];
//     }
//   }

//   findLoadMoreElement() {
//     try {
//       // If we're on the last page (prev button but no next button)
//       if (
//         document.getElementById("pnprev") &&
//         !document.getElementById("pnnext")
//       ) {
//         return null;
//       }

//       // Method 1: Find "More results" button
//       const moreResultsBtn = Array.from(document.querySelectorAll("a")).find(
//         (a) => a.textContent.includes("More results")
//       );

//       if (moreResultsBtn) {
//         return moreResultsBtn;
//       }

//       // Method 2: Look for "Next" button
//       const nextBtn = document.getElementById("pnnext");
//       if (nextBtn) {
//         return nextBtn;
//       }

//       // Method 3: Try to find any navigation button at the bottom
//       const navLinks = [
//         ...document.querySelectorAll(
//           "#botstuff table a[href^='/search?q=site:']"
//         ),
//       ];
//       this.log(`Found ${navLinks.length} potential navigation links`);

//       // Return the last one (typically "More results" or similar)
//       return navLinks[navLinks.length - 1];
//     } catch (err) {
//       this.log("Error finding load more button:", err);
//       return null;
//     }
//   }

//   normalizeUrlFully(url) {
//     try {
//       if (!url) return "";

//       // Handle URLs with or without protocol
//       if (!url.startsWith("http")) {
//         url = "https://" + url;
//       }

//       const urlObj = new URL(url);
//       // Remove trailing slashes and query parameters
//       return (urlObj.origin + urlObj.pathname)
//         .toLowerCase()
//         .trim()
//         .replace(/\/+$/, "");
//     } catch (e) {
//       this.log("Error normalizing URL:", e);
//       return url.toLowerCase().trim();
//     }
//   }

//   async startApplicationProcess() {
//     try {
//       console.log("📝 Starting application process");
//       this.statusOverlay.addInfo("Starting application process");
//       this.statusOverlay.updateStatus("applying");

//       // Validate user profile
//       if (!this.userProfile) {
//         console.log("⚠️ No user profile available, attempting to fetch...");
//         await this.fetchApplicationTaskData();
//       }

//       if (!this.userProfile) {
//         this.statusOverlay.addError(
//           "No user profile available - automation may fail"
//         );
//         console.error("❌ Failed to obtain user profile");
//       } else {
//         this.statusOverlay.addSuccess("User profile loaded successfully");
//         console.log("✅ User profile available:", {
//           name: this.userProfile.name || this.userProfile.firstName,
//           email: this.userProfile.email,
//         });
//       }

//       // Wait for page to fully load
//       await this.wait(3000);

//       // Start application
//       await this.apply();
//     } catch (error) {
//       this.reportError(error, { phase: "application" });
//       if (error.name === "SkipApplicationError") {
//         this.statusOverlay.addWarning("Application skipped: " + error.message);
//         this.safeSendPortMessage({
//           type: "APPLICATION_SKIPPED",
//           data: error.message,
//         });
//       } else {
//         this.statusOverlay.addError("Application error: " + error.message);
//         this.safeSendPortMessage({
//           type: "APPLICATION_ERROR",
//           data: this.errorToString(error),
//         });
//       }
//       this.applicationState.isApplicationInProgress = false;
//     }
//   }

//   async fetchApplicationTaskData() {
//     this.log("📡 Fetching application task data from background");
//     this.statusOverlay.addInfo("Fetching application data...");

//     const success = this.safeSendPortMessage({ type: "GET_APPLICATION_TASK" });
//     if (!success) {
//       throw new Error("Failed to request application task data");
//     }
//   }

//   async apply() {
//     try {
//       this.statusOverlay.addInfo("Starting to apply for job");

//       // Check if page is valid
//       if (
//         document.body.innerText.includes("Cannot GET") ||
//         document.body.innerText.includes("404 Not Found") ||
//         document.body.innerText.includes("No longer available")
//       ) {
//         throw new SkipApplicationError(
//           "Cannot start application: Page error or job no longer available"
//         );
//       }

//       // Extract job ID from URL
//       const urlParts = window.location.pathname.split("/");
//       const jobId = urlParts[urlParts.length - 1] || "unknown";
//       console.log("Extracted job ID:", jobId);

//       // Wait a moment for page to fully load
//       await this.wait(3000);

//       // Check if we're on a job details page or application form page
//       const applyButton = document.querySelector(
//         "a.c-button--primary, a.c-button--apply, a.cta-button, button.c-button--apply"
//       );
//       if (applyButton) {
//         this.statusOverlay.addInfo("Found apply button, clicking it");
//         applyButton.click();
//         await this.wait(3000);
//       }

//       // Check if we're on an apply page by looking for form
//       const form = this.findApplicationForm();
//       if (!form) {
//         throw new SkipApplicationError("Cannot find application form");
//       }

//       // Extract job description
//       const jobDescription = this.extractJobDescription();

//       // Process the form
//       const result = await this.processApplicationForm(
//         form,
//         this.userProfile,
//         jobDescription
//       );

//       this.statusOverlay.addInfo(
//         "Form submission result: " + (result ? "SUCCESS" : "FAILED")
//       );

//       if (result) {
//         // Get job details from page
//         const jobTitle =
//           document.querySelector("h1")?.textContent.trim() ||
//           document.title.split(" - ")[0] ||
//           document.title ||
//           "Job on Recruitee";

//         // Extract company name from URL or page
//         const companyName =
//           this.extractCompanyFromUrl(window.location.href) ||
//           document.querySelector('meta[property="og:site_name"]')?.content ||
//           "Company on Recruitee";

//         // Try to extract location from the page
//         let location = "Not specified";
//         const locationEl = document.querySelector(
//           '.job-location, .c-job__info-item, [data-ui="location"]'
//         );
//         if (locationEl) {
//           location = locationEl.textContent.trim();
//         }

//         // Send completion message
//         this.safeSendPortMessage({
//           type: "APPLICATION_COMPLETED",
//           data: {
//             jobId,
//             title: jobTitle,
//             company: companyName,
//             location,
//             jobUrl: window.location.href,
//             salary: "Not specified",
//             workplace: "Not specified",
//             postedDate: "Not specified",
//             applicants: "Not specified",
//           },
//         });

//         // Reset application state
//         this.applicationState.isApplicationInProgress = false;
//         this.applicationState.applicationStartTime = null;

//         console.log("Application completed successfully");
//         this.statusOverlay.addSuccess("Application completed successfully");
//         this.statusOverlay.updateStatus("success");
//       }

//       return result;
//     } catch (error) {
//       if (error instanceof SkipApplicationError) {
//         throw error;
//       } else {
//         console.error("Error in apply:", error);
//         throw new ApplicationError(
//           "Error during application process: " + this.errorToString(error)
//         );
//       }
//     }
//   }

//   async processApplicationForm(form, profile, jobDescription) {
//     this.statusOverlay.addInfo("Found application form, beginning to fill out");

//     try {
//       // Get the API host
//       const aiApiHost = this.getApiHost();

//       // Initialize/update form handler
//       if (!this.formHandler) {
//         this.formHandler = new RecruiteeFormHandler({
//           logger: (message) => this.statusOverlay.addInfo(message),
//           host: aiApiHost,
//           userData: profile,
//           jobDescription,
//         });
//       } else {
//         this.formHandler.userData = profile;
//         this.formHandler.jobDescription = jobDescription;
//       }

//       // Handle multi-step form if present
//       const isMultiStep = form.querySelector(".c-step, .steps-indicator");

//       if (isMultiStep) {
//         return await this.handleMultiStepForm(form, profile, jobDescription);
//       }

//       // Handle file uploads (resume)
//       await this.fileHandler.handleResumeUpload(profile, form);

//       // Fill out form fields using AI-enhanced RecruiteeFormHandler
//       await this.formHandler.fillFormWithProfile(form, profile);

//       // Handle required checkboxes
//       await this.formHandler.handleRequiredCheckboxes(form);

//       // Submit the form
//       return await this.formHandler.submitForm(form);
//     } catch (error) {
//       console.error("Error processing application form:", error);
//       this.statusOverlay.addError(
//         "Error processing form: " + this.errorToString(error)
//       );
//       return false;
//     }
//   }

//   async handleMultiStepForm(form, profile, jobDescription) {
//     this.statusOverlay.addInfo("Detected multi-step application form");

//     try {
//       // Handle resume upload - typically on first step
//       await this.fileHandler.handleResumeUpload(profile, form);

//       // Process each step until we reach the end
//       let isComplete = false;
//       let stepCount = 0;
//       const maxSteps = 10; // Safety limit

//       while (!isComplete && stepCount < maxSteps) {
//         stepCount++;
//         this.statusOverlay.addInfo(`Processing form step ${stepCount}`);

//         // Fill out visible form fields
//         await this.formHandler.fillFormWithProfile(form, profile);

//         // Handle required checkboxes
//         await this.formHandler.handleRequiredCheckboxes(form);

//         // Find next/submit button
//         const nextButton = this.formHandler.findSubmitButton(form);
//         if (!nextButton) {
//           throw new ApplicationError(
//             `Cannot find next/submit button on step ${stepCount}`
//           );
//         }

//         // Click the button
//         this.statusOverlay.addInfo(
//           `Clicking next/submit button on step ${stepCount}`
//         );
//         nextButton.click();

//         // Wait for page to update
//         await this.wait(3000);

//         // Check if we're done
//         const successMessage = document.querySelector(
//           "div.application-confirmation, div.success-message, h1.success-message, div[class*='success'], div.thank-you, div[class*='thankyou'], div.c-application__done"
//         );
//         if (successMessage) {
//           this.statusOverlay.addInfo(
//             "Found success message, application complete"
//           );
//           isComplete = true;
//           return true;
//         }

//         // Check if there was an error
//         const errorMessage = document.querySelector(
//           ".error-message, .field_with_errors, .invalid-feedback"
//         );
//         if (errorMessage) {
//           this.statusOverlay.addInfo(
//             `Error on step ${stepCount}: ${errorMessage.textContent.trim()}`
//           );
//           // Try to fix the error and continue
//         }

//         // Find form again (might have changed)
//         form = this.findApplicationForm();
//         if (!form) {
//           this.statusOverlay.addInfo(
//             "Form no longer found, checking if application completed"
//           );
//           // Check alternative success indicators
//           if (
//             document.body.textContent.includes("Thank you") ||
//             document.body.textContent.includes("Successfully")
//           ) {
//             isComplete = true;
//             return true;
//           } else {
//             throw new ApplicationError(
//               "Form disappeared without success message"
//             );
//           }
//         }
//       }

//       if (stepCount >= maxSteps) {
//         throw new ApplicationError("Exceeded maximum number of form steps");
//       }

//       return isComplete;
//     } catch (error) {
//       console.error("Error in multi-step form:", error);
//       throw error;
//     }
//   }

//   findApplicationForm() {
//     const formSelectors = [
//       "form.c-form",
//       "form#new_job_application",
//       "form.careers-form",
//       "form.application-form",
//     ];

//     for (const selector of formSelectors) {
//       const forms = document.querySelectorAll(selector);
//       if (forms.length) {
//         for (const form of forms) {
//           if (this.isElementVisible(form)) {
//             return form;
//           }
//         }
//       }
//     }

//     const allForms = document.querySelectorAll("form");
//     for (const form of allForms) {
//       if (
//         this.isElementVisible(form) &&
//         form.querySelectorAll("input, select, textarea").length > 0
//       ) {
//         return form;
//       }
//     }

//     return null;
//   }

//   extractJobDescription() {
//     let description = "";

//     const descriptionSelectors = [
//       ".c-job__description",
//       ".job-description",
//       ".description",
//       '[data-ui="job-description"]',
//       ".vacancy-description",
//       "#job-details",
//     ];

//     for (const selector of descriptionSelectors) {
//       const descElement = document.querySelector(selector);
//       if (descElement) {
//         description = descElement.textContent.trim();
//         break;
//       }
//     }

//     if (!description) {
//       const mainContent = document.querySelector(
//         "main, #content, .content, .job-content"
//       );
//       if (mainContent) {
//         description = mainContent.textContent.trim();
//       }
//     }

//     if (!description) {
//       const jobTitle = document.title || "";
//       const companyName =
//         this.extractCompanyFromUrl(window.location.href) || "";
//       description = `Job: ${jobTitle} at ${companyName}`;
//     }

//     return description;
//   }

//   extractCompanyFromUrl(url) {
//     try {
//       const matches = url.match(/\/\/(.+?)\.recruitee\.com\//);
//       if (matches && matches[1]) {
//         return (
//           matches[1].charAt(0).toUpperCase() +
//           matches[1].slice(1).replace(/-/g, " ")
//         );
//       }
//       return null;
//     } catch (error) {
//       return null;
//     }
//   }

//   isElementVisible(element) {
//     try {
//       if (!element) return false;

//       const style = window.getComputedStyle(element);

//       if (
//         style.display === "none" ||
//         style.visibility === "hidden" ||
//         style.opacity === "0"
//       ) {
//         return false;
//       }

//       const rect = element.getBoundingClientRect();
//       if (rect.width === 0 || rect.height === 0) {
//         return false;
//       }

//       return true;
//     } catch (error) {
//       return true;
//     }
//   }

//   errorToString(e) {
//     if (e instanceof Error) {
//       if (e.stack) {
//         return e.stack;
//       }
//       return e.message;
//     }
//     return String(e);
//   }

//   wait(ms) {
//     return new Promise((resolve) => setTimeout(resolve, ms));
//   }

//   async waitForPageLoad(timeout = 30000) {
//     return new Promise((resolve) => {
//       if (document.readyState === "complete") {
//         resolve(true);
//         return;
//       }

//       const checkComplete = () => {
//         if (document.readyState === "complete") {
//           resolve(true);
//         } else {
//           setTimeout(checkComplete, 100);
//         }
//       };

//       checkComplete();

//       setTimeout(() => resolve(false), timeout);
//     });
//   }

//   async waitForValidPage(timeout = 30000) {
//     const startTime = Date.now();

//     while (Date.now() - startTime < timeout) {
//       const url = window.location.href;

//       if (url.includes("google.com/search") || this.isRecruiteeJobPage(url)) {
//         await this.detectPageTypeAndStart();
//         return;
//       }

//       await this.delay(1000);
//     }

//     throw new Error("Timeout waiting for valid page");
//   }

//   // Rest of the utility methods...
//   getApiHost() {
//     return (
//       this.sessionApiHost ||
//       this.sessionContext?.apiHost ||
//       this.config.apiHost ||
//       API_HOST_URL ||
//       "http://localhost:3000"
//     );
//   }

//   async findJobs() {
//     return this.findAllLinksElements();
//   }

//   async applyToJob(jobElement) {
//     return await this.apply();
//   }

//   onDOMChange() {
//     // Handle DOM changes if needed
//   }

//   onNavigation(oldUrl, newUrl) {
//     // Handle navigation changes if needed
//   }

//   async pause() {
//     await super.pause();
//   }

//   async resume() {
//     await super.resume();
//   }

//   async stop() {
//     await super.stop();
//   }

//   log(message, data = {}) {
//     const sessionInfo = this.sessionId
//       ? `[Session: ${this.sessionId.slice(-6)}]`
//       : "[No Session]";
//     const contextInfo = this.hasSessionContext
//       ? "[Context: ✓]"
//       : "[Context: ✗]";
//     const profileInfo = this.userProfile ? "[Profile: ✓]" : "[Profile: ✗]";

//     console.log(
//       `🤖 [Recruitee${sessionInfo}${contextInfo}${profileInfo}] ${message}`,
//       data
//     );
//   }

//   cleanup() {
//     // Clear timers
//     if (this.healthCheckTimer) {
//       clearInterval(this.healthCheckTimer);
//     }

//     if (this.keepAliveInterval) {
//       clearInterval(this.keepAliveInterval);
//     }

//     if (this.stateVerificationInterval) {
//       clearInterval(this.stateVerificationInterval);
//     }

//     if (this.sendCvPageNotRespondTimeout) {
//       clearTimeout(this.sendCvPageNotRespondTimeout);
//     }

//     // Disconnect port
//     if (this.port) {
//       try {
//         this.port.disconnect();
//       } catch (e) {
//         // Ignore errors
//       }
//       this.port = null;
//     }

//     // Cleanup status overlay
//     if (this.statusOverlay) {
//       this.statusOverlay.destroy();
//       this.statusOverlay = null;
//     }

//     // Reset state
//     this.applicationState.isApplicationInProgress = false;
//     this.applicationState.applicationStartTime = null;
//     this.applicationState.applicationUrl = null;

//     super.cleanup();
//     this.log("🧹 Recruitee platform cleanup completed");
//   }
// }



// // platforms/base-platform.js
// ///Page loaded, current URL
// export default class BasePlatform {
//   constructor(config) {
//     this.sessionId = config.sessionId;
//     this.platform = config.platform;
//     this.userId = config.userId;
//     this.contentScript = config.contentScript;
//     this.config = config.config || {};

//     // State
//     this.isRunning = false;
//     this.isPaused = false;
//     this.currentJob = null;
//     this.progress = {
//       total: this.config.jobsToApply || 0,
//       completed: 0,
//       failed: 0,
//       skipped: 0,
//       current: null,
//     };

//     // Callbacks
//     this.onProgress = null;
//     this.onError = null;
//     this.onComplete = null;
//     this.onApplicationSubmitted = null;
//     this.onDOMChange = null;
//     this.onNavigation = null;
//   }

//   // Abstract methods - must be implemented by platform-specific classes
//   async initialize() {
//     this.log("🚀 Initializing platform automation");
//   }

//   async start(params = {}) {
//     throw new Error("start() method must be implemented by platform class");
//   }

//   async findJobs() {
//     throw new Error("findJobs() method must be implemented by platform class");
//   }

//   async applyToJob(jobElement) {
//     throw new Error(
//       "applyToJob() method must be implemented by platform class"
//     );
//   }

//   // Common utility methods
//   async pause() {
//     this.isPaused = true;
//     this.log("⏸️ Automation paused");
//   }

//   async resume() {
//     this.isPaused = false;
//     this.log("▶️ Automation resumed");
//   }

//   async stop() {
//     this.isRunning = false;
//     this.isPaused = false;
//     this.log("⏹️ Automation stopped");
//   }

//   // Progress reporting
//   updateProgress(updates) {
//     this.progress = { ...this.progress, ...updates };

//     if (this.onProgress) {
//       this.onProgress(this.progress);
//     }

//     // Notify content script
//     this.notifyContentScript("progress", this.progress);
//   }

//   reportError(error, context = {}) {
//     const errorInfo = {
//       message: error.message || error,
//       context,
//       timestamp: Date.now(),
//       sessionId: this.sessionId,
//       platform: this.platform,
//     };

//     this.log(`❌ Error: ${errorInfo.message}`, errorInfo);

//     if (this.onError) {
//       this.onError(errorInfo);
//     }

//     // Notify content script
//     this.notifyContentScript("error", errorInfo);
//   }

//   reportComplete() {
//     this.isRunning = false;
//     this.log("✅ Automation completed");

//     if (this.onComplete) {
//       this.onComplete();
//     }

//     // Notify content script
//     this.notifyContentScript("complete", {
//       sessionId: this.sessionId,
//       progress: this.progress,
//     });
//   }

//   reportApplicationSubmitted(jobData, applicationData) {
//     this.progress.completed++;
//     this.updateProgress({
//       completed: this.progress.completed,
//       current: null,
//     });

//     this.log(
//       `📝 Application submitted: ${jobData.title} at ${jobData.company}`
//     );

//     if (this.onApplicationSubmitted) {
//       this.onApplicationSubmitted(jobData, applicationData);
//     }

//     // Notify content script
//     this.notifyContentScript("applicationSubmitted", {
//       jobData,
//       applicationData,
//       sessionId: this.sessionId,
//     });
//   }

//   // Basic DOM utility methods (generic only)
//   async delay(ms) {
//     return new Promise((resolve) => setTimeout(resolve, ms));
//   }

//   // Communication with content script and background
//   async notifyContentScript(type, data) {
//     if (this.contentScript && this.contentScript.sendMessageToBackground) {
//       try {
//         await this.contentScript.sendMessageToBackground({
//           action: "platformNotification",
//           type,
//           data,
//           sessionId: this.sessionId,
//           platform: this.platform,
//         });
//       } catch (error) {
//         console.error("Error notifying content script:", error);
//       }
//     }
//   }

//   // Utility methods
//   log(message, data = {}) {
//     const logEntry = `🤖 [${this.platform}-${this.sessionId?.slice(
//       -6
//     )}] ${message}`;
//     console.log(logEntry, data);
//   }

//   getRandomDelay(min, max) {
//     return Math.floor(Math.random() * (max - min + 1)) + min;
//   }

//   cleanup() {
//     this.isRunning = false;
//     this.isPaused = false;
//     this.log("🧹 Platform cleanup completed");
//   }
// }


