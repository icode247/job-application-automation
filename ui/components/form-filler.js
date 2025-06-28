// ui/components/form-filler.js
export default class FormFiller {
  constructor(userPreferences) {
    this.preferences = userPreferences;
    this.fieldMappings = this.initializeFieldMappings();
  }

  initializeFieldMappings() {
    return {
      firstName: [
        "first name",
        "firstname",
        "fname",
        "given name",
        "voornaam",
        "prénom",
        "nombre",
        "nome",
        "vorname",
      ],
      lastName: [
        "last name",
        "lastname",
        "lname",
        "surname",
        "family name",
        "achternaam",
        "nom de famille",
        "apellido",
        "sobrenome",
        "nachname",
      ],
      email: [
        "email",
        "e-mail",
        "email address",
        "email id",
        "mail",
        "e-mailadres",
        "courriel",
        "correo",
        "e-mail",
      ],
      phone: [
        "phone",
        "telephone",
        "mobile",
        "cell",
        "number",
        "telefoon",
        "téléphone",
        "teléfono",
        "telefone",
      ],
      address: [
        "address",
        "street",
        "location",
        "residence",
        "adres",
        "adresse",
        "dirección",
        "endereço",
      ],
      city: ["city", "town", "plaats", "ville", "ciudad", "cidade"],
      zipCode: [
        "zip",
        "postal",
        "postcode",
        "zip code",
        "postal code",
        "postcode",
        "code postal",
        "código postal",
      ],
      country: ["country", "land", "pays", "país", "país"],
      linkedin: ["linkedin", "linkedin profile", "linkedin url"],
      website: ["website", "portfolio", "personal website", "homepage"],
      coverLetter: [
        "cover letter",
        "motivation",
        "why",
        "message",
        "motivatiebrief",
        "lettre de motivation",
        "carta de presentación",
      ],
      experience: [
        "experience",
        "years",
        "ervaring",
        "expérience",
        "experiencia",
      ],
      salary: [
        "salary",
        "compensation",
        "expected salary",
        "salaris",
        "salaire",
        "salario",
      ],
    };
  }

  async fillForm(options = {}) {
    const { platform, formContext, customMappings = {} } = options;

    // Merge custom mappings with default ones
    const mappings = { ...this.fieldMappings, ...customMappings };

    let fieldsFound = 0;
    let fieldsFilled = 0;

    try {
      // Get all form elements
      const formElements = document.querySelectorAll("input, textarea, select");

      for (const element of formElements) {
        // Skip if element is hidden or disabled
        if (element.type === "hidden" || element.disabled || element.readOnly) {
          continue;
        }

        const fieldInfo = this.identifyField(element, mappings);

        if (fieldInfo.type && this.preferences[fieldInfo.type]) {
          fieldsFound++;

          const filled = await this.fillField(
            element,
            fieldInfo.type,
            fieldInfo.context
          );
          if (filled) {
            fieldsFilled++;
          }
        }
      }

      // Handle platform-specific form filling
      if (platform) {
        const platformSpecific = await this.fillPlatformSpecificFields(
          platform
        );
        fieldsFilled += platformSpecific.filled;
      }

      return {
        success: true,
        fieldsFound,
        fieldsFilled,
        fillRate:
          fieldsFound > 0 ? ((fieldsFilled / fieldsFound) * 100).toFixed(1) : 0,
      };
    } catch (error) {
      console.error("Error filling form:", error);
      return {
        success: false,
        error: error.message,
        fieldsFound,
        fieldsFilled,
      };
    }
  }

  identifyField(element, mappings) {
    const attributes = [
      element.name?.toLowerCase() || "",
      element.id?.toLowerCase() || "",
      element.placeholder?.toLowerCase() || "",
      element.className?.toLowerCase() || "",
      element.getAttribute("data-testid")?.toLowerCase() || "",
      element.getAttribute("aria-label")?.toLowerCase() || "",
    ].join(" ");

    // Check label text
    const label =
      element.closest("label")?.textContent?.toLowerCase() ||
      document
        .querySelector(`label[for="${element.id}"]`)
        ?.textContent?.toLowerCase() ||
      "";

    const fieldText = `${attributes} ${label}`.toLowerCase();

    // Find matching field type
    for (const [fieldType, keywords] of Object.entries(mappings)) {
      for (const keyword of keywords) {
        if (fieldText.includes(keyword.toLowerCase())) {
          return {
            type: fieldType,
            context: {
              element: element.tagName,
              type: element.type,
              confidence: this.calculateConfidence(fieldText, keyword),
            },
          };
        }
      }
    }

    return { type: null, context: null };
  }

  calculateConfidence(fieldText, keyword) {
    // Simple confidence scoring based on keyword match specificity
    if (fieldText === keyword) return 1.0;
    if (fieldText.startsWith(keyword) || fieldText.endsWith(keyword))
      return 0.9;
    if (fieldText.includes(keyword)) return 0.7;
    return 0.5;
  }

  async fillField(element, fieldType, context) {
    try {
      let value = this.preferences[fieldType];

      if (!value) return false;

      // Apply transformations based on field type and context
      value = this.transformValue(value, fieldType, context);

      // Special handling for different input types
      if (element.tagName === "SELECT") {
        return this.selectOption(element, value);
      } else if (element.type === "checkbox" || element.type === "radio") {
        return this.selectBooleanField(element, value);
      } else {
        return this.fillTextField(element, value);
      }
    } catch (error) {
      console.error(`Error filling field ${fieldType}:`, error);
      return false;
    }
  }

