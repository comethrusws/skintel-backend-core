import { prisma } from '../lib/prisma';
import type { Prisma } from '../generated/prisma';
import OpenAI from 'openai';
import { maybePresignUrl } from '../lib/s3';

const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function buildProductAnalysisPrompt(): string {
  return (
    'You are a skincare product expert AI.\n' +
    'You will receive an image of a skincare product.\n' +
    'Your task:\n' +
    '1. Identify the product name and brand\n' +
    '2. Extract all visible ingredients from the label\n' +
    '3. Determine the product category (cleanser, moisturizer, serum, etc.)\n' +
    '4. Identify the skin concerns this product targets\n' +
    '5. Provide usage instructions if visible\n' +
    '6. Note any warnings or special instructions\n' +
    '7. If the product image is in another landuage, translate it to English\n' +
    '\n' +
    'Example output:\n' +
    '{\n' +
    '  "product_name": "CeraVe Foaming Facial Cleanser",\n' +
    '  "brand": "CeraVe",\n' +
    '  "category": "cleanser",\n' +
    '  "ingredients": ["ceramides", "hyaluronic acid", "niacinamide"],\n' +
    '  "target_concerns": ["dryness", "sensitivity", "barrier repair"],\n' +
    '  "usage_instructions": "Apply to wet face, massage gently, rinse thoroughly",\n' +
    '  "warnings": ["For external use only", "Avoid contact with eyes"],\n' +
    '  "skin_types": ["dry", "sensitive", "normal"],\n' +
    '  "key_benefits": ["gentle cleansing", "moisture retention", "skin barrier support"]\n' +
    '}'
  );
}

export async function analyzeProduct(imageUrl: string): Promise<object> {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not set');
  }

  const prompt = buildProductAnalysisPrompt();
  const urlForOpenAI = await maybePresignUrl(imageUrl, 300);

  const completion = await openai.chat.completions.create({
    model: OPENAI_MODEL,
    messages: [
      { role: 'system', content: prompt },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Please analyze this skincare product image and extract all relevant information. Return your response as valid JSON.' },
          { type: 'image_url', image_url: { url: urlForOpenAI } }
        ]
      }
    ],
    temperature: 0.1,
    response_format: { type: 'json_object' }
  });

  const content = completion.choices?.[0]?.message?.content ?? '';

  try {
    return JSON.parse(content);
  } catch {
    return { raw: content, error: 'Failed to parse AI response as JSON' };
  }
}

export async function createProduct(userId: string, imageUrl: string): Promise<{ id: string; productData: object }> {
  const productData = await analyzeProduct(imageUrl);

  const product = await prisma.product.create({
    data: {
      userId,
      imageUrl,
      productData: productData as Prisma.InputJsonValue,
    },
  });

  return {
    id: product.id,
    productData: productData,
  };
}

export async function getUserProducts(userId: string) {
  return await prisma.product.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      imageUrl: true,
      productData: true,
      createdAt: true,
      updatedAt: true,
    },
  });
}

export async function getProductById(productId: string, userId: string) {
  return await prisma.product.findFirst({
    where: { 
      id: productId,
      userId 
    },
    select: {
      id: true,
      imageUrl: true,
      productData: true,
      createdAt: true,
      updatedAt: true,
    },
  });
}

export async function deleteProduct(productId: string, userId: string): Promise<boolean> {
  try {
    await prisma.product.deleteMany({
      where: { 
        id: productId,
        userId 
      },
    });
    return true;
  } catch (error) {
    console.error('Failed to delete product:', error);
    return false;
  }
}
