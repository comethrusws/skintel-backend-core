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

export interface UVIndexSummary {
  latitude: number;
  longitude: number;
  uvIndex: number;
  observedAt: string;
}

export async function fetchUVIndex(lat: number, lon: number): Promise<UVIndexSummary> {
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

    if (!response.ok) {
      throw new Error(`UV API error: ${response.status}`);
    }

    const data: UVIndexAPIResponse = await response.json();

    if (!data.ok) {
      throw new Error(data.message || 'UV API responded with error');
    }

    const uvReading = data.now || data.forecast?.[0];

    if (!uvReading) {
      throw new Error('UV API did not return a reading');
    }

    return {
      latitude: data.latitude ?? lat,
      longitude: data.longitude ?? lon,
      uvIndex: uvReading.uvi,
      observedAt: uvReading.time,
    };
  } catch (error) {
    clearTimeout(timeoutId);

    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('UV API request timeout');
    }

    throw error;
  }
}

export function describeUVRisk(uvIndex: number) {
  if (uvIndex < 3) {
    return {
      level: 'low',
      headline: 'UV is low',
      detail: 'Minimal risk today, but SPF is always a good habit.',
      recommendation: 'SPF 15+ if you plan to be outside for long periods.',
    };
  }

  if (uvIndex < 6) {
    return {
      level: 'moderate',
      headline: 'Moderate UV levels',
      detail: 'Protect your skin if you are outdoors for more than 30 minutes.',
      recommendation: 'Use SPF 30+, wear sunglasses, and find shade mid-day.',
    };
  }

  if (uvIndex < 8) {
    return {
      level: 'high',
      headline: 'High UV alert',
      detail: 'Skin damage can happen quickly today.',
      recommendation: 'SPF 50+, reapply every 2 hours, and wear a hat.',
    };
  }

  if (uvIndex < 11) {
    return {
      level: 'very_high',
      headline: 'Very high UV alert',
      detail: 'Limit direct sun between 10AM-4PM.',
      recommendation: 'Seek shade, wear protective clothing, and reapply SPF frequently.',
    };
  }

  return {
    level: 'extreme',
    headline: 'Extreme UV warning',
    detail: 'Unprotected skin can burn in minutes.',
    recommendation: 'Avoid sun exposure, cover up completely, SPF 50+, and sunglasses.',
  };
}

