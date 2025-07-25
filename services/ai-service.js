// services/ai-service.js
export default class AIService {
  constructor(config) {
    this.apiHost = config.apiHost;
    this.answerCache = new Map();
  }

  async getAnswer(question, options = [], context = {}) {
    const normalizedQuestion = question.toLowerCase().trim();

    // Check cache first
    if (this.answerCache.has(normalizedQuestion)) {
      return this.answerCache.get(normalizedQuestion);
    }

    try {
      const response = await fetch(`${this.apiHost}/api/ai-answer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: normalizedQuestion,
          options,
          platform: context.platform || "linkedin",
          userData: context.userData || {},
          description: context.jobDescription || "",
        }),
      });

      if (!response.ok) throw new Error("AI service error");

      const data = await response.json();
      const answer = data.answer;

      // Cache the answer
      this.answerCache.set(normalizedQuestion, answer);

      return answer;
    } catch (error) {
      console.error("AI Answer Error:", error);
      // Return fallback answer
      return options.length > 0 ? options[0] : "";
    }
  }

  async generateCoverLetter(jobDetails, userProfile) {
    try {
      const response = await fetch(`${this.apiHost}/api/ai-cover-letter`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobDetails,
          userProfile,
        }),
      });

      if (!response.ok) throw new Error("Cover letter generation failed");

      const data = await response.json();
      return data.coverLetter;
    } catch (error) {
      console.error("Cover letter generation error:", error);
      return userProfile.defaultCoverLetter || "";
    }
  }

  clearCache() {
    this.answerCache.clear();
  }
}
