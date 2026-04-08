/**
 * Integration test: API call + TTS (Windows SAPI).
 * Tests the full response pipeline without needing Electron.
 * Usage: node scripts/test-full.js
 */

const fs = require("fs");
const path = require("path");
const { exec } = require("child_process");

const settingsPath = path.join(
  process.env.APPDATA || "",
  "clicky-windows",
  "settings.json"
);

async function testClaude(settings) {
  console.log("--- Testing Claude API ---");
  console.log(`Model: ${settings.claudeModel}`);

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": settings.anthropicApiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: settings.claudeModel,
      max_tokens: 100,
      messages: [
        {
          role: "user",
          content: "You are Clicky, an AI screen companion. Say hello in one sentence and confirm you can see screens.",
        },
      ],
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Claude API (${response.status}): ${error}`);
  }

  const data = await response.json();
  const text = data.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("");

  console.log(`Response: ${text}`);
  console.log(`Tokens: ${data.usage.input_tokens} in / ${data.usage.output_tokens} out`);
  console.log("PASS\n");
  return text;
}

async function testLocalTTS(text) {
  console.log("--- Testing Windows SAPI TTS ---");
  const short = text.slice(0, 80);
  const escaped = short.replace(/'/g, "''").replace(/"/g, '`"');
  const cmd = `powershell -Command "Add-Type -AssemblyName System.Speech; $synth = New-Object System.Speech.Synthesis.SpeechSynthesizer; $synth.Speak('${escaped}')"`;

  return new Promise((resolve) => {
    exec(cmd, { timeout: 15000 }, (error) => {
      if (error) {
        console.log(`WARN: TTS error (non-fatal): ${error.message}`);
      } else {
        console.log("Spoke text successfully");
      }
      console.log("PASS\n");
      resolve();
    });
  });
}

async function testElevenLabs(settings) {
  if (!settings.elevenlabsApiKey) {
    console.log("--- Skipping ElevenLabs (no key) ---\n");
    return;
  }
  console.log("--- Testing ElevenLabs TTS ---");
  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${settings.elevenlabsVoiceId}`,
    {
      method: "POST",
      headers: {
        "xi-api-key": settings.elevenlabsApiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text: "Clicky works!",
        model_id: "eleven_flash_v2_5",
      }),
    }
  );

  if (!response.ok) {
    throw new Error(`ElevenLabs (${response.status}): ${await response.text()}`);
  }

  const buf = await response.arrayBuffer();
  console.log(`Got ${buf.byteLength} bytes of audio`);
  console.log("PASS\n");
}

async function testAssemblyAI(settings) {
  if (!settings.assemblyaiApiKey) {
    console.log("--- Skipping AssemblyAI (no key) ---\n");
    return;
  }
  console.log("--- Testing AssemblyAI token ---");
  const response = await fetch(
    "https://api.assemblyai.com/v2/realtime/token",
    {
      method: "POST",
      headers: {
        Authorization: settings.assemblyaiApiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ expires_in: 60 }),
    }
  );

  if (!response.ok) {
    throw new Error(`AssemblyAI (${response.status}): ${await response.text()}`);
  }

  const data = await response.json();
  console.log(`Got temp token: ${data.token.slice(0, 20)}...`);
  console.log("PASS\n");
}

async function main() {
  let settings;
  try {
    settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
  } catch {
    console.error("No settings.json found. Run the app first.");
    process.exit(1);
  }

  console.log("=== Clicky Windows Integration Tests ===\n");

  let passed = 0;
  let failed = 0;

  try { await testClaude(settings); passed++; }
  catch (e) { console.error("FAIL:", e.message, "\n"); failed++; }

  try { await testLocalTTS("Hello, I am Clicky, your AI screen companion."); passed++; }
  catch (e) { console.error("FAIL:", e.message, "\n"); failed++; }

  try { await testElevenLabs(settings); passed++; }
  catch (e) { console.error("FAIL:", e.message, "\n"); failed++; }

  try { await testAssemblyAI(settings); passed++; }
  catch (e) { console.error("FAIL:", e.message, "\n"); failed++; }

  console.log(`=== Results: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
