import { Router, Response } from 'express';
import { authenticateUser, AuthenticatedRequest } from '../middleware/auth';
import { createProduct, getUserProducts, getProductById, deleteProduct, updateProductName } from '../services/products';
import { z } from 'zod';
import { maybePresignUrl } from '../lib/s3';

const router = Router();

const createProductSchema = z.object({
  image_urls: z.array(z.string().url('Must be a valid URL')).min(1, 'At least one image URL is required'),
});

const updateProductSchema = z.object({
  product_name: z.string().min(1, 'Product name is required').max(200, 'Product name too long'),
});

const productParamsSchema = z.object({
  productId: z.string().min(1, 'Product ID is required'),
});

/**
 * Helper to presign URLs inside product data
 */
async function presignProductData(productData: any) {
  if (!productData || typeof productData !== 'object') return productData;
  const newData = { ...productData };
  if (Array.isArray(newData.images)) {
    newData.images = await Promise.all(newData.images.map((url: string) => maybePresignUrl(url, 86400)));
  }

  if (newData.usage_location && typeof newData.usage_location === 'string') {
    newData.usage_location = [newData.usage_location];
  }

  return newData;
}

/**
 * @swagger
 * /v1/products:
 *   post:
 *     summary: Analyze and store a skincare product
 *     description: Upload product image URLs for AI analysis and storage. Supports multiple images per product (front, back, ingredients, etc.).
 *     tags: [Products]
 *     security:
 *       - BearerAuth: []
 *       - BasicAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               image_urls:
 *                 type: array
 *                 items:
 *                   type: string
 *                   format: uri
 *                 example: ["https://example.com/product-front.jpg", "https://example.com/product-back.jpg"]
 *                 description: Array of image URLs for the product (minimum 1 required)
 *             required:
 *               - image_urls
 *     responses:
 *       201:
 *         description: Product analyzed and stored successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id:
 *                   type: string
 *                 product_data:
 *                   type: object
 *                   description: Analyzed product data including product_name, brand, category, ingredients, expiry_date, usage_instructions, usage_method, usage_location, and other details.
 *                   example:
 *                     product_name: "CeraVe Foaming Facial Cleanser"
 *                     brand: "CeraVe"
 *                     category: "cleanser"
 *                     expiry_date: "2025-12-31"
 *                     ingredients: ["ceramides", "hyaluronic acid"]
 *                     usage_instructions: "Apply to wet face"
 *                     usage_method: "Massage gently onto wet skin"
 *                     usage_location: ["Face"]
 *       400:
 *         description: Invalid request data
 *       401:
 *         description: Authentication required
 *       500:
 *         description: Analysis failed
 *   get:
 *     summary: Get user's products
 *     description: Retrieve all products analyzed by the authenticated user
 *     tags: [Products]
 *     security:
 *       - BearerAuth: []
 *       - BasicAuth: []
 *     responses:
 *       200:
 *         description: Products retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 user_id:
 *                   type: string
 *                 products:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: string
 *                       image_url:
 *                         type: string
 *                       product_data:
 *                         type: object
 *                       created_at:
 *                         type: string
 *                         format: date-time
 *                       updated_at:
 *                         type: string
 *                         format: date-time
 *       401:
 *         description: Authentication required
 */

router.post('/', authenticateUser, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const validationResult = createProductSchema.safeParse(req.body);

    if (!validationResult.success) {
      res.status(400).json({
        error: 'Invalid request data',
        details: validationResult.error.errors
      });
      return;
    }

    const { image_urls } = validationResult.data;
    const userId = req.userId!;

    const result = await createProduct(userId, image_urls);

    const presignedImageUrl = await maybePresignUrl(result.imageUrl, 86400);
    const presignedProductData = await presignProductData(result.productData);

    res.status(201).json({
      id: result.id,
      image_url: presignedImageUrl,
      product_data: presignedProductData,
      created_at: result.createdAt.toISOString(),
      updated_at: result.updatedAt.toISOString(),
    });
  } catch (error) {
    console.error('Product creation error:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Product analysis failed'
    });
  }
});

