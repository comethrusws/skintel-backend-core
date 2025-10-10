import { prisma } from '../lib/prisma';
import type { Prisma } from '../generated/prisma';

const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

function getImageUrl(imageId: string): string {
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

  const value = record.answer?.value as unknown as { image_id?: string } | undefined;
  const imageId = value?.image_id;
  if (!imageId) {
    throw new Error('Image ID not found on answer value');
  }

  const imageUrl = getImageUrl(imageId);
  const landmarks = record.landmarks as unknown as object;

  const prompt = buildPrompt();

  const body = {
    model: OPENAI_MODEL,
    messages: [
      {
        role: 'system',
        content: prompt
      },
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
  } as const;

  const response = await fetch(OPENAI_API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenAI error ${response.status}: ${text}`);
  }

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content ?? '';

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


