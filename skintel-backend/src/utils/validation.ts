export const VALID_QUESTION_IDS = [
  'q_skin_concerns',
  'q_skin_sensitivity',
  'q_skin_type',
  'q_goal',
  'q_profile_gender',
  'q_age',
  'q_profile_ethnicity',
  'q_time_spent_outdoors',
  'q_profile_sun_exposure',
  'q_profile_weather_conditions',
  'q_regime_product',
  'q_medical_conditions',
  'q_hormone_factors',
  'q_face_photo_front',
  'q_face_photo_left',
  'q_face_photo_right',
  'q_skin_closeup',
  'q_onboarding_complete',
  'q_onboarding_status'
] as const;

export const QUESTION_TYPES = {
  q_skin_concerns: 'multi',
  q_skin_sensitivity: 'single',
  q_skin_type: 'single',
  q_goal: 'multi',
  q_profile_gender: 'single',
  q_age: 'slider',
  q_profile_ethnicity: 'single',
  q_time_spent_outdoors: 'single',
  q_profile_sun_exposure: 'single',
  q_profile_weather_conditions: 'single',
  q_regime_product: 'multi',
  q_medical_conditions: 'multi',
  q_hormone_factors: 'multi',
  q_face_photo_front: 'image',
  q_face_photo_left: 'image',
  q_face_photo_right: 'image',
  q_skin_closeup: 'image',
  q_onboarding_complete: 'boolean',
  q_onboarding_status: 'derived'
} as const;

export const VALID_VALUES = {
  q_skin_concerns: [
    'acne', 'dark_spots', 'wrinkles', 'fine_lines', 'dryness', 'oiliness',
    'redness', 'sensitivity', 'dullness', 'aging', 'firmness', 'spots', 'melasma', 'uneven_tone',
    'hyperpigmentation', 'blackheads', 'whiteheads', 'scarring', 'pores_and_texture', 'no_major_concerns', 'dehydration', 'not_sure'
  ],
  q_skin_sensitivity: [
    'not_sensitive', 'mildly_sensitive', 'very_sensitive', 'not_sure'],
  q_skin_type: [
    'oily', 'dry', 'combination', 'normal', 'dehydrated', 'not_sure'
  ],
  q_goal: [
    'healthy_glow', 'clear_skin', 'hydration', 'not_sure', 'anti_aging', 'brightening', 'oil_control',
    'pore_minimizing', 'acne_treatment', 'even_skin_tone', 'sun_protection', 'clear_and_blemish_free', 'even_tone', 'smooth_texture', 'hydrated_and_plump'
  ],
  q_profile_gender: ['female', 'male', 'nonbinary', 'prefer_not_to_say', 'female_pregnant', 'keep_private'],
  q_profile_ethnicity: [
    'east_asian', 'black', 'hispanic', 'latino', 'white', 'caucasian', 'middle_eastern', 'native_american', 'south_asian', 'african_descent',
    'pacific_islander', 'mixed', 'south_east_asian', 'indigenious_australian', 'indigenous_australian', 'prefer_not_to_say', 'keep_private'
  ],
  q_time_spent_outdoors: ['0_to_1_hr', '1_to_3_hours', 'more_than_3_hours'],
  q_profile_sun_exposure: ['minimal', 'moderate', 'high', 'very_high', 'not_sure', '0_to_1_hr', '1_to_3_hours', 'more_than_3_hours'],
  q_profile_weather_conditions: ['hot', 'temperate', 'cold', 'minus_10_to_15_celsius', '6_to_29_celsius', '16_to_29_celsius', '30_celsius_and_above'],
  q_medical_conditions: [
    'eczema', 'psoriasis', 'rosacea', 'not_sure', 'contact_dermatitis', 'allergies', 'medications', 'breakouts', 'blackheads',
    'pcos', 'seborrheic_dermatitis', 'none', 'other', 'spots', 'melasma', 'uneven_tone', 'fragrances', 'preservatives', 'metals', 'hormonal_treatments'
  ],
  q_hormone_factors: [
    'pregnancy', 'menopause', 'pms', 'puberty', 'hormonal_acne',
    'birth_control', 'hormone_therapy', 'high_stress', 'none', 'not_sure', 'other'
  ]
} as const;

