import { Router, Request, Response } from 'express';
import { locationWeatherRequestSchema } from '../lib/validation';
import { LocationWeatherResponse } from '../types';

const router = Router();

interface WeatherAPIResponse {
  main: {
    temp: number;
  };
  name: string;
  sys: {
    country: string;
  };
}

function mapTemperatureToRange(tempCelsius: number): 'minus_10_to_15_celsius' | '6_to_29_celsius' | '30_celsius_and_above' {
  if (tempCelsius < 6) {
    return 'minus_10_to_15_celsius';  // Cold range (below 6°C)
  } else if (tempCelsius <= 29) {
    return '6_to_29_celsius';         // Temperate range (6-29°C)
  } else {
    return '30_celsius_and_above';    // Hot range (30°C+)
  }
}

async function fetchWeatherData(lat: number, lon: number): Promise<WeatherAPIResponse> {
  const apiKey = process.env.OPENWEATHER_API_KEY;
  
  if (!apiKey) {
    throw new Error('OpenWeatherMap API key not configured');
  }

  const url = `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${apiKey}&units=metric`;
  
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout
  
  try {
    const response = await fetch(url, { 
      signal: controller.signal,
      headers: {
        'User-Agent': 'Skintel-Backend/1.0'
      }
    });
    
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      if (response.status === 401) {
        throw new Error('Invalid OpenWeatherMap API key');
      } else if (response.status === 404) {
        throw new Error('Location not found');
      } else {
        throw new Error(`Weather API error: ${response.status}`);
      }
    }
    
    return await response.json();
  } catch (error) {
    clearTimeout(timeoutId);
    
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('Weather API request timeout');
    }
    
    throw error;
  }
}

/**
 * @swagger
 * /v1/location/weather:
 *   post:
 *     summary: Get weather condition range for coordinates
 *     description: Fetch current temperature for given coordinates and return appropriate weather condition range
 *     tags: [Location]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               latitude:
 *                 type: number
 *                 minimum: -90
 *                 maximum: 90
 *                 example: 40.7128
 *               longitude:
 *                 type: number
 *                 minimum: -180
 *                 maximum: 180
 *                 example: -74.0060
 *             required:
 *               - latitude
 *               - longitude
 *     responses:
 *       200:
 *         description: Weather condition range retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 latitude:
 *                   type: number
 *                 longitude:
 *                   type: number
 *                 temperature_celsius:
 *                   type: number
 *                 weather_condition_range:
 *                   type: string
 *                   enum: ['minus_10_to_15_celsius', '6_to_29_celsius', '30_celsius_and_above']
 *                 location_name:
 *                   type: string
 *       400:
 *         description: Invalid coordinates
 *       500:
 *         description: Weather API error
 */
router.post('/weather', async (req: Request, res: Response): Promise<void> => {
  try {
    const validationResult = locationWeatherRequestSchema.safeParse(req.body);
    
    if (!validationResult.success) {
      res.status(400).json({ 
        error: 'Invalid coordinates',
        details: validationResult.error.errors 
      });
      return;
    }

    const { latitude, longitude } = validationResult.data;

    const weatherData = await fetchWeatherData(latitude, longitude);
    
    const temperatureCelsius = Math.round(weatherData.main.temp * 10) / 10; // Round to 1 decimal
    const weatherConditionRange = mapTemperatureToRange(temperatureCelsius);
    
    const locationName = weatherData.sys.country 
      ? `${weatherData.name}, ${weatherData.sys.country}`
      : weatherData.name;

    const response: LocationWeatherResponse = {
      latitude,
      longitude,
      temperature_celsius: temperatureCelsius,
      weather_condition_range: weatherConditionRange,
      location_name: locationName
    };

    res.json(response);
  } catch (error) {
    console.error('Location weather error:', error);
    
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    if (errorMessage.includes('API key') || errorMessage.includes('not configured')) {
      res.status(500).json({ error: 'Weather service configuration error' });
    } else if (errorMessage.includes('not found')) {
      res.status(400).json({ error: 'Invalid coordinates - location not found' });
    } else if (errorMessage.includes('timeout')) {
      res.status(503).json({ error: 'Weather service temporarily unavailable' });
    } else {
      res.status(500).json({ error: 'Failed to fetch weather data' });
    }
  }
});

interface UVIndexAPIResponse {
  ok: boolean;
  latitude?: number;
  longitude?: number;
  now?: {
    time: string;
    uvi: number;
  };
  forecast?: Array<{
    time: string;
    uvi: number;
  }>;
  history?: Array<{
    time: string;
    uvi: number;
  }>;
  message?: string;
}

async function fetchUVIndex(lat: number, lon: number): Promise<UVIndexAPIResponse> {
  const url = `https://currentuvindex.com/api/v1/uvi?latitude=${lat}&longitude=${lon}`;
  
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);
  
  try {
    const response = await fetch(url, { 
      signal: controller.signal,
      headers: {
        'User-Agent': 'Skintel-Backend/1.0'
      }
    });
    
    clearTimeout(timeoutId);
    
    const data: UVIndexAPIResponse = await response.json();
    
    if (!data.ok) {
      throw new Error(data.message || 'UV API error');
    }
    
    return data;
  } catch (error) {
    clearTimeout(timeoutId);
    
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('UV API request timeout');
    }
    
    throw error;
  }
}

/**
 * @swagger
 * /v1/location/uv:
 *   get:
 *     summary: Get UV index for coordinates
 *     description: Fetch current UV index and forecast for given coordinates
 *     tags: [Location]
 *     parameters:
 *       - in: query
 *         name: latitude
 *         required: true
 *         schema:
 *           type: number
 *           minimum: -90
 *           maximum: 90
 *         example: 40.6943
 *       - in: query
 *         name: longitude
 *         required: true
 *         schema:
 *           type: number
 *           minimum: -180
 *           maximum: 180
 *         example: -73.9249
 *     responses:
 *       200:
 *         description: UV index retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 latitude:
 *                   type: number
 *                 longitude:
 *                   type: number
 *                 uv_index:
 *                   type: number
 *                   description: Current UV index value (0-11+)
 *       400:
 *         description: Invalid coordinates
 *       429:
 *         description: Rate limit exceeded
 *       503:
 *         description: UV service unavailable
 */
router.get('/uv', async (req: Request, res: Response): Promise<void> => {
  try {
    const latitude = parseFloat(req.query.latitude as string);
    const longitude = parseFloat(req.query.longitude as string);

    const validationResult = locationWeatherRequestSchema.safeParse({
      latitude,
      longitude
    });
    
    if (!validationResult.success) {
      res.status(400).json({ 
        error: 'Invalid coordinates',
        details: validationResult.error.errors 
      });
      return;
    }

    const uvData = await fetchUVIndex(latitude, longitude);

    res.json({
      uv_index: uvData.now?.uvi || 0,
      latitude: uvData.latitude,
      longitude: uvData.longitude,
    });
  } catch (error) {
    console.error('UV index error:', error);
    
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    if (errorMessage.includes('invalid latitude') || errorMessage.includes('invalid longitude')) {
      res.status(400).json({ error: 'Invalid coordinates provided' });
    } else if (errorMessage.includes('timeout')) {
      res.status(503).json({ error: 'UV service temporarily unavailable' });
    } else {
      res.status(503).json({ error: 'Failed to fetch UV index data' });
    }
  }
});

export { router as locationRouter };
