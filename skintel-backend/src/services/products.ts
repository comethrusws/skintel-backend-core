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
    '3. Determine the product category (cleanser, moisturizer, serum, face powder, sunscreen, etc.)\n' +
    '4. Identify the skin concerns this product targets\n' +
    '5. Provide visible usage instructions and explicitly extract "How it should be used" (usage_method)\n' +
    '6. Identify "Where it is used" (usage_location) e.g., Face, Eyes, Body\n' +
    '7. Note any warnings or special instructions\n' +
    '8. CAREFULLY SCAN FOR EXPIRY DATE:\n' +
    '   - Look for: MFG/EXP dates, "Best Before", "Use By", "Expiry", "EXP", batch codes with dates\n' +
    '   - Check ALL text on packaging: front, back, bottom, crimps, seals, embossed text, small print\n' +
    '   - Common locations: near barcode, bottom of container, on crimp/seal, printed on tube end\n' +
    '   - Support formats: MM/YYYY, DD/MM/YYYY, YYYY-MM-DD, DD-MM-YY, MMM YYYY, etc.\n' +
    '   - Look for PAO (Period After Opening) symbol with months (e.g., "12M", "24M")\n' +
    '   - If you find a date, convert to YYYY-MM-DD format. If only month/year, use first day of month\n' +
    '   - If NO date is visible anywhere, return null for "expiry_date"\n' +
    '   - DO NOT hallucinate or guess dates\n' +
    '   - Make sure the usage location is always in an array even if it can be used in one location as mentioned in the mentioned output example format.\n' +
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
    '  "usage_location": ["Face", "Eyes", "Body"],\n' +
    '  "warnings": ["For external use only", "Avoid contact with eyes"],\n' +
    '  "skin_types": ["dry", "sensitive", "normal"],\n' +
    '  "key_benefits": ["gentle cleansing", "moisture retention", "skin barrier support"]\n' +
    '}'
  );
}
async function generateUsageInstructions(productData: any): Promise<{ usage_instructions: string; usage_method: string }> {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not set');
  }

  const category = productData.category || 'skincare product';
  const productName = productData.product_name || 'product';
  const usageLocation = productData.usage_location || 'skin';

  const prompt = (
    `You are a skincare expert. Generate short, specific usage instructions for a ${category}.\n` +
    `Product: ${productName}\n` +
    `Application area: ${usageLocation}\n\n` +
    `Provide:\n` +
    `1. "usage_instructions": Step-by-step instructions (2-3 sentences, specific to this product type)\n` +
    `2. "usage_method": Specific application technique (1-2 sentences, actionable and detailed)\n\n` +
    `Be SPECIFIC and DETAILED. Examples:\n` +
    `- For face powder: "Apply with a fluffy brush in circular motions, building coverage gradually"\n` +
    `- For serum: "Dispense 2-3 drops onto fingertips and gently press into skin using upward motions"\n` +
    `- For cleanser: "Massage onto damp skin in circular motions for 30-60 seconds, then rinse"\n\n` +
    `Return ONLY valid JSON with keys: usage_instructions, usage_method`
  );

  const completion = await openai.chat.completions.create({
    model: OPENAI_MODEL,
    messages: [
      { role: 'system', content: 'You are a skincare expert providing specific, actionable usage instructions.' },
      { role: 'user', content: prompt }
    ],
    response_format: { type: 'json_object' }
  });

  const content = completion.choices?.[0]?.message?.content ?? '{}';

  try {
    const result = JSON.parse(content);
    return {
      usage_instructions: result.usage_instructions || `Apply to ${usageLocation} as needed`,
      usage_method: result.usage_method || `Apply evenly to ${usageLocation}`
    };
  } catch {
    return {
      usage_instructions: `Apply to ${usageLocation} as directed`,
      usage_method: `Apply evenly to ${usageLocation}`
    };
  }
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

  let productData: any;
  try {
    productData = JSON.parse(content);
  } catch {
    return { raw: content, error: 'Failed to parse AI response as JSON' };
  }

  const needsUsageInstructions = !productData.usage_instructions || productData.usage_instructions === null || productData.usage_instructions.trim() === '';
  const needsUsageMethod = !productData.usage_method || productData.usage_method === null || productData.usage_method.trim() === '';

  if (needsUsageInstructions || needsUsageMethod) {
    try {
      const generatedUsage = await generateUsageInstructions(productData);

      if (needsUsageInstructions) {
        productData.usage_instructions = generatedUsage.usage_instructions;
      }
      if (needsUsageMethod) {
        productData.usage_method = generatedUsage.usage_method;
      }
    } catch (error) {
      console.error('Failed to generate usage instructions:', error);
    }
  }

  // Ensure usage_location is an array
  if (productData.usage_location && !Array.isArray(productData.usage_location)) {
    productData.usage_location = [productData.usage_location];
  }

  return productData;
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
