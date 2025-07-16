export class WellfoundFilters {
  constructor() {
    this.filterTypes = {
      location: {
        buttonSelector: '.styles_component__kQDF2',
        typingDelay: 300, 
        searchDelay: 2000, 
        createCustom: true
      },
      jobTitles: {
        buttonSelector: '.styles_inactive__aAc_w',
        typingDelay: 50, 
        searchDelay: 500, 
        createCustom: false
      }
    };
  }

  /**
   * Find and prepare the input field for a specific filter type
   * @param {string} filterType - 'location' or 'jobTitles'
   * @returns {HTMLElement|null} The input element or null if not found
   */
  async prepareFilter(filterType) {
    const config = this.filterTypes[filterType];
    if (!config) {
      console.error(`Invalid filter type: ${filterType}`);
      return null;
    }

    const button = document.querySelector(config.buttonSelector);
    let input;

    if (button) {
      button.click();
      console.log(`${filterType} button clicked!`);
      
      // Wait for the select to appear
      await this.delay(500);
      
      input = this.findInput();
    } else {
      console.log(`${filterType} button not found - looking for input directly`);
      input = this.findInput();
    }

    if (!input) {
      console.log(`${filterType} input not found`);
      return null;
    }

    console.log(`${filterType} input found:`, input);
    return input;
  }

  /**
   * Find the React Select input element
   * @returns {HTMLElement|null} The input element
   */
  findInput() {
    // Try to find input with various selectors
    const selectors = [
      '[id^="react-select-"][id$="-input"]',
      '.select__input input',
      'input[aria-autocomplete="list"]'
    ];

    for (const selector of selectors) {
      const input = document.querySelector(selector);
      if (input) return input;
    }

    return null;
  }

  /**
   * Clear all selected options from the multi-select
   * @param {string} filterType - Type of filter for logging
   */
  async clearAllSelectedOptions(filterType = 'filter') {
    let removeButtons = document.querySelectorAll('.select__multi-value__remove');
    console.log(`Found ${removeButtons.length} selected ${filterType} options to remove`);
    
    let count = 0;
    // Keep removing until no more remove buttons exist
    while (removeButtons.length > 0) {
      const removeButton = removeButtons[0]; // Always get the first one
      const optionText = removeButton.parentElement.querySelector('.select__multi-value__label')?.textContent || 'Unknown';
      console.log(`Removing ${filterType} option ${count + 1}: "${optionText}"`);
      removeButton.click();
      await this.delay(100);
      
      count++;
      // Re-query the DOM to get the updated list of remove buttons
      removeButtons = document.querySelectorAll('.select__multi-value__remove');
    }
    
    console.log(`All ${count} ${filterType} options cleared`);
  }

  /**
   * Properly set React Select input value
   * @param {HTMLElement} input - The input element
   * @param {string} value - The value to set
   */
  setReactInputValue(input, value) {
    const lastValue = input.value;
    input.value = value;

    const event = new Event('input', { bubbles: true });

    const tracker = input._valueTracker;
    if (tracker) {
      tracker.setValue(lastValue);
    }

    input.dispatchEvent(event);
  }

  /**
   * Type text into the input field with appropriate delays
   * @param {HTMLElement} input - The input element
   * @param {string} text - Text to type
   * @param {number} delay - Delay between characters
   */
  async typeText(input, text, delay = 50) {
    input.focus();
    input.click();

    // Clear the input first
    this.setReactInputValue(input, '');
    await this.delay(200);

    input.focus();

    let currentValue = '';
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      currentValue += char;

      this.setReactInputValue(input, currentValue);
      console.log(`Typed: "${currentValue}"`);

      await this.delay(delay);
    }
  }

  /**
   * Find and select an option from the dropdown
   * @param {string} searchText - Text that was typed
   * @param {boolean} createCustom - Whether to create custom option if not found
   * @returns {boolean} Whether an option was selected
   */
  async selectOption(searchText, createCustom = false) {
    const options = document.querySelectorAll('.select__option');
    console.log(`Dropdown shows ${options.length} options for "${searchText}"`);

    // Log all available options
    options.forEach((option, index) => {
      console.log(`Option ${index}: "${option.textContent.trim()}"`);
    });

    // Find matching option
    let foundOption = null;
    for (let option of options) {
      const optionText = option.textContent.trim();

      if (optionText.toLowerCase().includes(searchText.toLowerCase())) {
        foundOption = option;
        console.log(`Found matching option: "${optionText}"`);
        break;
      }
    }

    if (foundOption) {
      foundOption.click();
      console.log(`✓ Selected: ${foundOption.textContent.trim()}`);
      await this.delay(500);
      return true;
    }

    // If no match found and custom creation is enabled
    if (createCustom) {
      console.log(`No matching option found for "${searchText}" - creating custom option`);
      
      // Try to find input again in case it changed
      const input = this.findInput();
      if (input) {
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }));
        
        console.log(`✓ Created custom option: ${searchText}`);
        await this.delay(500);
        return true;
      }
    }

    console.log(`No matching option found for "${searchText}"`);
    return false;
  }

  /**
   * Add multiple options to a specific filter
   * @param {string} filterType - 'location' or 'jobTitles'
   * @param {string[]} options - Array of options to add
   * @param {boolean} clearFirst - Whether to clear existing options first
   */
  async addOptions(filterType, options, clearFirst = true) {
    const config = this.filterTypes[filterType];
    if (!config) {
      console.error(`Invalid filter type: ${filterType}`);
      return;
    }

    // Prepare the filter (find input, click button if needed)
    const input = await this.prepareFilter(filterType);
    if (!input) return;

    // Clear existing options if requested
    if (clearFirst) {
      await this.clearAllSelectedOptions(filterType);
      await this.delay(500);
    }

    // Add each option
    for (const option of options) {
      console.log(`Adding ${filterType} option: ${option}`);
      
      // Type the option
      await this.typeText(input, option, config.typingDelay);
      
      // Wait for dropdown to appear
      console.log(`Waiting for ${filterType} dropdown...`);
      await this.delay(config.searchDelay);
      
      // Select the option
      await this.selectOption(option, config.createCustom);
      
      // Wait between options
      await this.delay(500);
    }

    // Show final selections
    const selected = document.querySelectorAll('.select__multi-value__label');
    console.log(
      `Final ${filterType} selections:`,
      Array.from(selected).map(el => el.textContent)
    );
  }

  /**
   * Add job title filters
   * @param {string[]} jobTitles - Array of job titles to add
   * @param {boolean} clearFirst - Whether to clear existing selections
   */
  async addJobTitles(jobTitles, clearFirst = true) {
    await this.addOptions('jobTitles', jobTitles, clearFirst);
  }

  /**
   * Add location filters
   * @param {string[]} locations - Array of locations to add
   * @param {boolean} clearFirst - Whether to clear existing selections
   */
  async addLocations(locations, clearFirst = true) {
    await this.addOptions('location', locations, clearFirst);
  }

  /**
   * Utility method for delays
   * @param {number} ms - Milliseconds to wait
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get currently selected options
   * @returns {string[]} Array of selected option texts
   */
  getSelectedOptions() {
    const selected = document.querySelectorAll('.select__multi-value__label');
    return Array.from(selected).map(el => el.textContent);
  }
}