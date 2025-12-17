import { prisma } from '../lib/prisma';
import OpenAI from 'openai';
import { maybePresignUrl } from '../lib/s3';

const OPENAI_MODEL = process.env.OPENAI_MODEL_MINI || 'gpt-5-mini';
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function buildProductAnalysisPrompt(): string {
  return (
    'You are a skincare product expert AI.\n' +
    'You will receive an image of a skincare product.\n' +
    'Your task:\n' +
    '1. Identify the product name and brand (ensure brand is separate from product name)\n' +
    '2. Extract all visible ingredients from the label\n' +
    '3. Determine the product category (cleanser, moisturizer, serum, etc.)\n' +
    '4. Identify the skin concerns this product targets\n' +
    '5. Provide visible usage instructions and explicitly extract "How it should be used" (usage_method)\n' +
    '6. Identify "Where it is used" (usage_location) e.g., Face, Eyes, Body\n' +
    '7. Note any warnings or special instructions\n' +
    '8. Extract expiry date if visible. If NOT visible, return null for "expiry_date". Do not hallucinate a date.\n' +
    '9. If the product image is in another language, translate it to English\n' +
    '\n' +
    'Example output:\n' +
    '{\n' +
    '  "product_name": "CeraVe Foaming Facial Cleanser",\n' +
    '  "brand": "CeraVe",\n' +
    '  "expiry_date": "2027-04-12",\n' +
    '  "category": "cleanser",\n' +
    '  "ingredients": ["ceramides", "hyaluronic acid", "niacinamide"],\n' +
    '  "target_concerns": ["dryness", "sensitivity", "barrier repair"],\n' +
    '  "usage_instructions": "Apply to wet face, massage gently, rinse thoroughly",\n' +
    '  "usage_method": "Massage gently onto wet skin in a circular motion",\n' +
    '  "usage_location": "Face",\n' +
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
    response_format: { type: 'json_object' }
  });

  const content = completion.choices?.[0]?.message?.content ?? '';

  try {
    return JSON.parse(content);
  } catch {
    return { raw: content, error: 'Failed to parse AI response as JSON' };
  }
}

export async function createProduct(userId: string, imageUrls: string[]): Promise<{ id: string; imageUrl: string; productData: object; createdAt: Date; updatedAt: Date }> {
  const primaryImageUrl = imageUrls[0];

  const existingProduct = await prisma.product.findFirst({
    where: {
      userId,
      imageUrl: primaryImageUrl
    }
  });

  if (existingProduct) {
    return {
      id: existingProduct.id,
      imageUrl: existingProduct.imageUrl,
      productData: (existingProduct.productData as object) || {},
      createdAt: existingProduct.createdAt,
      updatedAt: existingProduct.updatedAt,
    };
  }

  const productData = await analyzeProduct(primaryImageUrl);

  const product = await prisma.product.create({
    data: {
      userId,
      imageUrl: primaryImageUrl,
      productData: {
        ...productData,
        images: imageUrls,
      },
    },
  });

  return {
    id: product.id,
    imageUrl: product.imageUrl,
    productData: (product.productData as object) || {},
    createdAt: product.createdAt,
    updatedAt: product.updatedAt,
  };
}

export async function updateProductName(productId: string, userId: string, name: string): Promise<{ id: string; imageUrl: string; productData: object; createdAt: Date; updatedAt: Date } | null> {
  try {
    const existingProduct = await prisma.product.findFirst({
      where: {
        id: productId,
        userId
      }
    });

    if (!existingProduct) {
      return null;
    }

    const currentProductData = existingProduct.productData as Record<string, any>;
    const updatedProductData = {
      ...currentProductData,
      product_name: name
    };

    const product = await prisma.product.update({
      where: { id: productId },
      data: {
        productData: updatedProductData,
      },
    });

    return {
      id: product.id,
      imageUrl: product.imageUrl,
      productData: (product.productData as object) || {},
      createdAt: product.createdAt,
      updatedAt: product.updatedAt,
    };
  } catch (error) {
    console.error('Failed to update product name:', error);
    return null;
  }
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
