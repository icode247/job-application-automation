// platforms/wellfound/wellfound.js - FIXED VERSION
import BasePlatform from "../base-platform.js";
import AIService from "../../services/ai-service.js";
import ApplicationTrackerService from "../../services/application-tracker-service.js";
import UserService from "../../services/user-service.js";
import WellfoundFormHandler from "./wellfound-form-handler.js";
import { StatusOverlay } from "../../services/index.js";

export default class WellfoundPlatform extends BasePlatform {
  constructor(config) {
    super(config);
    this.platform = "wellfound";
    this.baseUrl = "https://wellfound.com";
    this.hasStarted = false;
    this.automationStarted = false;
    this.processedJobs = new Set();
    this.currentJobDetails = null;
    this.currentJobIndex = 0;
    this.loginCheckInterval = null;

    // Initialize services with proper API host from config
    const apiHost =
      config.apiHost ||
      config.config?.apiHost ||
      config.sessionContext?.apiHost ||
      "http://localhost:3000";
    this.HOST = apiHost;

    // Initialize AI service with enhanced form filling capability
    this.aiService = new AIService({
      apiHost,
      userId: config.userId,
      platform: "wellfound",
    });

    this.appTracker = new ApplicationTrackerService({
      apiHost,
      userId: config.userId,
    });
    this.userService = new UserService({ apiHost, userId: config.userId });

    // Initialize form handler
    this.formHandler = new WellfoundFormHandler(
      this.aiService,
      this.userService,
      this
    );

    this.statusOverlay = new StatusOverlay({
      id: "wellfound-chatbot-overlay",
      platform: "WELLFOUND",
      icon: "🚀",
      position: { top: "10px", left: "10px" },
    });

    this.log(`🔧 Wellfound services initialized with API host: ${apiHost}`);
  }

  async checkIfLoggedIn() {
    try {
      const loggedOutIndicators = [
        '.wf_site-nav_buttons a[href="/login"]',
        'a[href*="/jobs/signup"]',
        'a[href*="/onboarding/recruit"]',
        ".signup-split",
        ".signup-drop",
      ];

      const buttons = document.querySelectorAll("button");
      for (const button of buttons) {
        const text = button.textContent?.trim().toLowerCase();
        const onclick = button.getAttribute("onclick");

        if (
          (text && text.includes("log in")) ||
          (onclick && onclick.includes("/login"))
        ) {
          this.log(`❌ Found 'Log In' button - user is not logged in`);
          return false;
        }
      }
      this.log("✅ No logged out indicators found - user is logged in");
      return true;
    } catch (error) {
      this.log("❌ Error checking login status:", error.message);
      return false;
    }
  }

  isElementVisible(element) {
    if (!element) return false;

    const style = window.getComputedStyle(element);
    if (
      style.display === "none" ||
      style.visibility === "hidden" ||
      style.opacity === "0"
    ) {
      return false;
    }

    const rect = element.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      return false;
    }

