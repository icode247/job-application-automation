// services/ai-service.js
export default class AIService {
  constructor(config) {
    this.apiHost = config.apiHost;
    this.answerCache = new Map();
    this.platform = config.platform || "generic";
  }

  /**
   * Main method for getting AI answers with enhanced context
   */
  async getAnswer(question, options = [], context = {}) {
    const normalizedQuestion = question.toLowerCase().trim();

    // Build cache key with all context
    const cacheKey = this.buildCacheKey(normalizedQuestion, options, context);

    if (this.answerCache.has(cacheKey)) {
      return this.answerCache.get(cacheKey);
    }

    try {
      // Build enhanced context with field analysis
      const enhancedContext = this.buildEnhancedContext({
        question,
        options,
        ...context
      });

      const response = await fetch(`${this.apiHost}/api/ai-answer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(enhancedContext)
      });

      if (!response.ok) {
        throw new Error(`AI service returned ${response.status}`);
      }

      const data = await response.json();
      let answer = data.answer;

      // Post-process answer based on field type
      answer = this.postProcessAnswer(answer, enhancedContext.fieldAnalysis);

      // Cache the processed answer
      this.answerCache.set(cacheKey, answer);
      return answer;

    } catch (error) {
      console.error("AI Answer Error:", error);
      // Return fallback answer
      return this.getFallbackAnswer(context.fieldType, options);
    }
  }

  /**
   * Build enhanced context with field analysis
   */
  buildEnhancedContext({
    question,
    options = [],
    platform = this.platform,
    userData = {},
    jobDescription = "",
    fieldType = null,
    fieldContext = "",
    fieldElement = null,
    required = false
  }) {
    // Analyze field if not provided or element is available
    const fieldAnalysis = fieldType ?
      { type: fieldType, subType: null, context: fieldContext, required } :
      this.analyzeField(fieldElement, question);

    // Build enhanced question with type-specific instructions
    const enhancedQuestion = this.buildEnhancedQuestion(question, fieldAnalysis, options);

    return {
      question: enhancedQuestion,
      originalQuestion: question,
      options,
      platform,
      userData,
      description: jobDescription, // Keep 'description' for backward compatibility
      jobDescription,
      fieldType: fieldAnalysis.type,
      fieldSubType: fieldAnalysis.subType,
      fieldContext: fieldAnalysis.context,
      required: fieldAnalysis.required,
      fieldAnalysis // Include full analysis for post-processing
    };
  }

  /**
   * Build enhanced question with type-specific instructions
   */
  buildEnhancedQuestion(question, fieldAnalysis, options) {
    const instructions = [];

    switch (fieldAnalysis.type) {
      case 'salary':
        instructions.push("provide only the numeric amount without currency symbols or commas");
        break;

      case 'date':
        const format = fieldAnalysis.formatting?.dateFormat || "MM/DD/YYYY";
        instructions.push(`provide date in ${format} format only`);
        break;

      case 'phone':
        instructions.push("provide phone number in international format if country code available");
        break;

      case 'email':
        instructions.push("provide a valid email address");
        break;

      case 'location':
        instructions.push("provide city, state/country format");
        break;

      case 'source':
        instructions.push("how you found this job opportunity");
        break;

      case 'textarea':
        if (fieldAnalysis.subType === 'cover_letter') {
          instructions.push("generate a professional cover letter tailored to this position");
        }
        if (fieldAnalysis.validation?.maxLength) {
          instructions.push(`maximum ${fieldAnalysis.validation.maxLength} characters`);
        }
        break;

      case 'text':
        if (fieldAnalysis.validation?.maxLength) {
          instructions.push(`maximum ${fieldAnalysis.validation.maxLength} characters`);
        }
        break;
    }

    // Add requirement context
    if (fieldAnalysis.required) {
      instructions.push("this field is required - provide a valid answer");
    }

    // Add options context
    if (options && options.length > 0) {
      instructions.push(`select from these options: ${options.join(", ")}`);
    }

    // Build final enhanced question
    if (instructions.length > 0) {
      return `${question} (${instructions.join('; ')})`;
    }

    return question;
  }

  /**
   * Post-process answer based on field type
   */
  postProcessAnswer(answer, fieldAnalysis) {
    if (!answer) return answer;

    switch (fieldAnalysis.type) {
      case 'salary':
        return this.extractNumericSalary(answer);

      case 'number':
        return this.extractNumericValue(answer);

      case 'date':
        return this.formatDate(answer, fieldAnalysis.formatting?.dateFormat);

      case 'phone':
        return this.formatPhoneNumber(answer);

      case 'email':
        return this.validateEmail(answer) ? answer : null;

      case 'text':
      case 'textarea':
        if (fieldAnalysis.validation?.maxLength) {
          return String(answer).substring(0, fieldAnalysis.validation.maxLength);
        }
        return String(answer);

      default:
        return answer;
    }
  }

  /**
   * Post-processing helper methods
   */
  extractNumericSalary(salaryText) {
    if (!salaryText) return null;

    const cleaned = String(salaryText)
      .replace(/[$,\s]/g, '')
      .replace(/[^\d.]/g, '');

    const match = cleaned.match(/\d+\.?\d*/);
    if (match) {
      const number = parseFloat(match[0]);
      if (!isNaN(number) && number > 0) {
        return Math.round(number).toString();
      }
    }
    return null;
  }

  extractNumericValue(text) {
    if (!text) return null;
    const number = parseFloat(String(text).replace(/[^\d.-]/g, ''));
    return isNaN(number) ? null : number.toString();
  }

  formatDate(dateStr, format = "MM/DD/YYYY") {
    try {
      const date = new Date(dateStr);
      if (isNaN(date.getTime())) return dateStr;

      const mm = String(date.getMonth() + 1).padStart(2, '0');
      const dd = String(date.getDate()).padStart(2, '0');
      const yyyy = date.getFullYear();

      switch (format.toUpperCase()) {
        case 'MM/DD/YYYY':
          return `${mm}/${dd}/${yyyy}`;
        case 'DD/MM/YYYY':
          return `${dd}/${mm}/${yyyy}`;
        case 'YYYY-MM-DD':
          return `${yyyy}-${mm}-${dd}`;
        default:
          return `${mm}/${dd}/${yyyy}`;
      }
    } catch (error) {
      return dateStr;
    }
  }

  formatPhoneNumber(phone) {
    if (!phone) return phone;
    // Basic phone formatting - can be enhanced based on requirements
    const cleaned = String(phone).replace(/\D/g, '');
    if (cleaned.length >= 10) {
      return cleaned;
    }
    return phone;
  }

  validateEmail(email) {
    if (!email) return false;
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  detectDateFormat(element, questionText) {
    if (element?.placeholder) {
      const placeholder = element.placeholder.toLowerCase();
      if (placeholder.includes('mm/dd/yyyy')) return 'MM/DD/YYYY';
      if (placeholder.includes('dd/mm/yyyy')) return 'DD/MM/YYYY';
      if (placeholder.includes('yyyy-mm-dd')) return 'YYYY-MM-DD';
    }

    if (questionText?.includes('mm/dd')) return 'MM/DD/YYYY';
    if (questionText?.includes('dd/mm')) return 'DD/MM/YYYY';

    return 'MM/DD/YYYY'; // Default
  }

  getFallbackAnswer(fieldType, options) {
    switch (fieldType) {
      case 'salary':
        return '80000';
      case 'phone':
        return '555-0123';
      case 'email':
        return 'user@example.com';
      case 'date':
        return new Date().toLocaleDateString('en-US');
      case 'location':
        return 'New York, NY';
      case 'source':
        return 'LinkedIn';
      default:
        return options.length > 0 ? options[0] : 'Yes';
    }
  }

  buildCacheKey(question, options, context) {
    return JSON.stringify({
      question,
      options: options.sort(),
      fieldType: context.fieldType,
      platform: context.platform
    });
  }
  async generateCoverLetter(jobDetails, userProfile) {
    const context = {
      fieldType: 'textarea',
      fieldSubType: 'cover_letter',
      userData: userProfile,
      jobDescription: jobDetails.description || JSON.stringify(jobDetails),
      platform: this.platform
    };

    return await this.getAnswer('Cover letter', [], context);
  }

  analyzeField(element, question) {
    const analysis = {
      type: 'text',
      subType: null,
      context: '',
      required: false,
      validation: {},
      formatting: {}
    };

    const questionLower = question.toLowerCase();

    if (element) {
      if (element.type === 'number' || element.inputMode === 'numeric') {
        analysis.type = 'number';
      } else if (element.type === 'tel') {
        analysis.type = 'phone';
      } else if (element.type === 'email') {
        analysis.type = 'email';
      } else if (element.type === 'date') {
        analysis.type = 'date';
      } else if (element.tagName === 'TEXTAREA') {
        analysis.type = 'textarea';
      }

      if (element.required || element.getAttribute('aria-required') === 'true') {
        analysis.required = true;
      }

      if (element.maxLength) {
        analysis.validation.maxLength = element.maxLength;
      }

      if (element.min) analysis.validation.min = element.min;
      if (element.max) analysis.validation.max = element.max;
    }

    if (this.isEmailField(questionLower)) {
      analysis.type = 'email';
      analysis.context = 'Valid email address required';
    }
    else if (this.isPhoneField(questionLower)) {
      analysis.type = 'phone';
      analysis.context = 'Phone number with country code if available';
    }
    else if (this.isSalaryField(questionLower)) {
      analysis.type = 'salary';
      analysis.subType = 'currency';
      analysis.context = 'Numeric salary amount required';
    }
    else if (this.isDateField(questionLower)) {
      analysis.type = 'date';
      analysis.formatting.dateFormat = this.detectDateFormat(element, questionLower);
      analysis.context = `Date in ${analysis.formatting.dateFormat} format required`;
    }
    else if (this.isHowDidYouHearField(questionLower)) {
      analysis.type = 'source';
      analysis.context = 'Source of job discovery';
    }
    else if (this.isCoverLetterField(questionLower)) {
      analysis.type = 'textarea';
      analysis.subType = 'cover_letter';
      analysis.context = 'Professional cover letter required';
    }
    else if (this.isLocationField(questionLower)) {
      analysis.type = 'location';
      analysis.context = 'Geographic location required';
    }

    return analysis;
  }

  isEmailField(text) {
    const emailPatterns = [
      /^email$/i,
      /email.*address/i,
      /e-?mail/i,
      /contact.*email/i,
      /work.*email/i,
      /personal.*email/i,
      /^e-?mail$/i
    ];
    return emailPatterns.some(pattern => pattern.test(text));
  }

  isPhoneField(text) {
    const phonePatterns = [
      /^phone$/i,
      /phone.*number/i,
      /telephone/i,
      /mobile/i,
      /cell.*phone/i,
      /contact.*number/i,
      /work.*phone/i,
      /home.*phone/i
    ];
    return phonePatterns.some(pattern => pattern.test(text));
  }

  isLocationField(text) {
    if (this.isEmailField(text) || this.isPhoneField(text)) {
      return false;
    }

    const locationPatterns = [
      /^location$/i,
      /current.*location/i,
      /where.*located/i,
      /city.*state/i,
      /state.*city/i,
      /where.*live/i,
      /residence/i,
      /geographic/i,
      /postal.*code/i,
      /zip.*code/i,
      /mailing.*address/i,
      /home.*address/i,
      /street.*address/i,
      /physical.*address/i,
      /billing.*address/i,
      /shipping.*address/i,
      /work.*address/i,
      /office.*address/i
    ];

    return locationPatterns.some(pattern => pattern.test(text));
  }

  isSalaryField(text) {
    const salaryPatterns = [
      /salary/i, /compensation/i, /expected.*salary/i, /salary.*expectation/i,
      /pay.*range/i, /wage/i, /rate.*hour/i, /hourly.*rate/i, /annual.*income/i,
      /desired.*salary/i, /monthly.*salary/i
    ];
    return salaryPatterns.some(pattern => pattern.test(text));
  }

  isDateField(text) {
    const datePatterns = [
      /date.*available/i, /start.*date/i, /available.*date/i, /graduation.*date/i,
      /end.*date/i, /when.*available/i, /notice.*period/i, /when.*can.*start/i,
      /date.*birth/i, /birth.*date/i
    ];
    return datePatterns.some(pattern => pattern.test(text));
  }

  isHowDidYouHearField(text) {
    const hearPatterns = [
      /how.*did.*you.*hear/i, /how.*did.*you.*find/i, /source.*referral/i,
      /referred.*by/i, /how.*learn.*about/i, /hear.*about.*position/i
    ];
    return hearPatterns.some(pattern => pattern.test(text));
  }

  isCoverLetterField(text) {
    const coverLetterPatterns = [
      /cover.*letter/i, /why.*interested/i, /tell.*us.*about/i, /additional.*information/i,
      /why.*you.*right/i, /motivation/i
    ];
    return coverLetterPatterns.some(pattern => pattern.test(text));
  }

  clearCache() {
    this.answerCache.clear();
  }
}