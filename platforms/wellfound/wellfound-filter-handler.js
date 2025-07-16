// Content script to apply Wellfound filters programmatically
export class WellfoundFilters {
  // Apply job type filters
  setJobTypes(types = ["full_time", "contract"]) {
    types.forEach((type) => {
      const checkbox = document.getElementById(`form-input--jobTypes--${type}`);
      if (checkbox && !checkbox.checked) {
        checkbox.click();
      }
    });
  }

  // Set salary range
  setSalary(minSalary, maxSalary) {
    const minInput = document.querySelector(
      'input[placeholder="Minimum salary"]'
    );
    const maxInput = document.querySelector(
      'input[placeholder="Maximum (optional)"]'
    );

    if (minInput) {
      minInput.value = minSalary;
      minInput.dispatchEvent(new Event("input", { bubbles: true }));
    }
    if (maxInput) {
      maxInput.value = maxSalary;
      maxInput.dispatchEvent(new Event("input", { bubbles: true }));
    }
  }

  // Add skills
  addSkills(skills = ["Python", "React.js", "Node.js"]) {
    const skillsInput = document.getElementById("skills-input");

    skills.forEach((skill) => {
      // Check if there's a recommended button for this skill
      const recommendedBtn = document.querySelector(
        `[data-test="AutocompleteWithRecommendationsField-RecommendedOptionButton--${skill}"]`
      );
      if (recommendedBtn) {
        recommendedBtn.click();
      } else {
        // Manually type and add the skill
        if (skillsInput) {
          skillsInput.value = skill;
          skillsInput.dispatchEvent(new Event("input", { bubbles: true }));
          // You might need to handle dropdown selection here
        }
      }
    });
  }

  // Add markets
  addMarkets(markets = ["Healthcare", "E-Commerce"]) {
    markets.forEach((market) => {
      const marketBtn = document.querySelector(
        `[data-test="AutocompleteWithRecommendationsField-RecommendedOptionButton--${market}"]`
      );
      if (marketBtn) {
        marketBtn.click();
      }
    });
  }

  // Set company sizes
  setCompanySizes(sizes = ["SIZE_11_50", "SIZE_51_200"]) {
    sizes.forEach((size) => {
      const checkbox = document.getElementById(
        `form-input--companySizes--${size}`
      );
      if (checkbox && !checkbox.checked) {
        checkbox.click();
      }
    });
  }

  // Set investment stages
  setInvestmentStages(stages = ["SEED_STAGE", "SERIES_A"]) {
    stages.forEach((stage) => {
      const checkbox = document.getElementById(
        `form-input--investmentStages--${stage}`
      );
      if (checkbox && !checkbox.checked) {
        checkbox.click();
      }
    });
  }

  // Set keywords
  setKeywords(included = [], excluded = []) {
    const includedInput = document.querySelector(
      '[data-test="KeywordsFilterField--keywords--input"]'
    );
    const excludedInput = document.querySelector(
      '[data-test="KeywordsFilterField--excludedKeywords--input"]'
    );

    if (includedInput && included.length > 0) {
      includedInput.value = included.join(", ");
      includedInput.dispatchEvent(new Event("input", { bubbles: true }));
    }

    if (excludedInput && excluded.length > 0) {
      excludedInput.value = excluded.join(", ");
      excludedInput.dispatchEvent(new Event("input", { bubbles: true }));
    }
  }

  // Toggle switches
  setRemoteOnly(enabled = true) {
    const toggle = document.getElementById("mostlyOrFullyRemote");
    if (toggle && toggle.checked !== enabled) {
      toggle.click();
    }
  }

  setHighlyResponsive(enabled = true) {
    const toggle = document.getElementById(
      "highlyResponsiveToIncomingApplications"
    );
    if (toggle && toggle.checked !== enabled) {
      toggle.click();
    }
  }

  setVisaSponsorship(enabled = true) {
    const toggle = document.getElementById("allowInternationalApplicants");
    if (toggle && toggle.checked !== enabled) {
      toggle.click();
    }
  }

  // Set experience range using slider
  setExperienceRange(min = 0, max = 5) {
    const sliders = document.querySelectorAll(".rheostat-handle");
    // Experience slider is typically the second one (after equity slider)
    if (sliders.length >= 4) {
      // 2 for equity, 2 for experience
      const minHandle = sliders[2];
      const maxHandle = sliders[3];

      // This is complex - you'd need to calculate positions and dispatch mouse events
      // For simplicity, you might want to use a library like Puppeteer for complex interactions
    }
  }

  // Apply all filters and view results
  applyFiltersAndSearch() {
    const viewResultsBtn = document.querySelector(
      '[data-test="SearchBar-ViewResultsButton"]'
    );
    if (viewResultsBtn) {
      viewResultsBtn.click();
    }
  }

  // Main method to apply a complete filter set
  applyFilterSet(filterConfig) {
    const {
      jobTypes,
      minSalary,
      maxSalary,
      skills,
      markets,
      companySizes,
      investmentStages,
      includedKeywords,
      excludedKeywords,
      remoteOnly,
      highlyResponsive,
      visaSponsorship,
    } = filterConfig;

    // Apply filters with delays to ensure DOM updates
    setTimeout(() => this.setJobTypes(jobTypes), 100);
    setTimeout(() => this.setSalary(minSalary, maxSalary), 200);
    setTimeout(() => this.addSkills(skills), 300);
    setTimeout(() => this.addMarkets(markets), 400);
    setTimeout(() => this.setCompanySizes(companySizes), 500);
    setTimeout(() => this.setInvestmentStages(investmentStages), 600);
    setTimeout(() => this.setKeywords(includedKeywords, excludedKeywords), 700);
    setTimeout(() => this.setRemoteOnly(remoteOnly), 800);
    setTimeout(() => this.setHighlyResponsive(highlyResponsive), 900);
    setTimeout(() => this.setVisaSponsorship(visaSponsorship), 1000);
    setTimeout(() => this.applyFiltersAndSearch(), 1500);
  }
}
