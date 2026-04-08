/**
 * Quick test: verifies your Anthropic API key and model ID work.
 * Usage: node scripts/test-api.js
 * Reads key from settings.json automatically.
 */

const fs = require("fs");
const path = require("path");

const settingsPath = path.join(
  process.env.APPDATA || "",
  "clicky-windows",
  "settings.json"
);

async function main() {
  // Load settings
  let settings;
  try {
    settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
  } catch {
    console.error("No settings.json found at", settingsPath);
    console.error("Run the app first and save your API key.");
    process.exit(1);
  }

  const apiKey = settings.anthropicApiKey;
  const model = settings.claudeModel;

  if (!apiKey) {
    console.error("No API key configured. Open the app and add your key.");
    process.exit(1);
  }

  console.log(`Testing model: ${model}`);
  console.log(`API key: ${apiKey.slice(0, 12)}...${apiKey.slice(-4)}`);
  console.log();

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: 50,
        messages: [{ role: "user", content: "Say 'Clicky works!' and nothing else." }],
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error(`API ERROR (${response.status}):`);
      console.error(error);

      if (response.status === 404) {
        console.error("\nModel not found. Try one of these:");
        console.error("  - claude-sonnet-4-6");
        console.error("  - claude-opus-4-6");
        console.error("  - claude-sonnet-4-5-20250929");
        console.error("  - claude-haiku-4-5-20251001");
      }
      process.exit(1);
    }

    const data = await response.json();
    const text = data.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("");

    console.log("SUCCESS! Response:", text);
    console.log("\nModel:", data.model);
    console.log("Usage:", JSON.stringify(data.usage));
  } catch (err) {
    console.error("Network error:", err.message);
    process.exit(1);
  }
}

main();