router.get('/', authenticateUser, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const userId = req.userId!;
    const products = await getUserProducts(userId);

    const productsWithPresignedUrls = await Promise.all(
      products.map(async (product: any) => ({
        id: product.id,
        image_url: await maybePresignUrl(product.imageUrl, 86400),
        product_data: await presignProductData(product.productData),
        created_at: product.createdAt.toISOString(),
        updated_at: product.updatedAt.toISOString()
      }))
    );

    res.json({
      user_id: userId,
      products: productsWithPresignedUrls
    });
  } catch (error) {
    console.error('Get products error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * @swagger
 * /v1/products/{productId}:
 *   get:
 *     summary: Get specific product details
 *     description: Retrieve details for a specific product by ID
 *     tags: [Products]
 *     security:
 *       - BearerAuth: []
 *       - BasicAuth: []
 *     parameters:
 *       - in: path
 *         name: productId
 *         required: true
 *         schema:
 *           type: string
 *         description: Product ID
 *     responses:
 *       200:
 *         description: Product details retrieved successfully
 *       404:
 *         description: Product not found
 *       401:
 *         description: Authentication required
 *   put:
 *     summary: Update product name
 *     description: Update the name of a specific product
 *     tags: [Products]
 *     security:
 *       - BearerAuth: []
 *       - BasicAuth: []
 *     parameters:
 *       - in: path
 *         name: productId
 *         required: true
 *         schema:
 *           type: string
 *         description: Product ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               product_name:
 *                 type: string
 *                 example: "Updated Product Name"
 *                 minLength: 1
 *                 maxLength: 200
 *             required:
 *               - product_name
 *     responses:
 *       200:
 *         description: Product name updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id:
 *                   type: string
 *                 product_data:
 *                   type: object
 *       400:
 *         description: Invalid request data
 *       404:
 *         description: Product not found
 *       401:
 *         description: Authentication required
 *   delete:
 *     summary: Delete a product
 *     description: Remove a product from user's collection
 *     tags: [Products]
 *     security:
 *       - BearerAuth: []
 *       - BasicAuth: []
 *     parameters:
 *       - in: path
 *         name: productId
 *         required: true
 *         schema:
 *           type: string
 *         description: Product ID
 *     responses:
 *       200:
 *         description: Product deleted successfully
 *       404:
 *         description: Product not found
 *       401:
 *         description: Authentication required
 */

router.get('/:productId', authenticateUser, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const validationResult = productParamsSchema.safeParse(req.params);

    if (!validationResult.success) {
      res.status(400).json({
        error: 'Invalid product ID',
        details: validationResult.error.errors
      });
      return;
    }

    const { productId } = validationResult.data;
    const userId = req.userId!;

    const product = await getProductById(productId, userId);

    if (!product) {
      res.status(404).json({ error: 'Product not found' });
      return;
    }

    const presignedImageUrl = await maybePresignUrl(product.imageUrl, 86400);
    const presignedProductData = await presignProductData(product.productData);

    res.json({
      id: product.id,
      image_url: presignedImageUrl,
      product_data: presignedProductData,
      created_at: product.createdAt.toISOString(),
      updated_at: product.updatedAt.toISOString(),
    });
  } catch (error) {
    console.error('Get product error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/:productId', authenticateUser, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const paramsValidation = productParamsSchema.safeParse(req.params);
    const bodyValidation = updateProductSchema.safeParse(req.body);

    if (!paramsValidation.success) {
      res.status(400).json({
        error: 'Invalid product ID',
        details: paramsValidation.error.errors
      });
      return;
    }

    if (!bodyValidation.success) {
      res.status(400).json({
        error: 'Invalid request data',
        details: bodyValidation.error.errors
      });
      return;
    }

    const { productId } = paramsValidation.data;
    const { product_name } = bodyValidation.data;
    const userId = req.userId!;

    const result = await updateProductName(productId, userId, product_name);

    if (!result) {
      res.status(404).json({ error: 'Product not found' });
      return;
    }

    const presignedImageUrl = await maybePresignUrl(result.imageUrl, 86400);
    const presignedProductData = await presignProductData(result.productData);

    res.json({
      id: result.id,
      image_url: presignedImageUrl,
      product_data: presignedProductData,
      created_at: result.createdAt.toISOString(),
      updated_at: result.updatedAt.toISOString(),
    });
  } catch (error) {
    console.error('Update product error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/:productId', authenticateUser, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const validationResult = productParamsSchema.safeParse(req.params);

    if (!validationResult.success) {
      res.status(400).json({
        error: 'Invalid product ID',
        details: validationResult.error.errors
      });
      return;
    }

    const { productId } = validationResult.data;
    const userId = req.userId!;

    const deleted = await deleteProduct(productId, userId);

    if (!deleted) {
      res.status(404).json({ error: 'Product not found or could not be deleted' });
      return;
    }

    res.json({ message: 'Product deleted successfully' });
  } catch (error) {
    console.error('Delete product error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export { router as productsRouter };
