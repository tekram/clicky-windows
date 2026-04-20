/**
 * Build a RIFF/WAVE container for 16-bit signed PCM mono audio.
 *
 * Shared between the OpenAI Whisper upload path (src/main/audio.ts) and
 * the local whisper.cpp temp-file path (whisper-local.ts).
 */
export function pcmToWav(pcm: Buffer, sampleRate = 16000): Buffer {
  return Buffer.concat([buildWavHeader(pcm.length, sampleRate), pcm]);
}

export function buildWavHeader(dataSize: number, sampleRate = 16000): Buffer {
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;

  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36);
  header.writeUInt32LE(dataSize, 40);
  return header;
}
