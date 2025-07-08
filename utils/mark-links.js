export function markLinkAsColor(linkEl, color, customText) {
  try {
    if (!linkEl || !linkEl.parentElement) return;

    // Clean up any existing highlights
    const existingHighlight = linkEl.parentElement.querySelector(
      ".lever-result-highlight"
    );
    if (existingHighlight) {
      existingHighlight.remove();
    }

    // Create highlight container
    const highlight = document.createElement("div");
    highlight.className = "lever-result-highlight";
    highlight.style.cssText = `
        position: absolute;
        right: 0;
        top: 0;
        background-color: ${
          color === "green"
            ? "rgba(76, 175, 80, 0.9)"
            : color === "orange"
            ? "rgba(255, 152, 0, 0.9)"
            : color === "red"
            ? "rgba(244, 67, 54, 0.9)"
            : color === "blue"
            ? "rgba(33, 150, 243, 0.9)"
            : "rgba(0, 0, 0, 0.7)"
        };
        color: white;
        padding: 2px 8px;
        border-radius: 3px;
        font-size: 12px;
        font-weight: bold;
        z-index: 1000;
        box-shadow: 0 1px 3px rgba(0,0,0,0.3);
      `;

    // Set text based on color with clearer labels
    let statusText;
    if (customText) {
      statusText = customText;
    } else {
      statusText =
        color === "green"
          ? "In Progress"
          : color === "orange"
          ? "Completed"
          : color === "red"
          ? "Skipped"
          : color === "blue"
          ? "Next"
          : "Unknown";
    }
    highlight.textContent = statusText;

    // Apply colorful border to the parent element
    linkEl.parentElement.style.cssText = `
        position: relative;
        border: 3px solid ${
          color === "green"
            ? "#4CAF50"
            : color === "orange"
            ? "#FF9800"
            : color === "red"
            ? "#F44336"
            : color === "blue"
            ? "#2196F3"
            : "#000000"
        };
        border-radius: 4px;
        padding: 4px;
        margin: 4px 0;
        transition: all 0.3s ease;
      `;

    // Add highlight to the parent
    linkEl.parentElement.appendChild(highlight);

    // Make sure the link itself looks different
    linkEl.style.cssText = `
        font-weight: bold;
        text-decoration: none;
        color: ${
          color === "green"
            ? "#2E7D32"
            : color === "orange"
            ? "#E65100"
            : color === "red"
            ? "#B71C1C"
            : color === "blue"
            ? "#0D47A1"
            : ""
        };
      `;

    // Update position if the window resizes
    const updatePosition = () => {
      highlight.style.right = "0";
      highlight.style.top = "0";
    };

    window.addEventListener("resize", updatePosition);
  } catch (err) {
    this.log("Error marking link:", err);
  }
}
