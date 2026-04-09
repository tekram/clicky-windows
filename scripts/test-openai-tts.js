const fs = require("fs");
const path = require("path");
const os = require("os");
const { exec } = require("child_process");

const settings = JSON.parse(
  fs.readFileSync(
    path.join(process.env.APPDATA, "clicky-windows", "settings.json"),
    "utf-8"
  )
);

async function main() {
  console.log("1. Fetching audio from OpenAI TTS...");
  const response = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${settings.openaiApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "tts-1",
      input: "Hello! This is Clicky using OpenAI text to speech.",
      voice: settings.openaiTtsVoice || "alloy",
      response_format: "mp3",
    }),
  });

  if (!response.ok) {
    console.error("API FAIL:", response.status, await response.text());
    process.exit(1);
  }

  const buf = Buffer.from(await response.arrayBuffer());
  console.log(`2. Got ${buf.length} bytes of audio`);

  const tmpFile = path.join(os.tmpdir(), "clicky-test-tts.mp3");
  fs.writeFileSync(tmpFile, buf);
  console.log(`3. Saved to ${tmpFile}`);

  console.log("4. Playing via PowerShell MediaPlayer...");
  const psCmd = [
    "Add-Type -AssemblyName presentationCore",
    "$p = New-Object System.Windows.Media.MediaPlayer",
    `$p.Open([Uri]'${tmpFile}')`,
    "$p.Play()",
    "Start-Sleep -Seconds 5",
    "$p.Close()",
  ].join("; ");

  exec(`powershell -Command "${psCmd}"`, { timeout: 15000 }, (err) => {
    if (err) {
      console.error("Play error:", err.message);
    } else {
      console.log("5. Done playing!");
    }
    try { fs.unlinkSync(tmpFile); } catch {}
  });
}

main();
