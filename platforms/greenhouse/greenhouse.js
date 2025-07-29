import BasePlatformAutomation from "../../shared/base/base-platform-automation.js";
import GreenhouseFormHandler from "./greenhouse-form-handler.js";
import GreenhouseFileHandler from "./greenhouse-file-handler.js";
import { UrlUtils, DomUtils, FormUtils } from "../../shared/utilities/index.js";
import {
    AIService,
    ApplicationTrackerService,
    UserService,
} from "../../services/index.js";

export default class GreenhousePlatform extends BasePlatformAutomation {
    constructor(config) {
        super(config);
        this.platform = "greenhouse";
        this.baseUrl = "https://job-boards.greenhouse.io";

        this.aiService = new AIService({ apiHost: this.getApiHost() });
        this.applicationTracker = new ApplicationTrackerService({
            userId: this.userId,
        });
        this.userService = new UserService({ userId: this.userId });

        this.fileHandler = null;
        this.formHandler = null;
        this.cachedJobDescription = null;
    }

    getPlatformDomains() {
        return ["https://job-boards.greenhouse.io", "https://boards.greenhouse.io"];
    }

    getSearchLinkPattern() {
        return /^https:\/\/(job-boards|boards)\.greenhouse\.io\/[^\/]+\/jobs\/[^\/]+/;
    }

    isValidJobPage(url) {
        if (!url) return false;
        const pattern = /^https:\/\/(job-boards|boards)\.greenhouse\.io\/[^\/]+\/jobs\/[^\/]+/;
        return pattern.test(url);
    }

    getApiHost() {
        return this.sessionApiHost || this.sessionContext?.apiHost || this.config.apiHost;
    }

    isApplicationPage(url) {
        return url.includes("/jobs/") && (url.includes("#app") || document.querySelector('#application_form, .application-form'));
    }

    getJobTaskMessageType() {
        return "SEND_CV_TASK";
    }

    isGreenhouseJobListingPage(url) {
        return /^https:\/\/(job-boards|boards)\.greenhouse\.io\/[^\/]+\/jobs\/[^\/]+/.test(url) &&
            !url.includes('#app');
    }

    isGreenhouseApplicationPage(url) {
        return /^https:\/\/(job-boards|boards)\.greenhouse\.io\/[^\/]+\/jobs\/[^\/]+#app/.test(url) ||
            (this.isValidJobPage(url) && document.querySelector('#application_form, .application-form'));
    }