  transformValue(value, fieldType, context) {
    switch (fieldType) {
      case "phone":
        // Format phone number based on context
        return this.formatPhoneNumber(value, context);

      case "experience":
        // Extract years from experience string
        return this.extractYearsFromExperience(value);

      case "salary":
        // Format salary
        return this.formatSalary(value);

      default:
        return value;
    }
  }

  formatPhoneNumber(phone, context) {
    // Remove all non-digits
    const digits = phone.replace(/\D/g, "");

    // Format based on length and context
    if (digits.length === 10) {
      return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
    }
    return phone; // Return original if can't format
  }

  extractYearsFromExperience(experience) {
    // Extract number from experience string like "5 years" or "2+ years"
    const match = experience.match(/(\d+)/);
    return match ? match[1] : experience;
  }

  formatSalary(salary) {
    // Remove currency symbols and format
    return salary.replace(/[^\d]/g, "");
  }

  selectOption(selectElement, value) {
    const options = Array.from(selectElement.options);

    // Try exact match first
    let option = options.find(
      (opt) =>
        opt.value.toLowerCase() === value.toLowerCase() ||
        opt.textContent.toLowerCase() === value.toLowerCase()
    );

    // Try partial match
    if (!option) {
      option = options.find(
        (opt) =>
          opt.value.toLowerCase().includes(value.toLowerCase()) ||
          opt.textContent.toLowerCase().includes(value.toLowerCase())
      );
    }

    if (option) {
      selectElement.value = option.value;
      selectElement.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    }

    return false;
  }

  selectBooleanField(element, value) {
    // Handle boolean-like values
    const booleanValue = this.parseBooleanValue(value);

    if (typeof booleanValue === "boolean") {
      element.checked = booleanValue;
      element.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    }

    return false;
  }

  parseBooleanValue(value) {
    if (typeof value === "boolean") return value;

    const stringValue = value.toString().toLowerCase();
    if (["yes", "true", "1", "y"].includes(stringValue)) return true;
    if (["no", "false", "0", "n"].includes(stringValue)) return false;

    return null;
  }

  fillTextField(element, value) {
    // Focus element first
    element.focus();

    // Clear existing value
    element.value = "";

    // Set new value
    element.value = value;

    // Dispatch events to trigger validation
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    element.dispatchEvent(new Event("blur", { bubbles: true }));

    return true;
  }

  async fillPlatformSpecificFields(platform) {
    let filled = 0;

    switch (platform) {
      case "linkedin":
        filled += await this.fillLinkedInSpecific();
        break;
      case "indeed":
        filled += await this.fillIndeedSpecific();
        break;
      case "workday":
        filled += await this.fillWorkdaySpecific();
        break;
    }

    return { filled };
  }

  async fillLinkedInSpecific() {
    let filled = 0;

    // Handle LinkedIn-specific fields
    const linkedinFields = [
      {
        selector: 'input[id*="phoneNumber"]',
        value: this.preferences.phone,
      },
      {
        selector: 'textarea[id*="coverLetter"]',
        value: this.preferences.coverLetter,
      },
    ];

    for (const field of linkedinFields) {
      const element = document.querySelector(field.selector);
      if (element && field.value) {
        this.fillTextField(element, field.value);
        filled++;
      }
    }

    return filled;
  }

  async fillIndeedSpecific() {
    let filled = 0;

    // Handle Indeed-specific patterns
    const indeedPatterns = [
      {
        pattern: /are you authorized to work/i,
        value: this.preferences.workAuthorization || "yes",
      },
      {
        pattern: /require visa sponsorship/i,
        value: this.preferences.visaSponsorship || "no",
      },
    ];

    const textElements = document.querySelectorAll("label, span, div");

    for (const element of textElements) {
      const text = element.textContent;

      for (const pattern of indeedPatterns) {
        if (pattern.pattern.test(text)) {
          const input =
            element.querySelector("input") ||
            element.parentElement.querySelector("input");

          if (input && pattern.value) {
            if (input.type === "radio") {
              const radioValue = pattern.value.toLowerCase();
              const radioButton = document.querySelector(
                `input[name="${input.name}"][value*="${radioValue}"]`
              );
              if (radioButton) {
                radioButton.checked = true;
                radioButton.dispatchEvent(
                  new Event("change", { bubbles: true })
                );
                filled++;
              }
            }
          }
        }
      }
    }

    return filled;
  }

  async fillWorkdaySpecific() {
    let filled = 0;

    // Handle Workday's data-automation-id attributes
    const workdayFields = [
      {
        selector: '[data-automation-id*="firstName"]',
        value: this.preferences.firstName,
      },
      {
        selector: '[data-automation-id*="lastName"]',
        value: this.preferences.lastName,
      },
      {
        selector: '[data-automation-id*="email"]',
        value: this.preferences.email,
      },
      {
        selector: '[data-automation-id*="phone"]',
        value: this.preferences.phone,
      },
    ];

    for (const field of workdayFields) {
      const element = document.querySelector(field.selector);
      if (element && field.value) {
        const input = element.querySelector("input") || element;
        if (input.tagName === "INPUT") {
          this.fillTextField(input, field.value);
          filled++;
        }
      }
    }

    return filled;
  }
}