export const AGE_RANGE = { min: 13, max: 99 };

export const isValidQuestionId = (questionId: string): boolean => {
  return VALID_QUESTION_IDS.includes(questionId as any);
};

export const getExpectedType = (questionId: string): string | null => {
  return QUESTION_TYPES[questionId as keyof typeof QUESTION_TYPES] || null;
};

export const getValidValues = (questionId: string): readonly string[] | null => {
  return VALID_VALUES[questionId as keyof typeof VALID_VALUES] || null;
};

export const validateQuestionValue = (questionId: string, value: any): boolean => {
  const expectedType = getExpectedType(questionId);
  if (!expectedType) return false;

  switch (expectedType) {
    case 'single': {
      if (typeof value !== 'string') return false;
      const validValues = getValidValues(questionId);
      if (!validValues) return true;
      return validValues.some(v =>
        v.toLowerCase().replace(/[_\s]/g, '') === value.toLowerCase().replace(/[_\s]/g, '')
      );
    }
    case 'multi': {
      if (!Array.isArray(value)) return false;
      if (value.length === 0) return true;
      const validValues = getValidValues(questionId);
      if (!validValues) return value.every(v => typeof v === 'string');
      return value.every(v =>
        typeof v === 'string' && validValues.some(vv =>
          vv.toLowerCase().replace(/[_\s]/g, '') === v.toLowerCase().replace(/[_\s]/g, '')
        )
      );
    }
    case 'slider': {
      if (typeof value !== 'number') return false;
      if (questionId === 'q_age') {
        return value >= AGE_RANGE.min && value <= AGE_RANGE.max;
      }
      return Number.isInteger(value) && value >= 0;
    }
    case 'image': {
      if (typeof value !== 'object' || value === null) return false;
      if (typeof (value as any).image_id === 'string') {
        return (value as any).image_id.length > 0; // no more strict img_ requirement
      }
      if (typeof (value as any).image_url === 'string') {
        const url = (value as any).image_url;
        return url.startsWith('http://') || url.startsWith('https://') || url.startsWith('/');
      }
      return false;
    }
    case 'boolean': {
      return typeof value === 'boolean';
    }
    case 'derived': {
      return typeof value === 'string';
    }
    default:
      return false;
  }
};

/**
 * Convert underscore-separated value to readable label
 */
export const formatLabel = (value: string): string => {
  return value
    .split('_')
    .map(word => {
      if (/^\d+$/.test(word)) return word;
      if (['hrs', 'hr', 'hours', 'celsius', 'and', 'to', 'than'].includes(word.toLowerCase())) {
        return word.toLowerCase();
      }
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(' ')
    .replace(/\s+to\s+/gi, ' - ')
    .replace(/\s+and\s+/gi, ' & ')
    .replace(/\bless than\b/gi, '<')
    .replace(/\bgreater than\b/gi, '>');
};

/**
 * Get question text for onboarding questions
 */
export const getQuestionText = (questionId: string): string => {
  const questionTexts: Record<string, string> = {
    q_skin_concerns: 'What are your main skin concerns?',
    q_skin_sensitivity: 'How sensitive is your skin?',
    q_skin_type: 'What is your skin type?',
    q_goal: 'What are your skincare goals?',
    q_profile_gender: 'What is your gender?',
    q_age: 'What is your age?',
    q_profile_ethnicity: 'What is your ethnicity?',
    q_time_spent_outdoors: 'How much time do you spend outdoors?',
    q_profile_sun_exposure: 'How much sun exposure do you get?',
    q_profile_weather_conditions: 'What are your local weather conditions?',
    q_regime_product: 'What products are you currently using?',
    q_medical_conditions: 'Do you have any medical conditions?',
    q_hormone_factors: 'Are there any hormone-related factors?',
    q_face_photo_front: 'Front face photo',
    q_face_photo_left: 'Left face photo',
    q_face_photo_right: 'Right face photo',
    q_skin_closeup: 'Skin closeup photo',
    q_onboarding_complete: 'Onboarding completed',
    q_onboarding_status: 'Onboarding status'
  };
  return questionTexts[questionId] || questionId;
};