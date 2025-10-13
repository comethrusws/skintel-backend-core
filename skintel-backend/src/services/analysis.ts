import { prisma } from '../lib/prisma';
import type { Prisma } from '../generated/prisma';
import OpenAI from 'openai';

const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function getImageUrl(imageId: string): string {
  // temp implementation until S3  is wired
  if (imageId.startsWith('http://') || imageId.startsWith('https://')) return imageId;
  return `http://localhost:3000/images/${imageId}`;
}

function buildPrompt(): string {
  return (
    'You are a dermatologist assistant AI.\n' +
    'You will receive a face image.\n' +
    'and a json value contaiining the dlib benchmarks of the face image.\n' +
    'Your task:\n' +
    '1. Do skin analysis\n' +
    '2. Clearly mention the affected regions (e.g., "mild acne on the right cheek").\n' +
    '3. Give severity-based explanations (mild = easy care, severe = consider dermatologist).\n' +
    '\n' +
    'Example output:\n' +
    '{\n' +
    '  "issues": [\n' +
    '    {"type": "dark_circles", "region": "under_eye_left", "severity": "moderate"},\n' +
    '    {"type": "acne", "region": "cheek_right", "severity": "mild"}\n' +
    '  ]\n' +
    '}'
  );
}

export async function analyzeSkin(answerId: string) {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not set');
  }

  const record = await prisma.facialLandmarks.findUnique({
    where: { answerId },
    include: {
      answer: {
        select: { value: true }
      }
    }
  });

  if (!record) {
    throw new Error('Landmarks record not found');
  }

  const value = record.answer?.value as unknown as { image_id?: string; image_url?: string } | undefined;
  const imageUrl = typeof value?.image_url === 'string'
    ? value!.image_url
    : (value?.image_id ? getImageUrl(value.image_id) : undefined);
  if (!imageUrl) {
    throw new Error('Image URL/ID not found on answer value');
  }
  const landmarks = record.landmarks as unknown as object;

  const prompt = buildPrompt();

  const completion = await openai.chat.completions.create({
    model: OPENAI_MODEL,
    messages: [
      { role: 'system', content: prompt },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Here is the face image and the landmarks JSON.' },
          { type: 'image_url', image_url: { url: imageUrl } },
          { type: 'text', text: JSON.stringify(landmarks) }
        ]
      }
    ],
    temperature: 0.2,
    response_format: { type: 'json_object' }
  });

  const content = completion.choices?.[0]?.message?.content ?? '';

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    parsed = { raw: content };
  }

  try {
    await prisma.facialLandmarks.update({
      where: { answerId },
      data: ({ analysis: parsed as Prisma.InputJsonValue } as unknown) as any
    });
  } catch (e) {
    console.error('Failed to persist analysis JSON:', e);
  }

  return parsed;
}

export async function analyzeWithLandmarks(imageUrl: string, landmarks: object) {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not set');
  }

  const prompt = buildPrompt();

  const completion = await openai.chat.completions.create({
    model: OPENAI_MODEL,
    messages: [
      { role: 'system', content: prompt },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Here is the face image and the landmarks JSON.' },
          { type: 'image_url', image_url: { url: imageUrl } },
          { type: 'text', text: JSON.stringify(landmarks) }
        ]
      }
    ],
    temperature: 0.2,
    response_format: { type: 'json_object' }
  });

  const content = completion.choices?.[0]?.message?.content ?? '';

  try {
    return JSON.parse(content);
  } catch {
    return { raw: content };
  }
}