    return element.offsetParent !== null;
  }

  async waitForLogin() {
    return new Promise((resolve) => {
      this.statusOverlay.addWarning(
        "🔐 Please log in to Wellfound first! I'll wait here and check every 10 seconds until you're logged in."
      );

      const checkLogin = async () => {
        this.log("🔍 Checking if user is logged in...");
        const isLoggedIn = await this.checkIfLoggedIn();

        if (isLoggedIn) {
          this.log("✅ User is now logged in!");
          this.statusOverlay.addSuccess(
            "Perfect! You're now logged in. Let's get started with finding you jobs! 🚀"
          );

          if (this.loginCheckInterval) {
            clearInterval(this.loginCheckInterval);
            this.loginCheckInterval = null;
          }
          resolve(true);
        } else {
          this.statusOverlay.addInfo(
            "Still waiting for you to log in... I'll keep checking every 10 seconds! ⏰"
          );
        }
      };

      // Check immediately
      checkLogin();

      // Then check every 10 seconds
      this.loginCheckInterval = setInterval(checkLogin, 10000);
    });
  }

  async initialize() {
    await super.initialize();
    this.log("🚀 Wellfound platform initialized");
    this.statusOverlay.create();
  }

  async start(params = {}) {
    if (this.hasStarted) {
      this.log(
        "⚠️ Wellfound automation already started, ignoring duplicate start request"
      );
      this.statusOverlay.addWarning(
        "Hey! I'm already working on finding you jobs. Let me finish this round first! 😊"
      );
      return;
    }

    this.hasStarted = true;
    this.isRunning = true;
    this.log("🚀 Starting Wellfound automation with user preferences");
    this.statusOverlay.addInfo(
      "Alright, let's get you some amazing job opportunities on Wellfound! Let me start searching based on your preferences..."
    );

    try {
      // Setup configuration
      this.config = {
        ...this.config,
        ...params,
        jobsToApply: params.jobsToApply || this.config.jobsToApply || 10,
        userId: params.userId || this.config.userId || this.userId,
        preferences: params.preferences || this.config.preferences || {},
        apiHost: params.apiHost || this.config.apiHost || this.HOST,
      };

      // STEP 1: Check if user is logged in FIRST
      this.log("🔐 Checking if user is logged in to Wellfound...");
      const isLoggedIn = await this.checkIfLoggedIn();

      console.log(isLoggedIn);

      if (!isLoggedIn) {
        this.log("❌ User is not logged in, waiting for login...");
        await this.waitForLogin();
      } else {
        this.log("✅ User is already logged in, proceeding...");
        this.statusOverlay.addSuccess(
          "Great! You're logged in to Wellfound. Let's start finding jobs!"
        );
      }

      // Check user authorization
      await this.checkUserAuthorization();
      this.updateProgress({ total: this.config.jobsToApply });

      // STEP 1: Navigate to jobs page if needed
      await this.ensureOnJobsPage();
      this.automationStarted = true;
      this.statusOverlay.updateStatus(
        "applying",
        "Finding perfect matches for you"
      );
      await this.processJobsSequentially();
    } catch (error) {
      this.hasStarted = false;
      this.reportError(error, { phase: "start" });
    }
  }

  async ensureOnJobsPage() {
    const currentUrl = window.location.href.toLowerCase();
    if (!currentUrl.includes("wellfound.com/jobs")) {
      this.log("📍 Navigating to Wellfound Jobs");
      this.statusOverlay.addInfo(
        "Let me take you to the Wellfound jobs page! ✨"
      );
      window.location.href = "https://wellfound.com/jobs";
      await this.delay(3000);
      await this.waitForPageLoad();
    } else {
      this.log("✅ Already on Wellfound Jobs page");
      this.statusOverlay.addSuccess("Great! We're already on Wellfound Jobs.");
    }
  }

  async processJobsSequentially() {
    let appliedCount = 0;
    let processedCount = 0;
    const targetJobs = this.config.jobsToApply;

    try {
      this.log(
        `🎯 Starting sequential job processing. Target: ${targetJobs} jobs`
      );
      this.statusOverlay.addInfo(
        `Processing ${targetJobs} jobs sequentially...`
      );

      while (appliedCount < targetJobs && this.isRunning) {
        const jobCards = await this.getCurrentJobCards();

        if (jobCards.length === 0) {
          this.statusOverlay.addWarning("No more job cards found!");
          break;
        }

        for (
          let i = this.currentJobIndex;
          i < jobCards.length && appliedCount < targetJobs;
          i++
        ) {
          if (!this.isRunning) break;

          const jobCard = jobCards[i];
          this.currentJobIndex = i;

          try {
            this.log(`📋 Processing job ${i + 1}/${jobCards.length}`);
            this.statusOverlay.addInfo(`Checking job ${processedCount + 1}...`);

            const jobOpened = await this.openJobDetails(jobCard);
            if (!jobOpened) {
              this.log("⚠️ Could not open job details, skipping");
              continue;
            }

            const jobDetails = await this.extractCompleteJobDetails();
            if (!jobDetails) {
              this.log("⚠️ Could not extract job details, skipping");
              await this.returnToJobsList();
              continue;
            }

            processedCount++;

            if (!this.doesJobMatchPreferences(jobDetails)) {
              this.log(
                `❌ Job "${jobDetails.title}" doesn't match preferences`
              );
              this.statusOverlay.addInfo(
                `Skipping "${jobDetails.title}" - doesn't match preferences`
              );
              await this.returnToJobsList();
              continue;
            }

            const alreadyApplied = await this.appTracker.checkIfAlreadyApplied(
              jobDetails.jobId
            );
            if (alreadyApplied) {
              this.log(`⚠️ Already applied to "${jobDetails.title}"`);
              await this.returnToJobsList();
              continue;
            }

            const formHandled = await this.handleDynamicApplicationForm(
              jobDetails
            );
            if (formHandled) {
              const verified = await this.verifyApplicationSuccess();

              if (verified) {
                appliedCount++;
                this.progress.completed = appliedCount;
                this.updateProgress({ completed: appliedCount });

                await this.userService.updateApplicationCount();
                await this.saveAppliedJob(jobDetails);

                this.log(
                  `✅ Successfully applied to job ${appliedCount}/${targetJobs}`
                );
                this.statusOverlay.addSuccess(
                  `Applied to "${jobDetails.title}"! (${appliedCount}/${targetJobs})`
                );

                this.reportApplicationSubmitted(jobDetails, {
                  method: "Wellfound Application",
                  userId: this.config.userId,
                  matchedPreferences: true,
                });
              } else {
                this.progress.failed++;
                this.updateProgress({ failed: this.progress.failed });
                this.statusOverlay.addError(
                  `Failed to apply to "${jobDetails.title}"`
                );
              }

              await this.returnToJobsList();
              await this.delay(2000); // Delay between applications
              return verified;
            }
          } catch (error) {
            this.log(`❌ Error processing job ${i + 1}:`, error.message);
            await this.returnToJobsList();
            continue;
          }
        }

        if (appliedCount < targetJobs) {
          const hasMore = await this.loadMoreJobs();
          if (!hasMore) {
            this.statusOverlay.addInfo(
              "No more jobs available for your criteria"
            );
            break;
          }
          this.currentJobIndex = 0;
        }
      }

      // Complete the process
      const message =
        appliedCount >= targetJobs
          ? `🎉 Successfully applied to all ${appliedCount} target jobs!`
          : `Applied to ${appliedCount} out of ${targetJobs} jobs. No more suitable matches found.`;

      this.log(message);
      this.statusOverlay.addSuccess(message);
      this.reportComplete();

      return {
        status: appliedCount >= targetJobs ? "target_reached" : "no_more_jobs",
        appliedCount,
        processedCount,
      };
    } catch (error) {
      this.log("❌ Error in sequential job processing:", error.message);
      this.statusOverlay.addError("Error during job processing");
      this.reportError(error, { phase: "processJobsSequentially" });
      throw error;
    }
  }

  async getCurrentJobCards() {
    await this.waitForElement(".styles_component__uTjje", 5000);
    return Array.from(document.querySelectorAll(".styles_component__uTjje"));
  }

  async openJobDetails(jobCard) {
    try {
      // Find the Learn More button or job link
      const learnMoreButton =
        jobCard.querySelector('button[data-test="LearnMoreButton"]') ||
        jobCard.querySelector('a[href*="/jobs/"]') ||
        jobCard.querySelector(".learn-more");

      if (!learnMoreButton) {
        this.log("❌ No Learn More button found in job card");
        return false;
      }

      // Click to open job details
      await this.clickElementReliably(learnMoreButton);
      await this.delay(2000);

      // Wait for job details page to load
      await this.waitForElement(
        ".styles_description__xjvTf, .job-description",
        8000
      );

      this.log("✅ Job details page opened");
      return true;
    } catch (error) {
      this.log("❌ Failed to open job details:", error.message);
      return false;
    }
  }

  async extractCompleteJobDetails() {
    try {
      await this.delay(1000);

      // Extract comprehensive job details
      const jobDetails = {
        jobId: this.extractJobIdFromUrl(window.location.href),
        title: this.extractText([
          "h1.inline.text-xl.font-semibold.text-black",
          "h1",
          ".job-title",
        ]),
        company: this.extractText([
          'a[rel="noopener noreferrer"] span.text-sm.font-semibold.text-black',
          ".company-name",
          ".text-sm.font-semibold.text-black",
        ]),
        location: this.extractLocationInfo(),
        jobType: this.extractJobTypeInfo(),
        description: this.extractJobDescription(),
        requirements: this.extractJobRequirements(),
        salary: this.extractSalaryInfo(),
        benefits: this.extractBenefits(),
        applicationFormFields: await this.extractApplicationFormFields(),
        url: window.location.href,
        platform: this.platform,
        extractedAt: Date.now(),
      };

      // Generate job ID if not found
      if (!jobDetails.jobId) {
        jobDetails.jobId = `${jobDetails.company}-${jobDetails.title}`
          .replace(/[^a-zA-Z0-9]/g, "")
          .toLowerCase();
      }

      this.currentJobDetails = jobDetails;
      this.log("📋 Complete job details extracted:", {
        title: jobDetails.title,
        company: jobDetails.company,
        hasFormFields: !!jobDetails.applicationFormFields,
      });

      return jobDetails;
    } catch (error) {
      this.log("❌ Failed to extract complete job details:", error.message);
      return null;
    }
  }

  extractLocationInfo() {
    try {
      const locationElements = document.querySelectorAll(
        "ul.block.text-md.text-black li"
      );
      for (const element of locationElements) {
        const text = element.textContent.trim();
        if (text.includes("Remote") || text.includes("Location")) {
          return text.split("|")[0].trim();
        }
      }
      return "Not specified";
    } catch (error) {
      return "Not specified";
    }
  }

  extractJobTypeInfo() {
    try {
      const typeElements = document.querySelectorAll(
        "ul.block.text-md.text-black li"
      );
      for (const element of typeElements) {
        const text = element.textContent.trim();
        if (
          text.includes("Full Time") ||
          text.includes("Part Time") ||
          text.includes("Contract")
        ) {
          return text.split("|").pop().trim();
        }
      }
      return "Not specified";
    } catch (error) {
      return "Not specified";
    }
  }

  extractJobDescription() {
    const descriptionElement =
      document.querySelector(".styles_description__xjvTf") ||
      document.querySelector("#job-description") ||
      document.querySelector(".description");
    return descriptionElement
      ? descriptionElement.textContent.trim()
      : "No description available";
  }

  extractJobRequirements() {
    try {
      // Look for requirements section
      const requirementsSection = Array.from(
        document.querySelectorAll("h3, h4, strong")
      ).find(
        (el) =>
          el.textContent.toLowerCase().includes("requirement") ||
          el.textContent.toLowerCase().includes("qualification")
      );

      if (requirementsSection) {
        const nextSibling = requirementsSection.nextElementSibling;
        if (nextSibling) {
          return nextSibling.textContent.trim();
        }
      }

      return "";
    } catch (error) {
      return "";
    }
  }

  extractSalaryInfo() {
    try {
      const salaryElements = document.querySelectorAll("span, div, p");
      for (const element of salaryElements) {
        const text = element.textContent;
        if (text && /\$[\d,]+/.test(text)) {
          return text.trim();
        }
      }
      return "Not specified";
    } catch (error) {
      return "Not specified";
    }
  }

  extractBenefits() {
    try {
      // Look for benefits section
      const benefitsSection = Array.from(
        document.querySelectorAll("h3, h4, strong")
      ).find(
        (el) =>
          el.textContent.toLowerCase().includes("benefit") ||
          el.textContent.toLowerCase().includes("perk")
      );

      if (benefitsSection) {
        const nextSibling = benefitsSection.nextElementSibling;
        if (nextSibling) {
          return nextSibling.textContent.trim();
        }
      }

      return "";
    } catch (error) {
      return "";
    }
  }

  async extractApplicationFormFields() {
    try {
      // Look for apply buttons using proper CSS selectors
      const applyButtonSelectors = [
        'button[type="submit"]',
        'button[data-test*="Apply"]',
        'button[data-test*="Submit"]',
        ".apply-button",
        ".apply-btn",
      ];

      // Also look for buttons/links with "Apply" text
      const allButtons = document.querySelectorAll("button, a");
      const applyButtons = Array.from(allButtons).filter(
        (btn) =>
          btn.textContent && btn.textContent.toLowerCase().includes("apply")
      );

      // Check CSS selector buttons
      for (const selector of applyButtonSelectors) {
        const buttons = document.querySelectorAll(selector);
        applyButtons.push(...Array.from(buttons));
      }

      if (applyButtons.length === 0) {
        this.log("No apply buttons found");
        return null;
      }

      // Find non-external apply button
      const internalApplyButton = applyButtons.find(
        (btn) =>
          !btn.href &&
          !btn.textContent.toLowerCase().includes("website") &&
          !btn.textContent.toLowerCase().includes("external")
      );

      if (!internalApplyButton) {
        return { type: "external", fields: [] };
      }

      // Click apply to reveal form (if not already visible)
      const existingForm = document.querySelector("form");
      if (
        !existingForm ||
        existingForm.querySelectorAll("input, textarea, select").length === 0
      ) {
        await this.clickElementReliably(internalApplyButton);
        await this.delay(3000);
      }

      // Extract comprehensive form fields
      const formFields = await this.extractFormFieldsWithQuestions();
      const form =
        document.querySelector("form") ||
        document.querySelector('[role="dialog"]');

      if (!form || formFields.length === 0) {
        this.log("No form or form fields found");
        return null;
      }

      return {
        type: "form",
        fields: formFields,
        formSelector: form ? this.generateSelector(form) : "form",
      };
    } catch (error) {
      this.log("❌ Failed to extract form fields:", error.message);
      return null;
    }
  }

  async extractFormFieldsWithQuestions() {
    try {
      const formFields = [];
      const form = document.querySelector("form");

      if (!form) return formFields;

      // Get all input elements
      const inputs = form.querySelectorAll("input, textarea, select");

      for (const input of inputs) {
        if (input.type === "hidden" || input.type === "submit") continue;

        // Find the associated label/question
        const fieldInfo = {
          element: input,
          name: input.name || input.id,
          type: input.type || input.tagName.toLowerCase(),
          placeholder: input.placeholder || "",
          required: input.required || input.hasAttribute("required"),
          selector: this.generateSelector(input),
          question: this.extractQuestionForField(input),
          value: input.value || "",
        };

        // Skip if we can't identify the field
        if (!fieldInfo.name && !fieldInfo.question) continue;

        formFields.push(fieldInfo);
        this.log(
          `📝 Found form field: ${fieldInfo.question || fieldInfo.name}`
        );
      }

      return formFields;
    } catch (error) {
      this.log(
        "❌ Error extracting form fields with questions:",
        error.message
      );
      return [];
    }
  }

  extractQuestionForField(input) {
    try {
      // Strategy 1: Look for associated label
      if (input.id) {
        const label = document.querySelector(`label[for="${input.id}"]`);
        if (label) {
          return label.textContent.trim();
        }
      }

      // Strategy 2: Look for parent label
      const parentLabel = input.closest("label");
      if (parentLabel) {
        // Get text content excluding the input itself
        const labelText = Array.from(parentLabel.childNodes)
          .filter(
            (node) =>
              node.nodeType === Node.TEXT_NODE ||
              (node.nodeType === Node.ELEMENT_NODE && node !== input)
          )
          .map((node) => node.textContent || "")
          .join(" ")
          .trim();
        if (labelText) return labelText;
      }

      // Strategy 3: Look for preceding text elements
      const container = input.closest("div") || input.parentElement;
      if (container) {
        const textElements = container.querySelectorAll(
          "div, span, p, h1, h2, h3, h4, h5, h6"
        );
        for (const element of textElements) {
          const text = element.textContent?.trim();
          if (
            (text && text.length > 5 && text.includes("?")) ||
            text.includes(":")
          ) {
            return text;
          }
        }
      }

      // Strategy 4: Look for any preceding text
      let current = input.previousElementSibling;
      while (current && current !== container) {
        const text = current.textContent?.trim();
        if (text && text.length > 5) {
          return text;
        }
        current = current.previousElementSibling;
      }

      // Strategy 5: Use placeholder or name as fallback
      return input.placeholder || input.name || "Unknown field";
    } catch (error) {
      return input.placeholder || input.name || "Unknown field";
    }
  }

  async handleDynamicApplicationForm() {
    try {
      // Wait for form to appear
      await this.delay(2000);

      await this.formHandler.processApplicationForm();
    } catch (error) {
      this.log("❌ Error handling dynamic form:", error.message);
      return false;
    }
  }

  async verifyApplicationSuccess() {
    // Use form handler's verification method
    return await this.formHandler.verifySubmissionSuccess();
  }

  async returnToJobsList() {
    try {
      // Try browser back button first
      window.history.back();
      await this.delay(2000);

      // Verify we're back on jobs list
      const jobCards = document.querySelectorAll(".styles_component__uTjje");
      if (jobCards.length > 0) {
        this.log("✅ Successfully returned to jobs list");
        return true;
      }

      // Fallback: navigate directly to jobs page
      window.location.href = "https://wellfound.com/jobs";
      await this.delay(3000);
      await this.waitForJobCards();

      return true;
    } catch (error) {
      this.log("❌ Error returning to jobs list:", error.message);
      return false;
    }
  }

  async clickElementReliably(element) {
    const strategies = [
      () => element.click(),
      () =>
        element.dispatchEvent(
          new MouseEvent("click", { bubbles: true, cancelable: true })
        ),
      () => {
        element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
        element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
        element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      },
      () => {
        element.focus();
        element.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Enter", bubbles: true })
        );
      },
    ];

    element.scrollIntoView({ behavior: "smooth", block: "center" });
    await this.delay(500);

    for (const strategy of strategies) {
      try {
        strategy();
        await this.delay(1000);
        return true;
      } catch (error) {
        continue;
      }
    }

    throw new Error("All click strategies failed");
  }

  generateSelector(element) {
    if (element.id) return `#${element.id}`;
    if (element.name) return `[name="${element.name}"]`;
    if (element.className) return `.${element.className.split(" ")[0]}`;
    return element.tagName.toLowerCase();
  }

  extractText(selectors) {
    for (const selector of selectors) {
      const element = document.querySelector(selector);
      if (element && element.textContent) {
        return element.textContent.trim();
      }
    }
    return "";
  }

  async waitForJobCards() {
    try {
      await this.waitForElement(".styles_component__uTjje", 10000);
      await this.delay(2000); // Additional wait for cards to fully load
      this.log("✅ Job cards loaded");
    } catch (error) {
      this.log("⚠️ Timeout waiting for job cards");
      throw new Error("Job cards failed to load");
    }
  }

  doesJobMatchPreferences(jobDetails) {
    const preferences = this.config.preferences || {};

    // Check if positions match (basic keyword matching)
    if (preferences.positions?.length) {
      const jobTitle = jobDetails.title?.toLowerCase() || "";
      const hasMatchingPosition = preferences.positions.some((position) =>
        jobTitle.includes(position.toLowerCase())
      );

      if (!hasMatchingPosition) {
        this.log(
          `❌ Job title "${jobDetails.title}" doesn't match required positions`
        );
        return false;
      }
    }

    // Check remote preference
    if (preferences.remoteOnly) {
      const isRemote =
        jobDetails.location?.toLowerCase().includes("remote") ||
        jobDetails.location?.toLowerCase().includes("anywhere") ||
        jobDetails.description?.toLowerCase().includes("remote");

      if (!isRemote) {
        this.log(`❌ Job "${jobDetails.title}" is not remote`);
        return false;
      }
    }

    return true;
  }

  extractJobIdFromUrl(url) {
    try {
      // Try to extract job ID from Wellfound URL patterns
      const patterns = [/\/jobs\/(\d+)/, /jobId=(\d+)/, /job[_-](\d+)/];

      for (const pattern of patterns) {
        const match = url.match(pattern);
        if (match) {
          return match[1];
        }
      }

      return null;
    } catch (error) {
      return null;
    }
  }

  async loadMoreJobs() {
    try {
      // Try to scroll to load more jobs
      window.scrollTo(0, document.body.scrollHeight);
      await this.delay(3000);

      // Check if new job cards loaded
      const newJobCards = document.querySelectorAll(".styles_component__uTjje");
      return newJobCards.length > 0;
    } catch (error) {
      this.log("Failed to load more jobs:", error.message);
      return false;
    }
  }

  async checkUserAuthorization() {
    try {
      this.statusOverlay.addInfo("Let me check if you're all set to apply...");

      const canApply = await this.userService.canApplyMore();
      if (!canApply) {
        const remaining = await this.userService.getRemainingApplications();
        const userDetails = await this.userService.getUserDetails();

        const message =
          userDetails.userRole === "credit"
            ? `Looks like you're running low on credits (${userDetails.credits} left). Time to top up! 💳`
            : `You've hit your daily limit! Don't worry, you have ${remaining} applications left overall. 📊`;

        this.statusOverlay.addWarning(message);
        throw new Error(`Cannot apply: ${message}`);
      }

      this.log("✅ User authorization check passed");
      this.statusOverlay.addSuccess(
        "Perfect! You're all authorized and ready to go!"
      );
    } catch (error) {
      this.log("❌ User authorization check failed:", error.message);
      this.statusOverlay.addError(
        "Hmm, there's an issue with your account permissions. " + error.message
      );
      throw error;
    }
  }

  async saveAppliedJob(jobDetails) {
    try {
      const success = await this.appTracker.saveAppliedJob({
        jobId: jobDetails.jobId,
        title: jobDetails.title,
        company: jobDetails.company,
        location: jobDetails.location,
        jobUrl: jobDetails.url,
        description: jobDetails.description,
        platform: this.platform,
      });


      console.log(success)
      if (success) {
        await this.appTracker.updateApplicationCount();
        this.log(`✅ Job application saved to database: ${jobDetails.title}`);
        this.statusOverlay.addSuccess(
          `I've saved "${jobDetails.title}" to your application history! 📝`
        );
        return true;
      } else {
        this.log(`⚠️ Failed to save job application: ${jobDetails.title}`);
        return false;
      }
    } catch (error) {
      this.log(`❌ Error saving job application: ${error.message}`);
      return false;
    }
  }

  async waitForPageLoad() {
    try {
      await this.waitForElement("body", 10000);
      await this.delay(2000);
    } catch (error) {
      console.error("Error waiting for page load:", error);
    }
  }

  async waitForElement(selector, timeout = 10000) {
    const startTime = Date.now();
    while (Date.now() - startTime < timeout) {
      const element = document.querySelector(selector);
      if (element) return element;
      await this.delay(100);
    }
    throw new Error(`Element not found: ${selector}`);
  }

  async delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  onDOMChange() {
    if (this.automationStarted && this.isRunning && !this.isPaused) {
      // Handle DOM changes if needed
    }
  }

  onNavigation(oldUrl, newUrl) {
    this.log(`🔄 Navigation detected: ${oldUrl} → ${newUrl}`);
    this.statusOverlay.addInfo("I noticed we moved to a different page...");

    if (
      !newUrl.includes("wellfound.com/jobs") &&
      this.automationStarted &&
      this.isRunning
    ) {
      this.log("⚠️ Navigated away from Wellfound Jobs, attempting to return");
      this.statusOverlay.addWarning(
        "Looks like we went off-track! Let me get us back to the jobs page..."
      );
      setTimeout(() => {
        if (this.isRunning) {
          this.navigateToWellfoundJobs();
        }
      }, 3000);
    }
  }

  async navigateToWellfoundJobs() {
    window.location.href = "https://wellfound.com/jobs";
    await this.delay(3000);
    await this.waitForPageLoad();
    this.log("✅ Navigation to Wellfound Jobs completed");
    this.statusOverlay.addSuccess(
      "Perfect! Now I'm setting up the search with all your preferences."
    );
  }

  async pause() {
    await super.pause();
    this.log("⏸️ Wellfound automation paused");
    this.statusOverlay.addWarning(
      "Taking a little break! I'll be here when you're ready to continue. ⏸️"
    );
  }

  async resume() {
    await super.resume();
    this.log("▶️ Wellfound automation resumed");
    this.statusOverlay.addSuccess(
      "I'm back! Let's continue finding you some great opportunities! 🚀"
    );
  }

  async stop() {
    await super.stop();
    this.hasStarted = false;
    this.automationStarted = false;
    this.log("⏹️ Wellfound automation stopped");
    this.statusOverlay.addWarning(
      "All done for now! Thanks for letting me help with your job search. Good luck! 🍀"
    );
  }

  cleanup() {
    super.cleanup();
    this.processedJobs.clear();

    // Cleanup status overlay
    if (this.statusOverlay) {
      this.statusOverlay.destroy();
      this.statusOverlay = null;
    }

    this.log("🧹 Wellfound platform cleanup completed");
  }
}