    platformSpecificUrlNormalization(url) {
        try {
            let cleanUrl = url;

            if (cleanUrl.includes('url?q=')) {
                const realUrl = this.extractRealUrlFromGoogleResult(cleanUrl);
                if (realUrl) {
                    cleanUrl = realUrl;
                }
            }

            cleanUrl = cleanUrl.replace(/#.*$/, "");
            cleanUrl = cleanUrl.replace(/\?utm_.*$/, "");
            cleanUrl = cleanUrl.replace(/&utm_.*$/, "");

            return cleanUrl;
        } catch (e) {
            return url.replace(/#.*$/, "");
        }
    }

    findAllLinksElements() {
        try {
            const googleResults = document.querySelectorAll('#rso a[href*="url?q="], #rso a[href*="greenhouse.io"]');
            const validLinks = [];

            for (const link of googleResults) {
                const realUrl = this.extractRealUrlFromGoogleResult(link.href);
                if (realUrl && this.isValidJobPage(realUrl)) {
                    const clonedLink = link.cloneNode(true);
                    clonedLink.href = realUrl;
                    validLinks.push(clonedLink);
                }
            }

            this.log(`Found ${validLinks.length} valid Greenhouse job links`);
            return validLinks;
        } catch (err) {
            this.log("Error finding Greenhouse links:", err);
            return [];
        }
    }

    extractRealUrlFromGoogleResult(googleUrl) {
        try {
            if (googleUrl.includes('greenhouse.io') && !googleUrl.includes('url?q=')) {
                return googleUrl;
            }

            if (googleUrl.includes('url?q=')) {
                const urlMatch = googleUrl.match(/url\?q=([^&]+)/);
                if (urlMatch) {
                    const decodedUrl = decodeURIComponent(urlMatch[1]);
                    if (decodedUrl.includes('greenhouse.io')) {
                        return decodedUrl;
                    }
                }
            }

            const urlObj = new URL(googleUrl);
            if (urlObj.searchParams.has('q')) {
                const qParam = urlObj.searchParams.get('q');
                if (qParam.includes('greenhouse.io')) {
                    return qParam;
                }
            }

            return null;
        } catch (e) {
            return null;
        }
    }

    findUnprocessedLink(links) {
        for (let i = 0; i < links.length; i++) {
            const url = this.normalizeUrlFully(links[i].href);

            if (this.isLinkProcessed(url)) {
                this.markProcessedLink(links[i]);
                continue;
            }

            if (!this.isValidJobPage(url)) {
                this.markInvalidLink(links[i], url);
                continue;
            }

            if (this.isGreenhouseApplicationPage(url)) {
                this.markInvalidLink(links[i], url);
                continue;
            }

            return { link: links[i], url };
        }

        return null;
    }

    matchesSearchPattern(url) {
        return this.isValidJobPage(url);
    }

    async handleNoUnprocessedLinks() {
        if (this.applicationState.isApplicationInProgress) {
            this.log("Application in progress, aborting navigation");
            return;
        }

        const loadMoreBtn = this.findLoadMoreElement();

        if (loadMoreBtn) {
            this.statusOverlay.showActionPreview(
                "Load more job opportunities",
                { action: "Clicking 'Load More' button" },
                2
            );

            await this.delay(2000);

            if (this.isPaused) {
                this.log("Automation paused during load more preview, aborting");
                return;
            }

            if (this.applicationState.isApplicationInProgress) {
                this.log("Application became in progress, aborting navigation");
                return;
            }

            this.statusOverlay.addInfo("Loading more Greenhouse job opportunities...");
            this.statusOverlay.updateStatus("searching", "Loading more jobs...");
            loadMoreBtn.click();

            setTimeout(() => {
                if (!this.applicationState.isApplicationInProgress && !this.isPaused) {
                    this.searchNext();
                }
            }, 3000);
        } else {
            this.statusOverlay.addSuccess(
                "Excellent! I've successfully processed all available Greenhouse jobs! 🎉"
            );
            this.statusOverlay.updateStatus("completed", "All Greenhouse jobs processed");
            this.safeSendPortMessage({ type: "SEARCH_COMPLETED" });
        }
    }

    handlePlatformSpecificMessage(type, data) {
        switch (type) {
            case "APPLICATION_STATUS_RESPONSE":
                this.handleApplicationStatusResponse(data);
                break;

            case "SUCCESS":
                this.handleSuccessMessage(data);
                break;

            case "JOB_TAB_STATUS":
                this.handleJobTabStatus(data);
                break;

            default:
                super.handlePlatformSpecificMessage(type, data);
        }
    }

    handleApplicationStatusResponse(data) {
        this.log("📊 Application status response:", data);

        if (data && data.active === false && this.applicationState.isApplicationInProgress) {
            this.log("⚠️ State mismatch detected! Resetting application progress flag");
            this.applicationState.isApplicationInProgress = false;
            this.applicationState.applicationStartTime = null;
            this.statusOverlay.addWarning("Detected state mismatch - resetting flags");
            setTimeout(() => this.searchNext(), 1000);
        }
    }

    handleSuccessMessage(data) {
        if (data) {
            if (data.submittedLinks !== undefined) {
                this.processSearchTaskData(data);
            } else if (data.profile !== undefined && !this.userProfile) {
                this.processSendCvTaskData(data);
            }
        }
    }

    handleJobTabStatus(data) {
        this.log("📊 Job tab status:", data);

        if (data.isOpen && data.isProcessing) {
            this.applicationState.isApplicationInProgress = true;
            this.statusOverlay.addInfo("Job application in progress, waiting...");

            setTimeout(() => {
                if (this.applicationState.isApplicationInProgress) {
                    this.safeSendPortMessage({ type: "CHECK_JOB_TAB_STATUS" });
                }
            }, 10000);
        } else {
            if (this.applicationState.isApplicationInProgress) {
                this.log("🔄 Resetting application in progress flag");
                this.applicationState.isApplicationInProgress = false;
                this.applicationState.applicationStartTime = null;
                this.statusOverlay.addInfo("No active job application, resuming search");
                setTimeout(() => this.searchNext(), 1000);
            }
        }
    }

    async start(params = {}) {
        try {
            this.isRunning = true;
            this.log("🚀 Starting Greenhouse automation");
            this.statusOverlay.addInfo("Starting Greenhouse automation");

            if (!this.userProfile && this.userId) {
                try {
                    console.log("🔄 Attempting to fetch user profile during start...");
                    this.userProfile = await this.userService.getUserDetails();
                    console.log("✅ User profile fetched during start");
                    this.statusOverlay.addSuccess("User profile loaded");

                    if (this.formHandler && this.userProfile) {
                        this.formHandler.userData = this.userProfile;
                    }
                } catch (error) {
                    console.error("❌ Failed to fetch user profile during start:", error);
                    this.statusOverlay.addWarning(
                        "Failed to load user profile - automation may have limited functionality"
                    );
                }
            }

            this.config = { ...this.config, ...params };
            await this.waitForPageLoad();
            await this.detectPageTypeAndStart();
        } catch (error) {
            this.reportError(error, { phase: "start" });
        }
    }

    async initialize() {
        await super.initialize();

        this.fileHandler = new GreenhouseFileHandler({
            statusService: this.statusOverlay,
            apiHost: this.getApiHost(),
        });

        this.formHandler = new GreenhouseFormHandler({
            logger: (message) => this.statusOverlay.addInfo(message),
            host: this.getApiHost(),
            userData: this.userProfile || {},
            jobDescription: "",
        });
    }

    async detectPageTypeAndStart() {
        const url = window.location.href;
        this.log(`🔍 Detecting page type for: ${url}`);

        if (url.includes("google.com/search")) {
            this.log("📊 Google search page detected");
            this.statusOverlay.addInfo("Google search page detected");
            await this.startSearchProcess();
        } else if (this.isValidJobPage(url)) {
            this.log("📋 Greenhouse job page detected");
            this.statusOverlay.addInfo("Greenhouse job page detected");
            await this.startApplicationProcess();
        } else {
            this.log("❓ Unknown page type, waiting for navigation");
            await this.waitForValidPage();
        }
    }

    async startSearchProcess() {
        try {
            this.statusOverlay.addInfo("Starting job search process");
            this.statusOverlay.updateStatus("searching");
            await this.fetchSearchTaskData();
        } catch (error) {
            this.reportError(error, { phase: "search" });
        }
    }

    async fetchSearchTaskData() {
        this.log("📡 Fetching search task data from background");
        this.statusOverlay.addInfo("Fetching search task data...");

        const success = this.safeSendPortMessage({ type: "GET_SEARCH_TASK" });
        if (!success) {
            throw new Error("Failed to request search task data");
        }
    }

    processSearchTaskData(data) {
        try {
            this.log("📊 Processing search task data:", data);

            if (!data) {
                this.log("⚠️ No search task data provided");
                return;
            }

            this.searchData = {
                tabId: data.tabId,
                limit: data.limit || 10,
                current: data.current || 0,
                domain: data.domain || this.getPlatformDomains(),
                submittedLinks: data.submittedLinks
                    ? data.submittedLinks.map((link) => ({ ...link, tries: 0 }))
                    : [],
                searchLinkPattern: data.searchLinkPattern
                    ? new RegExp(data.searchLinkPattern.replace(/^\/|\/[gimy]*$/g, ""))
                    : this.getSearchLinkPattern(),
            };

            setTimeout(() => this.searchNext(), 1000);
        } catch (error) {
            this.log("❌ Error processing search task data:", error);
            this.statusOverlay.addError(
                "Error processing search task data: " + error.message
            );
        }
    }

    async setSessionContext(sessionContext) {
        try {
            this.sessionContext = sessionContext;
            this.hasSessionContext = true;

            if (sessionContext.sessionId) this.sessionId = sessionContext.sessionId;
            if (sessionContext.platform) this.platform = sessionContext.platform;
            if (sessionContext.userId) this.userId = sessionContext.userId;

            if (sessionContext.userProfile) {
                if (!this.userProfile || Object.keys(this.userProfile).length === 0) {
                    this.userProfile = sessionContext.userProfile;
                    console.log("👤 User profile loaded from session context");
                } else {
                    this.userProfile = {
                        ...this.userProfile,
                        ...sessionContext.userProfile,
                    };
                    console.log("👤 User profile merged with session context");
                }
            }

            if (!this.userProfile && this.userId) {
                try {
                    console.log("📡 Fetching user profile from user service...");
                    this.userProfile = await this.userService.getUserDetails();
                    console.log("✅ User profile fetched successfully");
                } catch (error) {
                    console.error("❌ Failed to fetch user profile:", error);
                    this.statusOverlay?.addError(
                        "Failed to fetch user profile: " + error.message
                    );
                }
            }

            if (
                this.userId &&
                (!this.userService || this.userService.userId !== this.userId)
            ) {
                this.applicationTracker = new ApplicationTrackerService({
                    userId: this.userId,
                });
                this.userService = new UserService({ userId: this.userId });
                console.log("📋 Updated services with new userId:", this.userId);
            }

            if (sessionContext.apiHost) {
                this.sessionApiHost = sessionContext.apiHost;
            }

            if (this.formHandler && this.userProfile) {
                this.formHandler.userData = this.userProfile;
            }

            console.log("✅ Greenhouse session context set successfully", {
                hasUserProfile: !!this.userProfile,
                userId: this.userId,
                sessionId: this.sessionId,
                profileName: this.userProfile?.name || this.userProfile?.firstName,
                profileEmail: this.userProfile?.email,
            });
        } catch (error) {
            console.error("❌ Error setting Greenhouse session context:", error);
            this.statusOverlay?.addError(
                "❌ Error setting session context: " + error.message
            );
        }
    }

    async startApplicationProcess() {
        try {
            console.log("📝 Starting application process");
            this.statusOverlay.addInfo("Starting application process");

            if (!this.userProfile) {
                console.log("⚠️ No user profile available, attempting to fetch...");
                await this.fetchSendCvTaskData();
            }

            const currentUrl = window.location.href;
            if (this.isGreenhouseJobListingPage(currentUrl)) {
                console.log("📋 On job listing page, need to click Apply button");
                await this.handleJobListingPage();
            }

            const applied = this.checkSubmissionSuccess();
            if (applied) {
                await this.handleAlreadyApplied();
                return;
            }

            await this.apply();
        } catch (error) {
            this.reportError(error, { phase: "application" });
            this.handleApplicationError(error);
        }
    }

    async handleJobListingPage() {
        this.statusOverlay.addInfo(
            "Job listing page detected - clicking Apply button"
        );

        this.cachedJobDescription = await this.extractJobDescription();

        const applyButton = this.findGreenhouseApplyButton();
        if (!applyButton) {
            throw new Error("Cannot find Apply button on job listing page");
        }

        console.log("🖱️ Clicking Apply button");
        applyButton.click();

        await this.waitForApplicationForm();
        this.statusOverlay.addSuccess("Application form loaded successfully");
    }

    async handleAlreadyApplied() {
        const jobId = UrlUtils.extractJobId(window.location.href, "greenhouse");
        const company = UrlUtils.extractCompanyFromUrl(
            window.location.href,
            "greenhouse"
        );

        this.safeSendPortMessage({
            type: "SEND_CV_TASK_DONE",
            data: {
                jobId: jobId,
                title: document.title || "Job on Greenhouse",
                company: company || "Company on Greenhouse",
                location: "Not specified",
                jobUrl: window.location.href,
            },
        });

        this.applicationState.isApplicationInProgress = false;
        this.statusOverlay.addSuccess("Application completed successfully");
    }

    handleApplicationError(error) {
        if (error.name === "SendCvSkipError") {
            this.statusOverlay.addWarning("Application skipped: " + error.message);
            this.safeSendPortMessage({
                type: "SEND_CV_TASK_SKIP",
                data: error.message,
            });
        } else {
            this.statusOverlay.addError("Application error: " + error.message);
            this.safeSendPortMessage({
                type: "SEND_CV_TASK_ERROR",
                data: this.errorToString(error),
            });
        }
        this.applicationState.isApplicationInProgress = false;
    }

    async apply() {
        try {
            this.statusOverlay.addInfo("Starting application process");
            this.statusOverlay.updateStatus("applying");

            if (!this.validateHandlers()) {
                throw new Error("Required handlers are not properly initialized");
            }

            if (this.hasPageErrors()) {
                throw new Error("Cannot start send cv: Page error");
            }

            const form = this.findGreenhouseApplicationForm();
            console.log("Form found:", form);
            if (!form) {
                await this.wait(2000);
                const formAfterWait = this.findGreenhouseApplicationForm();
                if (!formAfterWait) {
                    throw new Error("Cannot find application form");
                }
                return await this.processApplicationForm(formAfterWait);
            }

            return await this.processApplicationForm(form);
        } catch (e) {
            if (e.name === "SendCvSkipError") {
                throw e;
            } else {
                console.error("Error in apply:", e);
                throw new Error(
                    "Error during application process: " + this.errorToString(e)
                );
            }
        }
    }

    findGreenhouseApplicationForm() {
        const form = document.querySelector('#application-form, .application--form, form[action*="application"]');
        if (form && DomUtils.isElementVisible(form)) return form;

        const forms = document.querySelectorAll('form');
        for (const form of forms) {
            if (DomUtils.isElementVisible(form) &&
                form.querySelector('input, select, textarea, button[type="submit"]')) {
                return form;
            }
        }
        return null;
    }

    async processApplicationForm(form) {
        this.statusOverlay.addInfo("Found application form, beginning to fill out");

        const jobDescription =
            this.cachedJobDescription || (await this.extractJobDescription());

        if (this.formHandler) {
            this.formHandler.jobDescription = jobDescription;
            this.formHandler.userData = this.userProfile;
        }

        try {
            if (this.fileHandler && this.userProfile) {
                await this.fileHandler.handleFileUploads(
                    form,
                    this.userProfile,
                    jobDescription
                );
            }
        } catch (error) {
            this.statusOverlay.addError("File upload failed: " + error.message);
        }

        try {
            if (this.formHandler) {
                await this.formHandler.fillFormWithProfile(
                    form,
                    this.userProfile,
                    jobDescription
                );
                this.statusOverlay.addSuccess("Form fields filled");
            }
        } catch (error) {
            this.statusOverlay.addWarning("Form filling failed: " + error.message);
        }

        return await this.formHandler.submitForm(form);
    }

    findGreenhouseApplyButton() {
        const elements = document.querySelectorAll('button, a, [role="button"]');

        for (const el of elements) {
            if (!DomUtils.isElementVisible(el)) continue;

            const text = el.textContent.toLowerCase();
            const label = el.getAttribute('aria-label')?.toLowerCase() || '';

            if (text.includes('apply') || label.includes('apply') || el.href?.includes('#app')) {
                return el;
            }
        }
        return null;
    }

    async waitForApplicationForm(timeout = 10000) {
        const startTime = Date.now();

        while (Date.now() - startTime < timeout) {
            if (window.location.href.includes("#app") || document.querySelector('#application-form, .application--form')) {
                const form = this.findGreenhouseApplicationForm();
                if (form) {
                    return true;
                }
            }
            await this.wait(500);
        }

        throw new Error("Timeout waiting for application form to load");
    }

    async extractJobDescription() {
        const selectors = {
            title: '.job__description p strong:first-child, .posting-headline h2, h1, h2',
            location: '.location, .job-location',
            content: '.job__description, .posting-content, .job-description'
        };

        const description = {
            title: DomUtils.extractText([selectors.title]),
            location: DomUtils.extractText([selectors.location]),
            company: UrlUtils.extractCompanyFromUrl(window.location.href, 'greenhouse')
        };

        const contentEl = document.querySelector(selectors.content);
        if (contentEl) {
            description.fullDescription = contentEl.textContent.trim();

            if (!description.location) {
                const locationMatch = description.fullDescription.match(/Location:\s*([^.\n]+)/i);
                description.location = locationMatch?.[1]?.trim();
            }
        }

        return description;
    }

    checkSubmissionSuccess() {
        if (
            window.location.href.includes("success") ||
            window.location.href.includes("confirmation") ||
            window.location.href.includes("thanks") ||
            window.location.href.includes("submitted")
        ) {
            this.statusOverlay.addSuccess(
                "URL indicates success page - application submitted"
            );
            return true;
        }

        const successElements = document.querySelectorAll(
            ".success, .success-message, .thank-you, .confirmation, .submitted"
        );

        if (successElements.length > 0) {
            this.statusOverlay.addSuccess("Success message found - application submitted");
            return true;
        }

        const errorElements = document.querySelectorAll(
            ".error, .error-message, .form-error, .alert-error, .validation-error"
        );

        if (errorElements.length > 0) {
            const errorMessages = Array.from(errorElements)
                .map((el) => el.textContent.trim())
                .filter((text) => text.length > 0);

            if (errorMessages.length > 0) {
                return false;
            }
        }

        this.statusOverlay.addWarning(
            "Unable to confirm submission success - status uncertain"
        );
        return false;
    }

    validateHandlers() {
        const issues = [];

        if (!this.statusOverlay) issues.push("Status overlay not initialized");
        if (!this.fileHandler) issues.push("File handler not initialized");
        if (!this.formHandler) issues.push("Form handler not initialized");
        if (!this.userProfile) issues.push("User profile not available");

        if (issues.length > 0) {
            this.statusOverlay?.addError(
                "Initialization issues: " + issues.join(", ")
            );
            return false;
        }

        return true;
    }

    hasPageErrors() {
        return (
            document.body.innerText.includes("Cannot GET") ||
            document.body.innerText.includes("404") ||
            document.body.innerText.includes("Page not found") ||
            document.location.search.includes("not_found=true")
        );
    }

    async fetchSendCvTaskData() {
        if (this.userProfile && this.hasSessionContext) {
            this.log("✅ User profile already available from session context");
            return;
        }

        this.log("📡 Fetching send CV task data from background");
        this.statusOverlay.addInfo("Fetching CV task data...");

        const success = this.safeSendPortMessage({ type: "GET_SEND_CV_TASK" });
        if (!success) {
            throw new Error("Failed to request send CV task data");
        }
    }

    processSendCvTaskData(data) {
        try {
            console.log("📊 Processing send CV task data:", {
                hasData: !!data,
                hasProfile: !!data?.profile,
            });

            if (data?.profile && !this.userProfile) {
                this.userProfile = data.profile;
                console.log("👤 User profile set from background response");
            }

            if (this.formHandler && this.userProfile) {
                this.formHandler.userData = this.userProfile;
            }

            this.statusOverlay.addSuccess("Apply initialization complete");
        } catch (error) {
            console.error("❌ Error processing send CV task data:", error);
            this.statusOverlay.addError("Error processing CV data: " + error.message);
        }
    }

    async waitForValidPage() {
        const url = window.location.href;

        if (url.includes("google.com/search") || this.isValidJobPage(url)) {
            await this.detectPageTypeAndStart();
            return;
        }

        const applyButton = this.findGreenhouseApplyButton();
        if (applyButton) {
            applyButton.click();
            await this.delay(3000);
            await this.startApplicationProcess();
            return;
        }

        await this.delay(3000);

        this.safeSendPortMessage({
            type: "SEND_CV_TASK_SKIP",
            data: {
                reason: "Invalid page - no search, job page, or application elements found",
                url: window.location.href
            }
        });

        this.applicationState.isApplicationInProgress = false;
        this.applicationState.applicationStartTime = null;
    }

    errorToString(e) {
        if (!e) return "Unknown error (no details)";
        if (e instanceof Error) {
            return e.message + (e.stack ? `\n${e.stack}` : "");
        }
        return String(e);
    }

    cleanup() {
        super.cleanup();
        this.cachedJobDescription = null;
        this.log("🧹 Greenhouse-specific cleanup completed");
    }
}